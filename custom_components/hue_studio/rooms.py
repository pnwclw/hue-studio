"""Hue rooms follow HA areas: read both sides, apply the alignment plan, watch changes.

The plan itself is computed by `alignment.py` (pure); this module feeds it from the
registries and the bridge, turns it into the panel's payload (entity ids instead of
bridge ids) and writes it to the bridge. Areas are Home Assistant's truth; scenes and
zones stay on the bridge (docs/rooms-and-scenes.md).
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
import logging
from typing import Any

from aiohttp import ClientError
from aiohue import HueBridgeV2
from aiohue.errors import AiohueException
from aiohue.v2.controllers.events import EventType
from aiohue.v2.models.resource import ResourceTypes
from aiohue.v2.models.scene import ScenePut
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.helpers.debounce import Debouncer

from . import alignment
from .const import DOMAIN, HUE_DOMAIN
from .lights import LIGHT_DOMAIN, async_all_lights, async_bridges
from .scenes import SCENE_DOMAIN, completed_actions

_LOGGER = logging.getLogger(__name__)

ROOM_PATH = "clip/v2/resource/room"
# Changes of areas, devices and entities settle before the plan is recomputed.
TRACK_COOLDOWN = 1.0


@dataclass(slots=True)
class BridgeRooms:
    """One bridge's side of the comparison, with the ids the panel needs."""

    hue_entry_id: str
    bridge: HueBridgeV2
    areas: list[alignment.Area]
    lights: list[alignment.Light]
    rooms: list[alignment.Room]
    scenes: list[alignment.Scene]
    # bridge id -> entity id (lights, scenes, rooms via their grouped light)
    light_entities: dict[str, str]
    scene_entities: dict[str, str]
    room_entities: dict[str, str]

    def plan(self, only: set[str] | None = None) -> alignment.Plan:
        """The alignment plan (cut down to some lights with `only`, light ids)."""
        return alignment.compute_plan(
            self.areas, self.lights, self.rooms, self.scenes, only=only
        )


@callback
def _light_area(entity: er.RegistryEntry, devices: dr.DeviceRegistry) -> str | None:
    """Area of a light entity: its own, else its device's."""
    if entity.area_id is not None:
        return entity.area_id
    device = devices.async_get(entity.device_id) if entity.device_id else None
    return device.area_id if device else None


@callback
def async_bridge_rooms(hass: HomeAssistant) -> list[BridgeRooms]:
    """Areas, lights, rooms and scenes of every bridge connected to Hue Studio."""
    entities = er.async_get(hass)
    devices = dr.async_get(hass)
    areas = [
        alignment.Area(area.id, area.name, area.icon)
        for area in ar.async_get(hass).async_list_areas()
    ]
    lights = async_all_lights(hass)
    result: list[BridgeRooms] = []
    for hue_entry_id, bridge in async_bridges(hass).items():
        own = [light for light in lights if light.bridge is bridge]
        light_entities = {light.resource.id: light.entity_id for light in own}
        room_entities: dict[str, str] = {}
        rooms: list[alignment.Room] = []
        for room in bridge.groups.room:
            rooms.append(
                alignment.Room(
                    room.id,
                    room.metadata.name,
                    tuple(
                        child.rid
                        for child in room.children
                        if child.rtype == ResourceTypes.DEVICE
                    ),
                )
            )
            if (grouped := room.grouped_light) is not None and (
                entity_id := entities.async_get_entity_id(
                    LIGHT_DOMAIN, HUE_DOMAIN, grouped
                )
            ):
                room_entities[room.id] = entity_id
        scenes: list[alignment.Scene] = []
        scene_entities: dict[str, str] = {}
        for scene in bridge.scenes.scene:
            scenes.append(
                alignment.Scene(
                    scene.id,
                    scene.group.rid,
                    tuple(
                        action.target.rid
                        for action in scene.actions
                        if action.target.rtype == ResourceTypes.LIGHT
                    ),
                )
            )
            if entity_id := entities.async_get_entity_id(
                SCENE_DOMAIN, HUE_DOMAIN, scene.id
            ):
                scene_entities[scene.id] = entity_id
        result.append(
            BridgeRooms(
                hue_entry_id=hue_entry_id,
                bridge=bridge,
                areas=areas,
                lights=[
                    alignment.Light(
                        light.resource.id,
                        light.resource.owner.rid,
                        _light_area(entry, devices)
                        if (entry := entities.async_get(light.entity_id))
                        else None,
                    )
                    for light in own
                ],
                rooms=rooms,
                scenes=scenes,
                light_entities=light_entities,
                scene_entities=scene_entities,
                room_entities=room_entities,
            )
        )
    return result


