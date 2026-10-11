"""Tests for rooms following areas: align_rooms, zones, the rooms WS API."""

from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from aiohue.errors import AiohueException
from aiohue.v2.models.resource import ResourceIdentifier, ResourceTypes
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.util import dt as dt_util
import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio.const import CONF_AUTO_ALIGN, DOMAIN
from custom_components.hue_studio.options import async_frontend_config

from .conftest import SCENES


def _device(rid: str) -> ResourceIdentifier:
    return ResourceIdentifier(rid=rid, rtype=ResourceTypes.DEVICE)


def _room(
    rid: str, name: str, devices: list[str], grouped: str | None
) -> SimpleNamespace:
    return SimpleNamespace(
        id=rid,
        metadata=SimpleNamespace(name=name),
        children=[_device(d) for d in devices],
        grouped_light=grouped,
    )


@pytest.fixture
def rooms_bridge(hass: HomeAssistant, hue_lights: MagicMock) -> MagicMock:
    """One Hue room "Living room" (strip and bulb); the bulb's area is the kitchen.

    `light.room` is the room's grouped light, `light.tv` a zone over the strip.
    """
    hue_entry = hass.config_entries.async_entries("hue")[0]
    entities = er.async_get(hass)
    areas = ar.async_get(hass)
    living = areas.async_create("Living room", icon="mdi:sofa")
    kitchen = areas.async_create("Kitchen", icon="mdi:stove")
    entities.async_update_entity("light.strip", area_id=living.id)
    entities.async_update_entity("light.bulb", area_id=kitchen.id)
    hass.states.async_remove("light.room")
    for object_id, unique_id in (("room", "res-grouped"), ("tv", "res-zone-light")):
        entities.async_get_or_create(
            "light",
            "hue",
            unique_id,
            config_entry=hue_entry,
            suggested_object_id=object_id,
        )
    owners = {
        "res-grouped": ResourceIdentifier(rid="res-room", rtype=ResourceTypes.ROOM),
        "res-zone-light": ResourceIdentifier(rid="res-zone", rtype=ResourceTypes.ZONE),
    }
    hue_lights.groups.grouped_light.get.side_effect = lambda rid: (
        SimpleNamespace(owner=owners[rid]) if rid in owners else None
    )
    hue_lights.groups.zone.get_lights.return_value = []
    hue_lights.rooms = [
        _room(
            "res-room", "Living room", ["dev-res-strip", "dev-res-bulb"], "res-grouped"
        )
    ]
    hue_lights.groups.room.__iter__.side_effect = lambda: iter(hue_lights.rooms)
    hue_lights.scenes.scene.__iter__.side_effect = lambda: iter(SCENES.values())
    hue_lights.request = AsyncMock(return_value=[{"rid": "res-new", "rtype": "room"}])
    return hue_lights


async def _align(hass: HomeAssistant, **data: object) -> dict:
    return await hass.services.async_call(
        DOMAIN, "align_rooms", data, blocking=True, return_response=True
    )


async def test_dry_run(hass: HomeAssistant, rooms_bridge: MagicMock) -> None:
    """The plan names lights, rooms and scenes by entity id; nothing is sent."""
    plan = await _align(hass, dry_run=True)
    rooms_bridge.request.assert_not_awaited()
    assert plan["changed"] is True
    rooms = {r["area"]: r for r in plan["rooms"]}
    assert rooms["living_room"] == {
        "area": "living_room",
        "name": "Living room",
        "create": False,
        "rename": False,
        "current_name": "Living room",
        "group": "light.room",
        "lights": ["light.strip"],
    }
    assert rooms["kitchen"]["create"] is True
    assert rooms["kitchen"]["lights"] == ["light.bulb"]
    assert plan["moves"] == [
        {
            "lights": ["light.bulb"],
            "area": "kitchen",
            "from": "Living room",
            "from_group": "light.room",
            "from_area": "living_room",
        }
    ]
    assert {s["entity_id"] for s in plan["scenes"]} == {"scene.sunset", "scene.plain"}
    assert plan["scenes"][0]["lost"] == ["light.bulb"]
    assert plan["hue_rooms"] == {
        "light.strip": "Living room",
        "light.bulb": "Living room",
    }
    assert plan["empty"] == [] and plan["conflicts"] == []
    # The room is split (strip stays, bulb goes): its name stays with the room.
    assert plan["splits"] == [
        {
            "name": "Living room + Kitchen",
            "from": "Living room",
            "group": "light.room",
            "lights": ["light.bulb", "light.strip"],
            "scenes": ["scene.sunset", "scene.plain"],
        }
    ]


