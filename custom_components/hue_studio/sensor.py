"""Sync Box sensors: HDMI ports, content, bridge connection, Wi-Fi."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
)
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import HueStudioConfigEntry
from .entity import SyncBoxEntity
from .sync import INPUTS, SyncBoxCoordinator

PARALLEL_UPDATES = 0

PORT_STATES = ["unplugged", "plugged", "linked", "unknown"]
BRIDGE_STATES = [
    "uninitialized",
    "disconnected",
    "connecting",
    "unauthorized",
    "connected",
    "invalidgroup",
    "streaming",
    "busy",
]
WIFI_STRENGTHS = ["not_connected", "weak", "fair", "good", "excellent"]


@dataclass(frozen=True, kw_only=True)
class SyncBoxSensorDescription(SensorEntityDescription):
    """How to read one sensor from the full state."""

    value_fn: Callable[[dict[str, Any]], str | None]
    exists_fn: Callable[[dict[str, Any]], bool] = lambda data: True


def _enum(value: Any, options: list[str]) -> str | None:
    return value if value in options else None


def _port(key: str) -> SyncBoxSensorDescription:
    return SyncBoxSensorDescription(
        key=f"hdmi{key[-1]}_status",
        device_class=SensorDeviceClass.ENUM,
        options=PORT_STATES,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data: _enum(
            ((data.get("hdmi") or {}).get(key) or {}).get("status"), PORT_STATES
        ),
        exists_fn=lambda data: isinstance((data.get("hdmi") or {}).get(key), dict),
    )


def _wifi(data: dict[str, Any]) -> str | None:
    strength = (data["device"].get("wifi") or {}).get("strength")
    if isinstance(strength, int) and 0 <= strength < len(WIFI_STRENGTHS):
        return WIFI_STRENGTHS[strength]
    return None


DESCRIPTIONS = (
    *(_port(key) for key in INPUTS),
    SyncBoxSensorDescription(
        key="content_info",
        value_fn=lambda data: (data.get("hdmi") or {}).get("contentSpecs") or None,
    ),
    SyncBoxSensorDescription(
        key="bridge_connection",
        device_class=SensorDeviceClass.ENUM,
        options=BRIDGE_STATES,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda data: _enum(
            (data.get("hue") or {}).get("connectionState"), BRIDGE_STATES
        ),
    ),
    SyncBoxSensorDescription(
        key="wifi_quality",
        device_class=SensorDeviceClass.ENUM,
        options=WIFI_STRENGTHS,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=_wifi,
        exists_fn=lambda data: "wifi" in data["device"],
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
        if d.exists_fn(coordinator.data)
    )


class SyncBoxSensor(SyncBoxEntity, SensorEntity):
    """A sensor backed by the box state."""

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
        return self.entity_description.value_fn(self.coordinator.data)
