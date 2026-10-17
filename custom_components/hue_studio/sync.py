"""Hue Play HDMI Sync Box: state polling, commands and the link to the bridge.

The box is driven through aiohuesyncbox (its models and controllers). It has no event
stream, so its state is polled; whenever an entertainment area starts or stops
streaming the bridge pushes that over its event stream and the boxes are refreshed at
once. Entertainment areas of the box are matched with the bridge's entertainment
configurations, which tells which Hue lights are being synced.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
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
    DeviceUpdate,
    ExecutionMode,
    GameMode,
    HdmiSource,
    HueSyncBox,
    Input,
    Intensity,
    LedMode,
    MusicMode,
    MusicPalette,
    Presets,
    SyncMode,
    Unauthorized,
    VideoMode,
)
from aiohuesyncbox.controllers.behavior import Behavior
from aiohuesyncbox.controllers.device import Device
from aiohuesyncbox.models import BehaviorUpdate, ExecutionUpdate
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
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
LED_MODES = {"off": LedMode.OFF, "normal": LedMode.REGULAR, "dimmed": LedMode.DIMMED}
NAME_MAX = 32

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


class SyncDevice(Device):
    """The box's device resource with what aiohuesyncbox (0.1.6) does not have yet:
    its name. Built on its controller and models."""

    def __init__(self, device: Device) -> None:
        """Wrap the device resource of a box (same data, same request function)."""
        super().__init__(device._data, device._request)

    async def set_name(self, name: str) -> None:
        """Rename the box."""
        await self._put(DeviceUpdate(name=name).to_dict())

    async def set_bluetooth(self, enabled: bool) -> None:
        """Let the Hue Sync app find the box over Bluetooth (to change its Wi-Fi)."""
        await self._put(DeviceUpdate(bluetooth=enabled).to_dict())


class SyncBehavior(Behavior):
    """The box's behavior with what aiohuesyncbox (0.1.6) does not have yet: turning
    on and off with the TV (HDMI CEC)."""

    def __init__(self, behavior: Behavior) -> None:
        """Wrap the behavior resource of a box (same data, same request function)."""
        super().__init__(behavior._data, behavior._request)

    async def set_cec_powersave(self, enabled: bool) -> None:
        """Follow the TV: on when it turns on, standby when it turns off."""
        await self._put(BehaviorUpdate(cec_powersave=enabled).to_dict())


def led_mode(api: HueSyncBox) -> str | None:
    """The box's LED as an option of LED_MODES."""
    mode = api.device.led_mode
    return next((name for name, value in LED_MODES.items() if value == mode), None)


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

    async def async_configure(
        self,
        *,
        name: str | None = None,
        led: str | None = None,
        tv_power: bool | None = None,
        bluetooth: bool | None = None,
    ) -> None:
        """The box's own settings: its name, its LED, following the TV and its
        Bluetooth (the Hue Sync app changes its Wi-Fi over it)."""
        if name is not None:
            name = name.strip()[:NAME_MAX]
            if name and name != self.api.device.name:
                await self.async_command(SyncDevice(self.api.device).set_name(name))
                devices = dr.async_get(self.hass)
                if device := devices.async_get_device_by_identifier(
                    (DOMAIN, self.box_id), self.config_entry.entry_id
                ):
                    devices.async_update_device(device.id, name=name)
        if led is not None and LED_MODES[led] != self.api.device.led_mode:
            await self.async_command(self.api.device.set_led_mode(LED_MODES[led]))
        if tv_power is not None and self.api.behavior is not None:
            await self.async_command(
                SyncBehavior(self.api.behavior).set_cec_powersave(tv_power)
            )
        if bluetooth is not None and bluetooth != self.api.device.bluetooth:
            await self.async_command(
                SyncDevice(self.api.device).set_bluetooth(bluetooth)
            )

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


# How long the bridge's button is waited for, and the box's connection to the bridge.
LINK_TIMEOUT = 60
CONNECT_TIMEOUT = 45
# Hue's error "link button not pressed".
LINK_BUTTON_NOT_PRESSED = 101


class BoxBridgeFailed(Exception):
    """Linking a box with a bridge failed: `reason` is shown in the panel."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def bridge_entry_of(hass: HomeAssistant, box_bridge_id: str | None) -> str | None:
    """The native `hue` entry of the bridge a box uses. A box names it by its 16-digit
    id (`ECB5FAFFFE8FCCC4`); the entry's unique id is that without `fffe`."""
    if not box_bridge_id or len(box_bridge_id) != 16:
        return None
    short = (box_bridge_id[:6] + box_bridge_id[10:]).lower()
    return next(
        (
            entry.entry_id
            for entry in hass.config_entries.async_entries(HUE_DOMAIN)
            if (entry.unique_id or "").lower() == short
        ),
        None,
    )


