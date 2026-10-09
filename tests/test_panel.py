"""Tests for the `/hue` panel."""

from unittest.mock import MagicMock

from homeassistant.components.frontend import DATA_PANELS
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import ClientSessionGenerator

from custom_components.hue_studio.panel import PANEL_URL_PATH, STATIC_URL


async def test_panel_lifecycle(
    hass: HomeAssistant,
    hass_client: ClientSessionGenerator,
    studio_entry: MockConfigEntry,
    mock_bridge: MagicMock,
) -> None:
    """The panel and its files are served while an entry is loaded."""
    assert await hass.config_entries.async_setup(studio_entry.entry_id)
    await hass.async_block_till_done()

    panel = hass.data[DATA_PANELS][PANEL_URL_PATH]
    custom = panel.config["_panel_custom"]
    assert custom["name"] == "hue-studio-panel"
    assert custom["module_url"].startswith(f"{STATIC_URL}/hue-studio-panel.js?v=")

    client = await hass_client()
    resp = await client.get(f"{STATIC_URL}/hue-studio-panel.js")
    assert resp.status == 200
    resp = await client.get(f"{STATIC_URL}/gallery/gallery.json")
    assert resp.status == 200
    gallery = await resp.json()
    assert gallery["scenes"]
    assert {s["category"] for s in gallery["scenes"]} <= {
        c["id"] for c in gallery["categories"]
    }

    assert await hass.config_entries.async_unload(studio_entry.entry_id)
    assert PANEL_URL_PATH not in hass.data[DATA_PANELS]