def plan_payload(side: BridgeRooms, plan: alignment.Plan) -> dict[str, Any]:
    """The plan with entity ids and names (panel and service response)."""
    lights_of: dict[str, list[str]] = {}
    for light in side.lights:
        if (entity_id := side.light_entities.get(light.id)) is not None:
            lights_of.setdefault(light.device, []).append(entity_id)
    rooms = {room.id: room for room in side.rooms}
    room_name = {room.id: room.name for room in side.rooms}
    names = {
        scene.id: resource.metadata.name
        for scene in side.scenes
        if (resource := side.bridge.scenes.scene.get(scene.id)) is not None
    }

    def entities(light_ids: Iterable[str]) -> list[str]:
        return sorted(
            side.light_entities[rid] for rid in light_ids if rid in side.light_entities
        )

    def device_entities(devices: Iterable[str]) -> list[str]:
        return sorted(e for device in devices for e in lights_of.get(device, []))

    scene_groups = {scene.id: scene.group for scene in side.scenes}
    return {
        "rooms": [
            {
                "area": target.area,
                "name": target.name,
                "create": target.create,
                "rename": target.rename,
                "current_name": target.current_name,
                "group": side.room_entities.get(target.room or ""),
                "lights": device_entities(target.devices),
            }
            for target in plan.rooms
        ],
        "moves": [
            {
                "lights": entities(move.lights),
                "area": move.area,
                "from": room_name.get(move.source or ""),
                "from_group": side.room_entities.get(move.source or ""),
                "from_area": move.source_area,
            }
            for move in plan.moves
        ],
        "empty": [
            {
                "name": rooms[room_id].name,
                "group": side.room_entities.get(room_id),
                "scenes": sum(1 for s in side.scenes if s.group == room_id),
            }
            for room_id in plan.empty
        ],
        "scenes": [
            {
                "entity_id": side.scene_entities.get(change.scene),
                "name": names.get(change.scene, change.scene),
                "group_name": room_name.get(scene_groups.get(change.scene, "")),
                "lost": entities(change.lost),
                "missing": entities(change.missing),
            }
            for change in plan.scenes
        ],
        "conflicts": device_entities(plan.conflicts),
        "hue_rooms": {
            entity_id: room_name[room_id]
            for device, room_id in plan.current.items()
            for entity_id in lights_of.get(device, [])
        },
    }


def merge_payloads(payloads: list[dict[str, Any]]) -> dict[str, Any]:
    """One payload for all bridges (lists concatenated, maps merged)."""
    merged: dict[str, Any] = {
        "rooms": [],
        "moves": [],
        "empty": [],
        "scenes": [],
        "conflicts": [],
        "hue_rooms": {},
    }
    for payload in payloads:
        for key, value in payload.items():
            if isinstance(value, dict):
                merged[key].update(value)
            else:
                merged[key].extend(value)
    merged["changed"] = bool(merged["moves"]) or any(
        room["create"] or room["rename"] for room in merged["rooms"]
    )
    return merged


@callback
def async_rooms_payload(hass: HomeAssistant) -> dict[str, Any]:
    """The full alignment plan of every bridge (nothing is changed)."""
    return merge_payloads(
        [plan_payload(side, side.plan()) for side in async_bridge_rooms(hass)]
    )


