"""Hue Play HDMI Sync Box: state polling, commands and the link to the bridge.

The box is driven through aiohuesyncbox (its models and controllers). It has no event
stream, so its state is polled; whenever an entertainment area starts or stops
streaming the bridge pushes that over its event stream and the boxes are refreshed at
once. Entertainment areas of the box are matched with the bridge's entertainment
configurations, which tells which Hue lights are being synced.
"""

from __future__ import annotations

from collections.abc import Awaitable
from dataclasses import dataclass
from datetime import timedelta
import logging
from typing import TYPE_CHECKING, Any, Protocol

from aiohttp import ClientError, ClientSession, ClientTimeout
from aiohue.v2.models.entertainment_configuration import (
    EntertainmentConfiguration,
    EntertainmentStatus,
)
from aiohuesyncbox import (
    AiohuesyncboxException,
    CycleDirection,
    ExecutionMode,
    GameMode,
    HdmiSource,
    HueSyncBox,
    Input,
    Intensity,
    MusicMode,
    MusicPalette,
    Presets,
    SyncMode,
    Unauthorized,
    VideoMode,
)
from aiohuesyncbox.models import ExecutionUpdate
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    CONF_KIND,
    DOMAIN,
    HUE_DOMAIN,
    KIND_SYNC_BOX,
    KIND_SYNC_BOX_LINK,
    SIGNAL_ENTERTAINMENT_UPDATED,
)
from .lights import LIGHT_DOMAIN, async_bridges

if TYPE_CHECKING:
    from . import HueStudioConfigEntry

_LOGGER = logging.getLogger(__name__)

POLL_INTERVAL = timedelta(seconds=3)

SYNC_MODES = [SyncMode.VIDEO.value, SyncMode.MUSIC.value, SyncMode.GAME.value]
INTENSITIES = [
    Intensity.SUBTLE.value,
    Intensity.MODERATE.value,
    Intensity.HIGH.value,
    Intensity.INTENSE.value,
]
INPUTS = ["input1", "input2", "input3", "input4"]

# Music palettes: service values (snake_case) -> the box's.
PALETTES = {
    "happy_energetic": MusicPalette.HAPPY_ENERGETIC,
    "happy_calm": MusicPalette.HAPPY_CALM,
    "melancholic_calm": MusicPalette.MELANCHOLIC_CALM,
    "melancholic_energetic": MusicPalette.MELANCHOLIC_ENERGETIC,
    "neutral": MusicPalette.NEUTRAL,
}
BRIGHTNESS_STEP = 20  # of the box's 0-200

# What a remote button (IR code) can do: action -> the execution change it sends.
# Also "input:<input1-4>" and "preset:<id>".
IR_ACTIONS: dict[str, ExecutionUpdate] = {
    "toggle_sync": ExecutionUpdate(toggle_sync_active=True),
    "sync_on": ExecutionUpdate(sync_active=True),
    "sync_off": ExecutionUpdate(sync_active=False),
    "power_off": ExecutionUpdate(mode=ExecutionMode.POWERSAVE),
    "passthrough": ExecutionUpdate(mode=ExecutionMode.PASSTHROUGH),
    "mode_video": ExecutionUpdate(mode=ExecutionMode.VIDEO),
    "mode_music": ExecutionUpdate(mode=ExecutionMode.MUSIC),
    "mode_game": ExecutionUpdate(mode=ExecutionMode.GAME),
    "next_mode": ExecutionUpdate(cycle_sync_mode=CycleDirection.NEXT),
    "next_input": ExecutionUpdate(cycle_hdmi_source=CycleDirection.NEXT),
    "next_intensity": ExecutionUpdate(cycle_intensity=CycleDirection.NEXT),
    "brighter": ExecutionUpdate(increment_brightness=BRIGHTNESS_STEP),
    "darker": ExecutionUpdate(increment_brightness=-BRIGHTNESS_STEP),
    "toggle_background": ExecutionUpdate(toggle_background_lighting=True),
}


