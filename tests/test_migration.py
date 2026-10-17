"""Moving a bridge, rooms and lights to another bridge (migration.py), with two fake
bridges.

The fake bridges keep devices, lights, rooms, zones, scenes and entertainment areas,
answer CLIP requests the way a bridge does (a deleted device leaves its rooms, zones,
scenes and areas), and stand in for the native integration: resources get entities in
HA's registry, and lose them.
"""

from __future__ import annotations

from collections.abc import Callable
from itertools import count
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from aiohue.v2.models.feature import OnFeature
from aiohue.v2.models.resource import ResourceIdentifier, ResourceTypes
from aiohue.v2.models.scene import (
    Action,
    ActionAction,
    Scene,
    SceneActiveStatus,
    SceneMetadata,
    SceneStatus,
)
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.hue_studio import migration
from custom_components.hue_studio.lights import HueLight
from custom_components.hue_studio.positions import (
    async_setup_positions,
    position_store,
)
from custom_components.hue_studio.websocket import async_setup_websocket

HUE = "hue"
MAC = {
    "desk": "00:17:88:01:00:00:00:01",
    "lamp": "00:17:88:01:00:00:00:02",
    "other": "00:17:88:01:00:00:00:03",
}


def _ref(rid: str, rtype: ResourceTypes) -> ResourceIdentifier:
    return ResourceIdentifier(rid=rid, rtype=rtype)


class Controller:
    """A dict of resources with aiohue's get / iteration."""

    def __init__(self) -> None:
        self.items: dict[str, Any] = {}

    def get(self, rid: str) -> Any:
        return self.items.get(rid)

    def __iter__(self):
        return iter(list(self.items.values()))


class Services:
    """A bridge's entertainment services: one per light."""

    def __init__(self, lights: Controller) -> None:
        self.lights = lights

    def __iter__(self):
        return iter(
            SimpleNamespace(
                id=f"{rid}-ent", renderer_reference=_ref(rid, ResourceTypes.LIGHT)
            )
            for rid in list(self.lights.items)
        )


def _locations(locations: list[dict[str, Any]]) -> SimpleNamespace:
    return SimpleNamespace(
        service_locations=[
            SimpleNamespace(
                service=_ref(loc["service"]["rid"], ResourceTypes.ENTERTAINMENT),
                positions=[SimpleNamespace(**p) for p in loc["positions"]],
            )
            for loc in locations
        ]
    )


