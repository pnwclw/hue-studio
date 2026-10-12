"""Sync Box sensors: HDMI ports, content, bridge connection, Wi-Fi."""

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
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import HueStudioConfigEntry
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
    """Add the sensors of a Sync Box."""
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