def ir_execution(action: str) -> dict[str, Any] | None:
    """The execution change of a remote button action (None: unknown action)."""
    if action in IR_ACTIONS:
        return IR_ACTIONS[action].to_dict()
    kind, _, value = action.partition(":")
    if kind == "input" and value in INPUTS:
        return ExecutionUpdate(hdmi_source=HdmiSource(value)).to_dict()
    if kind == "preset" and value:
        return ExecutionUpdate(preset=value).to_dict()
    return None


def ir_action(execution: dict[str, Any]) -> str | None:
    """The action of a remote button's execution change, if it is one of ours."""
    for action, update in IR_ACTIONS.items():
        if update.to_dict() == execution:
            return action
    if set(execution) == {"hdmiSource"}:
        return f"input:{execution['hdmiSource']}"
    if set(execution) == {"preset"}:
        return f"preset:{execution['preset']}"
    return None


class SyncPresets(Presets):
    """The box's presets with what aiohuesyncbox (0.1.6) does not have yet: starting
    one and deleting one. Built on its controller and models."""

    def __init__(self, presets: Presets) -> None:
        """Wrap the presets of a box (same request function, same items)."""
        super().__init__(presets._request)
        self._items = presets._items

    async def activate(self, preset_id: str) -> None:
        """Apply a preset (its execution change)."""
        await self._request(
            "put", "/execution", data=ExecutionUpdate(preset=preset_id).to_dict()
        )

    async def delete(self, preset_id: str) -> None:
        """Forget a preset."""
        await self._request("delete", f"{self._path}/{preset_id}")


MODELS = {
    "HSB1": "Hue Play HDMI Sync Box",
    "HSB2": "Hue Play HDMI Sync Box 8K",
}


class SyncBoxNotFound(Exception):
    """No Sync Box answered at the address."""


async def async_get_box_id(session: ClientSession, host: str) -> tuple[str, str]:
    """(box id, name) from the box's public device info, before pairing.

    The id is the name its certificate is issued to; aiohuesyncbox needs it to verify
    the connection, so this one unauthenticated request is not verified. Every later
    one is.
    """
    try:
        async with session.get(
            f"https://{host}/api/v1/device",
            ssl=False,
            timeout=ClientTimeout(total=10),
        ) as resp:
            data = await resp.json(content_type=None)
    except (ClientError, TimeoutError, ValueError) as err:
        raise SyncBoxNotFound(host) from err
    if not isinstance(data, dict) or not data.get("uniqueId"):
        raise SyncBoxNotFound(host)
    return str(data["uniqueId"]).upper(), str(data.get("name") or "")


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


def inputs(api: HueSyncBox) -> dict[str, Input]:
    """HDMI inputs the box has, by API id (input1-4)."""
    if api.hdmi is None:
        return {}
    ports = {key: getattr(api.hdmi, key) for key in INPUTS}
    return {key: port for key, port in ports.items() if port is not None}


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
    def of(cls, api: HueSyncBox) -> SyncState:
        """Interpret the execution state."""
        execution = api.execution
        current = execution.mode.value
        mode = current if current in SYNC_MODES else execution.last_sync_mode.value
        if mode not in SYNC_MODES:
            mode = SyncMode.VIDEO.value
        intensity = getattr(execution, mode).intensity.value
        return cls(
            power=execution.mode != ExecutionMode.POWERSAVE,
            syncing=execution.sync_active,
            mode=mode,
            intensity=intensity if intensity in INTENSITIES else None,
            brightness=api_to_pct(execution.brightness),
            input=execution.hdmi_source.value if execution.hdmi_source else None,
            area=area_id(execution.hue_target),
        )