class FakeBridge:
    """Just enough of HueBridgeV2 and the CLIP API for a move."""

    def __init__(
        self, name: str, on_add: Callable[..., None], on_remove: Callable[..., None]
    ) -> None:
        self.prefix = name
        self.ids = count(1)
        self.on_add = on_add
        self.on_remove = on_remove
        self.requests: list[tuple[str, str, Any]] = []
        self.macs: dict[str, str] = {}
        self.devices = Controller()
        self.devices.get_zigbee_connectivity = lambda rid: (
            SimpleNamespace(mac_address=self.macs[rid]) if rid in self.macs else None
        )
        self.lights = Controller()
        self.groups = SimpleNamespace(room=Controller(), zone=Controller())
        self.scenes = SimpleNamespace(scene=Controller())
        self.areas = Controller()
        self.config = SimpleNamespace(
            bridge_device=SimpleNamespace(
                id=f"{name}-bridge",
                metadata=SimpleNamespace(name=f"Bridge {name.upper()}"),
                product_data=SimpleNamespace(model_id="BSB002"),
            ),
            entertainment_configuration=self.areas,
            # Entertainment service `<light>-ent` of every light.
            entertainment=Services(self.lights),
        )

    def new_id(self, kind: str) -> str:
        return f"{self.prefix}-{kind}-{next(self.ids)}"

    def add_device(self, key: str, *, light: bool = True, device_id: str = "") -> str:
        """A device (with one light, `<device id>-light`, and its Zigbee connectivity
        `<device id>-zc`) joins."""
        device_id = device_id or self.new_id(key)
        services = [_ref(f"{device_id}-zc", ResourceTypes.ZIGBEE_CONNECTIVITY)]
        if light:
            rid = f"{device_id}-light"
            self.lights.items[rid] = SimpleNamespace(
                id=rid,
                owner=_ref(device_id, ResourceTypes.DEVICE),
                metadata=SimpleNamespace(function=None),
                powerup=SimpleNamespace(preset=None),
            )
            services.append(_ref(rid, ResourceTypes.LIGHT))
        self.devices.items[device_id] = SimpleNamespace(
            id=device_id,
            services=services,
            metadata=SimpleNamespace(
                name=f"Hue lamp {device_id}",
                archetype=SimpleNamespace(value="classic_bulb"),
            ),
            product_data=SimpleNamespace(
                product_archetype=SimpleNamespace(value="classic_bulb")
            ),
        )
        if key in MAC:
            self.macs[device_id] = MAC[key]
        self.on_add(self, "device", device_id)
        for service in services:
            kind = "light" if service.rtype == ResourceTypes.LIGHT else "sensor"
            self.on_add(self, kind, service.rid, device_id)
        return device_id

    def add_group(self, kind: str, rid: str, name: str, children: list[str]) -> Any:
        rtype = ResourceTypes.DEVICE if kind == "room" else ResourceTypes.LIGHT
        group = SimpleNamespace(
            id=rid,
            metadata=SimpleNamespace(
                name=name, archetype=SimpleNamespace(value="office")
            ),
            children=[_ref(c, rtype) for c in children],
            grouped_light=f"{rid}-group",
        )
        getattr(self.groups, kind).items[rid] = group
        self.on_add(self, "group", group.grouped_light)
        return group

    def add_scene(self, rid: str, name: str, group: str, lights: list[str]) -> Scene:
        rtype = (
            ResourceTypes.ROOM
            if group in self.groups.room.items
            else ResourceTypes.ZONE
        )
        scene = Scene(
            id=rid,
            metadata=SceneMetadata(name=name),
            group=_ref(group, rtype),
            actions=[
                Action(
                    target=_ref(light, ResourceTypes.LIGHT),
                    action=ActionAction(on=OnFeature(on=True)),
                )
                for light in lights
            ],
            speed=0.5,
            auto_dynamic=False,
            status=SceneStatus(active=SceneActiveStatus.INACTIVE),
        )
        self.scenes.scene.items[rid] = scene
        self.on_add(self, "scene", rid)
        return scene

    def add_area(self, rid: str, name: str, lights: list[str]) -> None:
        self.areas.items[rid] = SimpleNamespace(
            id=rid,
            metadata=SimpleNamespace(name=name),
            configuration_type=SimpleNamespace(value="screen"),
            locations=_locations(
                [
                    {
                        "service": {"rid": f"{light}-ent"},
                        "positions": [{"x": float(i), "y": 0.5, "z": 0.0}],
                    }
                    for i, light in enumerate(lights)
                ]
            ),
        )
        self.on_add(self, "area", rid)

    def delete_device(self, device_id: str) -> None:
        device = self.devices.items.pop(device_id)
        self.macs.pop(device_id, None)
        lights = [s.rid for s in device.services if s.rtype == ResourceTypes.LIGHT]
        for room in self.groups.room:
            room.children = [c for c in room.children if c.rid != device_id]
        for zone in self.groups.zone:
            zone.children = [c for c in zone.children if c.rid not in lights]
        for scene in self.scenes.scene:
            scene.actions = [a for a in scene.actions if a.target.rid not in lights]
        gone = {f"{rid}-ent" for rid in lights}
        for area in self.areas:
            area.locations.service_locations = [
                loc
                for loc in area.locations.service_locations
                if loc.service.rid not in gone
            ]
        for rid in lights:
            del self.lights.items[rid]
            self.on_remove(self, "light", rid)
        self.on_remove(self, "sensor", f"{device_id}-zc")
        self.on_remove(self, "device", device_id)

    async def request(self, method: str, path: str, json: Any = None) -> Any:
        self.requests.append((method, path, json))
        kind, _, rid = path.removeprefix("clip/v2/resource/").partition("/")
        if method == "delete":
            if kind == "device":
                self.delete_device(rid)
            elif kind == "scene":
                del self.scenes.scene.items[rid]
                self.on_remove(self, "scene", rid)
            elif kind == "entertainment_configuration":
                del self.areas.items[rid]
                self.on_remove(self, "area", rid)
            else:
                group = getattr(self.groups, kind).items.pop(rid)
                for scene in [s for s in self.scenes.scene if s.group.rid == rid]:
                    del self.scenes.scene.items[scene.id]
                    self.on_remove(self, "scene", scene.id)
                self.on_remove(self, "group", group.grouped_light)
        elif method == "post":
            new = self.new_id(kind)
            if kind == "scene":
                lights = [a["target"]["rid"] for a in json["actions"]]
                self.add_scene(
                    new, json["metadata"]["name"], json["group"]["rid"], lights
                )
            elif kind == "entertainment_configuration":
                locations = json["locations"]["service_locations"]
                lights = [
                    loc["service"]["rid"].removesuffix("-ent") for loc in locations
                ]
                self.add_area(new, json["metadata"]["name"], lights)
                self.areas.items[new].locations = _locations(locations)
            else:
                children = [c["rid"] for c in json["children"]]
                self.add_group(kind, new, json["metadata"]["name"], children)
            return [{"rid": new, "rtype": kind}]
        elif method == "put" and kind == "device":
            self.devices.items[rid].metadata.name = json["metadata"]["name"]
        elif method == "put" and kind in ("room", "zone"):
            rtype = ResourceTypes.DEVICE if kind == "room" else ResourceTypes.LIGHT
            getattr(self.groups, kind).items[rid].children = [
                _ref(c["rid"], rtype) for c in json["children"]
            ]
        elif method == "put" and kind == "scene":
            self.scenes.scene.items[rid].actions = [
                Action(
                    target=_ref(a["target"]["rid"], ResourceTypes.LIGHT),
                    action=ActionAction(on=OnFeature(on=True)),
                )
                for a in json["actions"]
            ]
        elif method == "put" and kind == "entertainment_configuration":
            self.areas.items[rid].locations = _locations(
                json["locations"]["service_locations"]
            )
        return []


