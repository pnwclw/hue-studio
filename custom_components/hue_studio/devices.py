"""Adding Hue devices from Home Assistant (HA-first device setup).

- Search: the bridge's `zigbee_device_discovery` (bridge firmware 1.60+), optionally
  limited to serial numbers printed on the devices (up to 10), or open to Zigbee lights
  of other brands (that join with the default link key) where the bridge offers it.
  Devices the bridge adds while Home Assistant runs are remembered as "new" until they
  are set up.
- Set up: a name (on the bridge; the native integration follows), an HA area (the HA
  device, like HA's "Assign area") and, for lights, the Hue room of that area (rooms
  hold devices, see `rooms.async_align`).
- Hue devices whose HA device has no area are listed too, so devices added in the Hue
  app can be set up the same way.
- Motion sensors also carry their sensitivity (the Hue app's "Motion sensitivity"),
  which the native integration does not expose; it is set on the bridge like the name.
- Lights carry the Hue app's "Function" (functional, decorative, mixed) and "Power on"
  (what the light does when it gets power: the bridge's power-up presets), set on every
  light service of the device.
- Delete: a device is removed from the bridge (the Hue app's "Delete"); the native
  integration then removes its HA device.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
import logging
import time
from typing import Any

from aiohttp import ClientError
from aiohue import HueBridgeV2
from aiohue.errors import AiohueException
from aiohue.v2.controllers.events import EventType
from aiohue.v2.models.device import Device, DeviceMetaDataPut, DevicePut
from aiohue.v2.models.feature import MotionSensingFeatureSensitivityPut
from aiohue.v2.models.motion import MotionPut
from aiohue.v2.models.resource import ResourceTypes
from aiohue.v2.models.zigbee_device_discovery import SearchActionType
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.util.hass_dict import HassKey

from .const import DOMAIN
from .lights import HUE_DOMAIN, LIGHT_DOMAIN, async_bridges
from .rooms import async_align

_LOGGER = logging.getLogger(__name__)

SIGNAL_DEVICES_UPDATED = f"{DOMAIN}_devices_updated"
MAX_SERIALS = 10
NAME_MAX = 32
LIGHT_FUNCTIONS = ("functional", "decorative", "mixed")
# Power-up presets the panel can pick; "custom" (set in the Hue app) is shown, not set.
POWER_ON_PRESETS = ("safety", "powerfail", "last_on_state")

SWITCH_TYPES = {ResourceTypes.BUTTON, ResourceTypes.RELATIVE_ROTARY}
SENSOR_TYPES = {
    ResourceTypes.MOTION,
    ResourceTypes.TEMPERATURE,
    ResourceTypes.LIGHT_LEVEL,
    ResourceTypes.CONTACT,
    ResourceTypes.CAMERA_MOTION,
}


@dataclass(slots=True)
class DeviceSetup:
    """What Hue Studio remembers about devices added through it, per bridge."""

    # hue device id -> time.time() it appeared on the bridge
    found: dict[str, float] = field(default_factory=dict)
    # hue entry id -> time.time() a search through Hue Studio started
    search_started: dict[str, float] = field(default_factory=dict)
    # hue entry id -> (the bridge object watched, unsubscribe from its device events)
    watching: dict[str, tuple[HueBridgeV2, Callable[[], None]]] = field(
        default_factory=dict
    )
    # motion resource id -> its last sensitivity seen (motion events come often)
    sensitivity: dict[str, dict[str, Any] | None] = field(default_factory=dict)
    # light resource id -> its last (function, power-up preset) seen (light events too)
    light_settings: dict[str, tuple[str | None, str | None]] = field(
        default_factory=dict
    )


_DATA: HassKey[DeviceSetup] = HassKey(f"{DOMAIN}_device_setup")


def _setup(hass: HomeAssistant) -> DeviceSetup:
    return hass.data.setdefault(_DATA, DeviceSetup())


def is_bridge_device(bridge: HueBridgeV2, device: Device) -> bool:
    """The bridge itself (a Bridge Pro has its own archetype, not `bridge_v2`)."""
    own = bridge.config.bridge_device
    return (own is not None and device.id == own.id) or str(
        getattr(device.product_data.product_archetype, "value", "")
    ).startswith("bridge")


def device_kind(device: Device) -> str:
    """light, switch, sensor or other: what the device mainly is."""
    types = {service.rtype for service in device.services}
    if ResourceTypes.LIGHT in types:
        return "light"
    if types & SWITCH_TYPES:
        return "switch"
    if types & SENSOR_TYPES:
        return "sensor"
    return "other"


@callback
def async_watch_bridges(hass: HomeAssistant) -> None:
    """Remember devices the bridges add from now on (idempotent)."""
    setup = _setup(hass)
    for hue_entry_id, bridge in async_bridges(hass).items():
        watched = setup.watching.get(hue_entry_id)
        if watched is not None and watched[0] is bridge:
            continue
        if watched is not None:
            # A reloaded entry has a new bridge object.
            watched[1]()

        @callback
        def added(event_type: EventType, item: Any) -> None:
            if event_type == EventType.RESOURCE_ADDED and isinstance(item, Device):
                setup.found[item.id] = time.time()
            async_dispatcher_send(hass, SIGNAL_DEVICES_UPDATED)

        @callback
        def motion_changed(event_type: EventType, item: Any) -> None:
            value = _sensitivity_of(item)
            if setup.sensitivity.get(item.id) != value:
                setup.sensitivity[item.id] = value
                async_dispatcher_send(hass, SIGNAL_DEVICES_UPDATED)

        @callback
        def light_changed(event_type: EventType, item: Any) -> None:
            value = _light_settings_of(item)
            if setup.light_settings.get(item.id) != value:
                setup.light_settings[item.id] = value
                async_dispatcher_send(hass, SIGNAL_DEVICES_UPDATED)

        unsubs = [
            bridge.devices.subscribe(added),
            bridge.sensors.motion.subscribe(
                motion_changed, event_filter=EventType.RESOURCE_UPDATED
            ),
            bridge.lights.subscribe(
                light_changed, event_filter=EventType.RESOURCE_UPDATED
            ),
        ]
        if (
            discovery := getattr(bridge.config, "zigbee_device_discovery", None)
        ) is not None:
            # Searching or not.
            unsubs.append(
                discovery.subscribe(
                    lambda *_: async_dispatcher_send(hass, SIGNAL_DEVICES_UPDATED)
                )
            )

        def unsubscribe(unsubs: list[Callable[[], None]] = unsubs) -> None:
            for unsub in unsubs:
                unsub()

        setup.watching[hue_entry_id] = (bridge, unsubscribe)


@callback
def async_stop_watching(hass: HomeAssistant) -> None:
    """Stop listening to the bridges' device events."""
    setup = _setup(hass)
    for _, unsub in setup.watching.values():
        unsub()
    setup.watching.clear()