async def async_align(
    hass: HomeAssistant,
    *,
    only: set[str] | None = None,
    dry_run: bool = False,
    complete_scenes: bool = True,
    delete_empty: bool = False,
    hue_entry_id: str | None = None,
) -> dict[str, Any]:
    """Compute the plan of each bridge and (unless `dry_run`) apply it.

    `only` (light entity ids) restricts the plan to moving those lights. Returns the
    payload of what was (or would be) done.
    """
    payloads: list[dict[str, Any]] = []
    for side in async_bridge_rooms(hass):
        if hue_entry_id is not None and side.hue_entry_id != hue_entry_id:
            continue
        ids: set[str] | None = None
        if only is not None:
            ids = {rid for rid, eid in side.light_entities.items() if eid in only}
            if not ids:
                continue
        plan = side.plan(ids)
        payloads.append(plan_payload(side, plan))
        if not dry_run:
            await _async_apply(side, plan, complete_scenes, delete_empty)
    return merge_payloads(payloads)


async def _async_apply(
    side: BridgeRooms,
    plan: alignment.Plan,
    complete_scenes: bool,
    delete_empty: bool,
) -> None:
    """Write the plan to the bridge, one request at a time.

    Devices leave their rooms first (a device can be in one room only), then new rooms
    are created with their devices and existing ones get theirs (and their new names).
    """
    bridge = side.bridge
    names = {room.id: room.name for room in side.rooms}
    children: dict[str, list[dict[str, str]]] = {
        room.id: [{"rid": c.rid, "rtype": c.rtype.value} for c in room.children]
        for room in bridge.groups.room
    }
    leaving: dict[str, set[str]] = {}
    joining: dict[str, set[str]] = {}
    for move in plan.moves:
        if move.source is not None:
            leaving.setdefault(move.source, set()).add(move.device)
        joining.setdefault(move.area, set()).add(move.device)

    for room_id, devices in leaving.items():
        children[room_id] = [c for c in children[room_id] if c["rid"] not in devices]
        await _async_request(
            bridge,
            names[room_id],
            "put",
            f"{ROOM_PATH}/{room_id}",
            {"children": children[room_id]},
        )

    for target in plan.rooms:
        added = sorted(joining.get(target.area, ()))
        refs = [{"rid": d, "rtype": ResourceTypes.DEVICE.value} for d in added]
        if target.room is None:
            await _async_request(
                bridge,
                target.name,
                "post",
                ROOM_PATH,
                {
                    "metadata": {"name": target.name, "archetype": target.archetype},
                    "children": refs,
                },
            )
            continue
        body: dict[str, Any] = {}
        if refs:
            body["children"] = children[target.room] + refs
        if target.rename:
            body["metadata"] = {"name": target.name}
        if body:
            await _async_request(
                bridge,
                target.current_name or target.name,
                "put",
                f"{ROOM_PATH}/{target.room}",
                body,
            )

    if delete_empty:
        for room_id in plan.empty:
            await _async_request(
                bridge, names[room_id], "delete", f"{ROOM_PATH}/{room_id}", None
            )

    if complete_scenes:
        await _async_complete_scenes(bridge, plan)


async def _async_complete_scenes(bridge: HueBridgeV2, plan: alignment.Plan) -> None:
    """Give scenes actions for the lights that joined their room."""
    for change in plan.scenes:
        if not change.missing:
            continue
        scene = bridge.scenes.scene.get(change.scene)
        new = [light for rid in change.missing if (light := bridge.lights.get(rid))]
        if scene is None or not new:
            continue
        actions = completed_actions(bridge, scene, new)
        try:
            await bridge.scenes.scene.update(scene.id, ScenePut(actions=actions))
        except (AiohueException, ClientError, TimeoutError) as err:
            # The rooms are aligned already; a scene that keeps its old actions is
            # not worth failing the whole call for.
            _LOGGER.warning("Could not complete scene %s: %s", scene.metadata.name, err)