@pytest.fixture
async def world(hass: HomeAssistant) -> SimpleNamespace:
    """Two bridges (`a` holds the office, `b` is empty) and HA as the native
    integration would have it."""
    await async_setup_positions(hass)
    await migration.async_setup_moves(hass)
    entities = er.async_get(hass)
    devices = dr.async_get(hass)
    office = ar.async_get(hass).async_create("Office")
    hall = ar.async_get(hass).async_create("Hall")
    entries = {}
    for name in ("a", "b"):
        entries[name] = MockConfigEntry(domain=HUE, title=f"Bridge {name}", data={})
        entries[name].add_to_hass(hass)
    domains = {
        "light": "light",
        "group": "light",
        "scene": "scene",
        "sensor": "sensor",
        "area": "binary_sensor",
    }

    def on_add(
        bridge: FakeBridge, kind: str, rid: str, device_id: str | None = None
    ) -> None:
        entry = entries[bridge.prefix]
        if kind == "device":
            devices.async_get_or_create(
                config_entry_id=entry.entry_id, identifiers={(HUE, rid)}
            )
            return
        device = (
            devices.async_get_device_by_identifier((HUE, device_id), entry.entry_id)
            if device_id
            else None
        )
        entity = entities.async_get_or_create(
            domains[kind],
            HUE,
            rid,
            config_entry=entry,
            device_id=device.id if device else None,
        )
        hass.states.async_set(entity.entity_id, "on")

    def on_remove(bridge: FakeBridge, kind: str, rid: str) -> None:
        if kind == "device":
            entry = entries[bridge.prefix]
            if device := devices.async_get_device_by_identifier(
                (HUE, rid), entry.entry_id
            ):
                devices.async_remove_device(device.id)
            return
        if entity_id := entities.async_get_entity_id(domains[kind], HUE, rid):
            entities.async_remove(entity_id)
            hass.states.async_remove(entity_id)

    a = FakeBridge("a", on_add, on_remove)
    b = FakeBridge("b", on_add, on_remove)
    bridges = {entries["a"].entry_id: a, entries["b"].entry_id: b}

    def name_entity(domain: str, rid: str, object_id: str) -> str:
        entity_id = entities.async_get_entity_id(domain, HUE, rid)
        hass.states.async_remove(entity_id)
        entities.async_update_entity(entity_id, new_entity_id=f"{domain}.{object_id}")
        hass.states.async_set(f"{domain}.{object_id}", "on")
        return f"{domain}.{object_id}"

    desk = a.add_device("desk", device_id="a-desk")
    lamp = a.add_device("lamp", device_id="a-lamp")
    a.add_device("other", device_id="a-other")
    for device_id in (desk, lamp):
        device = devices.async_get_device_by_identifier(
            (HUE, device_id), entries["a"].entry_id
        )
        devices.async_update_device(device.id, area_id=office.id)
    name_entity("light", "a-desk-light", "desk")
    name_entity("light", "a-lamp-light", "lamp")
    name_entity("light", "a-other-light", "other")
    name_entity("sensor", "a-desk-zc", "desk_zigbee")
    entities.async_update_entity("light.desk", name="Desk lamp", icon="mdi:desk-lamp")
    a.add_group("room", "a-office", "Office", [desk, lamp])
    a.add_group("zone", "a-work", "Work", ["a-desk-light", "a-lamp-light"])
    a.add_group("zone", "a-all", "All", ["a-desk-light", "a-other-light"])
    name_entity("light", "a-office-group", "office")
    name_entity("light", "a-work-group", "work")
    a.add_scene("a-read", "Read", "a-office", ["a-desk-light", "a-lamp-light"])
    a.add_scene("a-focus", "Focus", "a-work", ["a-desk-light", "a-lamp-light"])
    a.add_scene("a-evening", "Evening", "a-all", ["a-desk-light", "a-other-light"])
    name_entity("scene", "a-read", "office_read")
    name_entity("scene", "a-focus", "work_focus")
    a.add_area("a-tv", "TV", ["a-desk-light", "a-lamp-light"])
    name_entity("binary_sensor", "a-tv", "tv_area")
    await position_store(hass).async_update({"a-desk-light": [[0.1, 0.2, 0.0]]})

    def all_lights(_hass: HomeAssistant) -> list[HueLight]:
        found = []
        for entry_id, bridge in bridges.items():
            for e in er.async_entries_for_config_entry(entities, entry_id):
                if e.domain == "light" and (res := bridge.lights.get(e.unique_id)):
                    found.append(HueLight(e.entity_id, bridge, res))
        return found

    searches: list[tuple[str, list[str], bool]] = []

    async def search(_hass: HomeAssistant, entry_id: str, serials: list[str]) -> None:
        """Devices let go by their bridge and switched off and on (`joining`) join the
        searching bridge; with serial numbers it takes them from another bridge too."""
        # Whether the old bridge still had the desk when the search started.
        searches.append((entry_id, serials, a.devices.get("a-desk") is not None))
        target = bridges[entry_id]
        for key in world.joining:
            elsewhere = any(
                MAC[key] in b.macs.values()
                and any(b.macs.get(d.id) == MAC[key] for d in b.devices)
                for b in bridges.values()
            )
            if (serials or not elsewhere) and MAC[key] not in target.macs.values():
                target.add_device(key)

    async def align(_hass: HomeAssistant, *, only: set[str], hue_entry_id: str) -> None:
        """The room of the lights' area on the target bridge (as alignment does)."""
        target = bridges[hue_entry_id]
        owners = [
            target.lights.get(entities.async_get(e).unique_id).owner.rid for e in only
        ]
        room = next(iter(target.groups.room), None)
        if room is None:
            target.add_group("room", target.new_id("room"), "Office", owners)
        else:
            room.children += [_ref(o, ResourceTypes.DEVICE) for o in owners]

    world = SimpleNamespace(
        a=a,
        b=b,
        entries=entries,
        office=office.id,
        hall=hall.id,
        searches=searches,
        joining=["desk", "lamp"],
    )

    @callback
    def drop_state(event: Event) -> None:
        """As an entity platform does: a removed entity loses its state."""
        if event.data["action"] == "remove":
            hass.states.async_remove(event.data["entity_id"])

    hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, drop_state)
    with (
        patch.object(migration, "async_bridges", lambda _h: bridges),
        patch.object(migration, "async_all_lights", all_lights),
        patch.object(migration, "async_search", search),
        patch.object(migration, "async_align", align),
        patch.object(migration, "SEARCH_TIME", 0.05),
        patch.object(migration, "POLL", 0.01),
        patch.object(migration, "ENTITY_WAIT", 2.0),
    ):
        yield world


