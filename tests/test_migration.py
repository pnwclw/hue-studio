"""Moving lights and rooms to another bridge (migration.py), with two fake bridges.

The fake bridges keep devices, lights, rooms, zones and scenes, answer CLIP requests
the way a bridge does (a deleted device leaves its rooms, zones and scenes), and stand
in for the native integration: resources get entities in HA's registry, and lose them.
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
from homeassistant.core import HomeAssistant
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
MAC = {"desk": "00:17:88:01:00:00:00:01", "lamp": "00:17:88:01:00:00:00:02"}


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
        self.config = SimpleNamespace(
            bridge_device=SimpleNamespace(
                id=f"{name}-bridge",
                metadata=SimpleNamespace(name=f"Bridge {name.upper()}"),
                product_data=SimpleNamespace(model_id="BSB002"),
            ),
            entertainment_configuration=[],
            entertainment=[],
        )

    def new_id(self, kind: str) -> str:
        return f"{self.prefix}-{kind}-{next(self.ids)}"

    def add_device(self, key: str, *, light: bool = True, device_id: str = "") -> str:
        """A device (with one light, `<device id>-light`) joins."""
        device_id = device_id or self.new_id(key)
        services = []
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
            self.on_add(self, "light", service.rid, device_id)
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

    def delete_device(self, device_id: str) -> None:
        device = self.devices.items.pop(device_id)
        lights = [s.rid for s in device.services if s.rtype == ResourceTypes.LIGHT]
        for room in self.groups.room:
            room.children = [c for c in room.children if c.rid != device_id]
        for zone in self.groups.zone:
            zone.children = [c for c in zone.children if c.rid not in lights]
        for scene in self.scenes.scene:
            scene.actions = [a for a in scene.actions if a.target.rid not in lights]
        for rid in lights:
            del self.lights.items[rid]
            self.on_remove(self, "light", rid)
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
            else:
                children = [c["rid"] for c in json["children"]]
                self.add_group(kind, new, json["metadata"]["name"], children)
            return [{"rid": new, "rtype": kind}]
        elif method == "put" and kind == "device":
            self.devices.items[rid].metadata.name = json["metadata"]["name"]
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
    domains = {"light": "light", "group": "light", "scene": "scene"}

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
    await position_store(hass).async_update({"a-desk-light": [[0.1, 0.2, 0.0]]})

    def all_lights(_hass: HomeAssistant) -> list[HueLight]:
        found = []
        for entry_id, bridge in bridges.items():
            for e in er.async_entries_for_config_entry(entities, entry_id):
                if e.domain == "light" and (res := bridge.lights.get(e.unique_id)):
                    found.append(HueLight(e.entity_id, bridge, res))
        return found

    searches: list[tuple[str, list[str]]] = []

    async def search(_hass: HomeAssistant, entry_id: str, serials: list[str]) -> None:
        """Lights that were let go (or, with serials, any) join the searching bridge."""
        searches.append((entry_id, serials))
        target = bridges[entry_id]
        for key in world.joining:
            on_a = MAC[key] in a.macs.values() and any(
                a.macs.get(d.id) == MAC[key] for d in a.devices
            )
            if (serials or not on_a) and MAC[key] not in target.macs.values():
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


async def _run(hass: HomeAssistant, **kwargs: Any) -> dict[str, Any]:
    mover = hass.data[migration.STORAGE_KEY]
    await mover.task
    await hass.async_block_till_done()
    return mover.memo


def _unique_id(hass: HomeAssistant, entity_id: str) -> tuple[str, str]:
    entry = er.async_get(hass).async_get(entity_id)
    assert entry is not None, entity_id
    return entry.config_entry_id, entry.unique_id


async def test_plan(hass: HomeAssistant, world: SimpleNamespace) -> None:
    """What moving the office would do: its lights, scenes, zones moved or split."""
    b = world.entries["b"].entry_id
    selection = migration.async_select(hass, b, area=world.office)
    assert selection.room == "a-office"
    plan = migration.async_move_plan(hass, selection)
    assert plan["lights"] == ["light.desk", "light.lamp"]
    assert (plan["room"], plan["scenes"]) == ("Office", 3)
    assert plan["zones"] == [
        {"name": "Work", "whole": True},
        {"name": "All", "whole": False},
    ]
    assert (plan["target_name"], plan["over_limit"]) == ("Bridge B", False)
    # One light into another area: no room moves with it.
    one = migration.async_select(hass, b, lights=["light.desk"], to_area=world.hall)
    assert (one.devices, one.room, one.area) == (["a-desk"], None, world.hall)
    # Everything is on bridge a already: nothing to move there.
    with pytest.raises(ServiceValidationError):
        migration.async_select(hass, world.entries["a"].entry_id, area=world.office)
    with pytest.raises(ServiceValidationError):
        migration.async_select(hass, b, area=world.hall)


async def test_move_room(hass: HomeAssistant, world: SimpleNamespace) -> None:
    """The office moves: HA keeps entity ids, names and area; scenes and the zone that
    moved whole take over theirs; the zone left behind in part is split."""
    b_id = world.entries["b"].entry_id
    selection = migration.async_select(hass, b_id, area=world.office)
    await migration.async_start_move(hass, selection, [])
    memo = await _run(hass)
    assert (memo["step"], memo["error"]) == ("done", None)
    # Deleted on the old bridge first (no serial numbers), then found by MAC.
    assert ("delete", "clip/v2/resource/device/a-desk", None) in world.a.requests
    assert world.searches == [(b_id, [])]
    desk = next(d for d in memo["devices"] if d["id"] == "a-desk")
    new_desk = desk["new_lights"]["a-desk-light"]
    assert _unique_id(hass, "light.desk") == (b_id, new_desk)
    entry = er.async_get(hass).async_get("light.desk")
    assert (entry.name, entry.icon) == ("Desk lamp", "mdi:desk-lamp")
    assert world.b.devices.get(desk["new_id"]).metadata.name == "Hue lamp a-desk"
    ha_device = dr.async_get(hass).async_get(entry.device_id)
    assert ha_device.area_id == world.office
    # The room's scene and its entity id; the old room is gone (nothing left in it).
    assert world.a.groups.room.get("a-office") is None
    assert _unique_id(hass, "light.office")[0] == b_id
    read = _unique_id(hass, "scene.office_read")
    assert read[0] == b_id
    copy = world.b.scenes.scene.get(read[1])
    assert {a.target.rid for a in copy.actions} == {
        new_desk,
        memo["devices"][1]["new_lights"]["a-lamp-light"],
    }
    # Work moved whole (copied, deleted, taken over); All was split.
    assert world.a.groups.zone.get("a-work") is None
    assert _unique_id(hass, "light.work")[0] == b_id
    assert _unique_id(hass, "scene.work_focus")[0] == b_id
    assert world.a.groups.zone.get("a-all") is not None
    split = [z for z in world.b.groups.zone if z.metadata.name == "All"]
    assert [[c.rid for c in z.children] for z in split] == [[new_desk]]
    # Positions follow the light's new id.
    assert position_store(hass).lights == {new_desk: [[0.1, 0.2, 0.0]]}
    assert migration.async_move_payload(hass)["step"] == "done"
    await migration.async_finish_move(hass)
    assert migration.async_move_payload(hass) is None


async def test_move_light_with_serials(
    hass: HomeAssistant, world: SimpleNamespace
) -> None:
    """With serial numbers the new bridge takes the light first, then the old one
    forgets it; a light moved to another area follows its device there."""
    b_id = world.entries["b"].entry_id
    world.joining = ["desk"]
    selection = migration.async_select(
        hass, b_id, lights=["light.desk"], to_area=world.hall
    )
    await migration.async_start_move(hass, selection, ["ABC123"])
    memo = await _run(hass)
    assert memo["step"] == "done"
    assert world.searches == [(b_id, ["ABC123"])]
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
    (e.g. with its serial number) finishes it."""
    b_id = world.entries["b"].entry_id
    world.joining = ["desk"]
    selection = migration.async_select(hass, b_id, area=world.office)
    await migration.async_start_move(hass, selection, [])
    memo = await _run(hass)
    assert (memo["step"], memo["error"]) == ("waiting", "not_found")
    assert len(world.searches) == migration.SEARCH_ROUNDS
    payload = migration.async_move_payload(hass)
    assert [(x["entity_id"], x["found"]) for x in payload["lights"]] == [
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


async def test_unfinished_after_restart(
    hass: HomeAssistant, world: SimpleNamespace
) -> None:
    """A move a restart interrupted waits for another search."""
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
