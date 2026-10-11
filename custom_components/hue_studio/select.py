"""Sync Box selects: sync mode, intensity, HDMI input, entertainment area, LED.

Options are the same strings the popular HACS Sync Box integration uses (input and
area names as the user gave them), so existing automations keep working.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from aiohuesyncbox import ExecutionMode, HdmiSource, LedMode
from homeassistant.components.select import SelectEntity, SelectEntityDescription
from homeassistant.const import EntityCategory, Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import HueStudioConfigEntry
from .auto_entity import async_setup_auto_light_entities
from .entity import SyncBoxEntity
from .sync import INTENSITIES, SYNC_MODES, SyncBoxCoordinator, hue_target, inputs

PARALLEL_UPDATES = 1

LED_MODES = {"off": LedMode.OFF, "normal": LedMode.REGULAR, "dimmed": LedMode.DIMMED}


@dataclass(frozen=True, kw_only=True)
class SyncBoxSelectDescription(SelectEntityDescription):
    """How to read and set one select."""

    options_fn: Callable[[SyncBoxCoordinator], list[str]]
    current_fn: Callable[[SyncBoxCoordinator], str | None]
    select_fn: Callable[[SyncBoxCoordinator, str], Awaitable[None]]


def _inputs(c: SyncBoxCoordinator) -> dict[str, str]:
    """Input name -> API id."""
    return {port.name or key: key for key, port in inputs(c.api).items()}


def _areas(c: SyncBoxCoordinator) -> dict[str, str]:
    """Entertainment area name -> id."""
    return {group.name or group.id: group.id for group in c.api.hue.groups}


def _name_of(mapping: dict[str, str], value: str | None) -> str | None:
    return next((name for name, key in mapping.items() if key == value), None)


async def _select_input(c: SyncBoxCoordinator, option: str) -> None:
    await c.async_set_state(hdmi_source=HdmiSource(_inputs(c)[option]))


async def _select_area(c: SyncBoxCoordinator, option: str) -> None:
    await c.async_set_state(hue_target=hue_target(_areas(c)[option]))


async def _select_led(c: SyncBoxCoordinator, option: str) -> None:
    await c.async_command(c.api.device.set_led_mode(LED_MODES[option]))


def _led(c: SyncBoxCoordinator) -> str | None:
    mode = c.api.device.led_mode
    return next((name for name, value in LED_MODES.items() if value == mode), None)


DESCRIPTIONS = (
    SyncBoxSelectDescription(
        key="sync_mode",
        options_fn=lambda c: SYNC_MODES,
        current_fn=lambda c: c.state.mode,
        # Like the Sync Box app: picking a mode starts syncing in it.
        select_fn=lambda c, option: c.async_set_state(mode=ExecutionMode(option)),
    ),
    SyncBoxSelectDescription(
        key="intensity",
        options_fn=lambda c: INTENSITIES,
        current_fn=lambda c: c.state.intensity,
        select_fn=lambda c, option: c.async_set_state(
            **c.mode_changes(intensity=option)
        ),
    ),
    SyncBoxSelectDescription(
        key="hdmi_input",
        options_fn=lambda c: list(_inputs(c)),
        current_fn=lambda c: _name_of(_inputs(c), c.state.input),
        select_fn=_select_input,
    ),
    SyncBoxSelectDescription(
        key="entertainment_area",
        options_fn=lambda c: sorted(_areas(c), key=str.casefold),
        current_fn=lambda c: _name_of(_areas(c), c.state.area),
        select_fn=_select_area,
    ),
    SyncBoxSelectDescription(
        key="led_indicator",
        entity_category=EntityCategory.CONFIG,
        options_fn=lambda c: list(LED_MODES),
        current_fn=_led,
        select_fn=_select_led,
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HueStudioConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Add the selects of a Sync Box."""
    if entry.runtime_data.bridge is not None:
        async_setup_auto_light_entities(
            hass, entry, async_add_entities, Platform.SELECT
        )
        return
    coordinator = entry.runtime_data.sync
    assert coordinator is not None
    async_add_entities(SyncBoxSelect(coordinator, d) for d in DESCRIPTIONS)


class SyncBoxSelect(SyncBoxEntity, SelectEntity):
    """A select backed by the box state."""

    _platform_domain = Platform.SELECT

    entity_description: SyncBoxSelectDescription

    def __init__(
        self, coordinator: SyncBoxCoordinator, description: SyncBoxSelectDescription
    ) -> None:
        """Bind the description."""
        super().__init__(coordinator, description.key)
        self.entity_description = description

    @property
    def options(self) -> list[str]:
        """Options right now (input and area names can change)."""
        return self.entity_description.options_fn(self.coordinator)

    @property
    def current_option(self) -> str | None:
        """The selected option."""
        return self.entity_description.current_fn(self.coordinator)

    async def async_select_option(self, option: str) -> None:
        """Send the choice to the box."""
        await self.entity_description.select_fn(self.coordinator, option)
