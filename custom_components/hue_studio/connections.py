"""The Hue Studio entry and its connections: one per bridge of the native `hue`.

There is one Hue Studio entry. It uses every bridge the native integration has (CLIP
v2): host and app key are read from that bridge's `hue` config entry, and the
connection follows the entry — it opens when the entry is loaded, closes when it is
unloaded or removed, and retries while the bridge does not answer. Each bridge is a
service device of the Hue Studio entry, linked to the native bridge device.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import logging
from typing import TYPE_CHECKING

from aiohttp import ClientError
from aiohue import HueBridgeV2, LinkButtonNotPressed, Unauthorized
from aiohue.errors import BridgeBusy
from aiohue.v2.controllers.events import EventType
from homeassistant.config_entries import (
    SIGNAL_CONFIG_ENTRY_CHANGED,
    ConfigEntry,
    ConfigEntryChange,
    ConfigEntryState,
)
from homeassistant.const import CONF_HOST
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.dispatcher import (
    async_dispatcher_connect,
    async_dispatcher_send,
)

from .const import (
    CONF_KIND,
    DOMAIN,
    HUE_CONF_API_KEY,
    HUE_CONF_API_VERSION,
    HUE_DOMAIN,
    KIND_STUDIO,
    SIGNAL_BRIDGES_UPDATED,
    SIGNAL_ENTERTAINMENT_UPDATED,
)

if TYPE_CHECKING:
    from . import HueStudioConfigEntry

_LOGGER = logging.getLogger(__name__)

CONNECT_TIMEOUT = 10
# Seconds between attempts while a bridge does not answer: doubling up to the maximum.
RETRY_MIN = 15
RETRY_MAX = 300
# The panel's page of bridges and Sync Boxes; "Visit" on a device page opens the
# page of that bridge or box (`SETTINGS_URL/<its config entry id>`).
SETTINGS_URL = "homeassistant://hue/settings/bridges"


def is_studio(entry: ConfigEntry) -> bool:
    """Whether the entry is the Hue Studio entry (not a Sync Box)."""
    return entry.data.get(CONF_KIND) == KIND_STUDIO


@callback
def async_studio_entry(hass: HomeAssistant) -> HueStudioConfigEntry | None:
    """The Hue Studio entry, in whatever state, or None before it is added."""
    return next(
        (e for e in hass.config_entries.async_entries(DOMAIN) if is_studio(e)), None
    )


def is_supported_hue_entry(entry: ConfigEntry) -> bool:
    """An enabled native Hue entry that talks CLIP v2."""
    return (
        entry.domain == HUE_DOMAIN
        and entry.disabled_by is None
        and entry.unique_id is not None
        and entry.data.get(HUE_CONF_API_VERSION) == 2
    )


@callback
def async_supported_hue_entries(hass: HomeAssistant) -> list[ConfigEntry]:
    """Native Hue entries Hue Studio uses, loaded or not."""
    return [
        e
        for e in hass.config_entries.async_entries(HUE_DOMAIN)
        if is_supported_hue_entry(e)
    ]


class BridgeConnections:
    """The bridges of the Hue Studio entry, keyed by the id of their `hue` entry."""

    def __init__(self, hass: HomeAssistant, entry: HueStudioConfigEntry) -> None:
        """Nothing is connected until `async_start`."""
        self.hass = hass
        self.entry = entry
        self.bridges: dict[str, HueBridgeV2] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._unsubs: dict[str, Callable[[], None]] = {}
        self._failing: set[str] = set()
        self._stop: Callable[[], None] | None = None

    async def async_start(self) -> None:
        """Connect to the bridges of loaded `hue` entries and follow those entries.

        Every loaded bridge is tried once before setup goes on (so services work at
        once); one that does not answer is retried in the background.
        """
        hue_entries = async_supported_hue_entries(self.hass)
        self._async_remove_stale_devices({e.unique_id for e in hue_entries})
        for hue_entry in hue_entries:
            self._async_device(hue_entry)
        # Followed from now on: an entry loaded while the others connect counts too.
        self._stop = async_dispatcher_connect(
            self.hass, SIGNAL_CONFIG_ENTRY_CHANGED, self._async_entry_changed
        )
        loaded = [e for e in hue_entries if e.state is ConfigEntryState.LOADED]
        done = await asyncio.gather(*(self._async_try(e) for e in loaded))
        for hue_entry, ok in zip(loaded, done, strict=True):
            if not ok:
                self._async_retry_later(hue_entry.entry_id, wait=True)

    async def async_stop(self) -> None:
        """Stop following `hue` entries and close every connection."""
        if self._stop is not None:
            self._stop()
            self._stop = None
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for hue_entry_id in list(self.bridges):
            await self._async_drop(hue_entry_id, notify=False)

    # ---- connecting ----

    def _wanted(self, hue_entry_id: str) -> ConfigEntry | None:
        """The `hue` entry if its bridge should be connected now."""
        hue_entry = self.hass.config_entries.async_get_entry(hue_entry_id)
        if (
            hue_entry is None
            or not is_supported_hue_entry(hue_entry)
            or hue_entry.state is not ConfigEntryState.LOADED
        ):
            return None
        return hue_entry

    async def _async_try(self, hue_entry: ConfigEntry) -> bool:
        """Connect once. False: try again later (the bridge did not answer)."""
        hue_entry_id = hue_entry.entry_id
        host: str = hue_entry.data[CONF_HOST]
        bridge = HueBridgeV2(host, hue_entry.data[HUE_CONF_API_KEY])
        connected = False
        try:
            async with asyncio.timeout(CONNECT_TIMEOUT):
                await bridge.initialize()
            connected = True
        except LinkButtonNotPressed, Unauthorized:
            # The native integration uses the same key: it is failing too, and
            # reloading it (after re-authenticating) brings us back.
            _LOGGER.error(
                "The Hue bridge %s rejected the app key of the Philips Hue integration",
                hue_entry.title,
            )
            return True
        except (TimeoutError, ClientError, BridgeBusy) as err:
            log = _LOGGER.debug if hue_entry_id in self._failing else _LOGGER.warning
            log(
                "Cannot connect to the Hue bridge at %s: %s",
                host,
                str(err) or type(err).__name__,
            )
            self._failing.add(hue_entry_id)
            return False
        finally:
            if not connected:
                await bridge.close()
        if self._wanted(hue_entry_id) is None or hue_entry_id in self.bridges:
            # Unloaded meanwhile, or connected by another attempt.
            await bridge.close()
            return True
        if hue_entry_id in self._failing:
            self._failing.discard(hue_entry_id)
            _LOGGER.info("Connected to the Hue bridge at %s", host)
        self._async_add(hue_entry, bridge)
        return True

    @callback
    def _async_retry_later(self, hue_entry_id: str, *, wait: bool) -> None:
        if hue_entry_id in self._tasks:
            return
        self._tasks[hue_entry_id] = self.entry.async_create_background_task(
            self.hass,
            self._async_keep_trying(hue_entry_id, wait=wait),
            f"hue_studio_connect_{hue_entry_id}",
        )

    async def _async_keep_trying(self, hue_entry_id: str, *, wait: bool) -> None:
        delay = RETRY_MIN
        try:
            while True:
                if wait:
                    await asyncio.sleep(delay)
                    delay = min(delay * 2, RETRY_MAX)
                wait = True
                if (hue_entry := self._wanted(hue_entry_id)) is None:
                    return
                if await self._async_try(hue_entry):
                    return
        finally:
            if self._tasks.get(hue_entry_id) is asyncio.current_task():
                del self._tasks[hue_entry_id]

    @callback
    def _async_add(self, hue_entry: ConfigEntry, bridge: HueBridgeV2) -> None:
        self.bridges[hue_entry.entry_id] = bridge

        @callback
        def on_entertainment(event_type: EventType, resource: object) -> None:
            # Streaming started/stopped: Sync Boxes and open panels update at once.
            async_dispatcher_send(self.hass, SIGNAL_ENTERTAINMENT_UPDATED)

        @callback
        def on_motion_area(event_type: EventType, resource: object) -> None:
            # A MotionAware area changed (in the Hue app too): the settings update.
            async_dispatcher_send(self.hass, SIGNAL_BRIDGES_UPDATED)

        unsubs = [bridge.config.entertainment_configuration.subscribe(on_entertainment)]
        areas = getattr(bridge.config, "motion_area_configuration", None)
        if areas is not None:
            unsubs.append(areas.subscribe(on_motion_area))

        def unsubscribe() -> None:
            for unsub in unsubs:
                unsub()

        self._unsubs[hue_entry.entry_id] = unsubscribe
        self._async_device(hue_entry, bridge)
        self._async_notify()

    @callback
    def _async_detach(self, hue_entry_id: str) -> HueBridgeV2 | None:
        """Forget a bridge at once (and stop trying to connect); closing is up to the
        caller, so a reload of the `hue` entry right after finds it gone."""
        if (task := self._tasks.pop(hue_entry_id, None)) is not None:
            task.cancel()
        self._failing.discard(hue_entry_id)
        if (unsub := self._unsubs.pop(hue_entry_id, None)) is not None:
            unsub()
        return self.bridges.pop(hue_entry_id, None)

    async def _async_drop(self, hue_entry_id: str, *, notify: bool = True) -> None:
        """Close the connection of a bridge (and stop trying to open it)."""
        if (bridge := self._async_detach(hue_entry_id)) is not None:
            if notify:
                self._async_notify()
            await bridge.close()

    @callback
    def _async_notify(self) -> None:
        # Open panels: bridges, Sync Boxes, entertainment areas and positions.
        async_dispatcher_send(self.hass, SIGNAL_BRIDGES_UPDATED)

    @callback
    def _async_entry_changed(
        self, change: ConfigEntryChange, entry: ConfigEntry
    ) -> None:
        """A `hue` entry was added, loaded, unloaded, changed or removed."""
        if entry.domain != HUE_DOMAIN or self.hass.is_stopping:
            # Shutting down: the connections close with the Hue Studio entry.
            return
        hue_entry_id = entry.entry_id
        if change is ConfigEntryChange.REMOVED:
            self._async_remove_device(entry.unique_id)
        elif is_supported_hue_entry(entry):
            self._async_device(entry, self.bridges.get(hue_entry_id))
        if self._wanted(hue_entry_id) is not None:
            if hue_entry_id not in self.bridges:
                self._async_retry_later(hue_entry_id, wait=False)
        elif (bridge := self._async_detach(hue_entry_id)) is not None:
            self._async_notify()
            self.entry.async_create_background_task(
                self.hass, bridge.close(), f"hue_studio_disconnect_{hue_entry_id}"
            )

    # ---- service devices ----

    @callback
    def _async_device(
        self, hue_entry: ConfigEntry, bridge: HueBridgeV2 | None = None
    ) -> None:
        """The bridge's service device: named like the `hue` entry; once connected,
        with the bridge's model and software, linked to the native bridge device."""
        assert hue_entry.unique_id is not None
        devices = dr.async_get(self.hass)
        facts: dict[str, str] = {}
        if bridge is not None and (device := bridge.config.bridge_device) is not None:
            product = device.product_data
            for key, value in (
                ("manufacturer", product.manufacturer_name),
                ("model", product.product_name),
                ("sw_version", product.software_version),
            ):
                if isinstance(value, str):
                    facts[key] = value
            native = devices.async_get_device_by_identifier(
                (HUE_DOMAIN, str(device.id)), hue_entry.entry_id
            )
            if native is not None:
                facts["via_device_id"] = native.id
        devices.async_get_or_create(
            config_entry_id=self.entry.entry_id,
            identifiers={(DOMAIN, hue_entry.unique_id)},
            entry_type=dr.DeviceEntryType.SERVICE,
            name=hue_entry.title,
            configuration_url=f"{SETTINGS_URL}/{hue_entry.entry_id}",
            **facts,  # type: ignore[arg-type]
        )

    @callback
    def _async_remove_device(self, bridge_id: str | None) -> None:
        devices = dr.async_get(self.hass)
        if bridge_id and (
            device := devices.async_get_device_by_identifier(
                (DOMAIN, bridge_id), self.entry.entry_id
            )
        ):
            devices.async_remove_device(device.id)

    @callback
    def _async_remove_stale_devices(self, bridge_ids: set[str | None]) -> None:
        """Devices of bridges the native integration no longer has."""
        devices = dr.async_get(self.hass)
        for device in dr.async_entries_for_config_entry(devices, self.entry.entry_id):
            ours = [i for i in device.identifiers if len(i) > 1 and i[0] == DOMAIN]
            if ours and not any(i[1] in bridge_ids for i in ours):
                devices.async_remove_device(device.id)
