"""Hue Play HDMI Sync Box: state polling, commands and the link to the bridge.

The box has no event stream, so its state is polled; whenever an entertainment area
starts or stops streaming the bridge pushes that over its event stream and the boxes
are refreshed at once. Entertainment areas of the box are matched with the bridge's
entertainment configurations, which tells which Hue lights are being synced.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
import logging
from typing import TYPE_CHECKING, Any

from aiohue.v2.models.entertainment_configuration import EntertainmentStatus
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    CONF_KIND,
    DOMAIN,
    HUE_DOMAIN,
    KIND_SYNC_BOX,
    SIGNAL_ENTERTAINMENT_UPDATED,
)
from .lights import LIGHT_DOMAIN, async_bridges
from .syncbox import SyncBox, SyncBoxAuthError, SyncBoxError

if TYPE_CHECKING:
    from . import HueStudioConfigEntry

_LOGGER = logging.getLogger(__name__)

POLL_INTERVAL = timedelta(seconds=3)

SYNC_MODES = ["video", "music", "game"]
INTENSITIES = ["subtle", "moderate", "high", "intense"]
INPUTS = ["input1", "input2", "input3", "input4"]
# ledMode values of the API, by option.
LED_MODES = {"off": 0, "normal": 1, "dimmed": 2}
MODE_POWERSAVE = "powersave"
MODE_PASSTHROUGH = "passthrough"

MODELS = {
    "HSB1": "Hue Play HDMI Sync Box",
    "HSB2": "Hue Play HDMI Sync Box 8K",
}


def pct_to_api(value: float) -> int:
    """Brightness 1-100 % -> the box's 0-200 (100 = as the source)."""
    return round((value - 1) * 200 / 99)


def api_to_pct(value: int) -> int:
    """The box's 0-200 -> 1-100 %."""
    return round(value * 99 / 200 + 1)


def area_id(target: str | None) -> str | None:
    """Entertainment area id from `hueTarget` ("groups/<n>" or a UUID)."""
    if not target:
        return None
    return target.removeprefix("groups/")


def hue_target(group_id: str) -> str:
    """`hueTarget` for an entertainment area id (the inverse of `area_id`)."""
    return f"groups/{group_id}" if group_id.isdigit() else group_id


@dataclass(frozen=True, slots=True)
class SyncState:
    """The parts of the box state that entities and the panel read."""

    power: bool
    syncing: bool
    mode: str
    intensity: str | None
    brightness: int
    input: str | None
    area: str | None

    @classmethod
    def of(cls, data: dict[str, Any]) -> SyncState:
        """Interpret `execution` of a full state."""
        execution = data["execution"]
        current = execution.get("mode", MODE_POWERSAVE)
        mode = current if current in SYNC_MODES else execution.get("lastSyncMode")
        if mode not in SYNC_MODES:
            mode = "video"
        return cls(
            power=current != MODE_POWERSAVE,
            syncing=bool(execution.get("syncActive", current in SYNC_MODES)),
            mode=mode,
            intensity=(execution.get(mode) or {}).get("intensity"),
            brightness=api_to_pct(execution.get("brightness", 100)),
            input=execution.get("hdmiSource"),
            area=area_id(execution.get("hueTarget")),
        )


class SyncBoxCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Polls one Sync Box and sends commands to it."""

    config_entry: HueStudioConfigEntry

    def __init__(
        self, hass: HomeAssistant, entry: HueStudioConfigEntry, box: SyncBox
    ) -> None:
        """Poll every few seconds; the bridge triggers extra refreshes."""
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=f"{DOMAIN} sync box {box.box_id}",
            update_interval=POLL_INTERVAL,
        )
        self.box = box

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            return await self.box.state()
        except SyncBoxAuthError as err:
            raise ConfigEntryAuthFailed(
                translation_domain=DOMAIN, translation_key="sync_box_auth_failed"
            ) from err
        except SyncBoxError as err:
            raise UpdateFailed(
                translation_domain=DOMAIN,
                translation_key="sync_box_unreachable",
                translation_placeholders={"host": self.box.host},
            ) from err

    @property
    def state(self) -> SyncState:
        """Interpreted state (only valid after a successful refresh)."""
        return SyncState.of(self.data)

    @property
    def box_name(self) -> str:
        """The box's own name."""
        return str(self.data["device"].get("name") or "Sync Box")

    async def async_execute(self, changes: dict[str, Any]) -> None:
        """Change execution and read the result back."""
        await self._async_command(self.box.execution, changes)

    async def async_set_device(self, changes: dict[str, Any]) -> None:
        """Change device settings and read the result back."""
        await self._async_command(self.box.device, changes)

    async def _async_command(self, send: Any, changes: dict[str, Any]) -> None:
        try:
            await send(changes)
        except SyncBoxError as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="sync_box_command_failed",
                translation_placeholders={"name": self.box_name},
            ) from err
        await self.async_refresh()

    def intensity_changes(
        self, intensity: str, mode: str | None = None
    ) -> dict[str, Any]:
        """Execution changes setting the intensity of `mode` (default: the current one).

        `{"intensity": …}` only applies while syncing, so the mode's own settings are
        sent instead; the API expects them complete.
        """
        mode = mode or self.state.mode
        settings = dict(self.data["execution"].get(mode) or {})
        settings["intensity"] = intensity
        return {mode: settings}


