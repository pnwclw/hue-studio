"""Moving a whole bridge, a room, or lights going to a room on another bridge.

Each bridge is its own Hue system and an area belongs to one bridge
(docs/rooms-and-scenes.md). Hue Studio moves devices from one bridge to another the way
the Hue app's own steps go, and Home Assistant keeps their entity ids, names and areas:

1. What moves is remembered first, in a Store (a restart in between loses nothing):
   per device its Zigbee MAC, name, archetype, each light's function and power-on
   preset, the HA side of all its entities and of the device; the rooms that move whole
   (name, archetype, devices, scenes), the zones and entertainment areas of the moving
   lights.
2. The old bridge lets the devices go (they are deleted there).
3. The new bridge searches (about a minute, a few times) and knows each device again by
   its Zigbee MAC. A light let go looks for a bridge open to it only as it is switched
   on, so moving part of a bridge (a room, lights) the panel asks, while the search
   runs, to switch the lights off at the wall for about 10 seconds and on again (and to
   reset switches and sensors with their setup button); serial numbers let the new
   bridge reset lights close to it itself.
4. Name, archetype, function and power-on are set again; in HA every entity of a device
   takes over the old entity id, name, icon, labels, area and enabled/hidden state.
5. Rooms: a room that moves whole is made again on the new bridge (its name, archetype
   and devices; a room of that name there takes them in); lights going to another area
   follow room alignment. Then the scenes of moved rooms are copied, zones and
   entertainment areas whose lights all moved are copied (and deleted on the old
   bridge), those left behind in part are split (the moved lights get one of the same
   name); the old scenes and the emptied rooms go, and the copies take over their
   entity ids.

One move runs at a time, as a background task the panel watches
(`hue_studio/bridges/move/subscribe`); devices the search does not find leave it
waiting for another search (serial numbers), or for a search on the old bridge.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
import logging
import time
from typing import Any

from aiohttp import ClientError
from aiohue import HueBridgeV2
from aiohue.errors import AiohueException
from aiohue.util import dataclass_to_dict
from aiohue.v2.models.resource import ResourceTypes
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .bridges import PRO_MODELS, bridge_name
from .const import DOMAIN, HUE_DOMAIN
from .devices import (
    async_forget_new,
    async_search,
    install_code,
    is_bridge_device,
    light_settings,
    put_light_settings,
    takes_install_codes,
)
from .entertainment import entertainment_services
from .lights import LIGHT_DOMAIN, async_all_lights, async_bridges
from .positions import position_store
from .rooms import async_align, light_area
from .scenes import SCENE_DOMAIN

_LOGGER = logging.getLogger(__name__)

SIGNAL_MOVE_UPDATED = f"{DOMAIN}_move_updated"
STORAGE_KEY = f"{DOMAIN}.move"
LOST_KEY = f"{DOMAIN}.lost"
STORAGE_VERSION = 1
# Entries of a move's journal kept (the oldest go first).
LOG_LIMIT = 200

# A bridge searches for about a minute; a move searches a few times before it waits.
SEARCH_TIME = 60.0
SEARCH_ROUNDS = 3
POLL = 2.0
# How long the native integration may take to show a new resource as an entity.
ENTITY_WAIT = 60.0
# Lights a bridge holds (the Hue app's limits).
LIGHT_LIMIT = 50
PRO_LIGHT_LIMIT = 150

ROOM_PATH = "clip/v2/resource/room"
ZONE_PATH = "clip/v2/resource/zone"
SCENE_PATH = "clip/v2/resource/scene"
DEVICE_PATH = "clip/v2/resource/device"
ENTERTAINMENT_PATH = "clip/v2/resource/entertainment_configuration"


# --- what moves -------------------------------------------------------------------


@dataclass(slots=True)
class Selection:
    """What a request names, resolved."""

    source: str
    target: str
    # Hue device ids (every light of a device moves with it).
    devices: list[str]
    # The area moved lights go into (None: each keeps its own).
    area: str | None
    # Hue rooms on the source bridge that move whole.
    rooms: list[str] = field(default_factory=list)
    # Everything of the source bridge.
    whole_bridge: bool = False


def device_mac(bridge: HueBridgeV2, device_id: str) -> str | None:
    connectivity = bridge.devices.get_zigbee_connectivity(device_id)
    return getattr(connectivity, "mac_address", None) if connectivity else None


def _light_ids(device: Any) -> list[str]:
    """A device's lights in the order of its services (a stable order to map by)."""
    return [s.rid for s in device.services if s.rtype == ResourceTypes.LIGHT]


def _room_of(bridge: HueBridgeV2, device_id: str) -> Any | None:
    return next(
        (
            room
            for room in bridge.groups.room
            if any(c.rid == device_id for c in room.children)
        ),
        None,
    )


def _room_devices(room: Any) -> set[str]:
    return {c.rid for c in room.children if c.rtype == ResourceTypes.DEVICE}


def _light_devices(bridge: HueBridgeV2, room: Any) -> set[str]:
    """The devices of a room that have lights."""
    return {
        rid
        for rid in _room_devices(room)
        if (d := bridge.devices.get(rid)) is not None and _light_ids(d)
    }


def _check_target(hass: HomeAssistant, target: str) -> dict[str, HueBridgeV2]:
    bridges = async_bridges(hass)
    if target not in bridges:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="hue_entry_missing"
        )
    return bridges


@callback
def async_select_bridge(hass: HomeAssistant, source: str, target: str) -> Selection:
    """Everything of the bridge `source` (devices, rooms, zones, scenes, entertainment
    areas) to the bridge `target`."""
    bridges = _check_target(hass, target)
    if source not in bridges:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="hue_entry_missing"
        )
    if source == target:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="move_same_bridge"
        )
    bridge = bridges[source]
    devices = sorted(d.id for d in bridge.devices if not is_bridge_device(bridge, d))
    if not devices:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="move_nothing"
        )
    rooms = sorted(r.id for r in bridge.groups.room)
    return Selection(source, target, devices, None, rooms, whole_bridge=True)


