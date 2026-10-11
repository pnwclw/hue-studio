"""Adding Hue devices from Home Assistant (HA-first device setup).

- Search: the bridge's `zigbee_device_discovery` (bridge firmware 1.60+), optionally
  limited to serial numbers printed on the devices (up to 10). Devices the bridge adds
  while Home Assistant runs are remembered as "new" until they are set up.
- Set up: a name (on the bridge; the native integration follows), an HA area (the HA
  device, like HA's "Assign area") and, for lights, the Hue room of that area (rooms
  hold devices, see `rooms.async_align`).
- Hue devices whose HA device has no area are listed too, so devices added in the Hue
  app can be set up the same way.
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
from aiohue.v2.models.resource import ResourceTypes
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
    # hue entry id -> (the bridge object watched, unsubscribe from its device events)
    watching: dict[str, tuple[HueBridgeV2, Callable[[], None]]] = field(
        default_factory=dict
    )


_DATA: HassKey[DeviceSetup] = HassKey(f"{DOMAIN}_device_setup")


def _setup(hass: HomeAssistant) -> DeviceSetup:
    return hass.data.setdefault(_DATA, DeviceSetup())


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

        unsubs = [bridge.devices.subscribe(added)]
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


def _searching(bridge: HueBridgeV2) -> bool | None:
    """Whether the bridge searches now (None: it cannot search through the API)."""
    discovery = getattr(bridge.config, "zigbee_device_discovery", None)
    items = list(discovery) if discovery is not None else []
    if not items:
        return None
    return any(item.status.value == "active" for item in items)


@callback
def async_devices_payload(hass: HomeAssistant) -> dict[str, Any]:
    """What the panel's "Add devices" screen shows, per bridge (native hue entry id).

    {hue entry id: {"name", "searching": bool | None (None: no search through the API),
                    "devices": [{"id", "name", "product", "model", "archetype", "kind",
                                 "new", "area", "lights"}]}}
    Every device but the bridge; `new`: added while HA runs and not set up yet.
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
            if device.product_data.product_archetype.value == "bridge_v2":
                continue
            ha_device = by_hue_id.get(device.id)
            area = ha_device.area_id if ha_device else None
            new = device.id in setup.found
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
                }
            )
        # Newest first, then by name.
        listed.sort(key=lambda d: (-(d["found"] or 0), d["name"].casefold()))
        entry = hass.config_entries.async_get_entry(hue_entry_id)
        payload[hue_entry_id] = {
            "name": entry.title if entry else "Hue Bridge",
            "searching": _searching(bridge),
            "devices": listed,
        }
    return payload


def _bridge(hass: HomeAssistant, hue_entry_id: str | None) -> list[HueBridgeV2]:
    bridges = async_bridges(hass)
    if hue_entry_id is None:
        return list(bridges.values())
    if hue_entry_id not in bridges:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="hue_entry_missing"
        )
    return [bridges[hue_entry_id]]


async def async_search(
    hass: HomeAssistant, hue_entry_id: str | None, serials: list[str]
) -> None:
    """Let new devices join (about a minute); serial numbers find reset or far ones."""
    async_watch_bridges(hass)
    codes = [s.strip().upper() for s in serials if s.strip()][:MAX_SERIALS]
    for bridge in _bridge(hass, hue_entry_id):
        discovery = getattr(bridge.config, "zigbee_device_discovery", None)
        items = list(discovery) if discovery is not None else []
        if not items:
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key="search_unsupported"
            )
        try:
            await discovery.search(items[0].id, search_codes=codes or None)
        except (AiohueException, ClientError, TimeoutError) as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN, translation_key="search_failed"
            ) from err
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


async def async_setup_device(
    hass: HomeAssistant, device_id: str, name: str | None, area_id: str | None
) -> None:
    """Name a Hue device, put it into an HA area and its lights into that Hue room."""
    hue_entry_id, bridge, device = _find(hass, device_id)
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
