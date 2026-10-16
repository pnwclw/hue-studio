"""Moving lights, a room or a zone to another bridge.

Each bridge is its own Hue system and an area belongs to one bridge
(docs/rooms-and-scenes.md). A whole bridge moves with the Hue app's own transfer; here
a room (with its scenes and zones) or lights that go to a room on another bridge move,
and Home Assistant keeps their entity ids, names and areas:

1. What moves is remembered first, in a Store (a restart in between loses nothing):
   per device its Zigbee MAC, name, archetype, each light's function and power-on
   preset, the HA side of its entities and device; the room's and zones' scenes.
2. The devices leave the old bridge: deleted there (a deleted light resets itself and
   joins the next bridge that searches). With serial numbers the new bridge takes them
   first (it resets them by their serial) and the old one forgets them afterwards.
3. The new bridge searches (about a minute, a few times) and each device is known again
   by its Zigbee MAC.
4. Name, archetype, function and power-on are set again; in HA the new entities get the
   old entity ids, names, icons, labels and the area (the old ones are gone by then).
5. Hue rooms follow the areas (`rooms.async_align` on the new bridge). A whole room's
   scenes are copied into its new room and its old room's scenes and (when nothing is
   left in it) the room are deleted; zones whose lights all moved are copied and
   deleted, zones left behind in part are split (a zone of the same name over the moved
   lights). The copies take over the entity ids of what they replace.

One move runs at a time, as a background task the panel watches
(`hue_studio/bridges/move/subscribe`); lights the search does not find leave it waiting
for another search (with serial numbers, or on another bridge).
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable
from dataclasses import dataclass
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
    is_bridge_device,
    light_settings,
    put_light_settings,
)
from .entertainment import entertainment_services
from .lights import LIGHT_DOMAIN, async_all_lights, async_bridges
from .positions import position_store
from .rooms import async_align, light_area
from .scenes import SCENE_DOMAIN

_LOGGER = logging.getLogger(__name__)

SIGNAL_MOVE_UPDATED = f"{DOMAIN}_move_updated"
STORAGE_KEY = f"{DOMAIN}.move"
STORAGE_VERSION = 1

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


# --- what moves -------------------------------------------------------------------


@dataclass(slots=True)
class Selection:
    """What a request names, resolved: the lights' bridge, devices and the area."""

    source: str
    target: str
    # Hue device ids (every light of a device moves with it).
    devices: list[str]
    # The area the lights end up in (None: each keeps its own).
    area: str | None
    # The Hue room on the source bridge that moves as a whole, if any.
    room: str | None


def _mac(bridge: HueBridgeV2, device_id: str) -> str | None:
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


def _light_devices(bridge: HueBridgeV2, room: Any) -> set[str]:
    """The devices of a room that have lights."""
    return {
        c.rid
        for c in room.children
        if c.rtype == ResourceTypes.DEVICE
        and (d := bridge.devices.get(c.rid)) is not None
        and _light_ids(d)
    }


@callback
def async_select(
    hass: HomeAssistant,
    target: str,
    *,
    area: str | None = None,
    lights: Iterable[str] | None = None,
    to_area: str | None = None,
) -> Selection:
    """Resolve a move: an area's Hue lights (`area`) or some lights (`lights`), to the
    bridge `target`, the lights into `to_area` (default: their own area)."""
    bridges = async_bridges(hass)
    if target not in bridges:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="hue_entry_missing"
        )
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
    if source == target:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="move_same_bridge"
        )
    bridge = bridges[source]
    devices = sorted({light.resource.owner.rid for light in chosen})
    rooms = {r.id: r for d in devices if (r := _room_of(bridge, d)) is not None}
    whole = None
    if area is not None and len(rooms) == 1:
        room = next(iter(rooms.values()))
        if _light_devices(bridge, room) <= set(devices):
            whole = room.id
    return Selection(source, target, devices, to_area, whole)


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


