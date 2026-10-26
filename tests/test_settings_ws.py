"""Tests for the panel's settings: entertainment areas, bridges, integration options."""

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

from aiohue.v2.models.resource import ResourceTypes
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, entity_registry as er
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio.bridges.info import async_bridges_payload
from custom_components.hue_studio.space.entertainment import default_points

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


def _participant(rid: str, health: str = "healthy") -> SimpleNamespace:
    return SimpleNamespace(
        resource=SimpleNamespace(rid=rid),
        status=SimpleNamespace(health=SimpleNamespace(value=health)),
    )


def _area_sensor(rid: str, sensitivity: int = 2) -> SimpleNamespace:
    return SimpleNamespace(
        id=rid,
        enabled=True,
        sensitivity=SimpleNamespace(sensitivity=sensitivity, sensitivity_max=4),
    )


@pytest.fixture
def motion_bridge(
    hass: HomeAssistant, hue_lights: MagicMock, hue_entry: MockConfigEntry
) -> SimpleNamespace:
    """A Bridge Pro with four lights that can sense (bulb, strip, lamp, spot) in one
    room, an area of three of them and the Hue app's response to it."""
    registry = er.async_get(hass)
    for name in ("lamp", "spot"):
        registry.async_get_or_create(
            "light",
            HUE_DOMAIN,
            f"res-{name}",
            config_entry=hue_entry,
            suggested_object_id=name,
        )
    registry.async_get_or_create(
        "binary_sensor",
        HUE_DOMAIN,
        "sec-1",
        config_entry=hue_entry,
        suggested_object_id="office_area",
    )
    names = ("bulb", "strip", "lamp", "spot")
    devices = {
        f"dev-{n}": SimpleNamespace(
            lights=[f"res-{n}"], metadata=SimpleNamespace(name=n.title())
        )
        for n in names
    }
    hue_lights.devices.get.side_effect = devices.get
    candidates = [
        {
            "id": f"cand-{n}",
            "owner": {"rid": f"dev-{n}", "rtype": "device"},
            "type": "motion_area_candidate",
        }
        for n in names
    ]

    async def request(method: str, path: str, **kwargs: Any) -> Any:
        if method == "get" and path.endswith("motion_area_candidate"):
            return candidates
        if method == "post":
            return [{"rid": "ma-new", "rtype": "motion_area_configuration"}]
        return []

    hue_lights.request = AsyncMock(side_effect=request)
    hue_lights.config.bridge_id = "bridge-1"
    hue_lights.config.bridge_device = SimpleNamespace(
        product_data=SimpleNamespace(
            product_name="Hue Bridge", software_version="1.70", model_id="BSB003"
        )
    )
    room = SimpleNamespace(
        id="room-1",
        metadata=SimpleNamespace(name="Office"),
        children=[SimpleNamespace(rid=f"dev-{n}") for n in names],
    )
    hue_lights.groups.room.__iter__.side_effect = lambda: iter([room])
    hue_lights.groups.room.get.side_effect = {"room-1": room}.get
    hue_lights.groups.zone.__iter__.side_effect = lambda: iter([])
    hue_lights.groups.zone.get.return_value = None
    area = SimpleNamespace(
        id="ma-1",
        name="Office",
        group=SimpleNamespace(rid="room-1"),
        enabled=True,
        health=SimpleNamespace(value="healthy"),
        participants=[_participant(f"cand-{n}") for n in ("bulb", "strip", "lamp")],
        services=[
            SimpleNamespace(rid="conv-1", rtype=ResourceTypes.CONVENIENCE_AREA_MOTION),
            SimpleNamespace(rid="sec-1", rtype=ResourceTypes.SECURITY_AREA_MOTION),
        ],
    )
    configs = hue_lights.config.motion_area_configuration
    configs.__iter__.side_effect = lambda: iter([area])
    configs.get.side_effect = {"ma-1": area}.get
    hue_lights.sensors.convenience_area_motion.get.side_effect = {
        "conv-1": _area_sensor("conv-1", 3)
    }.get
    hue_lights.sensors.security_area_motion.get.side_effect = {
        "sec-1": _area_sensor("sec-1")
    }.get
    response = SimpleNamespace(
        id="beh-1",
        enabled=True,
        metadata=SimpleNamespace(name="Office"),
        configuration={
            "source": {"rid": "ma-1", "rtype": "motion_area_configuration"},
            "motion": {
                "motion_service": {"rid": "conv-1", "rtype": "convenience_area_motion"},
                "when": {"timeslots": [{}, {}, {}]},
            },
        },
    )
    hue_lights.config.behavior_instance.__iter__.side_effect = lambda: iter([response])
    hue_lights.config.behavior_instance.get.side_effect = {"beh-1": response}.get
    hue_lights.config.service_group.__iter__.side_effect = lambda: iter([])
    return SimpleNamespace(bridge=hue_lights, area=area)