def _discovery(bridge: HueBridgeV2) -> list[Any]:
    """The bridge's `zigbee_device_discovery` resources (none: it cannot search)."""
    discovery = getattr(bridge.config, "zigbee_device_discovery", None)
    return list(discovery) if discovery is not None else []


def _searching(bridge: HueBridgeV2) -> bool | None:
    """Whether the bridge searches now (None: it cannot search through the API)."""
    items = _discovery(bridge)
    if not items:
        return None
    return any(item.status.value == "active" for item in items)


def _other_brands(bridge: HueBridgeV2) -> bool:
    """Whether the bridge can also let other brands' Zigbee lights join."""
    items = _discovery(bridge)
    action = getattr(items[0], "action", None) if items else None
    return SearchActionType.SEARCH_ALLOW_DEFAULT_LINK_KEY in (
        getattr(action, "action_type_values", None) or []
    )


def _reachable(bridge: HueBridgeV2, device: Device) -> bool | None:
    """Whether the bridge reaches the device over Zigbee (None: it does not say)."""
    try:
        connectivity = bridge.devices.get_zigbee_connectivity(device.id)
    except AttributeError, KeyError:
        return None
    status = getattr(getattr(connectivity, "status", None), "value", None)
    return status != "disconnected" if isinstance(status, str) else None