@callback
def async_select(
    hass: HomeAssistant,
    target: str,
    *,
    area: str | None = None,
    lights: Iterable[str] | None = None,
    to_area: str | None = None,
) -> Selection:
    """Resolve a move: an area's Hue lights (`area`; its whole Hue room moves with its
    switches and sensors) or some lights (`lights`), to the bridge `target`, the lights
    into `to_area` (default: their own area)."""
    bridges = _check_target(hass, target)
    for check in (area, to_area):
        if check is not None and ar.async_get(hass).async_get_area(check) is None:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="unknown_ha_area",
                translation_placeholders={"area": check},
            )
    entities = er.async_get(hass)
    devices_reg = dr.async_get(hass)
    wanted = set(lights or ())
    chosen = [
        light
        for light in async_all_lights(hass)
        if light.entity_id in wanted
        or (
            area is not None
            and (entry := entities.async_get(light.entity_id)) is not None
            and light_area(entry, devices_reg) == area
        )
    ]
    # Lights already on the target bridge stay (a room on two bridges comes together).
    chosen = [light for light in chosen if light.bridge is not bridges[target]]
    sources = {
        hue_entry_id
        for light in chosen
        for hue_entry_id, bridge in bridges.items()
        if light.bridge is bridge
    }
    if not chosen:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="move_nothing"
        )
    if len(sources) > 1:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="move_one_source"
        )
    source = sources.pop()
    bridge = bridges[source]
    devices = {light.resource.owner.rid for light in chosen}
    rooms = {r.id: r for d in devices if (r := _room_of(bridge, d)) is not None}
    whole: list[str] = []
    if area is not None and len(rooms) == 1:
        room = next(iter(rooms.values()))
        if _light_devices(bridge, room) <= devices:
            # The room moves whole, with its switches and sensors.
            whole = [room.id]
            devices |= _room_devices(room)
    return Selection(source, target, sorted(devices), to_area, whole)


def _light_limit(bridge: HueBridgeV2) -> int:
    device = bridge.config.bridge_device
    model = getattr(getattr(device, "product_data", None), "model_id", None)
    return PRO_LIGHT_LIMIT if model in PRO_MODELS else LIGHT_LIMIT


def _zones_touched(bridge: HueBridgeV2, light_ids: set[str]) -> list[tuple[Any, bool]]:
    """Zones with moving lights: (zone, whether all its lights move)."""
    touched = []
    for zone in bridge.groups.zone:
        members = {c.rid for c in zone.children if c.rtype == ResourceTypes.LIGHT}
        if members & light_ids:
            touched.append((zone, members <= light_ids))
    return touched


def _entertainment_touched(
    bridge: HueBridgeV2, light_ids: set[str]
) -> list[tuple[Any, bool]]:
    """Entertainment areas with moving lights: (area, whether all its lights move)."""
    light_of = {sid: lid for lid, sid in entertainment_services(bridge).items()}
    touched = []
    for config in bridge.config.entertainment_configuration:
        members = {
            light_of.get(loc.service.rid) for loc in config.locations.service_locations
        }
        if members & light_ids:
            touched.append((config, members <= light_ids))
    return touched


@callback
def async_move_plan(hass: HomeAssistant, selection: Selection) -> dict[str, Any]:
    """What a move does, for the panel to show before it starts:

    {"source", "target", "source_name", "target_name", "whole_bridge",
     "lights": [light entity ids], "accessories": [names of switches and sensors],
     "rooms": [names of rooms moving whole], "scenes": count copied,
     "zones": [{"name", "whole"}], "entertainment": [{"name", "whole"}],
     "staying": [names of other devices of a room that stay], "over_limit": bool,
     "macs": {Zigbee MAC: name} of the moving devices (to match their QR codes),
     "install_codes": whether the target bridge lets devices in by their QR code,
     "devices": [{"mac", "name", "light", "entity_id"}] (serial numbers and QR codes
     are given per device)}
    """
    bridges = async_bridges(hass)
    bridge = bridges[selection.source]
    target = bridges[selection.target]
    entities = er.async_get(hass)
    moving = [d for rid in selection.devices if (d := bridge.devices.get(rid))]
    light_ids = {rid for d in moving for rid in _light_ids(d)}
    rooms = [r for rid in selection.rooms if (r := bridge.groups.room.get(rid))]
    zones = _zones_touched(bridge, light_ids)
    groups = {r.id for r in rooms} | {z.id for z, _whole in zones}
    return {
        "source": selection.source,
        "target": selection.target,
        "source_name": bridge_name(hass, selection.source, bridge),
        "target_name": bridge_name(hass, selection.target, target),
        "whole_bridge": selection.whole_bridge,
        "lights": sorted(
            e
            for rid in light_ids
            if (e := entities.async_get_entity_id(LIGHT_DOMAIN, HUE_DOMAIN, rid))
        ),
        "accessories": sorted(d.metadata.name for d in moving if not _light_ids(d)),
        "rooms": sorted(r.metadata.name for r in rooms),
        "scenes": sum(1 for s in bridge.scenes.scene if s.group.rid in groups),
        "zones": [{"name": z.metadata.name, "whole": whole} for z, whole in zones],
        "entertainment": [
            {"name": c.metadata.name, "whole": whole}
            for c, whole in _entertainment_touched(bridge, light_ids)
        ],
        "staying": [],
        "over_limit": sum(1 for _ in target.lights) + len(light_ids)
        > _light_limit(target),
        "macs": {
            mac.upper(): d.metadata.name
            for d in moving
            if (mac := device_mac(bridge, d.id))
        },
        "install_codes": takes_install_codes(target),
        "devices": [
            {
                "mac": mac.upper() if (mac := device_mac(bridge, d.id)) else None,
                "name": d.metadata.name,
                "light": bool(_light_ids(d)),
                "entity_id": next(
                    (
                        e
                        for rid in _light_ids(d)
                        if (
                            e := entities.async_get_entity_id(
                                LIGHT_DOMAIN, HUE_DOMAIN, rid
                            )
                        )
                    ),
                    None,
                ),
            }
            for d in moving
        ],
    }


# --- remembering ------------------------------------------------------------------


def _strings(values: Iterable[Any]) -> list[str]:
    return [v for v in values if isinstance(v, str)]


@callback
def remember_entity(hass: HomeAssistant, entity_id: str | None) -> dict[str, Any]:
    entry = er.async_get(hass).async_get(entity_id) if entity_id else None
    if entry is None:
        return {"entity_id": entity_id}
    return {
        "entity_id": entry.entity_id,
        "name": entry.name,
        "icon": entry.icon,
        "area_id": entry.area_id,
        "labels": sorted(entry.labels),
        "aliases": _strings(entry.aliases),
        "enabled": entry.disabled_by is None,
        "hidden_by_user": entry.hidden_by == er.RegistryEntryHider.USER,
    }


def service_keys(device: Any, *, lights: bool = False) -> list[tuple[str, str]]:
    """(key, resource id) of a device's services (lights only with `lights`); the key
    (type and index among that type) is the same for the device on any bridge."""
    seen: dict[str, int] = {}
    keys = []
    for service in device.services:
        if service.rtype == ResourceTypes.LIGHT and not lights:
            continue
        index = seen[service.rtype.value] = seen.get(service.rtype.value, -1) + 1
        keys.append((f"{service.rtype.value}:{index}", service.rid))
    return keys


