"""Tests for adding Hue devices from Home Assistant."""

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from aiohue.v2.controllers.events import EventType
from aiohue.v2.models.device import (
    Device,
    DeviceArchetypes,
    DeviceMetaData,
    DeviceProductData,
)
from aiohue.v2.models.feature import (
    MotionSensingFeatureSensitivity,
    MotionSensingFeatureSensitivityStatus,
)
from aiohue.v2.models.motion import Motion
from aiohue.v2.models.resource import ResourceIdentifier, ResourceTypes
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio.devices import device_kind

from .conftest import HUE_DOMAIN


def _device(
    rid: str,
    name: str,
    services: list[tuple[str, ResourceTypes]],
    archetype: str = "sultan_bulb",
) -> Device:
    return Device(
        id=rid,
        services=[ResourceIdentifier(rid=s, rtype=t) for s, t in services],
        product_data=DeviceProductData(
            model_id="LCA001",
            manufacturer_name="Signify",
            product_name="Hue color lamp",
            product_archetype=DeviceArchetypes(archetype),
            certified=True,
            software_version="1.0",
        ),
        metadata=DeviceMetaData(archetype=DeviceArchetypes(archetype), name=name),
    )


DEVICES = {
    "dev-bridge": _device("dev-bridge", "Bridge", [], "bridge_v2"),
    "dev-bulb": _device(
        "dev-bulb", "Hue color lamp 1", [("res-bulb", ResourceTypes.LIGHT)]
    ),
    "dev-motion": _device(
        "dev-motion",
        "Hue motion sensor 1",
        [("m1", ResourceTypes.MOTION), ("t1", ResourceTypes.TEMPERATURE)],
        "unknown_archetype",
    ),
    "dev-dial": _device(
        "dev-dial", "Tap dial", [("b1", ResourceTypes.BUTTON)], "unknown_archetype"
    ),
}


def test_device_kind() -> None:
    """What a device mainly is, from its services."""
    assert [device_kind(d) for d in DEVICES.values()] == [
        "other",
        "light",
        "sensor",
        "switch",
    ]


@pytest.fixture
def bridge(hue_lights: MagicMock) -> MagicMock:
    """The mocked bridge with devices and a Zigbee device discovery resource."""
    hue_lights.devices = MagicMock()
    hue_lights.devices.__iter__.side_effect = lambda: iter(DEVICES.values())
    hue_lights.devices.get.side_effect = DEVICES.get
    hue_lights.devices.update = AsyncMock()
    hue_lights.devices.set_identify = AsyncMock()
    hue_lights.devices.subscribe.return_value = MagicMock()
    motion = Motion(
        id="m1",
        owner=ResourceIdentifier(rid="dev-motion", rtype=ResourceTypes.DEVICE),
        enabled=True,
        sensitivity=MotionSensingFeatureSensitivity(sensitivity=2, sensitivity_max=4),
    )
    hue_lights.sensors.motion.get.side_effect = {"m1": motion}.get
    hue_lights.sensors.motion.update = AsyncMock()
    hue_lights.sensors.motion.subscribe.return_value = MagicMock()
    discovery = hue_lights.config.zigbee_device_discovery
    discovery.__iter__.side_effect = lambda: iter(
        [SimpleNamespace(id="disc-1", status=SimpleNamespace(value="ready"))]
    )
    discovery.search = AsyncMock()
    discovery.subscribe.return_value = MagicMock()
    return hue_lights


async def _ws(client: Any, **msg: Any) -> dict[str, Any]:
    await client.send_json_auto_id(msg)
    while "event" in (reply := await client.receive_json()):
        pass
    return reply