@callback
def async_sync_coordinators(hass: HomeAssistant) -> dict[str, SyncBoxCoordinator]:
    """Coordinators of loaded Sync Box entries, by entry id."""
    return {
        entry.entry_id: entry.runtime_data.sync
        for entry in hass.config_entries.async_loaded_entries(DOMAIN)
        if entry.data.get(CONF_KIND) == KIND_SYNC_BOX
        and entry.runtime_data.sync is not None
    }


@callback
def async_track_entertainment(
    hass: HomeAssistant, coordinator: SyncBoxCoordinator
) -> None:
    """Refresh the box as soon as the bridge reports streaming started or stopped."""

    @callback
    def refresh() -> None:
        hass.async_create_task(coordinator.async_request_refresh())

    coordinator.config_entry.async_on_unload(
        async_dispatcher_connect(hass, SIGNAL_ENTERTAINMENT_UPDATED, refresh)
    )


@callback
def async_area_lights(hass: HomeAssistant, group_id: str) -> list[str]:
    """Hue light entities of an entertainment area, from the bridge."""
    registry = er.async_get(hass)
    for bridge in async_bridges(hass).values():
        for config in bridge.config.entertainment_configuration:
            if group_id not in (config.id, (config.id_v1 or "").split("/")[-1]):
                continue
            return [
                entity_id
                for service in config.light_services or []
                if (
                    entity_id := registry.async_get_entity_id(
                        LIGHT_DOMAIN, HUE_DOMAIN, service.rid
                    )
                )
            ]
    return []


@callback
def async_streaming_lights(hass: HomeAssistant) -> set[str]:
    """Hue light entities in entertainment areas that stream right now.

    Comes from the bridge, so it also covers syncing from a PC or TV app.
    """
    registry = er.async_get(hass)
    lights: set[str] = set()
    for bridge in async_bridges(hass).values():
        for config in bridge.config.entertainment_configuration:
            if config.status != EntertainmentStatus.ACTIVE:
                continue
            for service in config.light_services or []:
                if entity_id := registry.async_get_entity_id(
                    LIGHT_DOMAIN, HUE_DOMAIN, service.rid
                ):
                    lights.add(entity_id)
    return lights


@callback
def sync_box_info(
    hass: HomeAssistant, coordinator: SyncBoxCoordinator
) -> dict[str, Any]:
    """What the panel shows of one box (hue_studio/sync/subscribe)."""
    registry = er.async_get(hass)
    box_id = coordinator.box.box_id
    entity_id = registry.async_get_entity_id("switch", DOMAIN, f"{box_id}_light_sync")
    if not coordinator.last_update_success or coordinator.data is None:
        return {"available": False, "entity_id": entity_id, "name": None}
    data = coordinator.data
    state = coordinator.state
    hdmi = data.get("hdmi") or {}
    groups: dict[str, Any] = (data.get("hue") or {}).get("groups") or {}
    return {
        "available": True,
        "entity_id": entity_id,
        "name": coordinator.box_name,
        "model": MODELS.get(data["device"].get("deviceType"), "Sync Box"),
        "power": state.power,
        "syncing": state.syncing,
        "mode": state.mode,
        "intensity": state.intensity,
        "brightness": state.brightness,
        "input": state.input,
        "inputs": [
            {
                "id": key,
                "name": hdmi[key].get("name") or key,
                "type": hdmi[key].get("type"),
                "status": hdmi[key].get("status"),
            }
            for key in INPUTS
            if isinstance(hdmi.get(key), dict)
        ],
        "area": state.area,
        "areas": sorted(
            (
                {
                    "id": group_id,
                    "name": group.get("name") or group_id,
                    "active": bool(group.get("active")),
                    "lights": async_area_lights(hass, group_id),
                }
                for group_id, group in groups.items()
            ),
            key=lambda a: a["name"].casefold(),
        ),
        "content": hdmi.get("contentSpecs") or None,
        "video_supported": bool(hdmi.get("videoSyncSupported", True)),
        "audio_supported": bool(hdmi.get("audioSyncSupported", True)),
        "connection": (data.get("hue") or {}).get("connectionState"),
    }