async def _run(hass: HomeAssistant) -> dict[str, Any]:
    mover = hass.data[migration.STORAGE_KEY]
    await mover.task
    await hass.async_block_till_done()
    return mover.memo


async def _move(
    hass: HomeAssistant, selection: migration.Selection, serials: list[str] = ()
) -> dict[str, Any]:
    """Start: the old bridge lets go, the new one searches."""
    await migration.async_start_move(hass, selection, list(serials))
    return await _run(hass)


def _unique_id(hass: HomeAssistant, entity_id: str) -> tuple[str, str]:
    entry = er.async_get(hass).async_get(entity_id)
    assert entry is not None, entity_id
    return entry.config_entry_id, entry.unique_id


async def test_plan(hass: HomeAssistant, world: SimpleNamespace) -> None:
    """What moving the office would do: its lights, scenes, zones and entertainment
    areas moved or split."""
    b = world.entries["b"].entry_id
    selection = migration.async_select(hass, b, area=world.office)
    assert selection.rooms == ["a-office"]
    plan = migration.async_move_plan(hass, selection)
    assert plan["lights"] == ["light.desk", "light.lamp"]
    assert (plan["rooms"], plan["scenes"]) == (["Office"], 3)
    assert plan["zones"] == [
        {"name": "Work", "whole": True},
        {"name": "All", "whole": False},
    ]
    assert plan["entertainment"] == [{"name": "TV", "whole": True}]
    assert (plan["target_name"], plan["over_limit"]) == ("Bridge B", False)
    # One light into another area: no room moves with it.
    one = migration.async_select(hass, b, lights=["light.desk"], to_area=world.hall)
    assert (one.devices, one.rooms, one.area) == (["a-desk"], [], world.hall)
    # Everything is on bridge a already: nothing to move there.
    with pytest.raises(ServiceValidationError):
        migration.async_select(hass, world.entries["a"].entry_id, area=world.office)
    with pytest.raises(ServiceValidationError):
        migration.async_select(hass, b, area=world.hall)
    whole = migration.async_select_bridge(hass, world.entries["a"].entry_id, b)
    assert (whole.devices, whole.rooms) == (
        ["a-desk", "a-lamp", "a-other"],
        ["a-office"],
    )