def _scene_body(scene: Any) -> dict[str, Any]:
    """A scene as a POST body (group and light ids are replaced when it is copied)."""
    body: dict[str, Any] = {
        "metadata": {"name": scene.metadata.name},
        "actions": [dataclass_to_dict(a, skip_none=True) for a in scene.actions],
    }
    if (image := scene.metadata.image) is not None:
        body["metadata"]["image"] = {"rid": image.rid, "rtype": image.rtype.value}
    if scene.palette is not None:
        palette = dataclass_to_dict(scene.palette, skip_none=True)
        # The bridge refuses `effects` next to `effects_v2` (scenes.scene_post_json).
        palette.pop("effects", None)
        body["palette"] = palette
    if scene.speed is not None:
        body["speed"] = scene.speed
    if scene.auto_dynamic is not None:
        body["auto_dynamic"] = scene.auto_dynamic
    return body


class _Remember:
    """Reads the source bridge and HA's registries into plain (stored) data."""

    def __init__(self, hass: HomeAssistant, source: str, bridge: HueBridgeV2) -> None:
        self.hass = hass
        self.source = source
        self.bridge = bridge
        self.entities = er.async_get(hass)
        self.by_unique_id: dict[str, list[er.RegistryEntry]] = {}
        for entry in er.async_entries_for_config_entry(self.entities, source):
            self.by_unique_id.setdefault(entry.unique_id, []).append(entry)

    def entity(self, unique_id: str | None) -> dict[str, Any]:
        """The HA side of a resource's first entity (any domain)."""
        entries = self.by_unique_id.get(unique_id or "", [])
        if not entries:
            return {"entity_id": None}
        return {
            **remember_entity(self.hass, entries[0].entity_id),
            "domain": entries[0].domain,
        }

    def scenes(self, group_id: str) -> list[dict[str, Any]]:
        return [
            {"id": s.id, "entity": self.entity(s.id), "body": _scene_body(s)}
            for s in self.bridge.scenes.scene
            if s.group.rid == group_id
        ]

    def group(self, group: Any) -> dict[str, Any]:
        return {
            "id": group.id,
            "name": group.metadata.name,
            "archetype": group.metadata.archetype.value,
            "devices": sorted(_room_devices(group)),
            "lights": [c.rid for c in group.children if c.rtype == ResourceTypes.LIGHT],
            "entity": self.entity(group.grouped_light),
            "scenes": self.scenes(group.id),
            "new_id": None,
        }

    def device(self, device: Any) -> dict[str, Any]:
        ha_device = dr.async_get(self.hass).async_get_device_by_identifier(
            (HUE_DOMAIN, device.id), self.source
        )
        lights = []
        for rid in _light_ids(device):
            function, power_on = light_settings(self.bridge.lights.get(rid))
            lights.append(
                {
                    "id": rid,
                    "function": function,
                    "power_on": power_on,
                    "entity": remember_entity(
                        self.hass,
                        self.entities.async_get_entity_id(
                            LIGHT_DOMAIN, HUE_DOMAIN, rid
                        ),
                    ),
                }
            )
        return {
            "id": device.id,
            "mac": device_mac(self.bridge, device.id),
            "name": device.metadata.name,
            "archetype": device.metadata.archetype.value,
            "light": bool(lights),
            "lights": lights,
            # The device's other entities (switch events, a sensor's readings, its
            # Zigbee connectivity, …) by service type and index.
            "others": [
                {
                    "key": key,
                    "domain": entry.domain,
                    "entity": remember_entity(self.hass, entry.entity_id),
                }
                for key, rid in service_keys(device)
                for entry in self.by_unique_id.get(rid, [])
            ],
            "ha_device": {
                "area_id": ha_device.area_id,
                "name_by_user": ha_device.name_by_user,
                "labels": sorted(ha_device.labels),
            }
            if ha_device is not None
            else None,
            # How it is found (serial number, QR code's install code), set before.
            "prep": {},
            # Filled in as the move goes.
            "method": None,
            "removed": False,
            "new_id": None,
            "new_lights": {},
            "new_services": {},
            "restored": False,
            "skipped": False,
        }

    def entertainment(self, config: Any, whole: bool) -> dict[str, Any]:
        light_of = {
            sid: lid for lid, sid in entertainment_services(self.bridge).items()
        }
        return {
            "id": config.id,
            "name": config.metadata.name,
            "type": config.configuration_type.value,
            "whole": whole,
            "lights": [
                {
                    "id": light_of.get(loc.service.rid),
                    "positions": [
                        {"x": p.x, "y": p.y, "z": p.z} for p in loc.positions
                    ],
                }
                for loc in config.locations.service_locations
            ],
            "entity": self.entity(config.id),
        }


@callback
def async_remember(hass: HomeAssistant, selection: Selection) -> dict[str, Any]:
    """Everything a move needs to restore, as plain data (stored)."""
    bridge = async_bridges(hass)[selection.source]
    read = _Remember(hass, selection.source, bridge)
    devices = [
        read.device(device)
        for rid in selection.devices
        if (device := bridge.devices.get(rid)) is not None
        and not is_bridge_device(bridge, device)
    ]
    light_ids = {light["id"] for d in devices for light in d["lights"]}
    return {
        "source": selection.source,
        "target": selection.target,
        "area": selection.area,
        "whole_bridge": selection.whole_bridge,
        "devices": devices,
        "rooms": [
            read.group(room)
            for rid in selection.rooms
            if (room := bridge.groups.room.get(rid)) is not None
        ],
        "zones": [
            {**read.group(zone), "whole": whole}
            for zone, whole in _zones_touched(bridge, light_ids)
        ],
        "entertainment": [
            read.entertainment(config, whole)
            for config, whole in _entertainment_touched(bridge, light_ids)
        ],
        "step": "saving",
        "started": time.time(),
        "error": None,
        "searching_until": None,
        # The device being moved now (its old id) and what happened so far.
        "current": None,
        "log": [],
    }


# --- the move ---------------------------------------------------------------------


@dataclass(slots=True)
class Mover:
    """The move in progress (or waiting), its stored memo and its task."""

    hass: HomeAssistant
    store: Store[dict[str, Any]]
    lost_store: Store[list[dict[str, Any]]]
    memo: dict[str, Any] | None = None
    task: asyncio.Task[None] | None = None
    # Devices a move let go that no bridge took (found again later, or forgotten).
    lost: list[dict[str, Any]] = field(default_factory=list)

    async def async_save(self) -> None:
        if self.memo is None:
            await self.store.async_remove()
        else:
            await self.store.async_save(self.memo)
        async_dispatcher_send(self.hass, SIGNAL_MOVE_UPDATED)

    async def async_save_lost(self) -> None:
        await self.lost_store.async_save(self.lost)
        async_dispatcher_send(self.hass, SIGNAL_MOVE_UPDATED)

    async def async_step(self, step: str, **changes: Any) -> None:
        assert self.memo is not None
        self.memo.update(step=step, **changes)
        await self.async_save()

    @property
    def busy(self) -> bool:
        return self.task is not None and not self.task.done()


