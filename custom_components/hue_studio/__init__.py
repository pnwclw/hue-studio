"""Hue Studio: Hue-app-style light control on top of the native Hue integration.

Kinds of config entries: a Hue bridge (borrowed from the native `hue` entry) and a Hue
Play HDMI Sync Box — paired directly (with entities of its own), or used through the
HACS `huesyncbox` integration (its entities and service, nothing of our own).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import logging

from aiohttp import ClientError
from aiohue import HueBridgeV2, LinkButtonNotPressed, Unauthorized
from aiohue.errors import BridgeBusy
from aiohue.v2.controllers.events import EventType
from aiohuesyncbox import HueSyncBox, RequestError, Unauthorized as SyncBoxUnauthorized
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import CONF_ACCESS_TOKEN, CONF_HOST, Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import (
    ConfigEntryAuthFailed,
    ConfigEntryError,
    ConfigEntryNotReady,
)
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.typing import ConfigType

from .const import (
    CONF_BOX_ID,
    CONF_HUE_ENTRY_ID,
    CONF_KIND,
    CONF_REGISTRATION_ID,
    CONF_SYNC_ENTRY_ID,
    DOMAIN,
    HUE_CONF_API_KEY,
    KIND_SYNC_BOX,
    KIND_SYNC_BOX_LINK,
    SIGNAL_CONFIG_UPDATED,
    SIGNAL_ENTERTAINMENT_UPDATED,
    SYNC_BOX_INTEGRATION,
)
from .panel import async_register_panel, async_unregister_panel
from .services import async_setup_services
from .sync import SyncBoxCoordinator, async_track_entertainment
from .sync_link import SyncBoxLink
from .websocket import async_setup_websocket

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

CONNECT_TIMEOUT = 10

SYNC_BOX_PLATFORMS = [
    Platform.NUMBER,
    Platform.SELECT,
    Platform.SENSOR,
    Platform.SWITCH,
]


@dataclass
class HueStudioData:
    """Runtime data of a Hue Studio config entry (a bridge or a Sync Box)."""

    bridge: HueBridgeV2 | None = None
    sync: SyncBoxCoordinator | None = None
    link: SyncBoxLink | None = None


type HueStudioConfigEntry = ConfigEntry[HueStudioData]


def is_sync_box(entry: ConfigEntry) -> bool:
    """Whether the entry is a Sync Box paired directly."""
    return entry.data.get(CONF_KIND) == KIND_SYNC_BOX


def is_bridge(entry: ConfigEntry) -> bool:
    """Whether the entry is a Hue bridge (the original kind, without `kind`)."""
    return CONF_KIND not in entry.data


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register services and the WebSocket API (once, independent of entries)."""
    async_setup_services(hass)
    async_setup_websocket(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: HueStudioConfigEntry) -> bool:
    """Set up a bridge or a Sync Box."""
    if is_sync_box(entry):
        return await _async_setup_sync_box(hass, entry)
    if entry.data.get(CONF_KIND) == KIND_SYNC_BOX_LINK:
        return await _async_setup_sync_box_link(hass, entry)
    return await _async_setup_bridge(hass, entry)


async def _async_setup_bridge(hass: HomeAssistant, entry: HueStudioConfigEntry) -> bool:
    """Connect to the bridge of the linked native Hue config entry."""
    hue_entry = hass.config_entries.async_get_entry(entry.data[CONF_HUE_ENTRY_ID])
    if hue_entry is None:
        raise ConfigEntryError(
            translation_domain=DOMAIN, translation_key="hue_entry_missing"
        )

    host: str = hue_entry.data[CONF_HOST]
    bridge = HueBridgeV2(host, hue_entry.data[HUE_CONF_API_KEY])
    try:
        async with asyncio.timeout(CONNECT_TIMEOUT):
            await bridge.initialize()
    except (LinkButtonNotPressed, Unauthorized) as err:
        await bridge.close()
        raise ConfigEntryError(
            translation_domain=DOMAIN, translation_key="bridge_auth_failed"
        ) from err
    except (TimeoutError, ClientError, BridgeBusy) as err:
        await bridge.close()
        raise ConfigEntryNotReady(
            translation_domain=DOMAIN,
            translation_key="bridge_unreachable",
            translation_placeholders={"host": host},
        ) from err

    entry.runtime_data = HueStudioData(bridge=bridge)

    @callback
    def on_entertainment(event_type: EventType, resource: object) -> None:
        # Streaming started/stopped: Sync Boxes and open panels update at once.
        async_dispatcher_send(hass, SIGNAL_ENTERTAINMENT_UPDATED)

    entry.async_on_unload(
        bridge.config.entertainment_configuration.subscribe(on_entertainment)
    )
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    await async_register_panel(hass)
    return True