async def test_motion_areas_payload(
    hass: HomeAssistant,
    motion_bridge: SimpleNamespace,
    hue_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A Bridge Pro's MotionAware: its areas with their lights (participants are
    candidates, one per light device), sensors, calibration and the Hue app's
    response; the lights that can sense and the rooms they are in."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/bridges/subscribe"})
    assert (await client.receive_json())["success"]
    # The candidates are read once Hue Studio follows the bridge.
    while True:
        bridge = (await client.receive_json())["event"][hue_entry.entry_id]
        if bridge["motion_lights"] is not None:
            break
    assert (bridge["id"], bridge["model"], bridge["pro"]) == (
        "bridge-1",
        "Hue Bridge Pro",
        True,
    )
    assert bridge["motion_areas"] == [
        {
            "id": "ma-1",
            "name": "Office",
            "group": "Office",
            "group_id": "room-1",
            "group_type": "room",
            "enabled": True,
            "health": "healthy",
            "calibrating": False,
            "calibration_started": None,
            "lights": [
                {
                    "id": f"cand-{n}",
                    "device": f"dev-{n}",
                    "entity_id": f"light.{n}",
                    "health": "healthy",
                }
                for n in ("bulb", "strip", "lamp")
            ],
            "sensitivity": {"value": 3, "max": 4},
            "security_sensitivity": {"value": 2, "max": 4},
            "sensor": "binary_sensor.office_area",
            "responses": [
                {"id": "beh-1", "name": "Office", "enabled": True, "slots": 3}
            ],
        }
    ]
    assert [light["entity_id"] for light in bridge["motion_lights"]] == [
        "light.bulb",
        "light.strip",
        "light.lamp",
        "light.spot",
    ]
    assert bridge["motion_groups"] == [
        {
            "id": "room-1",
            "type": "room",
            "name": "Office",
            "lights": ["cand-bulb", "cand-strip", "cand-lamp", "cand-spot"],
        }
    ]

    # Switched off and on again: the bridge calibrates, lights unhealthy until done.
    area = motion_bridge.area
    reply = await _ws(
        client, type="hue_studio/bridges/motion_area", area_id="ma-1", enabled=False
    )
    assert reply["success"]
    assert motion_bridge.bridge.request.call_args.kwargs["json"] == {"enabled": False}
    area.enabled = False
    reply = await _ws(
        client, type="hue_studio/bridges/motion_area", area_id="ma-1", enabled=True
    )
    area.enabled = True
    area.participants = [
        _participant(f"cand-{n}", "unhealthy") for n in ("bulb", "strip", "lamp")
    ]
    payload = async_bridges_payload(hass)[hue_entry.entry_id]["motion_areas"][0]
    assert payload["calibrating"] is True
    assert payload["calibration_started"] is not None


