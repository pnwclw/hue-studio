"""Tests for the `/hue` panel."""

from http import HTTPStatus
from pathlib import Path
from unittest.mock import MagicMock, patch

from homeassistant.components.frontend import DATA_PANELS
from homeassistant.core import HomeAssistant
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import (
    AiohttpClientMocker,
)
from pytest_homeassistant_custom_component.typing import ClientSessionGenerator

from custom_components.hue_studio.panel import PANEL_URL_PATH, STATIC_URL
from custom_components.hue_studio.scenes.gallery import async_gallery_scenes
from custom_components.hue_studio.scenes.pictures import THUMB_DIR

PICTURES = "custom_components.hue_studio.scenes.pictures"


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
    # The panel pads the safe areas itself; HA must not pad it as well.
    assert custom["handle_safe_area"] is True

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


async def test_gallery_picture(
    hass: HomeAssistant,
    hass_client_no_auth: ClientSessionGenerator,
    aioclient_mock: AiohttpClientMocker,
    studio_entry: MockConfigEntry,
    mock_bridge: MagicMock,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A gallery picture is the Hue app's, downloaded once; the tile stands in."""
    hass.config.config_dir = str(tmp_path)
    local = tmp_path / "local"
    local.mkdir()
    monkeypatch.setattr(f"{PICTURES}.LOCAL_DIR", local)
    assert await hass.config_entries.async_setup(studio_entry.entry_id)
    await hass.async_block_till_done()
    scenes = await async_gallery_scenes(hass)
    scene = next(s for s in scenes.values() if s.get("picture"))
    plain = next(s for s in scenes.values() if not s.get("picture"))
    tile = (THUMB_DIR / f"{scene['id']}.jpg").read_bytes()
    client = await hass_client_no_auth()

    # The download fails: the bundled tile, asked for again next time.
    aioclient_mock.get(scene["picture"], status=HTTPStatus.SERVICE_UNAVAILABLE)
    resp = await client.get(f"/api/hue_studio/gallery/{scene['id']}.jpg")
    assert resp.status == 200
    assert await resp.read() == tile
    assert resp.headers["Cache-Control"] == "no-cache"
    # ...and it is not tried again right away.
    await client.get(f"/api/hue_studio/gallery/{scene['id']}.jpg")
    assert aioclient_mock.call_count == 1

    # Later it downloads (at the tile's size, as JPEG) and is then kept.
    aioclient_mock.clear_requests()
    original = bytes(range(256)) * 1000  # several chunks
    aioclient_mock.get(
        scene["picture"], content=original, headers={"Content-Type": "image/jpeg"}
    )
    with patch(f"{PICTURES}.time.monotonic", return_value=1e9):
        resp = await client.get(f"/api/hue_studio/gallery/{scene['id']}.jpg")
        assert await resp.read() == original
        resp = await client.get(f"/api/hue_studio/gallery/{scene['id']}.jpg")
        assert await resp.read() == original
    assert aioclient_mock.call_count == 1
    assert aioclient_mock.mock_calls[0][1].query["w"] == "960"
    assert "max-age" in resp.headers["Cache-Control"]

    # A scene without one gets its tile; nothing else is served.
    resp = await client.get(f"/api/hue_studio/gallery/{plain['id']}.jpg")
    assert await resp.read() == (THUMB_DIR / f"{plain['id']}.jpg").read_bytes()
    resp = await client.get("/api/hue_studio/gallery/not_a_scene.jpg")
    assert resp.status == 404

    # A picture of its own (not in the repository) comes first.
    for own in (scene, plain):
        (local / f"{own['id']}.jpg").write_bytes(b"own")
        resp = await client.get(f"/api/hue_studio/gallery/{own['id']}.jpg")
        assert await resp.read() == b"own"
