"""Hue Studio: Hue-app-style light control on top of the native Hue integration.

Kinds of config entries: the Hue Studio entry (one, for every bridge of the native
`hue` integration: each is a service device of it) and a Hue Play HDMI Sync Box —
paired directly (with entities of its own), or used through the HACS `huesyncbox`
integration (its entities and service, nothing of our own).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import logging
from typing import Any

from aiohuesyncbox import HueSyncBox, RequestError, Unauthorized as SyncBoxUnauthorized
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import CONF_ACCESS_TOKEN, CONF_HOST, Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import (
    ConfigEntryAuthFailed,
    ConfigEntryError,
    ConfigEntryNotReady,
    HomeAssistantError,
)
from homeassistant.helpers import config_validation as cv, device_registry as dr
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.typing import ConfigType

from .automations import async_setup_automations
from .connections import (
    BridgeConnections,
    async_studio_entry,
    async_supported_hue_entries,
    is_studio,
)
from .const import (
    CONF_AUTO_ALIGN,
    CONF_BOX_ID,
    CONF_FOOTER,
    CONF_FOOTER_TABS,
    CONF_GALLERY_RULES,
    CONF_GALLERY_SEASONAL,
    CONF_GROUPS,
    CONF_HUE_ENTRY_ID,
    CONF_KIND,
    CONF_REGISTRATION_ID,
    CONF_ROOMS,
    CONF_SYNC_ENTRY_ID,
    DOMAIN,
    KIND_STUDIO,
    KIND_SYNC_BOX,
    KIND_SYNC_BOX_LINK,
    SIGNAL_CONFIG_UPDATED,
    SYNC_BOX_INTEGRATION,
)
from .panel import async_register_panel, async_unregister_panel
from .positions import async_setup_positions
from .rooms import async_align, async_track_areas
from .services import async_setup_services
from .sync import SyncBoxCoordinator, async_track_entertainment
from .sync_link import SyncBoxLink
from .websocket import async_setup_websocket

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

STUDIO_TITLE = "Hue Studio"

SYNC_BOX_PLATFORMS = [
    Platform.NUMBER,
    Platform.SELECT,
    Platform.SENSOR,
    Platform.SWITCH,
]


@dataclass
class HueStudioData:
    """Runtime data of a Hue Studio config entry (the bridges, or a Sync Box)."""

    connections: BridgeConnections | None = None
    sync: SyncBoxCoordinator | None = None
    link: SyncBoxLink | None = None


type HueStudioConfigEntry = ConfigEntry[HueStudioData]


def is_sync_box(entry: ConfigEntry) -> bool:
    """Whether the entry is a Sync Box paired directly."""
    return entry.data.get(CONF_KIND) == KIND_SYNC_BOX


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register services and the WebSocket API (once, independent of entries)."""
    await _async_merge_bridge_entries(hass)
    async_setup_services(hass)
    async_setup_websocket(hass)
    await async_setup_positions(hass)
    await async_setup_automations(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: HueStudioConfigEntry) -> bool:
    """Set up the bridges or a Sync Box."""
    if is_sync_box(entry):
        return await _async_setup_sync_box(hass, entry)
    if entry.data.get(CONF_KIND) == KIND_SYNC_BOX_LINK:
        return await _async_setup_sync_box_link(hass, entry)
    return await _async_setup_studio(hass, entry)