def _sync_box_api(entry: ConfigEntry) -> HueSyncBox:
    """aiohuesyncbox client for a Sync Box entry (it owns its HTTPS session)."""
    return HueSyncBox(
        entry.data[CONF_HOST],
        entry.data[CONF_BOX_ID],
        access_token=entry.data[CONF_ACCESS_TOKEN],
    )


async def _async_setup_sync_box(
    hass: HomeAssistant, entry: HueStudioConfigEntry
) -> bool:
    """Read the box once, start polling it and add its entities."""
    api = _sync_box_api(entry)
    try:
        await api.initialize()
    except SyncBoxUnauthorized as err:
        await api.close()
        raise ConfigEntryAuthFailed(
            translation_domain=DOMAIN, translation_key="sync_box_auth_failed"
        ) from err
    except RequestError as err:
        await api.close()
        raise ConfigEntryNotReady(
            translation_domain=DOMAIN,
            translation_key="sync_box_unreachable",
            translation_placeholders={"host": entry.data[CONF_HOST]},
        ) from err
    coordinator = SyncBoxCoordinator(hass, entry, api)
    entry.runtime_data = HueStudioData(sync=coordinator)
    entry.async_on_unload(api.close)
    async_track_entertainment(hass, coordinator)
    await hass.config_entries.async_forward_entry_setups(entry, SYNC_BOX_PLATFORMS)
    return True


async def _async_setup_sync_box_link(
    hass: HomeAssistant, entry: HueStudioConfigEntry
) -> bool:
    """Use a box of the `huesyncbox` integration (its entry must be loaded)."""
    sync_entry = hass.config_entries.async_get_entry(entry.data[CONF_SYNC_ENTRY_ID])
    if sync_entry is None or sync_entry.domain != SYNC_BOX_INTEGRATION:
        raise ConfigEntryError(
            translation_domain=DOMAIN, translation_key="sync_box_entry_missing"
        )
    if sync_entry.state is not ConfigEntryState.LOADED:
        # Set up later than us, or failing itself: try again later.
        raise ConfigEntryNotReady(
            translation_domain=DOMAIN,
            translation_key="sync_box_entry_not_loaded",
            translation_placeholders={"name": sync_entry.title},
        )
    entry.runtime_data = HueStudioData(link=SyncBoxLink(hass, sync_entry))
    return True


async def _async_options_updated(
    hass: HomeAssistant, entry: HueStudioConfigEntry
) -> None:
    """Options changed: no reload needed, just tell open panels."""
    async_dispatcher_send(hass, SIGNAL_CONFIG_UPDATED)


async def async_unload_entry(hass: HomeAssistant, entry: HueStudioConfigEntry) -> bool:
    """Close the bridge connection or drop the box's entities.

    The panel goes with the last bridge.
    """
    if is_sync_box(entry):
        return await hass.config_entries.async_unload_platforms(
            entry, SYNC_BOX_PLATFORMS
        )
    if not is_bridge(entry):
        return True
    if (bridge := entry.runtime_data.bridge) is not None:
        await bridge.close()
    if not any(
        other.entry_id != entry.entry_id and is_bridge(other)
        for other in hass.config_entries.async_loaded_entries(DOMAIN)
    ):
        async_unregister_panel(hass)
    return True


async def async_remove_entry(hass: HomeAssistant, entry: HueStudioConfigEntry) -> None:
    """Removing a Sync Box also removes our registration on it (best effort)."""
    if not is_sync_box(entry) or CONF_REGISTRATION_ID not in entry.data:
        return
    try:
        async with _sync_box_api(entry) as api:
            await api.unregister(entry.data[CONF_REGISTRATION_ID])
    except (RequestError, SyncBoxUnauthorized) as err:
        _LOGGER.info("Could not remove the registration from the Sync Box: %s", err)