def _upgrade(memo: dict[str, Any]) -> dict[str, Any] | None:
    """A move stored by an earlier version, in today's form (None: forget it, nothing
    of it had happened yet)."""
    if "rooms" in memo:
        return _complete(memo)
    if not any(d.get("removed") or d.get("new_id") for d in memo["devices"]):
        return None
    room = memo.pop("room", None)
    memo.update(
        rooms=[{**room, "devices": [d["id"] for d in memo["devices"]], "new_id": None}]
        if room
        else [],
        whole_bridge=False,
        entertainment=[],
    )
    for device in memo["devices"]:
        device.setdefault("light", bool(device["lights"]))
        device.setdefault("others", [])
        device.setdefault("new_services", {})
    return _complete(memo)


def _complete(memo: dict[str, Any]) -> dict[str, Any]:
    """Fields a move stored before moving device by device lacks."""
    memo.setdefault("current", None)
    memo.setdefault("log", [])
    for device in memo["devices"]:
        device.setdefault("prep", {})
        device.setdefault("method", None)
        device.setdefault("skipped", False)
    return memo


async def async_setup_moves(hass: HomeAssistant) -> None:
    """Load a move left unfinished (by a restart): it waits for the user."""
    mover = Mover(
        hass,
        Store(hass, STORAGE_VERSION, STORAGE_KEY, private=True),
        Store(hass, STORAGE_VERSION, LOST_KEY, private=True),
    )
    hass.data[STORAGE_KEY] = mover
    mover.lost = await mover.lost_store.async_load() or []
    stored = await mover.store.async_load()
    memo = _upgrade(stored) if stored else None
    if stored and memo is None:
        await mover.store.async_remove()
    if memo:
        mover.memo = memo
        if memo.get("step") not in ("done", "failed"):
            memo.update(step="waiting", error="interrupted", searching_until=None)


def _mover(hass: HomeAssistant) -> Mover:
    mover: Mover | None = hass.data.get(STORAGE_KEY)
    if mover is None:
        raise HomeAssistantError(
            translation_domain=DOMAIN, translation_key="not_set_up"
        )
    return mover


def _entity_id(device: dict[str, Any]) -> str | None:
    """The entity a device is shown by: its (first) light, else its first other one."""
    if device["lights"]:
        return device["lights"][0]["entity"]["entity_id"]
    return next((o["entity"]["entity_id"] for o in device["others"]), None)


def async_move_payload(hass: HomeAssistant) -> dict[str, Any] | None:
    """The move the panel shows, or None:

    {"step", "error", "source", "target", "source_name", "target_name", "rooms",
     "whole_bridge", "area", "searching_until", "running", "install_codes" (the target
     lets devices in by their QR code), "current" (the device being moved, its id),
     "devices": [{"id", "entity_id", "name", "light", "found", "mac", "qr" (its QR
     code given), "serial", "method", "removed", "skipped"}],
     "log": [{"at", "event", "name", …}]}
    """
    mover: Mover | None = hass.data.get(STORAGE_KEY)
    if mover is None or mover.memo is None:
        return None
    memo = mover.memo
    bridges = async_bridges(hass)

    def name(entry_id: str) -> str:
        bridge = bridges.get(entry_id)
        if bridge is not None:
            return bridge_name(hass, entry_id, bridge)
        entry = hass.config_entries.async_get_entry(entry_id)
        return entry.title if entry else entry_id

    return {
        "step": memo["step"],
        "error": memo.get("error"),
        "source": memo["source"],
        "target": memo["target"],
        "source_name": name(memo["source"]),
        "target_name": name(memo["target"]),
        "rooms": [room["name"] for room in memo["rooms"]],
        "whole_bridge": memo.get("whole_bridge", False),
        "area": memo.get("area"),
        "searching_until": memo.get("searching_until"),
        "running": mover.busy,
        "install_codes": (target := bridges.get(memo["target"])) is not None
        and takes_install_codes(target),
        "current": memo.get("current"),
        "devices": [
            {
                "id": device["id"],
                "entity_id": _entity_id(device),
                "name": device["name"],
                "light": device["light"],
                "found": device["new_id"] is not None,
                "mac": (device["mac"] or "").upper() or None,
                "qr": bool(device["prep"].get("code")),
                "serial": device["prep"].get("serial"),
                "method": device.get("method"),
                "removed": device["removed"],
                "skipped": device["skipped"],
            }
            for device in memo["devices"]
        ],
        "log": memo["log"],
    }


def _start(mover: Mover) -> None:
    mover.task = mover.hass.async_create_background_task(
        _async_run(mover), f"{DOMAIN} move to another bridge"
    )


def _check_idle(mover: Mover, *, memo: bool) -> None:
    """Refuse while a move runs; `memo`: one must be there (else: none unfinished)."""
    unfinished = mover.memo is not None and mover.memo["step"] not in (
        "done",
        "failed",
    )
    if mover.busy or (memo and mover.memo is None) or (not memo and unfinished):
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="move_busy"
        )


def _prepare(memo: dict[str, Any], prepared: Iterable[dict[str, str]]) -> None:
    """Serial numbers and QR codes' install codes given for devices, by Zigbee MAC."""
    by_mac = {(d["mac"] or "").upper(): d for d in memo["devices"]}
    for item in prepared:
        mac = install_code(item["mac"], "")["mac"]
        device = by_mac.get(mac)
        if device is None:
            continue
        if item.get("serial"):
            device["prep"]["serial"] = item["serial"].strip().upper()
        if item.get("code"):
            device["prep"]["code"] = install_code(mac, item["code"])["code"]


def _log(
    memo: dict[str, Any], event: str, device: dict[str, Any] | None = None, **data: Any
) -> None:
    """A line of the move's journal (the panel shows it; HA's log gets it too)."""
    name = device["name"] if device else None
    memo["log"] = [
        *memo["log"][-(LOG_LIMIT - 1) :],
        {"at": time.time(), "event": event, "name": name, **data},
    ]
    _LOGGER.info(
        "Moving to another bridge: %s%s%s",
        event,
        f" {name}" if name else "",
        "".join(f", {k}={v}" for k, v in data.items()),
    )