async def test_move_room(hass: HomeAssistant, world: SimpleNamespace) -> None:
    """The office moves: the old bridge lets go first, the lights are switched off and
    on, then the new bridge finds them; HA keeps entity ids, names and areas; the room
    is made again, scenes, the zone and the entertainment area that moved whole take
    over their entities; the zone left behind in part is split."""
    b_id = world.entries["b"].entry_id
    selection = migration.async_select(hass, b_id, area=world.office)
    memo = await _move(hass, selection)
    assert (memo["step"], memo["error"]) == ("done", None)
    # Let go first, then searched (the old bridge no longer had the desk).
    assert world.searches == [(b_id, [], False)]
    desk = next(d for d in memo["devices"] if d["id"] == "a-desk")
    new_desk = desk["new_lights"]["a-desk-light"]
    new_lamp = memo["devices"][1]["new_lights"]["a-lamp-light"]
    assert _unique_id(hass, "light.desk") == (b_id, new_desk)
    entry = er.async_get(hass).async_get("light.desk")
    assert (entry.name, entry.icon) == ("Desk lamp", "mdi:desk-lamp")
    assert _unique_id(hass, "sensor.desk_zigbee") == (b_id, f"{desk['new_id']}-zc")
    assert world.b.devices.get(desk["new_id"]).metadata.name == "Hue lamp a-desk"
    assert dr.async_get(hass).async_get(entry.device_id).area_id == world.office
    # The room, made again by name; its scene and entity ids.
    assert world.a.groups.room.get("a-office") is None
    (room,) = world.b.groups.room
    assert room.metadata.name == "Office"
    assert {c.rid for c in room.children} == {
        desk["new_id"],
        memo["devices"][1]["new_id"],
    }
    assert _unique_id(hass, "light.office") == (b_id, f"{room.id}-group")
    read = _unique_id(hass, "scene.office_read")
    assert read[0] == b_id
    copy = world.b.scenes.scene.get(read[1])
    assert {a.target.rid for a in copy.actions} == {new_desk, new_lamp}
    # Work moved whole; All was split.
    assert world.a.groups.zone.get("a-work") is None
    assert _unique_id(hass, "light.work")[0] == b_id
    assert _unique_id(hass, "scene.work_focus")[0] == b_id
    assert world.a.groups.zone.get("a-all") is not None
    split = [z for z in world.b.groups.zone if z.metadata.name == "All"]
    assert [[c.rid for c in z.children] for z in split] == [[new_desk]]
    # The entertainment area: copied with the lights where they were, entity kept.
    assert world.a.areas.get("a-tv") is None
    (tv,) = world.b.areas
    assert [
        (loc.service.rid, loc.positions[0].x) for loc in tv.locations.service_locations
    ] == [(f"{new_desk}-ent", 0.0), (f"{new_lamp}-ent", 1.0)]
    assert _unique_id(hass, "binary_sensor.tv_area") == (b_id, tv.id)
    # Positions follow the light's new id.
    assert position_store(hass).lights == {new_desk: [[0.1, 0.2, 0.0]]}
    assert migration.async_move_payload(hass)["step"] == "done"
    await migration.async_finish_move(hass)
    assert migration.async_move_payload(hass) is None


