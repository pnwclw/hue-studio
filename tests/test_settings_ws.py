"""Tests for the panel's settings: entertainment areas, bridges, integration options."""

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio.bridges import async_bridges_payload
from custom_components.hue_studio.entertainment import default_points

from .conftest import ENTERTAINMENT, HUE_DOMAIN, make_entertainment


async def _ws(client: Any, **msg: Any) -> dict[str, Any]:
    await client.send_json_auto_id(msg)
    while "event" in (reply := await client.receive_json()):
        pass
    return reply


def test_default_points() -> None:
    """New lights start along the front, spread from left to right."""
    assert default_points(0, 1) == [[0.0, 0.8, 0.0]]
    assert [default_points(i, 3)[0][0] for i in range(3)] == [-0.8, 0.0, 0.8]


async def test_entertainment_areas(
    hass: HomeAssistant,
    hue_lights: MagicMock,
    hue_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """List, create, change lights (kept ones keep their place), move, delete."""
    hue_lights.request = AsyncMock(return_value=[])
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/entertainment/subscribe"})
    assert (await client.receive_json())["success"]
    bridge = (await client.receive_json())["event"][hue_entry.entry_id]
    assert bridge["lights"] == ["light.bulb", "light.strip"]
    assert bridge["areas"] == [
        {
            "id": "ent-tv",
            "name": "TV area",
            "type": "screen",
            "streaming": False,
            "lights": {"light.strip": [[0.0, 0.5, 0.0]]},
        }
    ]

    reply = await _ws(
        client,
        type="hue_studio/entertainment/create",
        name="Desk",
        area_type="monitor",
        lights=["light.bulb"],
    )
    assert reply["success"]
    method, path = hue_lights.request.call_args.args
    assert (method, path) == ("post", "clip/v2/resource/entertainment_configuration")
    assert hue_lights.request.call_args.kwargs["json"] == {
        "type": "entertainment_configuration",
        "metadata": {"name": "Desk"},
        "configuration_type": "monitor",
        "locations": {
            "service_locations": [
                {
                    "service": {"rid": "ent-res-bulb", "rtype": "entertainment"},
                    "positions": [{"x": 0.0, "y": 0.8, "z": 0.0}],
                }
            ]
        },
    }

    reply = await _ws(
        client,
        type="hue_studio/entertainment/update",
        area_id="ent-tv",
        name="TV",
        lights=["light.strip", "light.bulb"],
    )
    assert reply["success"]
    body = hue_lights.request.call_args.kwargs["json"]
    assert body["metadata"] == {"name": "TV"}
    locations = body["locations"]["service_locations"]
    assert locations[0]["positions"] == [{"x": 0.0, "y": 0.5, "z": 0.0}]
    assert locations[1]["positions"] == [{"x": 0.8, "y": 0.8, "z": 0.0}]

    reply = await _ws(
        client,
        type="hue_studio/entertainment/positions",
        area_id="ent-tv",
        positions={"light.strip": [[-2.0, 0.1, 0.2]]},
    )
    assert reply["success"]
    body = hue_lights.request.call_args.kwargs["json"]
    assert body["locations"]["service_locations"][0]["positions"] == [
        {"x": -1.0, "y": 0.1, "z": 0.2}
    ]

    assert (
        await _ws(client, type="hue_studio/entertainment/delete", area_id="ent-tv")
    )["success"]
    assert hue_lights.request.call_args.args == (
        "delete",
        "clip/v2/resource/entertainment_configuration/ent-tv",
    )

    # Nothing changes while an area streams.
    ENTERTAINMENT[:] = [
        make_entertainment("ent-tv", "TV area", ["res-strip"], active=True)
    ]
    reply = await _ws(client, type="hue_studio/entertainment/delete", area_id="ent-tv")
    assert not reply["success"]


async def test_bridges_and_motion_areas(
    hass: HomeAssistant,
    hue_lights: MagicMock,
    hue_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Bridge facts and MotionAware areas, which can be switched off."""
    hue_lights.request = AsyncMock(return_value=[])
    hue_lights.config.bridge_id = "bridge-1"
    hue_lights.config.bridge_device = SimpleNamespace(
        product_data=SimpleNamespace(
            product_name="Hue Bridge Pro", software_version="1.70"
        )
    )
    area = SimpleNamespace(
        id="ma-1",
        name="Office",
        group=SimpleNamespace(rid="room-1"),
        enabled=True,
        health=SimpleNamespace(value="healthy"),
        participants=[
            SimpleNamespace(
                resource=SimpleNamespace(rid="res-bulb"),
                status=SimpleNamespace(health=SimpleNamespace(value="healthy")),
            )
        ],
    )
    configs = hue_lights.config.motion_area_configuration
    configs.__iter__.side_effect = lambda: iter([area])
    configs.get.side_effect = {"ma-1": area}.get
    hue_lights.groups.room.get.return_value = SimpleNamespace(
        metadata=SimpleNamespace(name="Office")
    )

    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/bridges/subscribe"})
    assert (await client.receive_json())["success"]
    bridge = (await client.receive_json())["event"][hue_entry.entry_id]
    assert (bridge["id"], bridge["model"], bridge["software"]) == (
        "bridge-1",
        "Hue Bridge Pro",
        "1.70",
    )
    assert bridge["motion_areas"] == [
        {
            "id": "ma-1",
            "name": "Office",
            "group": "Office",
            "enabled": True,
            "health": "healthy",
            "lights": [{"entity_id": "light.bulb", "health": "healthy"}],
        }
    ]
    assert (bridge["connected"], bridge["pro"], bridge["name"]) == (
        True,
        True,
        "Hue Bridge",
    )
    reply = await _ws(
        client, type="hue_studio/bridges/motion_area", area_id="ma-1", enabled=False
    )
    assert reply["success"]
    assert hue_lights.request.call_args.kwargs["json"] == {"enabled": False}


async def test_bridges_without_pro(
    hass: HomeAssistant,
    hue_lights: MagicMock,
    hue_entry: MockConfigEntry,
) -> None:
    """A bridge without MotionAware is no Bridge Pro; a bridge of the native
    integration Hue Studio is not connected to is listed with what its entry says."""
    hue_lights.config.bridge_device = SimpleNamespace(
        id="dev-bridge",
        metadata=SimpleNamespace(name="Upstairs"),
        product_data=SimpleNamespace(
            product_name="Hue Bridge", software_version="1.70", model_id="BSB002"
        ),
    )
    other = MockConfigEntry(
        domain=HUE_DOMAIN,
        title="Garden Bridge",
        unique_id="bridge-2",
        data={"host": "192.0.2.20", "api_key": "key", "api_version": 2},
    )
    other.add_to_hass(hass)
    payload = async_bridges_payload(hass)
    bridge = payload[hue_entry.entry_id]
    assert (bridge["name"], bridge["pro"], bridge["motion_areas"]) == (
        "Upstairs",
        False,
        None,
    )
    assert payload[other.entry_id] | {"connected": False} == {
        "name": "Garden Bridge",
        "connected": False,
        "host": "192.0.2.20",
        "id": "bridge-2",
        "model": None,
        "software": None,
        "pro": False,
        "ha_device": None,
        "devices": None,
        "lights": None,
        "motion_areas": None,
    }
    # A Bridge Pro without MotionAware areas yet: an empty list.
    hue_lights.config.bridge_device.product_data.model_id = "BSB003"
    assert async_bridges_payload(hass)[hue_entry.entry_id]["motion_areas"] == []


async def test_rename_bridge(
    hass: HomeAssistant,
    hue_lights: MagicMock,
    hue_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A bridge is renamed on the bridge (its device), like in the Hue app."""
    hue_lights.devices.update = AsyncMock()
    hue_lights.config.bridge_device = SimpleNamespace(
        id="dev-bridge", metadata=SimpleNamespace(name="Hue Bridge")
    )
    client = await hass_ws_client(hass)
    reply = await _ws(
        client,
        type="hue_studio/bridges/rename",
        hue_entry_id=hue_entry.entry_id,
        name=" Upstairs ",
    )
    assert reply["success"]
    rid, put = hue_lights.devices.update.call_args.args
    assert (rid, put.metadata.name) == ("dev-bridge", "Upstairs")
    reply = await _ws(
        client, type="hue_studio/bridges/rename", hue_entry_id="nope", name="X"
    )
    assert not reply["success"]


async def test_integration_settings(
    hass: HomeAssistant,
    hue_lights: MagicMock,
    studio_entry: MockConfigEntry,
    hue_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Room mapping and room sensors from the panel end up in the options."""
    group = er.async_get(hass).async_get_or_create(
        "light", HUE_DOMAIN, "grp-room", config_entry=hue_entry
    )
    hass.states.async_set(
        group.entity_id, "on", {"is_hue_group": True, "hue_type": "room"}
    )
    office = ar.async_get(hass).async_create("Office")
    client = await hass_ws_client(hass)
    reply = await _ws(
        client,
        type="hue_studio/config/set_group",
        entity_id=group.entity_id,
        area_id=office.id,
    )
    assert reply["success"], reply
    assert studio_entry.options["groups"] == {"grp-room": office.id}
    assert (
        await _ws(
            client,
            type="hue_studio/config/set_group",
            entity_id=group.entity_id,
            area_id=None,
        )
    )["success"]
    # No area has exactly its lights: a zone anyway, nothing to store.
    assert studio_entry.options["groups"] == {}
    assert not (
        await _ws(
            client,
            type="hue_studio/config/set_group",
            entity_id="light.bulb",
            area_id=None,
        )
    )["success"]

    reply = await _ws(
        client,
        type="hue_studio/config/set_room_sensors",
        room=f"area.{office.id}",
        motion=["binary_sensor.office_motion"],
    )
    assert reply["success"]
    assert studio_entry.options["rooms"] == {
        f"area.{office.id}": {
            "motion": ["binary_sensor.office_motion"],
            "temperature": [],
            "illuminance": [],
        }
    }
    assert (
        await _ws(
            client, type="hue_studio/config/set_room_sensors", room=f"area.{office.id}"
        )
    )["success"]
    assert studio_entry.options["rooms"] == {}