async def async_start_move(
    hass: HomeAssistant,
    selection: Selection,
    prepared: Iterable[dict[str, str]] = (),
) -> None:
    """Start a move (one at a time): device by device, the old bridge lets it go and
    the new one finds it (by its serial number first, where one was given, while the
    old bridge still has it); then rooms, scenes, zones and entertainment areas."""
    mover = _mover(hass)
    _check_idle(mover, memo=False)
    memo = async_remember(hass, selection)
    _prepare(memo, prepared)
    _log(memo, "start", count=len(memo["devices"]))
    mover.memo = memo
    await mover.async_save()
    _start(mover)


async def async_retry_move(
    hass: HomeAssistant,
    prepared: Iterable[dict[str, str]] = (),
    target: str | None = None,
    *,
    release: bool = False,
) -> None:
    """Search again for the device not found (with a serial number or QR code given
    now); `release`: one looked for by its serial number is let go by the old bridge
    first this time; `target`: the old bridge, to put the devices back while none has
    been found."""
    mover = _mover(hass)
    _check_idle(mover, memo=True)
    memo = mover.memo
    assert memo is not None
    if target is not None and target != memo["target"]:
        if target not in async_bridges(hass):
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key="hue_entry_missing"
            )
        if any(d["new_id"] for d in memo["devices"]):
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key="move_busy"
            )
        memo["target"] = target
        _log(memo, "back")
    _prepare(memo, prepared)
    if release and (device := _current(memo)) is not None:
        device["prep"]["release"] = True
    memo["error"] = None
    _start(mover)


async def async_skip_move_device(hass: HomeAssistant) -> None:
    """Go on without the device not found: it stays on the old bridge if that still
    has it, else it is kept among the lost devices (found again later)."""
    mover = _mover(hass)
    _check_idle(mover, memo=True)
    memo = mover.memo
    assert memo is not None
    if (device := _current(memo)) is not None:
        device["skipped"] = True
        _log(memo, "skipped", device)
    memo["error"] = None
    _start(mover)


def _current(memo: dict[str, Any]) -> dict[str, Any] | None:
    return next((d for d in memo["devices"] if d["id"] == memo["current"]), None)


async def async_finish_move(hass: HomeAssistant) -> None:
    """Forget a finished move, or stop waiting: devices the old bridge let go and no
    bridge took are kept among the lost devices."""
    mover = _mover(hass)
    if mover.busy:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="move_busy"
        )
    if mover.memo is not None:
        await _async_keep_lost(mover, mover.memo)
    mover.memo = None
    await mover.async_save()


# --- lost devices -----------------------------------------------------------------


async def _async_keep_lost(mover: Mover, memo: dict[str, Any]) -> None:
    """Remember the devices of a move that are on no bridge now; forget those found."""
    found = {(d["mac"] or "").upper() for d in memo["devices"] if d["new_id"]}
    lost = [x for x in mover.lost if x["device"]["mac"].upper() not in found]
    known = {x["device"]["mac"].upper() for x in lost}
    for device in memo["devices"]:
        mac = (device["mac"] or "").upper()
        if device["removed"] and device["new_id"] is None and mac and mac not in known:
            area = memo["area"] or (device["ha_device"] or {}).get("area_id")
            lost.append(
                {
                    "device": device,
                    "source": memo["source"],
                    "target": memo["target"],
                    "area": area,
                    "at": time.time(),
                }
            )
    if lost != mover.lost:
        mover.lost = lost
        await mover.async_save_lost()