async def test_add_devices(
    hass: HomeAssistant,
    bridge: MagicMock,
    hue_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Search, a device joins, it gets a name, an area and the matching Hue room."""
    devices = dr.async_get(hass)
    lamp = devices.async_get_or_create(
        config_entry_id=hue_entry.entry_id, identifiers={(HUE_DOMAIN, "dev-bulb")}
    )
    sensor = devices.async_get_or_create(
        config_entry_id=hue_entry.entry_id,
        identifiers={(HUE_DOMAIN, "dev-motion")},
    )
    office = ar.async_get(hass).async_create("Office")

    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/devices/subscribe"})
    assert (await client.receive_json())["success"]
    state = (await client.receive_json())["event"][hue_entry.entry_id]
    assert state["searching"] is False
    listed = {d["id"]: d for d in state["devices"]}
    # Devices without an area (the bridge itself is never listed).
    assert set(listed) == {"dev-bulb", "dev-motion", "dev-dial"}
    assert listed["dev-bulb"] | {"found": None} == {
        "id": "dev-bulb",
        "name": "Hue color lamp 1",
        "product": "Hue color lamp",
        "model": "LCA001",
        "archetype": "sultan_bulb",
        "kind": "light",
        "new": False,
        "found": None,
        "area": None,
        "lights": ["light.bulb"],
        "ha_device": lamp.id,
        "sensitivity": None,
    }
    assert listed["dev-motion"]["ha_device"] == sensor.id
    assert listed["dev-motion"]["sensitivity"] == {
        "value": 2,
        "max": 4,
        "changing": False,
    }

    assert (
        await _ws(client, type="hue_studio/devices/search", serials=[" ab12cd ", ""])
    )["success"]
    bridge.config.zigbee_device_discovery.search.assert_awaited_once_with(
        "disc-1", search_codes=["AB12CD"]
    )

    # The bridge adds the dial: it is new until set up.
    added = bridge.devices.subscribe.call_args.args[0]
    added(EventType.RESOURCE_ADDED, DEVICES["dev-dial"])
    await hass.async_block_till_done()
    state = (await client.receive_json())["event"][hue_entry.entry_id]
    assert state["devices"][0]["id"] == "dev-dial"
    assert state["devices"][0]["new"] is True

    assert (await _ws(client, type="hue_studio/devices/identify", device="dev-bulb"))[
        "success"
    ]
    bridge.devices.set_identify.assert_awaited_once_with("dev-bulb")

    with patch(
        "custom_components.hue_studio.devices.async_align", AsyncMock()
    ) as align:
        reply = await _ws(
            client,
            type="hue_studio/devices/setup",
            device="dev-bulb",
            name="Desk lamp",
            area_id=office.id,
        )
    assert reply["success"]
    put = bridge.devices.update.call_args.args[1]
    assert put.metadata.name == "Desk lamp"
    assert devices.async_get(lamp.id).area_id == office.id
    align.assert_awaited_once_with(
        hass, only={"light.bulb"}, hue_entry_id=hue_entry.entry_id
    )

    reply = await _ws(
        client, type="hue_studio/devices/setup", device="dev-gone", area_id=office.id
    )
    assert not reply["success"]


async def test_motion_sensitivity(
    hass: HomeAssistant,
    bridge: MagicMock,
    hue_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A motion sensor's sensitivity is set on the bridge (clamped); others refuse."""
    office = ar.async_get(hass).async_create("Office")
    client = await hass_ws_client(hass)
    reply = await _ws(
        client,
        type="hue_studio/devices/setup",
        device="dev-motion",
        area_id=office.id,
        sensitivity=9,
    )
    assert reply["success"]
    rid, put = bridge.sensors.motion.update.call_args.args
    assert rid == "m1"
    assert put.sensitivity.sensitivity == 4

    bridge.sensors.motion.update.reset_mock()
    reply = await _ws(
        client,
        type="hue_studio/devices/setup",
        device="dev-motion",
        area_id=office.id,
        sensitivity=2,
    )
    assert reply["success"]
    bridge.sensors.motion.update.assert_not_awaited()

    reply = await _ws(
        client,
        type="hue_studio/devices/setup",
        device="dev-bulb",
        area_id=office.id,
        sensitivity=1,
    )
    assert not reply["success"]
    assert "motion sensitivity" in reply["error"]["message"]

    # A changed sensitivity on the bridge reaches the panel; plain motion does not.
    from custom_components.hue_studio.devices import async_watch_bridges

    async_watch_bridges(hass)
    changed = bridge.sensors.motion.subscribe.call_args.args[0]
    motion = bridge.sensors.motion.get("m1")
    with patch("custom_components.hue_studio.devices.async_dispatcher_send") as send:
        changed(EventType.RESOURCE_UPDATED, motion)
        changed(EventType.RESOURCE_UPDATED, motion)
    assert send.call_count == 1
    # So does calibration starting after a change.
    motion.sensitivity.status = MotionSensingFeatureSensitivityStatus.CHANGING
    with patch("custom_components.hue_studio.devices.async_dispatcher_send") as send:
        changed(EventType.RESOURCE_UPDATED, motion)
    assert send.call_count == 1


async def test_sensitivity_alone(
    hass: HomeAssistant,
    bridge: MagicMock,
    hue_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """The sensitivity sheet tries values out live: only the sensitivity changes."""
    client = await hass_ws_client(hass)
    reply = await _ws(
        client,
        type="hue_studio/devices/sensitivity",
        device="dev-motion",
        sensitivity=0,
    )
    assert reply["success"]
    rid, put = bridge.sensors.motion.update.call_args.args
    assert (rid, put.sensitivity.sensitivity) == ("m1", 0)
    bridge.devices.update.assert_not_awaited()

    reply = await _ws(
        client, type="hue_studio/devices/sensitivity", device="dev-bulb", sensitivity=1
    )
    assert not reply["success"]
