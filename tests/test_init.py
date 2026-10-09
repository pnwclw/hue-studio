"""Tests for Hue Studio setup and unload."""

from unittest.mock import MagicMock

from aiohue import Unauthorized
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from .conftest import BRIDGE_HOST


async def test_setup_and_unload(
    hass: HomeAssistant, studio_entry: MockConfigEntry, mock_bridge: MagicMock
) -> None:
    """Setup uses the native entry's host and app key; unload closes the bridge."""
    assert await hass.config_entries.async_setup(studio_entry.entry_id)
    await hass.async_block_till_done()

    assert studio_entry.state is ConfigEntryState.LOADED
    mock_bridge.assert_called_once_with(BRIDGE_HOST, "test-app-key")
    bridge = mock_bridge.return_value
    bridge.initialize.assert_awaited_once()
    assert studio_entry.runtime_data.bridge is bridge

    assert await hass.config_entries.async_unload(studio_entry.entry_id)
    assert studio_entry.state is ConfigEntryState.NOT_LOADED
    bridge.close.assert_awaited_once()


@pytest.mark.parametrize(
    ("error", "state"),
    [
        (TimeoutError, ConfigEntryState.SETUP_RETRY),
        (Unauthorized, ConfigEntryState.SETUP_ERROR),
    ],
)
async def test_setup_bridge_errors(
    hass: HomeAssistant,
    studio_entry: MockConfigEntry,
    mock_bridge: MagicMock,
    error: type[Exception],
    state: ConfigEntryState,
) -> None:
    """Connection problems retry; a rejected app key fails without retrying."""
    mock_bridge.return_value.initialize.side_effect = error

    await hass.config_entries.async_setup(studio_entry.entry_id)
    await hass.async_block_till_done()

    assert studio_entry.state is state
    mock_bridge.return_value.close.assert_awaited_once()


async def test_setup_hue_entry_missing(hass: HomeAssistant) -> None:
    """If the linked native Hue entry is gone, setup fails."""
    entry = MockConfigEntry(
        domain="hue_studio", data={"hue_entry_id": "does-not-exist"}
    )
    entry.add_to_hass(hass)

    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.SETUP_ERROR