@callback
def async_lost_payload(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Devices a move let go that no bridge took:
    [{"mac", "name", "light", "entity_id", "target", "area", "at"}]."""
    mover: Mover | None = hass.data.get(STORAGE_KEY)
    if mover is None:
        return []
    return [
        {
            "mac": x["device"]["mac"].upper(),
            "name": x["device"]["name"],
            "light": x["device"]["light"],
            "entity_id": _entity_id(x["device"]),
            "target": x["target"],
            "area": x["area"],
            "at": x["at"],
        }
        for x in mover.lost
    ]


def _lost(mover: Mover, mac: str) -> dict[str, Any]:
    wanted = install_code(mac, "")["mac"]
    item = next((x for x in mover.lost if x["device"]["mac"].upper() == wanted), None)
    if item is None:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="unknown_hue_device",
            translation_placeholders={"device": mac},
        )
    return item


async def async_find_lost(
    hass: HomeAssistant,
    mac: str,
    target: str,
    prepared: Iterable[dict[str, str]] = (),
) -> None:
    """Look for a lost device on a bridge (a move of that one device): found, it gets
    its settings, entities, area and room back."""
    mover = _mover(hass)
    _check_idle(mover, memo=False)
    _check_target(hass, target)
    item = _lost(mover, mac)
    device = {
        **item["device"],
        "prep": dict(item["device"].get("prep") or {}),
        "removed": True,
        "new_id": None,
        "new_lights": {},
        "new_services": {},
        "restored": False,
        "skipped": False,
    }
    memo = {
        "source": item["source"],
        "target": target,
        "area": item["area"],
        "whole_bridge": False,
        "devices": [device],
        "rooms": [],
        "zones": [],
        "entertainment": [],
        "step": "saving",
        "started": time.time(),
        "error": None,
        "searching_until": None,
        "current": None,
        "log": [],
    }
    _prepare(memo, prepared)
    _log(memo, "start", count=1)
    mover.memo = memo
    await mover.async_save()
    _start(mover)


async def async_forget_lost(hass: HomeAssistant, mac: str) -> None:
    """Stop keeping a lost device (its HA entities went with it)."""
    mover = _mover(hass)
    item = _lost(mover, mac)
    mover.lost = [x for x in mover.lost if x is not item]
    await mover.async_save_lost()


class MoveError(HomeAssistantError):
    """A step failed; `reason` is shown in the panel."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


async def _async_run(mover: Mover) -> None:
    hass = mover.hass
    memo = mover.memo
    assert memo is not None
    try:
        await _async_move(hass, mover, memo)
    except MoveError as err:
        if err.reason != "not_found":
            _log(memo, "failed", reason=err.reason)
        await mover.async_step(
            "waiting" if err.reason == "not_found" else "failed",
            error=err.reason,
            searching_until=None,
        )
    except (AiohueException, ClientError, TimeoutError, HomeAssistantError) as err:
        _LOGGER.warning("Moving to another bridge stopped: %s", err)
        _log(memo, "failed", reason="bridge")
        await mover.async_step("failed", error="bridge", searching_until=None)
    except asyncio.CancelledError:
        await mover.async_step("waiting", error="interrupted", searching_until=None)
        raise


async def _async_request(
    bridge: HueBridgeV2, method: str, path: str, body: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    if body is None:
        return await bridge.request(method, path) or []
    return await bridge.request(method, path, json=body) or []


async def _async_move(hass: HomeAssistant, mover: Mover, memo: dict[str, Any]) -> None:
    bridges = async_bridges(hass)
    source = bridges.get(memo["source"])
    target = bridges.get(memo["target"])
    if target is None:
        raise MoveError("target_offline")
    # Devices the target has already (an earlier round).
    _match(target, memo["devices"])
    for device in memo["devices"]:
        if device["new_id"] is not None and not device["restored"]:
            await _async_restore(hass, mover, memo, source, target, device)
    # One device at a time: never more than one on no bridge. Lights first; switches
    # and sensors (reset by their button) after them.
    queue = sorted(
        (d for d in memo["devices"] if d["new_id"] is None and not d["skipped"]),
        key=lambda d: not d["light"],
    )
    for device in queue:
        await _async_move_one(hass, mover, memo, source, target, device)
    memo["current"] = None

    await mover.async_step("rooms")
    await _async_rooms(hass, target, memo)

    await mover.async_step("scenes")
    if memo["target"] == memo["source"]:
        await _async_put_back(target, memo)
    else:
        await _async_copy_groups(hass, source, target, memo)
        await _async_copy_entertainment(hass, source, target, memo)
    async_forget_new(hass, [d["new_id"] for d in memo["devices"] if d["new_id"]])
    await _async_keep_lost(mover, memo)
    _log(memo, "done")
    await mover.async_step("done", error=None, searching_until=None)


def _method(device: dict[str, Any], takes_codes: bool) -> str:
    """How a device is found: by its serial number while the old bridge still has it
    (the new one resets it), else let go first and found by its QR code's install
    code, by being switched off and on (a light), or by its setup button."""
    prep = device["prep"]
    if not device["light"]:
        return "button"
    if prep.get("serial") and not prep.get("release") and not device["removed"]:
        return "serial"
    if prep.get("code") and takes_codes:
        return "qr"
    return "power"


async def _async_move_one(
    hass: HomeAssistant,
    mover: Mover,
    memo: dict[str, Any],
    source: HueBridgeV2 | None,
    target: HueBridgeV2,
    device: dict[str, Any],
) -> None:
    """Move one device: found by the new bridge, let go by the old one, restored."""
    method = _method(device, takes_install_codes(target))
    memo["current"] = device["id"]
    device["method"] = method
    _log(memo, "device", device, method=method)
    if method != "serial" and not device["removed"]:
        if source is None:
            raise MoveError("source_offline")
        await mover.async_step("removing")
        await _async_remove(source, device)
        _log(memo, "removed", device)
        await mover.async_save()
    seconds = await _async_search_for(hass, mover, target, memo, device)
    if device["new_id"] is None:
        _log(memo, "not_found", device)
        raise MoveError("not_found")
    _log(memo, "found", device, seconds=seconds)
    await _async_restore(hass, mover, memo, source, target, device)


async def _async_restore(
    hass: HomeAssistant,
    mover: Mover,
    memo: dict[str, Any],
    source: HueBridgeV2 | None,
    target: HueBridgeV2,
    device: dict[str, Any],
) -> None:
    """A device found on the new bridge: the old one forgets it (found by its serial
    number, it still lists it), its settings and HA entities come back."""
    if not device["removed"] and source is not None and source is not target:
        await _async_remove(source, device)
    await mover.async_step("restoring")
    await _async_restore_bridge(target, device)
    await _async_restore_ha(hass, memo, [device])
    device["restored"] = True
    _log(memo, "restored", device)
    await mover.async_save()


def _match(bridge: HueBridgeV2, devices: list[dict[str, Any]]) -> None:
    """Know moved devices on a bridge again by their Zigbee MAC."""
    by_mac = {
        mac: device
        for device in bridge.devices
        if not is_bridge_device(bridge, device)
        and (mac := device_mac(bridge, device.id))
    }
    for memo in devices:
        device = by_mac.get(memo["mac"] or "")
        if device is None or memo["new_id"] is not None:
            continue
        memo["new_id"] = device.id
        new = _light_ids(device)
        memo["new_lights"] = {
            light["id"]: new[index]
            for index, light in enumerate(memo["lights"])
            if index < len(new)
        }
        memo["new_services"] = dict(service_keys(device))


async def _async_remove(source: HueBridgeV2, device: dict[str, Any]) -> None:
    """The old bridge forgets a device."""
    if device["removed"]:
        return
    if source.devices.get(device["id"]) is not None:
        await _async_request(source, "delete", f"{DEVICE_PATH}/{device['id']}")
    device["removed"] = True


async def _async_search_for(
    hass: HomeAssistant,
    mover: Mover,
    target: HueBridgeV2,
    memo: dict[str, Any],
    device: dict[str, Any],
) -> int:
    """Let the target bridge search for one device (a few rounds), with its serial
    number and install code if it has them; the seconds it took."""
    prep = device["prep"]
    serials = [prep["serial"]] if prep.get("serial") else []
    codes = (
        [{"mac": device["mac"], "code": prep["code"]}]
        if prep.get("code") and device["mac"]
        else None
    )
    started = time.time()
    for search in range(1, SEARCH_ROUNDS + 1):
        _match(target, [device])
        if device["new_id"] is not None:
            break
        await async_search(hass, memo["target"], serials, install_codes=codes)
        until = time.time() + SEARCH_TIME
        _log(memo, "search", device, round=search)
        await mover.async_step("searching", searching_until=until)
        while time.time() < until:
            _match(target, [device])
            if device["new_id"] is not None:
                break
            await asyncio.sleep(POLL)
    _match(target, [device])
    return round(time.time() - started)


async def _async_restore_bridge(target: HueBridgeV2, device: dict[str, Any]) -> None:
    """Name, archetype, and each light's function and power-on, as they were."""
    await _async_request(
        target,
        "put",
        f"{DEVICE_PATH}/{device['new_id']}",
        {"metadata": {"name": device["name"], "archetype": device["archetype"]}},
    )
    for light in device["lights"]:
        if (rid := device["new_lights"].get(light["id"])) is not None:
            await put_light_settings(target, rid, light["function"], light["power_on"])


async def _async_until(check: Callable[[], bool]) -> bool:
    """Whether `check` holds within ENTITY_WAIT (the bridge's event stream and the
    native integration bring the changes in their own time)."""
    deadline = time.monotonic() + ENTITY_WAIT
    while not check():
        if time.monotonic() >= deadline:
            return False
        await asyncio.sleep(1)
    return True


async def async_take_over(
    hass: HomeAssistant,
    domain: str,
    unique_id: str,
    old: dict[str, Any],
    *,
    keep_area: bool = True,
) -> str | None:
    """Give a new entity the entity id and the settings of the one it replaces
    (without `keep_area`, no area of its own: it follows its device)."""
    entities = er.async_get(hass)

    def new() -> str | None:
        return entities.async_get_entity_id(domain, HUE_DOMAIN, unique_id)

    if not await _async_until(lambda: new() is not None):
        return None
    entity_id = new()
    assert entity_id is not None
    changes: dict[str, Any] = {}
    wanted = old.get("entity_id")

    def free() -> bool:
        return entities.async_get(wanted) is None and hass.states.async_available(
            wanted
        )

    # The old entity goes when its bridge reports the resource gone.
    if wanted and wanted != entity_id and await _async_until(free):
        changes["new_entity_id"] = wanted
    for key in ("name", "icon"):
        if old.get(key) is not None:
            changes[key] = old[key]
    if old.get("labels"):
        changes["labels"] = set(old["labels"])
    if old.get("aliases"):
        changes["aliases"] = list(old["aliases"])
    if not keep_area:
        changes["area_id"] = None
    elif old.get("area_id") is not None:
        changes["area_id"] = old["area_id"]
    entry = entities.async_get(entity_id)
    if old.get("enabled") and entry is not None and entry.disabled_by is not None:
        changes["disabled_by"] = None
    if old.get("hidden_by_user"):
        changes["hidden_by"] = er.RegistryEntryHider.USER
    if changes:
        entities.async_update_entity(entity_id, **changes)
    return changes.get("new_entity_id", entity_id)


async def _async_restore_ha(
    hass: HomeAssistant, memo: dict[str, Any], devices: list[dict[str, Any]]
) -> None:
    """HA keeps the moved devices as they were: entity ids, names, icons, labels and
    areas."""
    devices_reg = dr.async_get(hass)
    for device in devices:
        if device["restored"]:
            continue
        for light in device["lights"]:
            if (rid := device["new_lights"].get(light["id"])) is None:
                continue
            # A light moved to another area follows its device (no area of its own).
            await async_take_over(
                hass, LIGHT_DOMAIN, rid, light["entity"], keep_area=not memo["area"]
            )
        for other in device["others"]:
            if (rid := device["new_services"].get(other["key"])) is not None:
                await async_take_over(hass, other["domain"], rid, other["entity"])
        ha_device = devices_reg.async_get_device_by_identifier(
            (HUE_DOMAIN, device["new_id"]), memo["target"]
        )
        old = device["ha_device"] or {}
        if ha_device is not None:
            devices_reg.async_update_device(
                ha_device.id,
                area_id=memo["area"] or old.get("area_id"),
                name_by_user=old.get("name_by_user"),
                labels=set(old.get("labels") or ()),
            )
    # Positions outside entertainment areas are kept by light resource id.
    store = position_store(hass)
    changes: dict[str, Any] = {}
    for device in devices:
        for old_rid, new_rid in device["new_lights"].items():
            if (points := store.lights.get(old_rid)) is not None:
                changes[old_rid] = None
                changes[new_rid] = points
    if changes:
        await store.async_update(changes)


async def _async_new_group(target: HueBridgeV2, kind: str, group_id: str) -> Any | None:
    """A room or zone that was just created (the event stream brings it)."""
    controller = target.groups.room if kind == "room" else target.groups.zone
    await _async_until(lambda: controller.get(group_id) is not None)
    return controller.get(group_id)


async def _async_rooms(
    hass: HomeAssistant, target: HueBridgeV2, memo: dict[str, Any]
) -> None:
    """Rooms on the new bridge: a room that moved whole is made again (or a room of its
    name there takes its devices in); other moved lights follow room alignment."""
    new_ids = {d["id"]: d["new_id"] for d in memo["devices"] if d["new_id"]}
    in_rooms: set[str] = set()
    for room in memo["rooms"]:
        devices = [new_ids[d] for d in room["devices"] if d in new_ids]
        in_rooms.update(devices)
        if not devices:
            continue
        existing = target.groups.room.get(room["new_id"] or "") or next(
            (r for r in target.groups.room if r.metadata.name == room["name"]), None
        )
        if existing is None:
            created = await _async_request(
                target,
                "post",
                ROOM_PATH,
                {
                    "metadata": {"name": room["name"], "archetype": room["archetype"]},
                    "children": [{"rid": d, "rtype": "device"} for d in devices],
                },
            )
            if created:
                room["new_id"] = created[0]["rid"]
                await _async_new_group(target, "room", room["new_id"])
            continue
        room["new_id"] = existing.id
        missing = [d for d in devices if d not in _room_devices(existing)]
        if missing:
            children = [
                {"rid": c.rid, "rtype": c.rtype.value} for c in existing.children
            ]
            await _async_request(
                target,
                "put",
                f"{ROOM_PATH}/{existing.id}",
                {
                    "children": children
                    + [{"rid": d, "rtype": "device"} for d in missing]
                },
            )
    others = {
        e
        for d in memo["devices"]
        if d["new_id"] and d["new_id"] not in in_rooms
        for rid in d["new_lights"].values()
        if (e := er.async_get(hass).async_get_entity_id(LIGHT_DOMAIN, HUE_DOMAIN, rid))
    }
    if others:
        await async_align(hass, only=others, hue_entry_id=memo["target"])


async def _async_copy_scenes(
    target: HueBridgeV2,
    scenes: list[dict[str, Any]],
    group: dict[str, str],
    lights: dict[str, str],
) -> list[tuple[str, dict[str, Any]]]:
    """Copy scenes into a room or zone of the target bridge, their light ids mapped
    (a scene of the same name there is kept). Returns (new scene id, the original's
    HA side) of each copy."""
    existing = {
        s.metadata.name for s in target.scenes.scene if s.group.rid == group["rid"]
    }
    copies = []
    for scene in scenes:
        body = dict(scene["body"])
        if body["metadata"]["name"] in existing:
            continue
        actions = [
            {**action, "target": {"rid": lights[rid], "rtype": "light"}}
            for action in body["actions"]
            if (rid := action["target"]["rid"]) in lights
        ]
        if not actions:
            continue
        body.update(group=group, actions=actions)
        created = await _async_request(target, "post", SCENE_PATH, body)
        if created:
            copies.append((created[0]["rid"], scene["entity"]))
    return copies


async def _async_take_over_all(
    hass: HomeAssistant, copies: list[tuple[str, str, dict[str, Any]]]
) -> None:
    for domain, rid, old in copies:
        await async_take_over(hass, domain, rid, old)


async def _async_copy_groups(
    hass: HomeAssistant,
    source: HueBridgeV2 | None,
    target: HueBridgeV2,
    memo: dict[str, Any],
) -> None:
    """The scenes of moved rooms, and the zones of the moved lights, on the new bridge.

    Copies first; then what they replace is deleted on the old bridge (the scenes of a
    moved room, which have no lights left, the room when nothing is left in it, zones
    whose lights all moved) and the copies take over its entity ids. A zone left
    behind in part keeps its other lights; the moved ones get a zone of its name."""
    lights = {old: new for d in memo["devices"] for old, new in d["new_lights"].items()}
    taking: list[tuple[str, str, dict[str, Any]]] = []
    for room in memo["rooms"]:
        new_room = target.groups.room.get(room["new_id"] or "")
        if new_room is None:
            continue
        copies = await _async_copy_scenes(
            target, room["scenes"], {"rid": new_room.id, "rtype": "room"}, lights
        )
        taking += [(SCENE_DOMAIN, rid, old) for rid, old in copies]
        # A device of the room that stayed (skipped, still on the old bridge) keeps
        # the room and its scenes there.
        stayed = any(
            d["id"] in room["devices"] and d["new_id"] is None and not d["removed"]
            for d in memo["devices"]
        )
        if source is None or stayed:
            continue
        for scene in room["scenes"]:
            if source.scenes.scene.get(scene["id"]) is not None:
                await _async_request(source, "delete", f"{SCENE_PATH}/{scene['id']}")
        old_room = source.groups.room.get(room["id"])
        if old_room is not None and not old_room.children:
            await _async_request(source, "delete", f"{ROOM_PATH}/{room['id']}")
            if new_room.grouped_light:
                taking.append((LIGHT_DOMAIN, new_room.grouped_light, room["entity"]))
    for zone in memo["zones"]:
        members = sorted(lights[rid] for rid in zone["lights"] if rid in lights)
        if not members:
            continue
        # A zone of this name over these lights there already (an earlier round).
        new_zone = next(
            (
                z
                for z in target.groups.zone
                if z.metadata.name == zone["name"]
                and {c.rid for c in z.children} >= set(members)
            ),
            None,
        )
        if new_zone is None:
            created = await _async_request(
                target,
                "post",
                ZONE_PATH,
                {
                    "type": "zone",
                    "metadata": {"name": zone["name"], "archetype": zone["archetype"]},
                    "children": [{"rid": rid, "rtype": "light"} for rid in members],
                },
            )
            if not created:
                continue
            new_zone = await _async_new_group(target, "zone", created[0]["rid"])
            if new_zone is None:
                continue
        copies = await _async_copy_scenes(
            target, zone["scenes"], {"rid": new_zone.id, "rtype": "zone"}, lights
        )
        # Whole: every light of it moved (none was skipped).
        if not zone["whole"] or any(rid not in lights for rid in zone["lights"]):
            continue
        if source is not None and source.groups.zone.get(zone["id"]) is not None:
            await _async_request(source, "delete", f"{ZONE_PATH}/{zone['id']}")
        if new_zone.grouped_light:
            taking.append((LIGHT_DOMAIN, new_zone.grouped_light, zone["entity"]))
        taking += [(SCENE_DOMAIN, rid, old) for rid, old in copies]
    await _async_take_over_all(hass, taking)


async def _async_copy_entertainment(
    hass: HomeAssistant,
    source: HueBridgeV2 | None,
    target: HueBridgeV2,
    memo: dict[str, Any],
) -> None:
    """Entertainment areas of the moved lights on the new bridge, the lights where they
    were; one whose lights all moved goes on the old bridge (its entity is taken over),
    one left behind in part keeps its other lights."""
    lights = {old: new for d in memo["devices"] for old, new in d["new_lights"].items()}
    services = entertainment_services(target)
    taking: list[tuple[str, str, dict[str, Any]]] = []
    for area in memo["entertainment"]:
        locations = [
            {
                "service": {"rid": services[new], "rtype": "entertainment"},
                "positions": light["positions"],
            }
            for light in area["lights"]
            if (new := lights.get(light["id"] or "")) is not None and new in services
        ]
        if not locations or any(
            c.metadata.name == area["name"]
            for c in target.config.entertainment_configuration
        ):
            continue
        created = await _async_request(
            target,
            "post",
            ENTERTAINMENT_PATH,
            {
                "type": "entertainment_configuration",
                "metadata": {"name": area["name"]},
                "configuration_type": area["type"],
                "locations": {"service_locations": locations},
            },
        )
        whole = area["whole"] and all(
            light["id"] in lights for light in area["lights"] if light["id"]
        )
        if not whole or source is None:
            continue
        if any(c.id == area["id"] for c in source.config.entertainment_configuration):
            await _async_request(source, "delete", f"{ENTERTAINMENT_PATH}/{area['id']}")
        if created and (domain := area["entity"].get("domain")):
            taking.append((domain, created[0]["rid"], area["entity"]))
    await _async_take_over_all(hass, taking)


async def _async_put_back(bridge: HueBridgeV2, memo: dict[str, Any]) -> None:
    """Back on the old bridge (nothing had been found elsewhere): the lights rejoin
    their zones, scenes and entertainment areas there, as they were."""
    lights = {old: new for d in memo["devices"] for old, new in d["new_lights"].items()}

    def mapped(rid: str) -> str:
        return lights.get(rid, rid)

    for zone in memo["zones"]:
        if bridge.groups.zone.get(zone["id"]) is not None:
            await _async_request(
                bridge,
                "put",
                f"{ZONE_PATH}/{zone['id']}",
                {
                    "children": [
                        {"rid": mapped(r), "rtype": "light"} for r in zone["lights"]
                    ]
                },
            )
    for group in [*memo["rooms"], *memo["zones"]]:
        for scene in group["scenes"]:
            if bridge.scenes.scene.get(scene["id"]) is None:
                continue
            actions = [
                {**a, "target": {"rid": mapped(a["target"]["rid"]), "rtype": "light"}}
                for a in scene["body"]["actions"]
            ]
            await _async_request(
                bridge, "put", f"{SCENE_PATH}/{scene['id']}", {"actions": actions}
            )
    services = entertainment_services(bridge)
    for area in memo["entertainment"]:
        if not any(
            c.id == area["id"] for c in bridge.config.entertainment_configuration
        ):
            continue
        locations = [
            {
                "service": {
                    "rid": services[mapped(light["id"])],
                    "rtype": "entertainment",
                },
                "positions": light["positions"],
            }
            for light in area["lights"]
            if light["id"] and mapped(light["id"]) in services
        ]
        await _async_request(
            bridge,
            "put",
            f"{ENTERTAINMENT_PATH}/{area['id']}",
            {"locations": {"service_locations": locations}},
        )