class SyncBoxCoordinator(DataUpdateCoordinator[None]):
    """Polls one Sync Box (its state lives in `api`) and sends commands to it."""

    config_entry: HueStudioConfigEntry

    def __init__(
        self, hass: HomeAssistant, entry: HueStudioConfigEntry, api: HueSyncBox
    ) -> None:
        """Poll every few seconds; the bridge triggers extra refreshes."""
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=f"{DOMAIN} sync box",
            update_interval=POLL_INTERVAL,
            # The state is the `api` object itself, updated in place.
            always_update=True,
        )
        self.api = api

    async def _async_update_data(self) -> None:
        try:
            await self.api.refresh_data()
        except Unauthorized as err:
            raise ConfigEntryAuthFailed(
                translation_domain=DOMAIN, translation_key="sync_box_auth_failed"
            ) from err
        except AiohuesyncboxException as err:
            raise UpdateFailed(
                translation_domain=DOMAIN,
                translation_key="sync_box_unreachable",
                translation_placeholders={"host": self.config_entry.data["host"]},
            ) from err

    @property
    def box_id(self) -> str:
        """Id of the box (certificate name, 12 hex digits)."""
        return self.api.device.unique_id

    @property
    def box_name(self) -> str:
        """The box's own name."""
        return self.api.device.name or "Sync Box"

    @property
    def state(self) -> SyncState:
        """Interpreted state."""
        return SyncState.of(self.api)

    def panel_info(self) -> dict[str, Any]:
        """The payload of hue_studio/sync/subscribe for this box."""
        return sync_box_info(self.hass, self)

    async def async_command(self, command: Awaitable[None]) -> None:
        """Run a command of the library on the box, then read the state back."""
        try:
            await command
        except AiohuesyncboxException as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="sync_box_command_failed",
                translation_placeholders={"name": self.box_name},
            ) from err
        await self.async_refresh()

    async def async_set_state(self, **changes: Any) -> None:
        """`execution.set_state` of aiohuesyncbox with these keyword arguments."""
        await self.async_command(self.api.execution.set_state(**changes))

    def mode_changes(
        self,
        mode: str | None = None,
        *,
        intensity: str | None = None,
        background_lighting: bool | None = None,
        palette: str | None = None,
    ) -> dict[str, Any]:
        """set_state arguments changing the settings of `mode` (default: current).

        `intensity=` alone only applies while syncing, so the mode's own settings are
        sent instead; the API expects them complete. A palette is music's, background
        lighting video's and game's; the other one is ignored.
        """
        mode = mode or self.state.mode
        execution = self.api.execution
        if mode == SyncMode.MUSIC:
            current = execution.music
            return {
                "music": MusicMode(
                    intensity=Intensity(intensity) if intensity else current.intensity,
                    palette=PALETTES[palette] if palette else current.palette,
                )
            }
        current = execution.game if mode == SyncMode.GAME else execution.video
        settings = {
            "intensity": Intensity(intensity) if intensity else current.intensity,
            "background_lighting": current.background_lighting
            if background_lighting is None
            else background_lighting,
        }
        if mode == SyncMode.GAME:
            return {"game": GameMode(**settings)}
        return {"video": VideoMode(**settings)}

    @property
    def presets(self) -> SyncPresets:
        """The box's presets (start, delete as well)."""
        return SyncPresets(self.api.presets)

    def current_execution(self) -> dict[str, Any]:
        """What the box does now as an execution change (to save as a preset)."""
        execution = self.api.execution
        state = self.state
        mode = ExecutionMode(state.mode) if state.syncing else execution.mode
        update = ExecutionUpdate(
            mode=mode,
            hdmi_source=execution.hdmi_source,
            brightness=execution.brightness,
            hue_target=execution.hue_target,
            **self.mode_changes(state.mode),
        )
        return update.to_dict()


class SyncBoxSource(Protocol):
    """A Sync Box as the panel and `set_sync` see it, however it is connected."""

    def async_add_listener(self, update_callback: CALLBACK_TYPE) -> CALLBACK_TYPE:
        """Call `update_callback` whenever the box state may have changed."""

    def panel_info(self) -> dict[str, Any]:
        """The payload of hue_studio/sync/subscribe for this box."""