async def test_motion_area_commands(
    hass: HomeAssistant,
    motion_bridge: SimpleNamespace,
    hass_ws_client: WebSocketGenerator,
    hue_entry: MockConfigEntry,
) -> None:
    """Create, change, recalibrate and delete areas; switch off the Hue app's
    response."""
    request = motion_bridge.bridge.request
    client = await hass_ws_client(hass)

    reply = await _ws(
        client,
        type="hue_studio/motion_areas/create",
        hue_entry_id=hue_entry.entry_id,
        group="room-1",
        lights=["light.bulb", "light.strip", "light.spot"],
        name=" Desk ",
    )
    assert reply["success"], reply
    assert reply["result"] == {"area_id": "ma-new"}
    assert request.call_args.args == (
        "post",
        "clip/v2/resource/motion_area_configuration",
    )
    assert request.call_args.kwargs["json"] == {
        "type": "motion_area_configuration",
        "name": "Desk",
        "group": {"rid": "room-1", "rtype": "room"},
        "participants": [
            {"resource": {"rid": f"cand-{n}", "rtype": "motion_area_candidate"}}
            for n in ("bulb", "strip", "spot")
        ],
        "enabled": True,
    }
    # Too few lights, a light that cannot sense, a group that is not on the bridge.
    for bad in (
        {"lights": ["light.bulb", "light.strip"], "group": "room-1"},
        {
            "lights": ["light.bulb", "light.strip", "light.other_brand"],
            "group": "room-1",
        },
        {"lights": ["light.bulb", "light.strip", "light.spot"], "group": "room-x"},
    ):
        reply = await _ws(
            client,
            type="hue_studio/motion_areas/create",
            hue_entry_id=hue_entry.entry_id,
            name="X",
            **bad,
        )
        assert not reply["success"]

    request.reset_mock()
    reply = await _ws(
        client,
        type="hue_studio/motion_areas/update",
        area_id="ma-1",
        name="Study",
        lights=["light.bulb", "light.strip", "light.lamp", "light.spot"],
        sensitivity=9,
        security_sensitivity=2,
    )
    assert reply["success"], reply
    calls = [(c.args, c.kwargs.get("json")) for c in request.call_args_list]
    assert calls == [
        (
            ("put", "clip/v2/resource/motion_area_configuration/ma-1"),
            {
                "name": "Study",
                "participants": [
                    {"resource": {"rid": f"cand-{n}", "rtype": "motion_area_candidate"}}
                    for n in ("bulb", "strip", "lamp", "spot")
                ],
            },
        ),
        # Clamped to the sensor's range; the security sensor already has its value.
        (
            ("put", "clip/v2/resource/convenience_area_motion/conv-1"),
            {"sensitivity": {"sensitivity": 4}},
        ),
    ]

    request.reset_mock()
    reply = await _ws(
        client, type="hue_studio/motion_areas/recalibrate", area_id="ma-1"
    )
    assert reply["success"]
    assert [c.kwargs["json"] for c in request.call_args_list] == [
        {"enabled": False},
        {"enabled": True},
    ]

    reply = await _ws(
        client,
        type="hue_studio/motion_areas/response",
        behavior_id="beh-1",
        enabled=False,
    )
    assert reply["success"]
    assert request.call_args.args == ("put", "clip/v2/resource/behavior_instance/beh-1")
    assert request.call_args.kwargs["json"] == {"enabled": False}

    reply = await _ws(client, type="hue_studio/motion_areas/delete", area_id="ma-1")
    assert reply["success"]
    assert request.call_args.args == (
        "delete",
        "clip/v2/resource/motion_area_configuration/ma-1",
    )
    reply = await _ws(client, type="hue_studio/motion_areas/delete", area_id="ma-x")
    assert not reply["success"]


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
        "rooms": None,
        "zones": None,
        "motion_areas": None,
        "motion_lights": None,
        "motion_groups": None,
    }
    # A Bridge Pro without MotionAware areas yet: an empty list. It calls itself
    # "Hue Bridge"; its model id names it.
    hue_lights.config.bridge_device.product_data.model_id = "BSB003"
    pro = async_bridges_payload(hass)[hue_entry.entry_id]
    assert (pro["motion_areas"], pro["model"]) == ([], "Hue Bridge Pro")


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