@callback
def async_move_plan(hass: HomeAssistant, selection: Selection) -> dict[str, Any]:
    """What a move does, for the panel to show before it starts:

    {"source", "target", "source_name", "target_name",
     "lights": [entity ids], "room": name | None, "scenes": count copied,
     "zones": [{"name", "whole"}], "entertainment": [names],
     "staying": [names of other devices in the room], "over_limit": bool}
    """
    bridges = async_bridges(hass)
    bridge = bridges[selection.source]
    target = bridges[selection.target]
    entities = er.async_get(hass)
    light_ids = {
        rid
        for d in selection.devices
        if (device := bridge.devices.get(d)) is not None
        for rid in _light_ids(device)
    }
    light_entities = sorted(
        e
        for rid in light_ids
        if (e := entities.async_get_entity_id(LIGHT_DOMAIN, HUE_DOMAIN, rid))
    )
    room = bridge.groups.room.get(selection.room) if selection.room else None
    staying = (
        [
            d.metadata.name
            for c in room.children
            if c.rtype == ResourceTypes.DEVICE
            and c.rid not in selection.devices
            and (d := bridge.devices.get(c.rid)) is not None
        ]
        if room is not None
        else []
    )
    zones = _zones_touched(bridge, light_ids)
    scenes = 0
    if room is not None:
        scenes += sum(1 for s in bridge.scenes.scene if s.group.rid == room.id)
    for zone, _whole in zones:
        scenes += sum(1 for s in bridge.scenes.scene if s.group.rid == zone.id)
    services = {
        sid for lid, sid in entertainment_services(bridge).items() if lid in light_ids
    }
    entertainment = [
        config.metadata.name
        for config in bridge.config.entertainment_configuration
        if any(
            loc.service.rid in services for loc in config.locations.service_locations
        )
    ]
    return {
        "source": selection.source,
        "target": selection.target,
        "source_name": bridge_name(hass, selection.source, bridge),
        "target_name": bridge_name(hass, selection.target, target),
        "lights": light_entities,
        "room": room.metadata.name if room is not None else None,
        "scenes": scenes,
        "zones": [{"name": z.metadata.name, "whole": whole} for z, whole in zones],
        "entertainment": sorted(set(entertainment)),
        "staying": sorted(staying),
        "over_limit": sum(1 for _ in target.lights) + len(light_ids)
        > _light_limit(target),
    }


# --- remembering ------------------------------------------------------------------


def _strings(values: Iterable[Any]) -> list[str]:
    return [v for v in values if isinstance(v, str)]


@callback
def _remember_entity(hass: HomeAssistant, entity_id: str | None) -> dict[str, Any]:
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
    }


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


@callback
def _remember_scenes(
    hass: HomeAssistant, bridge: HueBridgeV2, group_id: str
) -> list[dict[str, Any]]:
    entities = er.async_get(hass)
    return [
        {
            "id": scene.id,
            "entity": _remember_entity(
                hass, entities.async_get_entity_id(SCENE_DOMAIN, HUE_DOMAIN, scene.id)
            ),
            "body": _scene_body(scene),
        }
        for scene in bridge.scenes.scene
        if scene.group.rid == group_id
    ]


@callback
def _remember_group(
    hass: HomeAssistant, bridge: HueBridgeV2, group: Any
) -> dict[str, Any]:
    entities = er.async_get(hass)
    grouped = group.grouped_light
    return {
        "id": group.id,
        "name": group.metadata.name,
        "archetype": group.metadata.archetype.value,
        "lights": [c.rid for c in group.children if c.rtype == ResourceTypes.LIGHT],
        "entity": _remember_entity(
            hass,
            entities.async_get_entity_id(LIGHT_DOMAIN, HUE_DOMAIN, grouped)
            if grouped
            else None,
        ),
        "scenes": _remember_scenes(hass, bridge, group.id),
    }