def _sensitivity_of(motion: Any) -> dict[str, Any] | None:
    """{"value", "max", "changing"} of a motion resource, or None if it has none.
    `changing`: the sensor is calibrating to a new sensitivity (about 15 s)."""
    feature = getattr(motion, "sensitivity", None)
    value = getattr(feature, "sensitivity", None)
    if not isinstance(value, int):
        return None
    top = getattr(feature, "sensitivity_max", None)
    status = getattr(getattr(feature, "status", None), "value", None)
    return {
        "value": value,
        "max": top if isinstance(top, int) else max(value, 2),
        "changing": status == "changing",
    }


def _enum_value(value: Any) -> str | None:
    value = getattr(value, "value", None)
    return value if isinstance(value, str) and value != "unknown" else None


def _light_settings_of(light: Any) -> tuple[str | None, str | None]:
    """(function, power-up preset) of a light resource; None where it has none."""
    function = _enum_value(getattr(getattr(light, "metadata", None), "function", None))
    preset = _enum_value(getattr(getattr(light, "powerup", None), "preset", None))
    return function, preset


def _device_light_settings(
    bridge: HueBridgeV2, device: Device
) -> tuple[str | None, str | None]:
    """(function, power-up preset) of a device's (first) light."""
    for rid in device.lights:
        if (light := bridge.lights.get(rid)) is not None:
            return _light_settings_of(light)
    return None, None


def _motion_of(bridge: HueBridgeV2, device: Device) -> tuple[str, Any] | None:
    """The (first) motion resource of a device: (id, resource)."""
    for service in device.services:
        if service.rtype == ResourceTypes.MOTION:
            motion = bridge.sensors.motion.get(service.rid)
            if motion is not None:
                return service.rid, motion
    return None


def _device_sensitivity(bridge: HueBridgeV2, device: Device) -> dict[str, Any] | None:
    found = _motion_of(bridge, device)
    return _sensitivity_of(found[1]) if found else None


@callback
def async_devices_payload(hass: HomeAssistant) -> dict[str, Any]:
    """What the panel's "Add devices" screen shows, per bridge (native hue entry id).

    {hue entry id: {"name", "searching": bool | None (None: no search through the API),
                    "search_started": time a search through Hue Studio started | None,
                    "other_brands": bool (the search can let other brands' lights join),
                    "devices": [{"id", "name", "product", "model", "archetype", "kind",
                                 "new", "found", "area", "lights", "ha_device",
                                 "sensitivity", "software", "reachable",
                                 "function", "power_on"}]}}
    Every device but the bridge; `new`: added while HA runs and not set up yet.
    `function` and `power_on` (a power-up preset): a light's, else None.
    """
    setup = _setup(hass)
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    payload: dict[str, Any] = {}
    for hue_entry_id, bridge in async_bridges(hass).items():
        by_hue_id = {
            ident[1]: device
            for device in dr.async_entries_for_config_entry(devices, hue_entry_id)
            for ident in device.identifiers
            if ident[0] == HUE_DOMAIN
        }
        light_entities = {
            entry.unique_id: entry.entity_id
            for entry in er.async_entries_for_config_entry(entities, hue_entry_id)
            if entry.domain == LIGHT_DOMAIN
        }
        listed = []
        for device in bridge.devices:
            if is_bridge_device(bridge, device):
                continue
            ha_device = by_hue_id.get(device.id)
            area = ha_device.area_id if ha_device else None
            new = device.id in setup.found
            function, power_on = _device_light_settings(bridge, device)
            listed.append(
                {
                    "id": device.id,
                    "name": device.metadata.name,
                    "product": device.product_data.product_name,
                    "model": device.product_data.model_id,
                    "archetype": device.metadata.archetype.value,
                    "kind": device_kind(device),
                    "new": new,
                    "found": setup.found.get(device.id),
                    "area": area,
                    "lights": sorted(
                        light_entities[rid]
                        for rid in device.lights
                        if rid in light_entities
                    ),
                    "ha_device": ha_device.id if ha_device else None,
                    "sensitivity": _device_sensitivity(bridge, device),
                    "software": device.product_data.software_version,
                    "reachable": _reachable(bridge, device),
                    "function": function,
                    "power_on": power_on,
                }
            )
        # Newest first, then by name.
        listed.sort(key=lambda d: (-(d["found"] or 0), d["name"].casefold()))
        entry = hass.config_entries.async_get_entry(hue_entry_id)
        searching = _searching(bridge)
        payload[hue_entry_id] = {
            "name": entry.title if entry else "Hue Bridge",
            "searching": searching,
            "search_started": setup.search_started.get(hue_entry_id)
            if searching
            else None,
            "other_brands": _other_brands(bridge),
            "devices": listed,
        }
    return payload


