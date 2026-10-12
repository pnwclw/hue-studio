"""Sync Box brightness."""

from __future__ import annotations

from homeassistant.components.number import NumberEntity
from homeassistant.const import PERCENTAGE, Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import HueStudioConfigEntry
from .entity import SyncBoxEntity
from .sync import pct_to_api

PARALLEL_UPDATES = 1


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HueStudioConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Add the brightness of a Sync Box."""
    coordinator = entry.runtime_data.sync
    assert coordinator is not None
    async_add_entities([BrightnessNumber(coordinator, "brightness")])


class BrightnessNumber(SyncBoxEntity, NumberEntity):
    """Sync brightness, 1-100 % (the box's 0-200, where 100 follows the source)."""

    _platform_domain = Platform.NUMBER

    _attr_native_min_value = 1
    _attr_native_max_value = 100
    _attr_native_step = 1
    _attr_native_unit_of_measurement = PERCENTAGE

    @property
    def native_value(self) -> float:
        """Brightness in percent."""
        return self.coordinator.state.brightness

    async def async_set_native_value(self, value: float) -> None:
        """Set the brightness."""
        await self.coordinator.async_set_state(brightness=pct_to_api(value))
