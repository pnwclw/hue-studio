"""Auto light entities: one service device per area with auto light settings.

Made for dashboards (Lovelace, Mushroom, Bubble Card) and automations: translated
names and states, icons per state, the scene's gallery picture as `entity_picture`,
everything in the area's device so card editors find it by area. Entities belong to
one bridge entry (the first one), since auto light is per area, not per bridge.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from homeassistant.components.button import ButtonEntity
from homeassistant.components.number import NumberEntity
from homeassistant.components.select import SelectEntity
from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.const import PERCENTAGE, STATE_ON, Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import area_registry as ar, device_registry as dr
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .auto_control import (
    SIGNAL_AREA,
    SIGNAL_AREAS,
    AutoLightManager,
    auto_light_manager,
)
from .auto_light import CONTROL_AUTO, CONTROLS, MAX_OFFSET
from .auto_select import PHASES
from .const import CONF_HUE_ENTRY_ID, DOMAIN
from .panel import STATIC_URL

# A press of "next scene" or a return to auto shows the new scene this fast.
QUICK_TRANSITION = 2.0


class AutoLightEntity(Entity):
    """Base: attached to the area's auto light device, updated by the manager."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _platform_domain: str
    key: str

    def __init__(self, manager: AutoLightManager, area_id: str) -> None:
        """Attach to the area's device."""
        self.manager = manager
        self.area_id = area_id
        area = ar.async_get(manager.hass).async_get_area(area_id)
        self._attr_translation_key = self.key
        self._attr_unique_id = f"auto_light_{area_id}_{self.key}"
        # A suggestion from the area id: translated names would give ids in the UI
        # language (e.g. Polish); a rename by the user stays.
        self.entity_id = f"{self._platform_domain}.{area_id}_{self.key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"auto_light_{area_id}")},
            translation_key="auto_light",
            translation_placeholders={"area": area.name if area else area_id},
            entry_type=DeviceEntryType.SERVICE,
            manufacturer="Hue Studio",
        )

    @property
    def available(self) -> bool:
        """Gone with the area's auto light settings."""
        return self.area_id in self.manager.areas

    async def async_added_to_hass(self) -> None:
        """Follow the area's state; put the device into the area."""
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass, f"{SIGNAL_AREA}_{self.area_id}", self.async_write_ha_state
            )
        )
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_AREAS, self.async_write_ha_state)
        )
        devices = dr.async_get(self.hass)
        device = devices.async_get_device({(DOMAIN, f"auto_light_{self.area_id}")})
        if device is not None and device.area_id is None:
            devices.async_update_device(device.id, area_id=self.area_id)

    @property
    def state_info(self) -> Any:
        """The area's runtime state."""
        return self.manager.areas.get(self.area_id)

    async def _async_show_if_on(self) -> None:
        """Show the (new) selection at once if auto light controls lit lights."""
        lights = self.manager.area_lights(self.area_id)
        if any((s := self.hass.states.get(e)) and s.state == STATE_ON for e in lights):
            await self.manager.async_apply(self.area_id, transition=QUICK_TRANSITION)


class PhaseSensor(AutoLightEntity, SensorEntity):
    """The phase of the day."""

    _platform_domain = Platform.SENSOR
    key = "light_phase"
    _attr_device_class = SensorDeviceClass.ENUM

    def __init__(self, manager: AutoLightManager, area_id: str) -> None:
        """Declare the phases."""
        super().__init__(manager, area_id)
        self._attr_options = list(PHASES)

    @property
    def native_value(self) -> str | None:
        """morning, day, golden, evening or night."""
        state = self.state_info
        return state.selection.phase if state and state.selection else None