def _bridge(hass: HomeAssistant, hue_entry_id: str | None) -> dict[str, HueBridgeV2]:
    bridges = async_bridges(hass)
    if hue_entry_id is None:
        return bridges
    if hue_entry_id not in bridges:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="hue_entry_missing"
        )
    return {hue_entry_id: bridges[hue_entry_id]}


async def async_search(
    hass: HomeAssistant,
    hue_entry_id: str | None,
    serials: list[str],
    other_brands: bool = False,
) -> None:
    """Let new devices join (about a minute); serial numbers find reset or far ones,
    `other_brands` also lets Zigbee lights of other brands join."""
    async_watch_bridges(hass)
    setup = _setup(hass)
    codes = [s.strip().upper() for s in serials if s.strip()][:MAX_SERIALS]
    for entry_id, bridge in _bridge(hass, hue_entry_id).items():
        items = _discovery(bridge)
        if not items:
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key="search_unsupported"
            )
        extra: dict[str, Any] = {}
        if other_brands and _other_brands(bridge):
            extra["action_type"] = SearchActionType.SEARCH_ALLOW_DEFAULT_LINK_KEY
        try:
            await bridge.config.zigbee_device_discovery.search(
                items[0].id, search_codes=codes or None, **extra
            )
        except (AiohueException, ClientError, TimeoutError) as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN, translation_key="search_failed"
            ) from err
        setup.search_started[entry_id] = time.time()
    async_dispatcher_send(hass, SIGNAL_DEVICES_UPDATED)


def _find(hass: HomeAssistant, device_id: str) -> tuple[str, HueBridgeV2, Device]:
    for hue_entry_id, bridge in async_bridges(hass).items():
        if (device := bridge.devices.get(device_id)) is not None:
            return hue_entry_id, bridge, device
    raise ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key="unknown_hue_device",
        translation_placeholders={"device": device_id},
    )


async def async_identify(hass: HomeAssistant, device_id: str) -> None:
    """Make a device show itself (a light breathes, a sensor blinks its LED)."""
    _, bridge, device = _find(hass, device_id)
    try:
        await bridge.devices.set_identify(device.id)
    except (AiohueException, ClientError, TimeoutError) as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="command_failed",
            translation_placeholders={"entity_id": device.metadata.name},
        ) from err


def _sensitive_motion(bridge: HueBridgeV2, device: Device) -> tuple[str, Any]:
    """The motion resource of a device that has a sensitivity, or raise."""
    motion = _motion_of(bridge, device)
    if motion is None or _sensitivity_of(motion[1]) is None:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="no_motion_sensitivity",
            translation_placeholders={"device": device.metadata.name},
        )
    return motion


async def _put_sensitivity(
    bridge: HueBridgeV2, device: Device, motion: tuple[str, Any], sensitivity: int
) -> None:
    """Set a motion sensor's sensitivity (clamped to its range) unless it has it."""
    rid, resource = motion
    current = _sensitivity_of(resource) or {"value": 0, "max": 0}
    value = min(max(sensitivity, 0), current["max"])
    if value == current["value"]:
        return
    try:
        await bridge.sensors.motion.update(
            rid,
            MotionPut(
                sensitivity=MotionSensingFeatureSensitivityPut(sensitivity=value)
            ),
        )
    except (AiohueException, ClientError, TimeoutError) as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="command_failed",
            translation_placeholders={"entity_id": device.metadata.name},
        ) from err


async def async_set_sensitivity(
    hass: HomeAssistant, device_id: str, sensitivity: int
) -> None:
    """Set a motion sensor's sensitivity alone (tried out live, then kept or reverted);
    the sensor calibrates for about 15 s after a change."""
    _, bridge, device = _find(hass, device_id)
    await _put_sensitivity(
        bridge, device, _sensitive_motion(bridge, device), sensitivity
    )


