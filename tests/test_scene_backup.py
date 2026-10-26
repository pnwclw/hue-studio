"""Tests for exporting bridge scenes to a file and making them again."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from aiohue.v2.models.resource import ResourceIdentifier, ResourceTypes
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
import pytest
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio.const import DOMAIN
from custom_components.hue_studio.scene_backup import backup_folder, stale_copies

from .conftest import LIGHTS, ROOMS, SCENES


def test_stale_copies() -> None:
    """The newest copies stay, and an older one that holds a deleted scene."""
    copies = [
        ("c5", {"a"}),
        ("c4", {"a"}),
        ("c3", {"a", "b"}),  # "b" was deleted after this one
        ("c2", {"a", "b"}),
        ("c1", {"a", "c"}),  # "c" too, before
    ]
    assert stale_copies(copies, 2) == ["c2"]
    assert stale_copies(copies, 5) == []
    assert stale_copies([("c2", {"a"}), ("c1", {"a"})], 1) == ["c1"]


@pytest.fixture
def bridge(hass: HomeAssistant, hue_lights: MagicMock) -> MagicMock:
    """The mocked bridge with its room, lights by MAC and scenes to walk through."""
    hue_lights.config.bridge_id = "bridge-1"
    hue_lights.config.bridge_device = None
    hue_lights.scenes.scene.__iter__.side_effect = lambda: iter(SCENES.values())
    hue_lights.lights.__iter__.side_effect = lambda: iter(LIGHTS.values())
    hue_lights.groups.room.__iter__.side_effect = lambda: iter(ROOMS.values())
    hue_lights.groups.room.get_lights.side_effect = lambda rid: list(LIGHTS.values())
    hue_lights.devices.get.side_effect = lambda device_id: SimpleNamespace(
        services=[
            ResourceIdentifier(
                rid=device_id.removeprefix("dev-"), rtype=ResourceTypes.LIGHT
            )
        ]
    )
    hue_lights.devices.get_zigbee_connectivity.side_effect = lambda device_id: (
        SimpleNamespace(mac_address=f"00:17:88:{device_id}")
    )
    hue_lights.request = AsyncMock(return_value=[{"rid": "res-new", "rtype": "scene"}])
    return hue_lights


async def _export(hass: HomeAssistant, **data: object) -> dict:
    return await hass.services.async_call(
        DOMAIN, "export_scenes", data, blocking=True, return_response=True
    )


async def test_export(hass: HomeAssistant, bridge: MagicMock) -> None:
    """Every scene with its room's name and its lights by MAC, name and entity."""
    result = await _export(hass)
    assert result["scenes"] == 2
    data = json.loads((backup_folder(hass) / result["file"]).read_text())
    (saved,) = data["bridges"]
    assert saved["id"] == "bridge-1"
    assert saved["lights"]["res-strip"] == {
        "mac": "00:17:88:dev-res-strip",
        "index": 0,
        "name": "res-strip",
        "entity_id": "light.strip",
    }
    sunset = next(s for s in saved["scenes"] if s["id"] == "res-scene")
    assert sunset["group"] == {"type": "room", "name": "Living room"}
    assert sunset["entity_id"] == "scene.sunset"
    assert sunset["body"]["metadata"] == {"name": "Sunset"}
    assert "effects" not in sunset["body"]["palette"]
    assert "group" not in sunset["body"]


async def test_export_keeps_deleted_scenes(
    hass: HomeAssistant, bridge: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An export right after a scene was deleted keeps the copy that has it."""
    folder: Path = backup_folder(hass)
    plain = SimpleNamespace(**vars(SCENES["res-plain"]))
    plain.metadata = SimpleNamespace(name="Plain", image=None, appdata=None)
    monkeypatch.setitem(SCENES, "res-plain", plain)
    first = (await _export(hass, keep=1))["file"]
    # Copies made in the same second would share a name.
    (folder / first).rename(folder / "scenes-20000101-000000.json")
    monkeypatch.delitem(SCENES, "res-plain")
    second = await _export(hass, keep=1)
    assert second["removed"] == []
    (folder / second["file"]).rename(folder / "scenes-20000102-000000.json")
    third = await _export(hass, keep=1)
    # The second copy has nothing the newest lacks; the first still has "Plain".
    assert third["removed"] == ["scenes-20000102-000000.json"]
    assert (folder / "scenes-20000101-000000.json").exists()


async def test_import(hass: HomeAssistant, bridge: MagicMock) -> None:
    """Scenes come back in the room of their name, lights found by MAC."""
    file = (await _export(hass))["file"]
    # Re-paired: new light ids, same MACs.
    bridge.scenes.scene.__iter__.side_effect = lambda: iter([])
    renamed = {
        "new-strip": SimpleNamespace(
            **{**vars(LIGHTS["res-strip"]), "id": "new-strip"}
        ),
    }
    bridge.lights.__iter__.side_effect = lambda: iter(renamed.values())
    bridge.lights.get.side_effect = renamed.get
    bridge.groups.room.get_lights.side_effect = lambda rid: list(renamed.values())

    plan = await hass.services.async_call(
        DOMAIN,
        "import_scenes",
        {"file": file, "dry_run": True},
        blocking=True,
        return_response=True,
    )
    assert plan["created"] == [
        {"scene": "Sunset", "group": "Living room"},
        {"scene": "Sunset", "group": "Living room"},
    ]
    assert plan["missing_lights"][0]["lights"] == ["res-bulb"]
    bridge.request.assert_not_awaited()

    await hass.services.async_call(DOMAIN, "import_scenes", {}, blocking=True)
    method, path = bridge.request.call_args.args
    body = bridge.request.call_args.kwargs["json"]
    assert (method, path) == ("post", "clip/v2/resource/scene")
    assert body["group"] == {"rid": "res-room", "rtype": "room"}
    assert [a["target"]["rid"] for a in body["actions"]] == ["new-strip"]


async def test_import_existing(hass: HomeAssistant, bridge: MagicMock) -> None:
    """A scene of that name stays unless replaced (its picture kept then)."""
    await _export(hass)
    plan = await hass.services.async_call(
        DOMAIN, "import_scenes", {}, blocking=True, return_response=True
    )
    assert {s["reason"] for s in plan["skipped"]} == {"exists"}
    bridge.request.assert_not_awaited()

    await hass.services.async_call(
        DOMAIN, "import_scenes", {"replace": True}, blocking=True
    )
    method, path = bridge.request.call_args.args
    assert method == "put"
    assert path.startswith("clip/v2/resource/scene/res-")
    assert "metadata" not in bridge.request.call_args.kwargs["json"]


async def test_import_only_our_files(hass: HomeAssistant, bridge: MagicMock) -> None:
    """A file is a name in our folder, never a path."""
    for name in ("../secrets.yaml", "scenes-missing.json", "other.json"):
        with pytest.raises(ServiceValidationError):
            await hass.services.async_call(
                DOMAIN, "import_scenes", {"file": name}, blocking=True
            )


async def test_list_backups(
    hass: HomeAssistant, bridge: MagicMock, hass_ws_client: WebSocketGenerator
) -> None:
    """The panel lists the copies, newest first."""
    file = (await _export(hass))["file"]
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/scenes/backups"})
    result = (await client.receive_json())["result"]
    assert result["backups"][0]["file"] == file
    assert result["backups"][0]["scenes"] == 2
