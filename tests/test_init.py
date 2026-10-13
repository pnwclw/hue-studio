"""Tests for Hue Studio setup and unload: the bridges of the Hue Studio entry."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from aiohue import Unauthorized
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import CONF_HOST
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.hue_studio.const import (
    CONF_HUE_ENTRY_ID,
    CONF_KIND,
    DOMAIN,
    HUE_CONF_API_KEY,
    HUE_CONF_API_VERSION,
    HUE_DOMAIN,
    KIND_STUDIO,
)

from .conftest import BRIDGE_HOST, BRIDGE_ID


def _bridges(entry: MockConfigEntry) -> dict:
    return entry.runtime_data.connections.bridges


def _second_hue_entry(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(
        domain=HUE_DOMAIN,
        title="Upstairs Bridge",
        unique_id="001788fffe111111",
        data={
            CONF_HOST: "192.0.2.11",
            HUE_CONF_API_KEY: "other-key",
            HUE_CONF_API_VERSION: 2,
        },
    )
    entry.add_to_hass(hass)
    return entry


async def test_setup_and_unload(
    hass: HomeAssistant,
    hue_entry: MockConfigEntry,
    studio_entry: MockConfigEntry,
    mock_bridge: MagicMock,
) -> None:
    """Setup uses the native entry's host and app key; the bridge is a service
    device linked to the native bridge device; unload closes the bridge."""
    devices = dr.async_get(hass)
    native = devices.async_get_or_create(
        config_entry_id=hue_entry.entry_id, identifiers={(HUE_DOMAIN, "dev-bridge")}
    )
    bridge = mock_bridge.return_value
    bridge.config.bridge_device = SimpleNamespace(
        id="dev-bridge",
        product_data=SimpleNamespace(
            manufacturer_name="Signify Netherlands B.V.",
            product_name="Hue Bridge Pro",
            software_version="1.70.0",
        ),
    )
    assert await hass.config_entries.async_setup(studio_entry.entry_id)
    await hass.async_block_till_done()

    assert studio_entry.state is ConfigEntryState.LOADED
    mock_bridge.assert_called_once_with(BRIDGE_HOST, "test-app-key")
    bridge.initialize.assert_awaited_once()
    assert _bridges(studio_entry) == {hue_entry.entry_id: bridge}
    device = devices.async_get_device_by_identifier(
        (DOMAIN, BRIDGE_ID), studio_entry.entry_id
    )
    assert device is not None
    assert device.entry_type is dr.DeviceEntryType.SERVICE
    assert device.name == "Hue Bridge"
    assert device.model == "Hue Bridge Pro"
    assert device.sw_version == "1.70.0"
    assert device.via_device_id == native.id
    assert device.configuration_url == "homeassistant://hue/settings/bridges"

    assert await hass.config_entries.async_unload(studio_entry.entry_id)
    assert studio_entry.state is ConfigEntryState.NOT_LOADED
    bridge.close.assert_awaited_once()


async def test_unreachable_bridge_retried(
    hass: HomeAssistant, studio_entry: MockConfigEntry, mock_bridge: MagicMock
) -> None:
    """A bridge that does not answer does not hold up setup; it is tried again."""
    bridge = mock_bridge.return_value
    bridge.initialize.side_effect = [TimeoutError, None]
    with patch("custom_components.hue_studio.connections.RETRY_MIN", 0):
        assert await hass.config_entries.async_setup(studio_entry.entry_id)
        await hass.async_block_till_done()

    assert studio_entry.state is ConfigEntryState.LOADED
    assert bridge.initialize.await_count == 2
    assert bridge.close.await_count == 1
    assert len(_bridges(studio_entry)) == 1


async def test_rejected_app_key_not_retried(
    hass: HomeAssistant, studio_entry: MockConfigEntry, mock_bridge: MagicMock
) -> None:
    """A rejected app key waits for the native entry to be fixed (and reloaded)."""
    bridge = mock_bridge.return_value
    bridge.initialize.side_effect = Unauthorized
    with patch("custom_components.hue_studio.connections.RETRY_MIN", 0):
        assert await hass.config_entries.async_setup(studio_entry.entry_id)
        await hass.async_block_till_done()

    assert studio_entry.state is ConfigEntryState.LOADED
    bridge.initialize.assert_awaited_once()
    assert _bridges(studio_entry) == {}


async def test_follows_native_entries(
    hass: HomeAssistant,
    hue_entry: MockConfigEntry,
    studio_entry: MockConfigEntry,
    mock_bridge: MagicMock,
) -> None:
    """A bridge added to the native integration later is used at once; unloading
    its entry closes it, removing it removes its device."""
    assert await hass.config_entries.async_setup(studio_entry.entry_id)
    await hass.async_block_till_done()
    devices = dr.async_get(hass)

    other = _second_hue_entry(hass)
    assert await hass.config_entries.async_setup(other.entry_id)
    await hass.async_block_till_done()
    assert set(_bridges(studio_entry)) == {hue_entry.entry_id, other.entry_id}
    mock_bridge.assert_called_with("192.0.2.11", "other-key")
    assert devices.async_get_device_by_identifier(
        (DOMAIN, "001788fffe111111"), studio_entry.entry_id
    )

    # A reload closes the connection and opens it again.
    assert await hass.config_entries.async_reload(other.entry_id)
    await hass.async_block_till_done()
    assert set(_bridges(studio_entry)) == {hue_entry.entry_id, other.entry_id}

    assert await hass.config_entries.async_unload(other.entry_id)
    await hass.async_block_till_done()
    assert set(_bridges(studio_entry)) == {hue_entry.entry_id}

    await hass.config_entries.async_remove(other.entry_id)
    await hass.async_block_till_done()
    assert (
        devices.async_get_device_by_identifier(
            (DOMAIN, "001788fffe111111"), studio_entry.entry_id
        )
        is None
    )
    assert devices.async_get_device_by_identifier(
        (DOMAIN, BRIDGE_ID), studio_entry.entry_id
    )


async def test_stale_bridge_device_removed(
    hass: HomeAssistant, studio_entry: MockConfigEntry, mock_bridge: MagicMock
) -> None:
    """A bridge the native integration lost while HA was off loses its device."""
    devices = dr.async_get(hass)
    stale = devices.async_get_or_create(
        config_entry_id=studio_entry.entry_id, identifiers={(DOMAIN, "gone")}
    )
    assert await hass.config_entries.async_setup(studio_entry.entry_id)
    await hass.async_block_till_done()
    assert devices.async_get(stale.id) is None


async def test_old_bridge_entries_merged(
    hass: HomeAssistant, hue_entry: MockConfigEntry, mock_bridge: MagicMock
) -> None:
    """Entries of one bridge each become the Hue Studio entry with all options."""
    other = _second_hue_entry(hass)
    first = MockConfigEntry(
        domain=DOMAIN,
        title="Hue Bridge",
        unique_id=BRIDGE_ID,
        data={CONF_HUE_ENTRY_ID: hue_entry.entry_id},
        options={
            "groups": {"grp-a": "office"},
            "rooms": {"area.office": {"motion": ["binary_sensor.a"]}},
            "footer": True,
        },
    )
    second = MockConfigEntry(
        domain=DOMAIN,
        title="Upstairs Bridge",
        unique_id=other.unique_id,
        data={CONF_HUE_ENTRY_ID: other.entry_id},
        options={"groups": {"grp-b": "zone"}, "auto_align": True, "footer": True},
    )
    first.add_to_hass(hass)
    second.add_to_hass(hass)

    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()

    entries = hass.config_entries.async_entries(DOMAIN)
    assert entries == [first]
    assert first.data == {CONF_KIND: KIND_STUDIO}
    assert first.unique_id == DOMAIN
    assert first.title == "Hue Studio"
    assert first.options == {
        "groups": {"grp-a": "office", "grp-b": "zone"},
        "rooms": {"area.office": {"motion": ["binary_sensor.a"]}},
        "auto_align": True,
        "footer": True,
    }
    assert first.state is ConfigEntryState.LOADED
    assert set(_bridges(first)) == {hue_entry.entry_id, other.entry_id}


async def test_unknown_entry_kind(hass: HomeAssistant, mock_bridge: MagicMock) -> None:
    """An entry of a kind this version does not know fails to set up."""
    entry = MockConfigEntry(domain=DOMAIN, data={CONF_KIND: "from_the_future"})
    entry.add_to_hass(hass)

    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.SETUP_ERROR
