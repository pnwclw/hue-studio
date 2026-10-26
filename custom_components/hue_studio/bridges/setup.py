"""Adding a Hue bridge from the panel.

Bridges on the network are found the way the native `hue` integration finds them: mDNS
(`_hue._tcp`) and, as a fallback, the Hue discovery service. A new bridge is linked by
driving the native integration's own config flow through HA's public flow API, so the
`hue` entry, its app key and its options are exactly what HA's integration page would
have made. Hue Studio uses every bridge of the native integration (connections.py), so
the new bridge shows up in the panel by itself.

A bridge on Wi-Fi (Bridge Pro) gets its network and password from the Hue app over
Bluetooth, which nothing but the Hue app can do. Once it is on the network it is found
and linked like a bridge on Ethernet.

The step ids and fields of the native flow (`init` with `id`, `manual` with `host`,
`link`) are the only thing used from the `hue` integration; anything else ends in
"unknown" and the panel points to HA's integration page.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass
import logging
from typing import Any

from aiohttp import ClientError
from aiohue.discovery import URL_NUPNP
from aiohue.util import normalize_bridge_id
from homeassistant.config_entries import (
    SIGNAL_CONFIG_ENTRY_CHANGED,
    SOURCE_USER,
    ConfigEntry,
    ConfigEntryChange,
)
from homeassistant.const import CONF_HOST
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResult, FlowResultType, UnknownFlow
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from ..const import HUE_DOMAIN
from ..core.connections import is_supported_hue_entry

_LOGGER = logging.getLogger(__name__)

HUE_SERVICE = "_hue._tcp.local."
# How long to wait for the button on the bridge, and how often to try meanwhile.
LINK_TIMEOUT = 60
LINK_RETRY = 2
DETAILS_TIMEOUT = 5
# Product names by model id (data, like aiohue's product_name).
MODELS = {"BSB001": "Hue Bridge", "BSB002": "Hue Bridge", "BSB003": "Hue Bridge Pro"}
# The first bridge (round, CLIP v1 only) cannot be used by Hue Studio.
UNSUPPORTED_MODELS = {"BSB001"}

# Steps of the native `hue` config flow (homeassistant/components/hue/config_flow.py).
HUE_STEP_INIT = "init"
HUE_STEP_MANUAL = "manual"
HUE_STEP_LINK = "link"
HUE_MANUAL_ID = "manual"


class LinkFailed(HomeAssistantError):
    """Linking a bridge ended without a bridge; `reason` is what the panel shows."""

    def __init__(self, reason: str) -> None:
        """Remember why (a key of the panel's `bridge_add.failed_*` strings)."""
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class FoundBridge:
    """A bridge answering on the network."""

    id: str
    host: str
    name: str
    model: str | None
    supported: bool


@callback
def async_track_hue_entries(
    hass: HomeAssistant, on_change: Callable[[], None]
) -> Callable[[], None]:
    """Call `on_change` when a native `hue` entry is added, removed or changed;
    returns the unsubscribe function."""

    @callback
    def changed(change: ConfigEntryChange, entry: ConfigEntry) -> None:
        if entry.domain == HUE_DOMAIN:
            on_change()

    return async_dispatcher_connect(hass, SIGNAL_CONFIG_ENTRY_CHANGED, changed)


async def async_bridge_details(hass: HomeAssistant, host: str) -> FoundBridge | None:
    """What a bridge tells anyone on the network (`/api/config` needs no key)."""
    session = async_get_clientsession(hass, verify_ssl=False)
    try:
        async with asyncio.timeout(DETAILS_TIMEOUT):
            async with session.get(f"http://{host}/api/config") as res:
                res.raise_for_status()
                data = await res.json(content_type=None)
    except ClientError, TimeoutError, ValueError:
        return None
    if not isinstance(data, dict) or "bridgeid" not in data:
        # Emulators answer here too, without a bridge id.
        return None
    model_id = data.get("modelid")
    return FoundBridge(
        id=normalize_bridge_id(data["bridgeid"]),
        host=host,
        name=data.get("name") or MODELS.get(model_id, "Hue Bridge"),
        model=MODELS.get(model_id),
        supported=model_id not in UNSUPPORTED_MODELS,
    )


async def _async_nupnp_hosts(hass: HomeAssistant) -> list[str]:
    """Addresses the Hue discovery service knows for this network (needs internet)."""
    session = async_get_clientsession(hass)
    try:
        async with asyncio.timeout(10):
            async with session.get(URL_NUPNP) as res:
                res.raise_for_status()
                items = await res.json(content_type=None)
    except ClientError, TimeoutError, ValueError:
        return []
    return [
        item["internalipaddress"]
        for item in items
        if isinstance(item, dict) and item.get("internalipaddress")
    ]


async def _async_watch_mdns(
    hass: HomeAssistant, on_host: Callable[[str], None]
) -> Callable[[], Awaitable[None]]:
    """Browse `_hue._tcp` with HA's shared zeroconf; returns the stop function."""
    # Imported here: zeroconf is an after-dependency, the panel works without it.
    from homeassistant.components import zeroconf
    from zeroconf import IPVersion, ServiceStateChange, Zeroconf
    from zeroconf.asyncio import AsyncServiceBrowser, AsyncServiceInfo

    aiozc = await zeroconf.async_get_async_instance(hass)

    async def resolve(name: str) -> None:
        info = AsyncServiceInfo(HUE_SERVICE, name)
        if not await info.async_request(aiozc.zeroconf, 3000):
            return
        for address in info.parsed_addresses(IPVersion.V4Only):
            on_host(address)
            return

    def on_change(
        # zeroconf calls handlers by keyword, with all four
        zeroconf: Zeroconf,
        service_type: str,
        name: str,
        state_change: ServiceStateChange,
    ) -> None:
        if state_change is not ServiceStateChange.Removed:
            hass.async_create_background_task(resolve(name), "hue_studio_mdns")

    browser = AsyncServiceBrowser(aiozc.zeroconf, HUE_SERVICE, handlers=[on_change])
    return browser.async_cancel


class BridgeDiscovery:
    """Bridges on the network while the panel's "Add a bridge" screen is open."""

    def __init__(self, hass: HomeAssistant, on_change: Callable[[], None]) -> None:
        """Nothing runs until `async_start`."""
        self.hass = hass
        self._on_change = on_change
        self._found: dict[str, FoundBridge] = {}
        self._hosts: set[str] = set()
        self._pending = 0
        self._nupnp_done = False
        self._stop_mdns: Callable[[], Awaitable[None]] | None = None
        self._tasks: set[asyncio.Task[None]] = set()

    async def async_start(self) -> None:
        """Browse mDNS and ask the discovery service once."""
        try:
            self._stop_mdns = await _async_watch_mdns(self.hass, self.async_add_host)
        except Exception as err:
            _LOGGER.debug("mDNS browsing for Hue bridges unavailable: %s", err)
        self._spawn(self._async_nupnp())

    async def async_stop(self) -> None:
        """Stop browsing and probing."""
        for task in self._tasks:
            task.cancel()
        if self._stop_mdns is not None:
            with suppress(Exception):
                await self._stop_mdns()
            self._stop_mdns = None

    @callback
    def async_add_host(self, host: str) -> None:
        """Ask a host that may be a bridge for its details (once per host)."""
        if host in self._hosts:
            return
        self._hosts.add(host)
        self._spawn(self._async_probe(host))

    def _spawn(self, coro: Awaitable[None]) -> None:
        task = self.hass.async_create_background_task(coro, "hue_studio_discovery")  # type: ignore[arg-type]
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _async_nupnp(self) -> None:
        for host in await _async_nupnp_hosts(self.hass):
            self.async_add_host(host)
        self._nupnp_done = True
        self._on_change()

    async def _async_probe(self, host: str) -> None:
        self._pending += 1
        self._on_change()
        try:
            found = await async_bridge_details(self.hass, host)
        finally:
            self._pending -= 1
        if found is not None:
            self._found[found.id] = found
        self._on_change()

    @callback
    def payload(self) -> dict[str, Any]:
        """{"searching": bool,
            "bridges": [{"id", "host", "name", "model", "supported"}]}
        Bridges the native integration has already (Hue Studio uses them all) are left
        out."""
        known = {
            normalize_bridge_id(entry.unique_id)
            for entry in self.hass.config_entries.async_entries(HUE_DOMAIN)
            if entry.unique_id
        }
        return {
            "searching": self._pending > 0 or not self._nupnp_done,
            "bridges": [
                {
                    "id": found.id,
                    "host": found.host,
                    "name": found.name,
                    "model": found.model,
                    "supported": found.supported,
                }
                for found in sorted(self._found.values(), key=lambda f: (f.name, f.id))
                if found.id not in known
            ],
        }


def _abort_flow(hass: HomeAssistant, flow_id: str) -> None:
    with suppress(UnknownFlow):
        hass.config_entries.flow.async_abort(flow_id)


@callback
def _hue_entry_by_host(hass: HomeAssistant, host: str) -> ConfigEntry | None:
    return next(
        (
            entry
            for entry in hass.config_entries.async_entries(HUE_DOMAIN)
            if entry.data.get(CONF_HOST) == host
        ),
        None,
    )


async def _async_link_flow(
    hass: HomeAssistant, host: str | None, bridge_id: str | None
) -> tuple[str, bool]:
    """A native `hue` flow waiting at its link step: (flow id, started by us).

    A flow HA started when it discovered the bridge is reused (and left alone if the
    user gives up).
    """
    if bridge_id:
        for flow in hass.config_entries.flow.async_progress_by_handler(
            HUE_DOMAIN, match_context={"unique_id": normalize_bridge_id(bridge_id)}
        ):
            if flow.get("step_id") == HUE_STEP_LINK:
                return flow["flow_id"], False
    if not host:
        raise LinkFailed("not_found")
    if _hue_entry_by_host(hass, host) is not None:
        raise LinkFailed("already_added")

    result: FlowResult = await hass.config_entries.flow.async_init(
        HUE_DOMAIN, context={"source": SOURCE_USER}
    )
    flow_id = result.get("flow_id")
    try:
        if result["type"] is FlowResultType.FORM and result["step_id"] == HUE_STEP_INIT:
            result = await hass.config_entries.flow.async_configure(
                result["flow_id"], {"id": HUE_MANUAL_ID}
            )
        if (
            result["type"] is FlowResultType.FORM
            and result["step_id"] == HUE_STEP_MANUAL
        ):
            result = await hass.config_entries.flow.async_configure(
                result["flow_id"], {CONF_HOST: host}
            )
    except asyncio.CancelledError:
        if flow_id:
            _abort_flow(hass, flow_id)
        raise
    except Exception as err:
        _LOGGER.debug("Hue bridge at %s did not answer: %s", host, err)
        if flow_id:
            _abort_flow(hass, flow_id)
        raise LinkFailed("cannot_connect") from err
    if result["type"] is FlowResultType.ABORT:
        reason = result.get("reason")
        if reason == "already_configured" and (entry := _hue_entry_by_host(hass, host)):
            return entry
        raise LinkFailed(
            "cannot_connect"
            if reason in ("cannot_connect", "invalid_host")
            else "unknown"
        )
    if result["type"] is not FlowResultType.FORM or result["step_id"] != HUE_STEP_LINK:
        if flow_id:
            _abort_flow(hass, flow_id)
        raise LinkFailed("unknown")
    return result["flow_id"], True


async def async_link(
    hass: HomeAssistant,
    on_step: Callable[[dict[str, Any]], None],
    *,
    host: str | None = None,
    bridge_id: str | None = None,
) -> ConfigEntry:
    """Link a bridge with HA (the native `hue` flow); returns the new `hue` entry.

    `on_step` hears {"step": "connecting"}, then {"step": "press", "timeout": s} while
    waiting for the bridge's button. Raises LinkFailed; cancelling gives up (a flow we
    started is aborted, one HA discovered stays on HA's integration page).
    """
    on_step({"step": "connecting"})
    flow_id, started = await _async_link_flow(hass, host, bridge_id)
    entry = await _async_press_link(hass, on_step, flow_id, started)
    if not is_supported_hue_entry(entry):
        # HA has it now, but it only talks the old API (the first, round bridge).
        raise LinkFailed("unsupported")
    return entry


async def _async_press_link(
    hass: HomeAssistant,
    on_step: Callable[[dict[str, Any]], None],
    flow_id: str,
    started: bool,
) -> ConfigEntry:
    """Submit the link step until the button was pressed: the new `hue` entry."""
    on_step({"step": "press", "timeout": LINK_TIMEOUT})
    loop = asyncio.get_running_loop()
    deadline = loop.time() + LINK_TIMEOUT
    open_flow = started
    try:
        while True:
            result: FlowResult = await hass.config_entries.flow.async_configure(
                flow_id, {}
            )
            if result["type"] is FlowResultType.CREATE_ENTRY:
                open_flow = False
                return result["result"]
            if result["type"] is FlowResultType.ABORT:
                open_flow = False
                raise LinkFailed(
                    "cannot_connect"
                    if result.get("reason") == "cannot_connect"
                    else "unknown"
                )
            if result["type"] is not FlowResultType.FORM or (
                result["step_id"] != HUE_STEP_LINK
            ):
                raise LinkFailed("unknown")
            if loop.time() >= deadline:
                raise LinkFailed("timeout")
            await asyncio.sleep(LINK_RETRY)
    except UnknownFlow as err:
        # HA's integration page (or another panel) finished or dropped it meanwhile.
        open_flow = False
        raise LinkFailed("unknown") from err
    finally:
        if open_flow:
            _abort_flow(hass, flow_id)