async def test_move_bridge(hass: HomeAssistant, world: SimpleNamespace) -> None:
    """Everything of a bridge moves: every device, the room by name, every zone
    whole, and the old bridge is left empty."""
    a_id, b_id = world.entries["a"].entry_id, world.entries["b"].entry_id
    world.joining = ["desk", "lamp", "other"]
    await migration.async_start_move(
        hass, migration.async_select_bridge(hass, a_id, b_id), []
    )
    memo = await _run(hass)
    assert memo["step"] == "done"
    assert not list(world.a.devices) and not list(world.a.groups.zone)
    assert {
        _unique_id(hass, e)[0] for e in ("light.desk", "light.lamp", "light.other")
    } == {b_id}
    assert sorted(z.metadata.name for z in world.b.groups.zone) == ["All", "Work"]
    assert _unique_id(hass, "light.office")[0] == b_id
    assert [r.metadata.name for r in world.b.groups.room] == ["Office"]


async def test_move_light_with_serials(
    hass: HomeAssistant, world: SimpleNamespace
) -> None:
    """A light moved to another area follows its device there; serial numbers go to
    the search."""
    b_id = world.entries["b"].entry_id
    world.joining = ["desk"]
    selection = migration.async_select(
        hass, b_id, lights=["light.desk"], to_area=world.hall
    )
    memo = await _move(hass, selection, ["ABC123"])
    assert memo["step"] == "done"
    assert world.searches == [(b_id, ["ABC123"], False)]
    assert world.a.devices.get("a-desk") is None
    entry = er.async_get(hass).async_get("light.desk")
    assert entry.config_entry_id == b_id and entry.area_id is None
    assert dr.async_get(hass).async_get(entry.device_id).area_id == world.hall
    # The office stays on the old bridge with the lamp.
    assert world.a.groups.room.get("a-office") is not None


async def test_not_found_then_retry(
    hass: HomeAssistant, world: SimpleNamespace
) -> None:
    """A light the search does not find leaves the move waiting; another search
    finishes it."""
    b_id = world.entries["b"].entry_id
    world.joining = ["desk"]
    selection = migration.async_select(hass, b_id, area=world.office)
    memo = await _move(hass, selection)
    assert (memo["step"], memo["error"]) == ("waiting", "not_found")
    assert len(world.searches) == migration.SEARCH_ROUNDS
    payload = migration.async_move_payload(hass)
    assert [(x["entity_id"], x["found"]) for x in payload["devices"]] == [
        ("light.desk", True),
        ("light.lamp", False),
    ]
    # The found light is restored already.
    assert _unique_id(hass, "light.desk")[0] == b_id
    with pytest.raises(ServiceValidationError):
        await migration.async_start_move(hass, selection, [])
    world.joining = ["desk", "lamp"]
    await migration.async_retry_move(hass, ["XYZ789"])
    memo = await _run(hass)
    assert memo["step"] == "done"
    assert _unique_id(hass, "light.lamp")[0] == b_id
    assert _unique_id(hass, "scene.office_read")[0] == b_id


