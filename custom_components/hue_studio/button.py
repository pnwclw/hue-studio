"""Buttons: auto light's "next scene" (a bridge entry's areas)."""

from __future__ import annotations

from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import HueStudioConfigEntry
from .auto_entity import async_setup_auto_light_entities

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HueStudioConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Add the auto light buttons of the areas."""
    async_setup_auto_light_entities(hass, entry, async_add_entities, Platform.BUTTON)