class SceneSensor(AutoLightEntity, SensorEntity):
    """The scene of the day (its name; the gallery picture as entity picture)."""

    _platform_domain = Platform.SENSOR
    key = "light_scene"

    @property
    def native_value(self) -> str | None:
        """The scene's name."""
        scene = self._scene()
        return self.manager.scene_name(self.area_id, scene) if scene else None

    def _scene(self) -> str | None:
        state = self.state_info
        return state.selection.scene if state and state.selection else None

    @property
    def entity_picture(self) -> str | None:
        """The scene's gallery thumbnail (shown by Mushroom, Bubble Card, …)."""
        scene = self._scene()
        return f"{STATIC_URL}/gallery/thumb/{scene}.jpg" if scene else None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Where the scene comes from."""
        state = self.state_info
        if not state or not state.selection:
            return None
        selection = state.selection
        return {
            "scene_id": selection.scene,
            "pool": list(selection.pool),
            "pool_phase": selection.pool_phase,
            "season": selection.season,
            "mood": selection.mood,
            "holiday": selection.holiday,
            "step": selection.step,
        }


class BrightnessSensor(AutoLightEntity, SensorEntity):
    """The brightness auto light shows now."""

    _platform_domain = Platform.SENSOR
    key = "light_brightness"
    _attr_native_unit_of_measurement = PERCENTAGE

    @property
    def native_value(self) -> int | None:
        """1-100 %."""
        state = self.state_info
        return state.selection.brightness if state and state.selection else None


class ControlSelect(AutoLightEntity, SelectEntity):
    """Who controls the lights: auto light, a person (manual), or nobody (off)."""

    _platform_domain = Platform.SELECT
    key = "light_control"

    def __init__(self, manager: AutoLightManager, area_id: str) -> None:
        """Declare the controls."""
        super().__init__(manager, area_id)
        self._attr_options = list(CONTROLS)

    @property
    def current_option(self) -> str:
        """auto, manual or off."""
        return self.manager.control(self.area_id)

    async def async_select_option(self, option: str) -> None:
        """Hand control over; back to auto shows the auto scene at once."""
        await self.manager.async_set_control(self.area_id, option)
        if option == CONTROL_AUTO:
            await self._async_show_if_on()


class OffsetNumber(AutoLightEntity, NumberEntity):
    """Personal brightness offset of the current phase."""

    _platform_domain = Platform.NUMBER
    key = "light_offset"
    _attr_native_min_value = -MAX_OFFSET
    _attr_native_max_value = MAX_OFFSET
    _attr_native_step = 5
    _attr_native_unit_of_measurement = PERCENTAGE

    @property
    def native_value(self) -> float | None:
        """Offset of the phase whose pool is used, in %."""
        state = self.state_info
        if not state or not state.selection:
            return None
        offsets = (self.manager.store.areas.get(self.area_id) or {}).get("offsets")
        return (offsets or {}).get(state.selection.pool_phase, 0)

    async def async_set_native_value(self, value: float) -> None:
        """Store it; lit lights follow at once."""
        await self.manager.async_set_offset(self.area_id, round(value))
        await self._async_show_if_on()


class NextSceneButton(AutoLightEntity, ButtonEntity):
    """Another scene of the pool (for the rest of the day and phase)."""

    _platform_domain = Platform.BUTTON
    key = "next_light_scene"

    async def async_press(self) -> None:
        """Skip to the next scene; lit lights show it at once."""
        await self.manager.async_next_scene(self.area_id)
        await self._async_show_if_on()


ENTITIES: dict[Platform, tuple[type[AutoLightEntity], ...]] = {
    Platform.SENSOR: (PhaseSensor, SceneSensor, BrightnessSensor),
    Platform.SELECT: (ControlSelect,),
    Platform.NUMBER: (OffsetNumber,),
    Platform.BUTTON: (NextSceneButton,),
}


@callback
def async_setup_auto_light_entities(
    hass: HomeAssistant,
    entry: Any,
    async_add_entities: AddConfigEntryEntitiesCallback,
    platform: Platform,
) -> None:
    """Add a platform's auto light entities (on the first bridge entry only).

    Areas that get auto light settings later get their entities then.
    """
    bridges = sorted(
        e.entry_id
        for e in hass.config_entries.async_entries(DOMAIN)
        if CONF_HUE_ENTRY_ID in e.data
    )
    if not bridges or bridges[0] != entry.entry_id:
        return
    manager = auto_light_manager(hass)
    added: set[str] = set()

    @callback
    def add_new() -> None:
        new = [area_id for area_id in manager.areas if area_id not in added]
        added.update(new)
        async_add_entities(
            cls(manager, area_id) for area_id in new for cls in ENTITIES[platform]
        )

    add_new()
    unsub: Callable[[], None] = async_dispatcher_connect(hass, SIGNAL_AREAS, add_new)
    entry.async_on_unload(unsub)