async def _async_merge_bridge_entries(hass: HomeAssistant) -> None:
    """Entries of one bridge each (up to 0.9.1-alpha.1) become the one Hue Studio entry.

    The first of them is kept as the Hue Studio entry, with the options of all of them
    (room mapping and sensors are keyed by unique ids, so they never clash); the others
    are removed. Runs before any entry is set up.
    """
    old = sorted(
        (
            e
            for e in hass.config_entries.async_entries(DOMAIN)
            if CONF_HUE_ENTRY_ID in e.data
        ),
        key=lambda e: e.disabled_by is not None,
    )
    if not old:
        return
    studio = async_studio_entry(hass)
    sources = [*([studio] if studio else []), *old]
    groups: dict[str, Any] = {}
    rooms: dict[str, Any] = {}
    for source in reversed(sources):
        groups.update(source.options.get(CONF_GROUPS, {}))
        rooms.update(source.options.get(CONF_ROOMS, {}))
    options: dict[str, Any] = {
        CONF_GROUPS: groups,
        CONF_ROOMS: rooms,
        CONF_AUTO_ALIGN: any(s.options.get(CONF_AUTO_ALIGN) for s in sources),
    }
    # Panel settings were written to every bridge entry alike: the first one's.
    for key in (
        CONF_FOOTER,
        CONF_FOOTER_TABS,
        CONF_GALLERY_SEASONAL,
        CONF_GALLERY_RULES,
    ):
        if (owner := next((s for s in sources if key in s.options), None)) is not None:
            options[key] = owner.options[key]
    if studio is None:
        studio, old = old[0], old[1:]
        hass.config_entries.async_update_entry(
            studio,
            data={CONF_KIND: KIND_STUDIO},
            title=STUDIO_TITLE,
            unique_id=DOMAIN,
            options=options,
        )
    else:
        hass.config_entries.async_update_entry(studio, options=options)
    for entry in old:
        await hass.config_entries.async_remove(entry.entry_id)
    _LOGGER.info("Hue Studio now has one entry for all bridges (%s)", studio.entry_id)


async def _async_setup_studio(hass: HomeAssistant, entry: HueStudioConfigEntry) -> bool:
    """Connect to every bridge of the native integration and register the panel."""
    if not is_studio(entry):
        # An unknown kind of entry (from a newer version, after a downgrade).
        raise ConfigEntryError(
            translation_domain=DOMAIN, translation_key="unknown_entry"
        )
    connections = BridgeConnections(hass, entry)
    entry.runtime_data = HueStudioData(connections=connections)
    await connections.async_start()
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    entry.async_on_unload(_async_track_auto_align(hass, entry))
    await async_register_panel(hass)
    return True


@callback
def _async_track_auto_align(
    hass: HomeAssistant, entry: HueStudioConfigEntry
) -> Callable[[], None]:
    """With the option on, align the bridges' rooms when HA areas change.

    Only HA changes trigger it: a light moved in the Hue app is a mismatch the panel
    shows, not something to undo behind the user's back. Empty rooms are never
    deleted automatically.
    """

    async def align() -> None:
        if not entry.options.get(CONF_AUTO_ALIGN):
            return
        try:
            await async_align(hass)
        except HomeAssistantError as err:
            _LOGGER.warning("Automatic room alignment failed: %s", err)

    @callback
    def on_change() -> None:
        if entry.options.get(CONF_AUTO_ALIGN):
            entry.async_create_background_task(hass, align(), "hue_studio_auto_align")

    return async_track_areas(hass, on_change)


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
    """Close the bridge connections (and the panel), or drop the box's entities."""
    if is_sync_box(entry):
        return await hass.config_entries.async_unload_platforms(
            entry, SYNC_BOX_PLATFORMS
        )
    if not is_studio(entry):
        return True
    if (connections := entry.runtime_data.connections) is not None:
        await connections.async_stop()
    async_unregister_panel(hass)
    return True


async def async_remove_config_entry_device(
    hass: HomeAssistant, entry: HueStudioConfigEntry, device: dr.DeviceEntry
) -> bool:
    """A bridge's device can be deleted once the native integration lost the bridge;
    it comes back when the bridge does."""
    if not is_studio(entry):
        return False
    bridges = {e.unique_id for e in async_supported_hue_entries(hass)}
    return not any(
        len(ident) > 1 and ident[0] == DOMAIN and ident[1] in bridges
        for ident in device.identifiers
    )


async def async_remove_entry(hass: HomeAssistant, entry: HueStudioConfigEntry) -> None:
    """Removing a Sync Box also removes our registration on it (best effort)."""
    if not is_sync_box(entry) or CONF_REGISTRATION_ID not in entry.data:
        return
    try:
        async with _sync_box_api(entry) as api:
            await api.unregister(entry.data[CONF_REGISTRATION_ID])
    except (RequestError, SyncBoxUnauthorized) as err:
        _LOGGER.info("Could not remove the registration from the Sync Box: %s", err)
