"""Sensors: the phase of the day (Hue Studio entry); a Sync Box's HDMI ports,
content, bridge connection and Wi-Fi."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from aiohuesyncbox import ConnectionState, HueSyncBox, PortStatus, WifiStrength
from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
)
from homeassistant.const import EntityCategory, Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import HueStudioConfigEntry, daylight, pool
from .connections import is_studio
from .entity import SyncBoxEntity
from .sync import INPUTS, SyncBoxCoordinator, inputs

PARALLEL_UPDATES = 0

PORT_STATES = [s.value for s in PortStatus if s != PortStatus.UNKNOWN_API_VALUE]
BRIDGE_STATES = [
    s.value for s in ConnectionState if s != ConnectionState.UNKNOWN_API_VALUE
]
# By WifiStrength value (0-4).
WIFI_STRENGTHS = [s.name.lower() for s in sorted(WifiStrength)]


@dataclass(frozen=True, kw_only=True)
class SyncBoxSensorDescription(SensorEntityDescription):
    """How to read one sensor from the box."""

    value_fn: Callable[[HueSyncBox], str | None]
    exists_fn: Callable[[HueSyncBox], bool] = lambda api: True


def _enum(value: str | None, options: list[str]) -> str | None:
    """A value the sensor declares (unknown values of the API become None)."""
    return value if value in options else None


def _port(key: str) -> SyncBoxSensorDescription:
    return SyncBoxSensorDescription(
        key=f"hdmi{key[-1]}_status",
        device_class=SensorDeviceClass.ENUM,
        options=PORT_STATES,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda api: _enum(
            port.status.value if (port := inputs(api).get(key)) else None, PORT_STATES
        ),
        exists_fn=lambda api: key in inputs(api),
    )


def _wifi(api: HueSyncBox) -> str | None:
    wifi = api.device.wifi
    if wifi is None or not 0 <= wifi.strength < len(WIFI_STRENGTHS):
        return None
    return WIFI_STRENGTHS[wifi.strength]


DESCRIPTIONS = (
    *(_port(key) for key in INPUTS),
    SyncBoxSensorDescription(
        key="content_info",
        value_fn=lambda api: (api.hdmi.content_specs or None) if api.hdmi else None,
        exists_fn=lambda api: api.hdmi is not None,
    ),
    SyncBoxSensorDescription(
        key="bridge_connection",
        device_class=SensorDeviceClass.ENUM,
        options=BRIDGE_STATES,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda api: _enum(api.hue.connection_state.value, BRIDGE_STATES),
    ),
    SyncBoxSensorDescription(
        key="wifi_quality",
        device_class=SensorDeviceClass.ENUM,
        options=WIFI_STRENGTHS,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=_wifi,
        exists_fn=lambda api: api.device.wifi is not None,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HueStudioConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Add the phase of the day, or the sensors of a Sync Box."""
    if is_studio(entry):
        async_add_entities([PhaseSensor()])
        return
    coordinator = entry.runtime_data.sync
    assert coordinator is not None
    async_add_entities(
        SyncBoxSensor(coordinator, d)
        for d in DESCRIPTIONS
        if d.exists_fn(coordinator.api)
    )


class SyncBoxSensor(SyncBoxEntity, SensorEntity):
    """A sensor backed by the box state."""

    _platform_domain = Platform.SENSOR

    entity_description: SyncBoxSensorDescription

    def __init__(
        self, coordinator: SyncBoxCoordinator, description: SyncBoxSensorDescription
    ) -> None:
        """Bind the description."""
        super().__init__(coordinator, description.key)
        self.entity_description = description

    @property
    def native_value(self) -> str | None:
        """Current value."""
        return self.entity_description.value_fn(self.coordinator.api)


class PhaseSensor(SensorEntity):
    """The phase of the day of the global light of the day, with season and weather."""

    _attr_has_entity_name = True
    _attr_translation_key = "phase"
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_unique_id = pool.PHASE_UNIQUE_ID
    _attr_should_poll = False

    def __init__(self) -> None:
        """Attach to Hue Studio's own device."""
        # Only a suggestion; not derived from the translated name.
        self.entity_id = "sensor.hue_studio_phase"
        self._attr_options = list(daylight.PHASES)
        self._attr_native_value = None
        self._attr_extra_state_attributes = {}
        self._attr_device_info = pool.device_info()

    async def async_added_to_hass(self) -> None:
        """Follow the clock, the settings and the mood."""
        self.async_on_remove(
            pool.async_track_light_of_the_day(self.hass, self._async_changed)
        )
        await self._async_refresh()

    @callback
    def _async_changed(self) -> None:
        self.hass.async_create_task(self._async_refresh(), "hue_studio_phase")

    async def _async_refresh(self) -> None:
        selection = await pool.async_selection(self.hass)
        attributes = {"season": selection.season, "weather": selection.weather}
        if (selection.phase, attributes) == (
            self._attr_native_value,
            self._attr_extra_state_attributes,
        ):
            return
        self._attr_native_value = selection.phase
        self._attr_extra_state_attributes = attributes
        self.async_write_ha_state()