@callback
def async_remember(hass: HomeAssistant, selection: Selection) -> dict[str, Any]:
    """Everything a move needs to restore, as plain data (stored)."""
    bridge = async_bridges(hass)[selection.source]
    entities = er.async_get(hass)
    devices_reg = dr.async_get(hass)
    devices = []
    light_ids: set[str] = set()
    for device_id in selection.devices:
        device = bridge.devices.get(device_id)
        if device is None or is_bridge_device(bridge, device):
            continue
        ha_device = devices_reg.async_get_device_by_identifier(
            (HUE_DOMAIN, device_id), selection.source
        )
        lights = []
        for rid in _light_ids(device):
            light_ids.add(rid)
            function, power_on = light_settings(bridge.lights.get(rid))
            lights.append(
                {
                    "id": rid,
                    "function": function,
                    "power_on": power_on,
                    "entity": _remember_entity(
                        hass,
                        entities.async_get_entity_id(LIGHT_DOMAIN, HUE_DOMAIN, rid),
                    ),
                }
            )
        devices.append(
            {
                "id": device_id,
                "mac": _mac(bridge, device_id),
                "name": device.metadata.name,
                "archetype": device.metadata.archetype.value,
                "lights": lights,
                "ha_device": {
                    "area_id": ha_device.area_id,
                    "name_by_user": ha_device.name_by_user,
                    "labels": sorted(ha_device.labels),
                }
                if ha_device is not None
                else None,
                # Filled in as the move goes.
                "removed": False,
                "new_id": None,
                "new_lights": {},
                "restored": False,
            }
        )
    room = bridge.groups.room.get(selection.room) if selection.room else None
    return {
        "source": selection.source,
        "target": selection.target,
        "area": selection.area,
        "devices": devices,
        "room": _remember_group(hass, bridge, room) if room is not None else None,
        "zones": [
            {**_remember_group(hass, bridge, zone), "whole": whole}
            for zone, whole in _zones_touched(bridge, light_ids)
        ],
        "step": "saving",
        "started": time.time(),
        "error": None,
        "searching_until": None,
        "serials": [],
    }


# --- the move ---------------------------------------------------------------------


@dataclass(slots=True)
class Mover:
    """The move in progress (or waiting), its stored memo and its task."""

    hass: HomeAssistant
    store: Store[dict[str, Any]]
    memo: dict[str, Any] | None = None
    task: asyncio.Task[None] | None = None

    async def async_save(self) -> None:
        if self.memo is None:
            await self.store.async_remove()
        else:
            await self.store.async_save(self.memo)
        async_dispatcher_send(self.hass, SIGNAL_MOVE_UPDATED)

    async def async_step(self, step: str, **changes: Any) -> None:
        assert self.memo is not None
        self.memo.update(step=step, **changes)
        await self.async_save()

    @property
    def busy(self) -> bool:
        return self.task is not None and not self.task.done()


async def async_setup_moves(hass: HomeAssistant) -> None:
    """Load a move left unfinished (by a restart): it waits for another search."""
    mover = Mover(hass, Store(hass, STORAGE_VERSION, STORAGE_KEY, private=True))
    hass.data[STORAGE_KEY] = mover
    memo = await mover.store.async_load()
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