async def test_apply(hass: HomeAssistant, rooms_bridge: MagicMock) -> None:
    """The bulb leaves the living room first, then the kitchen room is created."""
    await _align(hass)
    calls = [(c.args, c.kwargs.get("json")) for c in rooms_bridge.request.mock_calls]
    assert calls == [
        (
            ("put", "clip/v2/resource/room/res-room"),
            {"children": [{"rid": "dev-res-strip", "rtype": "device"}]},
        ),
        (
            ("post", "clip/v2/resource/room"),
            {
                "metadata": {"name": "Kitchen", "archetype": "kitchen"},
                "children": [{"rid": "dev-res-bulb", "rtype": "device"}],
            },
        ),
    ]


async def test_keep_split_scenes(hass: HomeAssistant, rooms_bridge: MagicMock) -> None:
    """A zone over the split room's lights gets copies of its scenes, rooms after."""
    rooms_bridge.groups.room.get.side_effect = lambda rid: SimpleNamespace(
        metadata=SimpleNamespace(archetype=SimpleNamespace(value="living_room"))
    )
    rooms_bridge.request = AsyncMock(
        side_effect=lambda method, path, **_: [{"rid": f"new-{path.split('/')[-1]}"}]
    )
    await _align(hass, keep_split_scenes=True)
    calls = [(c.args, c.kwargs.get("json")) for c in rooms_bridge.request.mock_calls]
    assert [args for args, _ in calls] == [
        ("post", "clip/v2/resource/zone"),
        ("post", "clip/v2/resource/scene"),
        ("post", "clip/v2/resource/scene"),
        ("put", "clip/v2/resource/room/res-room"),
        ("post", "clip/v2/resource/room"),
    ]
    assert calls[0][1] == {
        "type": "zone",
        "metadata": {"name": "Living room + Kitchen", "archetype": "living_room"},
        "children": [
            {"rid": "res-bulb", "rtype": "light"},
            {"rid": "res-strip", "rtype": "light"},
        ],
    }
    sunset = calls[1][1]
    assert sunset["group"] == {"rid": "new-zone", "rtype": "zone"}
    assert sunset["metadata"] == {"name": "Sunset"}
    assert [a["target"]["rid"] for a in sunset["actions"]] == ["res-strip", "res-bulb"]
    assert (sunset["speed"], sunset["auto_dynamic"]) == (0.5, False)
    assert len(sunset["palette"]["color"]) == 3
    assert "effects" not in sunset["palette"]
    assert "palette" not in calls[2][1]


async def test_keep_split_scenes_fails_first(
    hass: HomeAssistant, rooms_bridge: MagicMock
) -> None:
    """When the zone cannot be made, no room is changed."""
    rooms_bridge.request = AsyncMock(side_effect=AiohueException("nope"))
    with pytest.raises(HomeAssistantError) as err:
        await _align(hass, keep_split_scenes=True)
    assert err.value.translation_key == "split_zone_failed"
    assert [c.args for c in rooms_bridge.request.mock_calls] == [
        ("post", "clip/v2/resource/zone")
    ]