async def async_setup_device(
    hass: HomeAssistant,
    device_id: str,
    name: str | None,
    area_id: str | None,
    sensitivity: int | None = None,
    function: str | None = None,
    power_on: str | None = None,
) -> None:
    """Name a Hue device, put it into an HA area and its lights into that Hue room;
    a motion sensor's sensitivity, a light's function and power-on behavior too."""
    hue_entry_id, bridge, device = _find(hass, device_id)
    motion = _sensitive_motion(bridge, device) if sensitivity is not None else None
    if (function is not None or power_on is not None) and not device.lights:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="not_a_light",
            translation_placeholders={"device": device.metadata.name},
        )
    if area_id is not None and ar.async_get(hass).async_get_area(area_id) is None:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="unknown_ha_area",
            translation_placeholders={"area": area_id},
        )
    name = (name or "").strip()[:NAME_MAX]
    if name and name != device.metadata.name:
        try:
            await bridge.devices.update(
                device.id,
                DevicePut(metadata=DeviceMetaDataPut(archetype=None, name=name)),
            )
        except (AiohueException, ClientError, TimeoutError) as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="command_failed",
                translation_placeholders={"entity_id": device.metadata.name},
            ) from err
    if motion is not None and sensitivity is not None:
        await _put_sensitivity(bridge, device, motion, sensitivity)
    if function is not None or power_on is not None:
        await _put_light_settings(bridge, device, function, power_on)
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    ha_device = next(
        (
            d
            for d in dr.async_entries_for_config_entry(devices, hue_entry_id)
            if (HUE_DOMAIN, device.id) in d.identifiers
        ),
        None,
    )
    if ha_device is not None:
        devices.async_update_device(ha_device.id, area_id=area_id)
        # Entities that override the area would not follow the device.
        for entry in er.async_entries_for_device(entities, ha_device.id):
            if entry.area_id is not None:
                entities.async_update_entity(entry.entity_id, area_id=None)
    lights = {
        entry.entity_id
        for entry in er.async_entries_for_config_entry(entities, hue_entry_id)
        if entry.domain == LIGHT_DOMAIN and entry.unique_id in device.lights
    }
    if lights and area_id is not None:
        await async_align(hass, only=lights, hue_entry_id=hue_entry_id)
    _setup(hass).found.pop(device.id, None)
    async_dispatcher_send(hass, SIGNAL_DEVICES_UPDATED)


async def _put_light_settings(
    bridge: HueBridgeV2, device: Device, function: str | None, power_on: str | None
) -> None:
    """Set the function and the power-up preset of every light of a device (only
    what differs; aiohue's LightPut has no metadata, hence the plain request)."""
    for rid in device.lights:
        current_function, current_preset = _light_settings_of(bridge.lights.get(rid))
        body: dict[str, Any] = {}
        if function is not None and function != current_function:
            body["metadata"] = {"function": function}
        if power_on is not None and power_on != current_preset:
            body["powerup"] = {"preset": power_on}
        if not body:
            continue
        try:
            await bridge.request("put", f"clip/v2/resource/light/{rid}", json=body)
        except (AiohueException, ClientError, TimeoutError) as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="command_failed",
                translation_placeholders={"entity_id": device.metadata.name},
            ) from err


async def async_delete_device(hass: HomeAssistant, device_id: str) -> None:
    """Remove a device from its bridge (never the bridge itself); the native
    integration removes its HA device when the bridge reports it gone."""
    _, bridge, device = _find(hass, device_id)
    if device.product_data.product_archetype.value.startswith("bridge"):
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="unknown_hue_device",
            translation_placeholders={"device": device_id},
        )
    try:
        await bridge.request("delete", f"clip/v2/resource/device/{device.id}")
    except (AiohueException, ClientError, TimeoutError) as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="command_failed",
            translation_placeholders={"entity_id": device.metadata.name},
        ) from err
    _setup(hass).found.pop(device.id, None)
    async_dispatcher_send(hass, SIGNAL_DEVICES_UPDATED)