@callback
def async_move_payload(hass: HomeAssistant) -> dict[str, Any] | None:
    """The move the panel shows, or None:

    {"step", "error", "source", "target", "source_name", "target_name", "room",
     "area", "searching_until", "running",
     "lights": [{"entity_id", "name", "found"}]}
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
        "room": memo["room"]["name"] if memo.get("room") else None,
        "area": memo.get("area"),
        "searching_until": memo.get("searching_until"),
        "running": mover.busy,
        "lights": [
            {
                "entity_id": light["entity"]["entity_id"],
                "name": device["name"],
                "found": device["new_id"] is not None,
            }
            for device in memo["devices"]
            for light in device["lights"][:1]
        ],
    }


async def async_start_move(
    hass: HomeAssistant, selection: Selection, serials: list[str]
) -> None:
    """Start a move (one at a time)."""
    mover = _mover(hass)
    if mover.busy or (
        mover.memo is not None and mover.memo["step"] not in ("done", "failed")
    ):
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="move_busy"
        )
    memo = async_remember(hass, selection)
    memo["serials"] = serials
    mover.memo = memo
    await mover.async_save()
    mover.task = hass.async_create_background_task(
        _async_run(mover), f"{DOMAIN} move to another bridge"
    )


async def async_retry_move(
    hass: HomeAssistant, serials: list[str], target: str | None = None
) -> None:
    """Search again for the lights not found yet (with serial numbers, or on another
    bridge, e.g. the old one to put them back)."""
    mover = _mover(hass)
    if mover.busy or mover.memo is None:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="move_busy"
        )
    if target is not None:
        if target not in async_bridges(hass):
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key="hue_entry_missing"
            )
        mover.memo["target"] = target
    mover.memo.update(serials=serials, error=None)
    mover.task = hass.async_create_background_task(
        _async_run(mover), f"{DOMAIN} move to another bridge"
    )


async def async_finish_move(hass: HomeAssistant) -> None:
    """Forget a finished move, or stop waiting for lights that were not found (they
    stay wherever they are; the rest has been restored)."""
    mover = _mover(hass)
    if mover.busy:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="move_busy"
        )
    mover.memo = None
    await mover.async_save()


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
        await mover.async_step(
            "waiting" if err.reason == "not_found" else "failed",
            error=err.reason,
            searching_until=None,
        )
    except (AiohueException, ClientError, TimeoutError, HomeAssistantError) as err:
        _LOGGER.warning("Moving to another bridge stopped: %s", err)
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
    pending = [d for d in memo["devices"] if d["new_id"] is None]
    # Lights the target bridge has already (an earlier round, or a move back).
    _match(target, pending)
    pending = [d for d in pending if d["new_id"] is None]

    if pending and not memo["serials"]:
        # Without serial numbers the old bridge lets go first (a deleted light resets).
        if source is None and any(not d["removed"] for d in pending):
            raise MoveError("source_offline")
        await mover.async_step("removing")
        for device in pending:
            await _async_remove(source, device)
            await mover.async_save()

    if pending:
        await _async_search(hass, mover, target, memo)
    found = [d for d in memo["devices"] if d["new_id"] is not None]
    # With serial numbers the new bridge took them; the old one forgets them now.
    for device in found:
        if not device["removed"]:
            await _async_remove(source, device)
    await mover.async_save()

    await mover.async_step("restoring")
    for device in found:
        if not device["restored"]:
            await _async_restore_bridge(target, device)
    await _async_restore_ha(hass, memo, found)
    for device in found:
        device["restored"] = True
    await mover.async_save()

    await mover.async_step("rooms")
    new_lights = {
        e
        for d in found
        for rid in d["new_lights"].values()
        if (e := er.async_get(hass).async_get_entity_id(LIGHT_DOMAIN, HUE_DOMAIN, rid))
    }
    if new_lights:
        await async_align(hass, only=new_lights, hue_entry_id=memo["target"])
    if any(d["new_id"] is None for d in memo["devices"]):
        # Scenes and zones wait for every light (they are copied once).
        raise MoveError("not_found")

    await mover.async_step("scenes")
    await _async_copy_groups(hass, source, target, memo)
    async_forget_new(hass, [d["new_id"] for d in found])
    await mover.async_step("done", error=None, searching_until=None)


def _match(bridge: HueBridgeV2, devices: list[dict[str, Any]]) -> None:
    """Know moved devices on a bridge again by their Zigbee MAC."""
    by_mac = {
        mac: device
        for device in bridge.devices
        if not is_bridge_device(bridge, device) and (mac := _mac(bridge, device.id))
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


async def _async_remove(source: HueBridgeV2 | None, device: dict[str, Any]) -> None:
    if device["removed"]:
        return
    if source is not None and source.devices.get(device["id"]) is not None:
        await _async_request(source, "delete", f"{DEVICE_PATH}/{device['id']}")
    device["removed"] = True


async def _async_search(
    hass: HomeAssistant, mover: Mover, target: HueBridgeV2, memo: dict[str, Any]
) -> None:
    """Let the target bridge search until every device is back (a few rounds)."""
    wanted = [d for d in memo["devices"] if d["new_id"] is None]
    for _round in range(SEARCH_ROUNDS):
        await async_search(hass, memo["target"], memo["serials"])
        until = time.time() + SEARCH_TIME
        await mover.async_step("searching", searching_until=until)
        while time.time() < until:
            before = sum(d["new_id"] is not None for d in wanted)
            _match(target, wanted)
            if all(d["new_id"] is not None for d in wanted):
                return
            if sum(d["new_id"] is not None for d in wanted) > before:
                await mover.async_save()
            await asyncio.sleep(POLL)
    _match(target, wanted)


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


async def _async_take_over(
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
    if changes:
        entities.async_update_entity(entity_id, **changes)
    return changes.get("new_entity_id", entity_id)


async def _async_restore_ha(
    hass: HomeAssistant, memo: dict[str, Any], devices: list[dict[str, Any]]
) -> None:
    """HA keeps the moved lights as they were: entity ids, names, icons, labels and
    area."""
    devices_reg = dr.async_get(hass)
    for device in devices:
        if device["restored"]:
            continue
        for light in device["lights"]:
            if (rid := device["new_lights"].get(light["id"])) is None:
                continue
            # A light moved to another area follows its device (no area of its own).
            await _async_take_over(
                hass, LIGHT_DOMAIN, rid, light["entity"], keep_area=not memo["area"]
            )
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


async def _async_new_group(
    hass: HomeAssistant, target: HueBridgeV2, kind: str, group_id: str
) -> Any | None:
    """A room or zone that was just created (the event stream brings it)."""
    controller = target.groups.room if kind == "room" else target.groups.zone
    await _async_until(lambda: controller.get(group_id) is not None)
    return controller.get(group_id)


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


async def _async_take_over_scenes(
    hass: HomeAssistant, copies: list[tuple[str, dict[str, Any]]]
) -> None:
    for rid, old in copies:
        await _async_take_over(hass, SCENE_DOMAIN, rid, old)


async def _async_copy_groups(
    hass: HomeAssistant,
    source: HueBridgeV2 | None,
    target: HueBridgeV2,
    memo: dict[str, Any],
) -> None:
    """A whole room's scenes, and the zones of the moved lights, on the new bridge.

    Copies first; then what they replace is deleted on the old bridge (a whole room's
    scenes, which have no lights left, the room when nothing is left in it, zones
    whose lights all moved) and the copies take over its entity ids. A zone left
    behind in part keeps its other lights; the moved ones get a zone of its name."""
    lights = {old: new for d in memo["devices"] for old, new in d["new_lights"].items()}
    new_devices = {d["new_id"] for d in memo["devices"] if d["new_id"]}
    if (room := memo["room"]) is not None:
        # The room alignment made (or found) for the area on the new bridge.
        new_room = next(
            (
                r
                for r in target.groups.room
                if any(c.rid in new_devices for c in r.children)
            ),
            None,
        )
        if new_room is not None:
            copies = await _async_copy_scenes(
                target, room["scenes"], {"rid": new_room.id, "rtype": "room"}, lights
            )
            if source is not None:
                for scene in room["scenes"]:
                    if source.scenes.scene.get(scene["id"]) is not None:
                        await _async_request(
                            source, "delete", f"{SCENE_PATH}/{scene['id']}"
                        )
                old = source.groups.room.get(room["id"])
                if old is not None and not old.children:
                    await _async_request(source, "delete", f"{ROOM_PATH}/{room['id']}")
                    if new_room.grouped_light:
                        await _async_take_over(
                            hass, LIGHT_DOMAIN, new_room.grouped_light, room["entity"]
                        )
            await _async_take_over_scenes(hass, copies)
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
            new_zone = await _async_new_group(hass, target, "zone", created[0]["rid"])
            if new_zone is None:
                continue
        copies = await _async_copy_scenes(
            target, zone["scenes"], {"rid": new_zone.id, "rtype": "zone"}, lights
        )
        if not zone["whole"]:
            continue
        if source is not None and source.groups.zone.get(zone["id"]) is not None:
            await _async_request(source, "delete", f"{ZONE_PATH}/{zone['id']}")
        if new_zone.grouped_light:
            await _async_take_over(
                hass, LIGHT_DOMAIN, new_zone.grouped_light, zone["entity"]
            )
        await _async_take_over_scenes(hass, copies)