async def test_complete_scenes_and_delete_empty(
    hass: HomeAssistant, rooms_bridge: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Joining lights get actions in the room's scenes; empty rooms can go."""
    # The kitchen exists already (empty, with a palette scene); an old room is empty.
    rooms_bridge.rooms.append(_room("res-kitchen", "Kitchen", [], None))
    rooms_bridge.rooms.append(_room("res-old", "Old", [], None))
    cook = replace(
        SCENES["res-scene"],
        id="res-cook",
        group=ResourceIdentifier(rid="res-kitchen", rtype=ResourceTypes.ROOM),
        actions=[],
    )
    monkeypatch.setitem(SCENES, "res-cook", cook)

    await _align(hass, delete_empty_rooms=True)
    calls = [c.args for c in rooms_bridge.request.mock_calls]
    assert calls == [
        ("put", "clip/v2/resource/room/res-room"),
        ("put", "clip/v2/resource/room/res-kitchen"),
        ("delete", "clip/v2/resource/room/res-old"),
    ]
    assert rooms_bridge.request.mock_calls[1].kwargs["json"] == {
        "children": [{"rid": "dev-res-bulb", "rtype": "device"}]
    }
    scene_id, put = rooms_bridge.scenes.scene.update.call_args.args
    assert scene_id == "res-cook"
    (action,) = put.actions
    assert action.target.rid == "res-bulb"
    # From the scene's palette: the bulb shows its first color.
    assert (action.action.color.xy.x, action.action.color.xy.y) == (0.6, 0.35)


async def test_align_one_light(hass: HomeAssistant, rooms_bridge: MagicMock) -> None:
    """With a target, only those lights move (e.g. "Restore in Hue")."""
    rooms_bridge.rooms.append(_room("res-kitchen", "Kitchen", [], None))
    plan = await _align(hass, entity_id="light.strip", dry_run=True)
    assert plan["moves"] == [] and plan["rooms"] == []
    plan = await _align(hass, entity_id="light.bulb", dry_run=True)
    assert [m["lights"] for m in plan["moves"]] == [["light.bulb"]]
    assert [(r["area"], r["create"]) for r in plan["rooms"]] == [("kitchen", False)]


async def test_zones(hass: HomeAssistant, rooms_bridge: MagicMock) -> None:
    """Zones are renamed, refilled and deleted; rooms are refused."""
    await hass.services.async_call(
        DOMAIN,
        "update_zone",
        {
            "entity_id": "light.tv",
            "name": "TV",
            "lights": ["light.strip", "light.bulb"],
        },
        blocking=True,
    )
    args = rooms_bridge.request.call_args
    assert args.args == ("put", "clip/v2/resource/zone/res-zone")
    assert args.kwargs["json"] == {
        "metadata": {"name": "TV"},
        "children": [
            {"rid": "res-strip", "rtype": "light"},
            {"rid": "res-bulb", "rtype": "light"},
        ],
    }
    await hass.services.async_call(
        DOMAIN, "delete_zone", {"entity_id": "light.tv"}, blocking=True
    )
    rooms_bridge.request.assert_awaited_with("delete", "clip/v2/resource/zone/res-zone")
    rooms_bridge.request.reset_mock()
    with pytest.raises(ServiceValidationError) as err:
        await hass.services.async_call(
            DOMAIN, "delete_zone", {"entity_id": "light.room"}, blocking=True
        )
    assert err.value.translation_key == "not_hue_zone"
    rooms_bridge.request.assert_not_awaited()


async def test_ws_rooms(
    hass: HomeAssistant, rooms_bridge: MagicMock, hass_ws_client: WebSocketGenerator
) -> None:
    """The plan is pushed at once and again when an area changes."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/rooms/subscribe"})
    assert (await client.receive_json())["success"]
    first = (await client.receive_json())["event"]
    assert first["changed"] is True

    er.async_get(hass).async_update_entity("light.bulb", area_id="living_room")
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=2))
    second = (await client.receive_json())["event"]
    assert second["changed"] is False
    assert second["moves"] == []


async def test_ws_set_area(
    hass: HomeAssistant, rooms_bridge: MagicMock, hass_ws_client: WebSocketGenerator
) -> None:
    """A light's area goes to its device; an area of the entity itself is dropped."""
    hue_entry = hass.config_entries.async_entries("hue")[0]
    devices = dr.async_get(hass)
    device = devices.async_get_or_create(
        config_entry_id=hue_entry.entry_id, identifiers={("hue", "dev-res-bulb")}
    )
    entities = er.async_get(hass)
    # The bulb entity still has an area of its own (kitchen).
    entities.async_update_entity("light.bulb", device_id=device.id)
    client = await hass_ws_client(hass)

    async def set_area(area_id: str | None) -> bool:
        await client.send_json_auto_id(
            {
                "type": "hue_studio/lights/set_area",
                "entity_id": "light.bulb",
                "area_id": area_id,
            }
        )
        return (await client.receive_json())["success"]

    assert await set_area("living_room")
    assert devices.async_get(device.id).area_id == "living_room"
    assert entities.async_get("light.bulb").area_id is None
    assert await set_area(None)
    assert devices.async_get(device.id).area_id is None
    assert not await set_area("nope")


async def test_auto_align(
    hass: HomeAssistant, rooms_bridge: MagicMock, studio_entry: MockConfigEntry
) -> None:
    """With the option on, an area change is written to the bridge."""
    entities = er.async_get(hass)
    entities.async_update_entity("light.bulb", area_id="living_room")
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=2))
    await hass.async_block_till_done()
    rooms_bridge.request.assert_not_awaited()

    hass.config_entries.async_update_entry(
        studio_entry, options={CONF_AUTO_ALIGN: True}
    )
    await hass.async_block_till_done()
    entities.async_update_entity("light.bulb", area_id="kitchen")
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=4))
    await hass.async_block_till_done()
    assert [c.args[0] for c in rooms_bridge.request.mock_calls] == ["put", "post"]


async def test_ws_set_config(
    hass: HomeAssistant,
    rooms_bridge: MagicMock,
    studio_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """The panel's settings change the options of the bridge entries."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "hue_studio/config/set", "auto_align": True}
    )
    assert (await client.receive_json())["success"]
    assert studio_entry.options[CONF_AUTO_ALIGN] is True


async def test_ws_set_footer(
    hass: HomeAssistant,
    rooms_bridge: MagicMock,
    studio_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Experimental footer settings are panel options too; at most five tabs."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "hue_studio/config/set", "footer": True, "footer_tabs": ["hue", "map"]}
    )
    assert (await client.receive_json())["success"]
    assert studio_entry.options["footer"] is True
    assert studio_entry.options["footer_tabs"] == ["hue", "map"]
    config = async_frontend_config(hass)
    assert (config["footer"], config["footer_tabs"]) == (True, ["hue", "map"])

    await client.send_json_auto_id(
        {"type": "hue_studio/config/set", "footer_tabs": list("abcdef")}
    )
    assert not (await client.receive_json())["success"]