@callback
def async_sync_boxes(hass: HomeAssistant) -> dict[str, SyncBoxSource]:
    """Loaded Sync Boxes (paired directly or used through huesyncbox), by entry id."""
    boxes: dict[str, SyncBoxSource] = {}
    for entry in hass.config_entries.async_loaded_entries(DOMAIN):
        data = entry.runtime_data
        if entry.data.get(CONF_KIND) == KIND_SYNC_BOX and data.sync is not None:
            boxes[entry.entry_id] = data.sync
        elif entry.data.get(CONF_KIND) == KIND_SYNC_BOX_LINK and data.link is not None:
            boxes[entry.entry_id] = data.link
    return boxes


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
def async_entertainment_area(
    hass: HomeAssistant, *, area_id: str | None = None, name: str | None = None
) -> EntertainmentConfiguration | None:
    """The bridge's entertainment configuration with this id (or v1 id) or name."""
    for bridge in async_bridges(hass).values():
        for config in bridge.config.entertainment_configuration:
            ids = (config.id, (config.id_v1 or "").split("/")[-1])
            if area_id is not None and area_id in ids:
                return config
            if name is not None and config.metadata.name == name:
                return config
    return None


@callback
def async_config_lights(
    hass: HomeAssistant, config: EntertainmentConfiguration | None
) -> list[str]:
    """Hue light entities of an entertainment configuration."""
    if config is None:
        return []
    registry = er.async_get(hass)
    return [
        entity_id
        for service in config.light_services or []
        if (
            entity_id := registry.async_get_entity_id(
                LIGHT_DOMAIN, HUE_DOMAIN, service.rid
            )
        )
    ]


@callback
def async_area_lights(hass: HomeAssistant, group_id: str) -> list[str]:
    """Hue light entities of an entertainment area, from the bridge."""
    return async_config_lights(hass, async_entertainment_area(hass, area_id=group_id))


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
    entity_id = registry.async_get_entity_id(
        "switch", DOMAIN, f"{coordinator.box_id}_light_sync"
    )
    if not coordinator.last_update_success:
        return {"available": False, "entity_id": entity_id, "name": None}
    api = coordinator.api
    state = coordinator.state
    hdmi = api.hdmi
    return {
        "available": True,
        "entity_id": entity_id,
        "name": coordinator.box_name,
        "model": MODELS.get(api.device.device_type, "Sync Box"),
        "power": state.power,
        "syncing": state.syncing,
        "mode": state.mode,
        "intensity": state.intensity,
        "brightness": state.brightness,
        "input": state.input,
        "inputs": [
            {
                "id": key,
                "name": port.name or key,
                "type": port.type.value,
                "status": port.status.value,
            }
            for key, port in inputs(api).items()
        ],
        "area": state.area,
        "areas": sorted(
            (
                {
                    "id": group.id,
                    "name": group.name or group.id,
                    "active": group.active,
                    "lights": async_area_lights(hass, group.id),
                }
                for group in api.hue.groups
            ),
            key=lambda a: a["name"].casefold(),
        ),
        "palette": _palette_key(api.execution.music.palette),
        "background_lighting": {
            "video": api.execution.video.background_lighting,
            "game": api.execution.game.background_lighting,
        },
        "presets": sorted(
            (
                {"id": p.id, "name": p.name, "last_used": p.last_used}
                for p in api.presets
            ),
            key=lambda p: p["name"].casefold(),
        ),
        "preset": api.execution.preset,
        "ir": {
            "scanning": api.ir.scan.scanning,
            "scanned": list(api.ir.scan.codes),
            "codes": [
                {"code": c.code, "name": c.name, "action": ir_action(c.execution)}
                for c in sorted(api.ir.codes.values(), key=lambda c: c.name.casefold())
            ],
        }
        if api.ir
        else None,
        # What only a directly paired box can do (not one linked through huesyncbox).
        "features": ["palette", "background_lighting", "presets"]
        + (["ir"] if api.ir else []),
        "content": (hdmi.content_specs or None) if hdmi else None,
        "video_supported": hdmi.video_sync_supported if hdmi else True,
        "audio_supported": hdmi.audio_sync_supported if hdmi else True,
        "connection": api.hue.connection_state.value,
    }


def _palette_key(palette: MusicPalette) -> str | None:
    return next((k for k, v in PALETTES.items() if v == palette), None)