async def async_link_box_bridge(
    hass: HomeAssistant,
    coordinator: SyncBoxCoordinator,
    hue_entry_id: str,
    on_step: Callable[[dict[str, Any]], None],
) -> str | None:
    """Move a box to another bridge: the bridge's button gives it its own entertainment
    credentials (they go to the box, never into HA), the box connects, and it streams
    to the entertainment area of the same name there (else the first). Returns that
    area's name. `on_step` hears {"step": "press", "timeout"} and
    {"step": "connecting"}. Raises BoxBridgeFailed."""
    entry = hass.config_entries.async_get_entry(hue_entry_id)
    if entry is None or entry.domain != HUE_DOMAIN:
        raise BoxBridgeFailed("no_bridge")
    host = entry.data["host"]
    session = async_get_clientsession(hass, verify_ssl=False)
    await coordinator.async_refresh()
    api = coordinator.api
    current = api.hue.groups_by_id.get(api.hue.group_id or "")
    area_name = current.name if current else None
    try:
        async with session.get(
            f"https://{host}/api/config", timeout=ClientTimeout(total=10)
        ) as resp:
            bridge_id = str((await resp.json(content_type=None)).get("bridgeid") or "")
    except (ClientError, TimeoutError, ValueError) as err:
        raise BoxBridgeFailed("bridge") from err
    if len(bridge_id) != 16:
        raise BoxBridgeFailed("bridge")

    on_step({"step": "press", "timeout": LINK_TIMEOUT})
    loop = asyncio.get_running_loop()
    deadline = loop.time() + LINK_TIMEOUT
    while True:
        try:
            async with session.post(
                f"https://{host}/api",
                json={"devicetype": "hue_studio#sync_box", "generateclientkey": True},
                timeout=ClientTimeout(total=10),
            ) as resp:
                answer = await resp.json(content_type=None)
        except (ClientError, TimeoutError, ValueError) as err:
            raise BoxBridgeFailed("bridge") from err
        first = answer[0] if isinstance(answer, list) and answer else {}
        if "success" in first:
            username = first["success"]["username"]
            client_key = first["success"]["clientkey"]
            break
        if first.get("error", {}).get("type") != LINK_BUTTON_NOT_PRESSED:
            raise BoxBridgeFailed("bridge")
        if loop.time() >= deadline:
            raise BoxBridgeFailed("timeout")
        await asyncio.sleep(1)

    on_step({"step": "connecting"})
    try:
        await api.hue.set_bridge(bridge_id.upper(), username, client_key)
    except AiohuesyncboxException as err:
        raise BoxBridgeFailed("box") from err
    deadline = loop.time() + CONNECT_TIMEOUT
    while True:
        await coordinator.async_refresh()
        hue = api.hue
        if (
            (hue.bridge_unique_id or "").upper() == bridge_id.upper()
            and hue.connection_state.value in ("connected", "streaming")
            and hue.groups
        ):
            break
        if loop.time() >= deadline:
            raise BoxBridgeFailed("box")
        await asyncio.sleep(2)
    group = next(
        (g for g in api.hue.groups if area_name and g.name == area_name),
        api.hue.groups[0],
    )
    if group.id != api.hue.group_id:
        await coordinator.async_command(api.hue.set_group_id(group.id))
    return group.name


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
    device = dr.async_get(hass).async_get_device_by_identifier(
        (DOMAIN, coordinator.box_id), coordinator.config_entry.entry_id
    )
    wifi = api.device.wifi
    update = api.device.updatable_firmware_version
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
        "features": ["palette", "background_lighting", "presets", "settings"]
        + (["ir"] if api.ir else []),
        "device": {
            "id": coordinator.box_id,
            "host": api.device.ip_address,
            "firmware": api.device.firmware_version,
            "update": update
            if update and update != api.device.firmware_version
            else None,
            "wifi": int(wifi.strength) if wifi else None,
            "wifi_name": wifi.ssid if wifi else None,
            "bluetooth": api.device.bluetooth,
            "led": led_mode(api),
            "tv_power": api.behavior.cec_powersave if api.behavior else None,
            "ha_device": device.id if device else None,
        },
        "content": (hdmi.content_specs or None) if hdmi else None,
        "video_supported": hdmi.video_sync_supported if hdmi else True,
        "audio_supported": hdmi.audio_sync_supported if hdmi else True,
        "connection": api.hue.connection_state.value,
        # The native `hue` entry of the bridge it streams to.
        "bridge": bridge_entry_of(hass, api.hue.bridge_unique_id),
    }


def _palette_key(palette: MusicPalette) -> str | None:
    return next((k for k, v in PALETTES.items() if v == palette), None)