async def test_put_back(hass: HomeAssistant, world: SimpleNamespace) -> None:
    """Not found on the new bridge: the lights go back to the old one, into their
    room, zones, scenes and entertainment areas there."""
    a_id, b_id = world.entries["a"].entry_id, world.entries["b"].entry_id
    world.joining = []
    selection = migration.async_select(hass, b_id, area=world.office)
    memo = await _move(hass, selection)
    assert memo["step"] == "waiting"
    world.joining = ["desk", "lamp"]
    await migration.async_retry_move(hass, [], a_id)
    memo = await _run(hass)
    assert memo["step"] == "done"
    new_desk = memo["devices"][0]["new_lights"]["a-desk-light"]
    assert _unique_id(hass, "light.desk") == (a_id, new_desk)
    assert new_desk in {
        a.target.rid for a in world.a.scenes.scene.get("a-read").actions
    }
    assert new_desk in {c.rid for c in world.a.groups.zone.get("a-all").children}
    assert f"{new_desk}-ent" in {
        loc.service.rid for loc in world.a.areas.get("a-tv").locations.service_locations
    }
    assert _unique_id(hass, "scene.office_read") == (a_id, "a-read")


async def test_unfinished_after_restart(
    hass: HomeAssistant, world: SimpleNamespace
) -> None:
    """A move a restart interrupted waits for the user."""
    b_id = world.entries["b"].entry_id
    mover = hass.data[migration.STORAGE_KEY]
    memo = migration.async_remember(
        hass, migration.async_select(hass, b_id, area=world.office)
    )
    memo["step"] = "searching"
    await mover.store.async_save(memo)
    await migration.async_setup_moves(hass)
    payload = migration.async_move_payload(hass)
    assert (payload["step"], payload["error"], payload["running"]) == (
        "waiting",
        "interrupted",
        False,
    )


async def test_room_on_two_bridges(hass: HomeAssistant, world: SimpleNamespace) -> None:
    """A room with lights on both bridges comes together: only the lights that are
    elsewhere move."""
    a_id, b_id = world.entries["a"].entry_id, world.entries["b"].entry_id
    spot = world.b.add_device("spot", device_id="b-spot")
    device = dr.async_get(hass).async_get_device_by_identifier((HUE, spot), b_id)
    dr.async_get(hass).async_update_device(device.id, area_id=world.office)
    selection = migration.async_select(hass, a_id, area=world.office)
    assert (selection.source, selection.devices) == (b_id, ["b-spot"])
    to_b = migration.async_select(hass, b_id, area=world.office)
    assert to_b.devices == ["a-desk", "a-lamp"]


async def test_subscribe_without_move(
    hass: HomeAssistant,
    world: SimpleNamespace,
    hass_ws_client: Any,
    hass_admin_user: Any,
) -> None:
    """With no move the subscription still answers (null), so the panel can plan one."""
    async_setup_websocket(hass)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/bridges/move/subscribe"})
    assert (await client.receive_json())["success"]
    event = await client.receive_json()
    assert event["type"] == "event" and event["event"] is None


async def test_move_of_an_earlier_version(
    hass: HomeAssistant, world: SimpleNamespace
) -> None:
    """A move stored by an earlier version: forgotten when nothing of it had happened,
    else brought into today's form."""
    mover = hass.data[migration.STORAGE_KEY]
    device = {"id": "a-desk", "mac": MAC["desk"], "name": "Desk", "lights": []}
    old = {
        "source": "a",
        "target": "b",
        "area": None,
        "room": {"id": "a-office", "name": "Office", "scenes": []},
        "zones": [],
        "devices": [{**device, "removed": False, "new_id": None, "restored": False}],
        "step": "waiting",
        "error": "not_found",
        "serials": [],
    }
    await mover.store.async_save(old)
    await migration.async_setup_moves(hass)
    assert migration.async_move_payload(hass) is None
    old["devices"][0]["removed"] = True
    await hass.data[migration.STORAGE_KEY].store.async_save(old)
    await migration.async_setup_moves(hass)
    payload = migration.async_move_payload(hass)
    assert (payload["rooms"], payload["devices"][0]["found"]) == (["Office"], False)
