"""Sync Box switches: power and light sync."""

from __future__ import annotations

from typing import Any

from aiohuesyncbox import ExecutionMode
from homeassistant.components.switch import SwitchEntity
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import HueStudioConfigEntry
from .entity import SyncBoxEntity

PARALLEL_UPDATES = 1


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HueStudioConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Add the switches of a Sync Box."""
    coordinator = entry.runtime_data.sync
    assert coordinator is not None
    async_add_entities(
        [PowerSwitch(coordinator, "power"), SyncSwitch(coordinator, "light_sync")]
    )


class PowerSwitch(SyncBoxEntity, SwitchEntity):
    """On = HDMI passes through (or syncs); off = power save."""

    _platform_domain = Platform.SWITCH

    @property
    def is_on(self) -> bool:
        """Whether the box is out of power save."""
        return self.coordinator.state.power

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Wake up into passthrough (sync stays off until asked)."""
        await self.coordinator.async_set_state(mode=ExecutionMode.PASSTHROUGH)

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Power save."""
        await self.coordinator.async_set_state(mode=ExecutionMode.POWERSAVE)


class SyncSwitch(SyncBoxEntity, SwitchEntity):
    """Light sync in the last used mode."""

    _platform_domain = Platform.SWITCH

    @property
    def is_on(self) -> bool:
        """Whether the lights follow the picture or music."""
        return self.coordinator.state.syncing

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Start syncing (wakes the box up if needed)."""
        await self.coordinator.async_set_state(sync_active=True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Stop syncing; the picture keeps passing through."""
        await self.coordinator.async_set_state(sync_active=False)