async def _async_request(
    bridge: HueBridgeV2,
    name: str,
    method: str,
    path: str,
    body: dict[str, Any] | None,
) -> None:
    try:
        if body is None:
            await bridge.request(method, path)
        else:
            await bridge.request(method, path, json=body)
    except (AiohueException, ClientError, TimeoutError) as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="room_change_failed",
            translation_placeholders={"name": name},
        ) from err


@callback
def async_set_light_area(
    hass: HomeAssistant, entity_id: str, area_id: str | None
) -> None:
    """Put a Hue light into an area, the way HA's own "Assign area" would.

    The light's device moves (that is where the native integration keeps areas; an
    entity without a name of its own cannot have an area of its own anyway), and an
    area the entity overrides it with is dropped.
    """
    entities = er.async_get(hass)
    devices = dr.async_get(hass)
    entry = entities.async_get(entity_id)
    if entry is None or entry.domain != LIGHT_DOMAIN or entry.platform != HUE_DOMAIN:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="not_hue_light",
            translation_placeholders={"entity_id": entity_id},
        )
    if area_id is not None and ar.async_get(hass).async_get_area(area_id) is None:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="unknown_ha_area",
            translation_placeholders={"area": area_id},
        )
    device = devices.async_get(entry.device_id) if entry.device_id else None
    if device is None:
        entities.async_update_entity(entity_id, area_id=area_id)
        return
    devices.async_update_device(device.id, area_id=area_id)
    if entry.area_id is not None:
        entities.async_update_entity(entity_id, area_id=None)


@callback
def async_track_areas(
    hass: HomeAssistant, on_change: Callable[[], None]
) -> Callable[[], None]:
    """Call `on_change` (debounced) when areas, or areas of devices/entities, change."""
    debouncer: Debouncer[None] = Debouncer(
        hass, _LOGGER, cooldown=TRACK_COOLDOWN, immediate=False, function=on_change
    )

    @callback
    def area_changed(event: Event[Any]) -> None:
        debouncer.async_schedule_call()

    @callback
    def member_changed(event: Event[Any]) -> None:
        # Devices and entities: added, removed, or given another area.
        data = event.data
        if data.get("action") != "update" or "area_id" in data.get("changes", {}):
            debouncer.async_schedule_call()

    unsubs = [
        hass.bus.async_listen(ar.EVENT_AREA_REGISTRY_UPDATED, area_changed),
        hass.bus.async_listen(dr.EVENT_DEVICE_REGISTRY_UPDATED, member_changed),
        hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, member_changed),
    ]

    @callback
    def unsubscribe() -> None:
        for unsub in unsubs:
            unsub()
        debouncer.async_cancel()

    return unsubscribe


@callback
def async_track_rooms(
    hass: HomeAssistant, on_change: Callable[[], None]
) -> Callable[[], None]:
    """Call `on_change` (debounced) when anything the plan depends on changes.

    Areas (as in `async_track_areas`) and, on every connected bridge, rooms, lights
    added or removed, and scenes.
    """
    debouncer: Debouncer[None] = Debouncer(
        hass, _LOGGER, cooldown=TRACK_COOLDOWN, immediate=False, function=on_change
    )

    @callback
    def bridge_changed(*_: Any) -> None:
        debouncer.async_schedule_call()

    unsubs = [async_track_areas(hass, debouncer.async_schedule_call)]
    for bridge in async_bridges(hass).values():
        unsubs.append(bridge.groups.room.subscribe(bridge_changed))
        unsubs.append(
            bridge.lights.subscribe(
                bridge_changed,
                event_filter=(EventType.RESOURCE_ADDED, EventType.RESOURCE_DELETED),
            )
        )
        unsubs.append(bridge.scenes.scene.subscribe(bridge_changed))

    @callback
    def unsubscribe() -> None:
        for unsub in unsubs:
            unsub()
        debouncer.async_cancel()

    return unsubscribe
