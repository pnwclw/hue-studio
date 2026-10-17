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
    PowerUpPreset,
)
from aiohue.v2.models.light import LightFunction
from aiohue.v2.models.motion import Motion
from aiohue.v2.models.resource import ResourceIdentifier, ResourceTypes
from aiohue.v2.models.zigbee_device_discovery import (
    AddInstallCodes,
    InstallCode,
    SearchActionType,
    ZigbeeDeviceDiscoveryActionPut,
    ZigbeeDeviceDiscoveryPut,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio.devices import async_devices_payload, device_kind

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
    hue_lights.devices.get_zigbee_connectivity.side_effect = lambda rid: (
        SimpleNamespace(status=SimpleNamespace(value="disconnected"))
        if rid == "dev-dial"
        else None
    )
    hue_lights.request = AsyncMock(return_value=[])
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
        "software": "1.0",
        "reachable": None,
        "function": None,
        "power_on": None,
    }
    assert listed["dev-dial"]["reachable"] is False
    assert state["search_started"] is None
    assert state["other_brands"] is False
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


async def test_light_settings(
    hass: HomeAssistant,
    bridge: MagicMock,
    hue_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A light's function and power-on behavior: listed, set on the bridge (only
    what changed), refused for other devices; changes on the bridge reach the panel."""
    light = SimpleNamespace(
        id="res-bulb",
        metadata=SimpleNamespace(function=LightFunction.DECORATIVE),
        powerup=SimpleNamespace(preset=PowerUpPreset.SAFETY),
    )
    bridge.lights.get.side_effect = {"res-bulb": light}.get
    state = async_devices_payload(hass)[hue_entry.entry_id]
    listed = {d["id"]: d for d in state["devices"]}
    assert (listed["dev-bulb"]["function"], listed["dev-bulb"]["power_on"]) == (
        "decorative",
        "safety",
    )
    assert listed["dev-motion"]["function"] is None

    client = await hass_ws_client(hass)
    reply = await _ws(
        client,
        type="hue_studio/devices/setup",
        device="dev-bulb",
        function="decorative",
        power_on="last_on_state",
    )
    assert reply["success"]
    bridge.request.assert_awaited_once_with(
        "put",
        "clip/v2/resource/light/res-bulb",
        json={"powerup": {"preset": "last_on_state"}},
    )

    bridge.request.reset_mock()
    reply = await _ws(
        client, type="hue_studio/devices/setup", device="dev-bulb", power_on="safety"
    )
    assert reply["success"]
    bridge.request.assert_not_awaited()

    reply = await _ws(
        client, type="hue_studio/devices/setup", device="dev-dial", function="mixed"
    )
    assert not reply["success"]
    assert "not a light" in reply["error"]["message"]
    reply = await _ws(
        client, type="hue_studio/devices/setup", device="dev-bulb", power_on="custom"
    )
    assert not reply["success"]

    from custom_components.hue_studio.devices import async_watch_bridges

    async_watch_bridges(hass)
    changed = bridge.lights.subscribe.call_args.args[0]
    with patch("custom_components.hue_studio.devices.async_dispatcher_send") as send:
        changed(EventType.RESOURCE_UPDATED, light)
        changed(EventType.RESOURCE_UPDATED, light)
        light.metadata.function = LightFunction.FUNCTIONAL
        changed(EventType.RESOURCE_UPDATED, light)
    assert send.call_count == 2


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


async def test_search_other_brands(
    hass: HomeAssistant,
    bridge: MagicMock,
    hue_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Where the bridge offers it, a search also lets other brands' lights join; the
    panel learns when the search started."""
    discovery = bridge.config.zigbee_device_discovery
    status = SimpleNamespace(value="ready")
    item = SimpleNamespace(
        id="disc-1",
        status=status,
        action=SimpleNamespace(
            action_type_values=[
                SearchActionType.SEARCH,
                SearchActionType.SEARCH_ALLOW_DEFAULT_LINK_KEY,
            ]
        ),
    )
    discovery.__iter__.side_effect = lambda: iter([item])
    client = await hass_ws_client(hass)
    reply = await _ws(
        client, type="hue_studio/devices/search", serials=[], other_brands=True
    )
    assert reply["success"]
    discovery.search.assert_awaited_once_with(
        "disc-1",
        search_codes=None,
        action_type=SearchActionType.SEARCH_ALLOW_DEFAULT_LINK_KEY,
    )
    status.value = "active"
    state = async_devices_payload(hass)[hue_entry.entry_id]
    assert state["searching"] is True
    assert state["other_brands"] is True
    assert isinstance(state["search_started"], float)


async def test_search_with_install_codes(
    hass: HomeAssistant,
    bridge: MagicMock,
    hue_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A device's QR code (its MAC and install code) goes to the bridge with the
    search where the bridge takes install codes; otherwise it searches as usual."""
    discovery = bridge.config.zigbee_device_discovery
    item = SimpleNamespace(
        id="disc-1",
        status=SimpleNamespace(value="ready"),
        action=SimpleNamespace(action_type_values=[SearchActionType.SEARCH]),
        add_install_codes=SimpleNamespace(),
    )
    discovery.__iter__.side_effect = lambda: iter([item])
    discovery.update = AsyncMock()
    client = await hass_ws_client(hass)
    qr = {"mac": "0017880100000042", "code": "ab" * 18}
    reply = await _ws(
        client,
        type="hue_studio/devices/search",
        serials=["AB12CD"],
        install_codes=[qr],
    )
    assert reply["success"]
    discovery.update.assert_awaited_once_with(
        "disc-1",
        ZigbeeDeviceDiscoveryPut(
            action=ZigbeeDeviceDiscoveryActionPut(
                action_type=SearchActionType.SEARCH, search_codes=["AB12CD"]
            ),
            add_install_codes=AddInstallCodes(
                install_codes=[
                    InstallCode(mac_address="00:17:88:01:00:00:00:42", ic="AB" * 18)
                ]
            ),
        ),
    )
    discovery.search.assert_not_awaited()

    # A bridge without install codes (an older one) only searches.
    item.add_install_codes = None
    discovery.update.reset_mock()
    reply = await _ws(client, type="hue_studio/devices/search", install_codes=[qr])
    assert reply["success"]
    discovery.update.assert_not_awaited()
    discovery.search.assert_awaited_once_with("disc-1", search_codes=None)

    # Not a QR code's MAC or install code.
    bad = {"mac": "0017", "code": "ab"}
    reply = await _ws(client, type="hue_studio/devices/search", install_codes=[bad])
    assert not reply["success"]


async def test_delete_device(
    hass: HomeAssistant,
    bridge: MagicMock,
    hue_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """A device is removed from its bridge; the bridge itself never is."""
    client = await hass_ws_client(hass)
    reply = await _ws(client, type="hue_studio/devices/delete", device="dev-dial")
    assert reply["success"]
    bridge.request.assert_awaited_once_with(
        "delete", "clip/v2/resource/device/dev-dial"
    )
    bridge.request.reset_mock()
    reply = await _ws(client, type="hue_studio/devices/delete", device="dev-bridge")
    assert not reply["success"]
    bridge.request.assert_not_awaited()


async def test_bridge_pro_not_listed(
    hass: HomeAssistant, bridge: MagicMock, hue_entry: MockConfigEntry
) -> None:
    """A bridge is not one of its own devices, whatever its archetype (a Bridge Pro's
    `bridge_v3` is unknown to older aiohue)."""
    pro = _device("dev-pro", "Hue Bridge Pro", [], "unknown_archetype")
    bridge.devices.__iter__.side_effect = lambda: iter([*DEVICES.values(), pro])
    bridge.config.bridge_device = SimpleNamespace(id="dev-pro")
    listed = {
        d["id"] for d in async_devices_payload(hass)[hue_entry.entry_id]["devices"]
    }
    assert "dev-pro" not in listed and "dev-bridge" not in listed
    assert "dev-bulb" in listed
