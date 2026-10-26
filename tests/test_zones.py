"""Tests for Hue zones mirrored as HA labels, both ways."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

from aiohue.v2.models.resource import ResourceIdentifier, ResourceTypes
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er, label_registry as lr
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio.const import DOMAIN
from custom_components.hue_studio.zones import (
    Side,
    Synced,
    ZoneMirror,
    decide,
    zone_name,
)

from .conftest import LIGHTS


def _side(name: str, *lights: str) -> Side:
    return Side(name, frozenset(lights))


def test_decide() -> None:
    """The side that changed is followed; the bridge wins a tie."""
    synced = Synced("TV", "Hue zone: TV", frozenset({"light.a"}))
    same = _side("Hue zone: TV", "light.a")

    nothing = decide(synced, _side("TV", "light.a"), same)
    assert nothing.name is None and nothing.lights is None

    from_bridge = decide(synced, _side("Sofa", "light.a", "light.b"), same)
    assert (from_bridge.name, from_bridge.name_to_bridge) == ("Sofa", False)
    assert from_bridge.lights == {"light.a", "light.b"}
    assert not from_bridge.lights_to_bridge

    from_label = decide(synced, _side("TV", "light.a"), _side("Hue zone: Telly", "b"))
    assert (from_label.name, from_label.name_to_bridge) == ("Telly", True)
    assert (from_label.lights, from_label.lights_to_bridge) == ({"b"}, True)

    tie = decide(synced, _side("TV", "light.c"), _side("Hue zone: TV", "light.d"))
    assert (tie.lights, tie.lights_to_bridge) == ({"light.c"}, False)

    # A label left without lights never empties the zone.
    empty = decide(synced, _side("TV", "light.a"), _side("Hue zone: TV"))
    assert (empty.lights, empty.lights_to_bridge) == ({"light.a"}, False)


def test_zone_name() -> None:
    assert zone_name("Hue zone: TV") == "TV"
    assert zone_name("hue ZONE: TV ") == "TV"
    assert zone_name("Telly") == "Telly"


class FakeZones:
    """The bridge's zones: what the panel or the Hue app would change."""

    def __init__(self) -> None:
        self.zones: dict[str, SimpleNamespace] = {}
        self.members: dict[str, list[str]] = {}

    def add(self, zone_id: str, name: str, lights: list[str]) -> None:
        self.zones[zone_id] = SimpleNamespace(
            id=zone_id,
            metadata=SimpleNamespace(name=name),
            services=[
                ResourceIdentifier(
                    rid=f"grp-{zone_id}", rtype=ResourceTypes.GROUPED_LIGHT
                )
            ],
        )
        self.members[zone_id] = list(lights)

    async def request(self, method: str, path: str, json: Any = None) -> Any:
        if method == "post":
            zone_id = f"res-zone-{len(self.zones)}"
            self.add(
                zone_id, json["metadata"]["name"], [c["rid"] for c in json["children"]]
            )
            return [{"rid": zone_id, "rtype": "zone"}]
        zone_id = path.rsplit("/", 1)[1]
        if "metadata" in json:
            self.zones[zone_id].metadata.name = json["metadata"]["name"]
        if "children" in json:
            self.members[zone_id] = [c["rid"] for c in json["children"]]
        return [{"rid": zone_id, "rtype": "zone"}]


@pytest.fixture
async def zones(
    hass: HomeAssistant, hue_lights: MagicMock, studio_entry: MockConfigEntry
) -> FakeZones:
    """One zone "TV" with the strip; "Zones as labels" on."""
    fake = FakeZones()
    fake.add("res-zone", "TV", ["res-strip"])
    groups = hue_lights.groups.zone
    groups.__iter__.side_effect = lambda: iter(list(fake.zones.values()))
    groups.get.side_effect = fake.zones.get
    groups.get_lights.side_effect = lambda zone_id: [
        LIGHTS[rid] for rid in fake.members[zone_id]
    ]
    hue_lights.config.bridge_id = "bridge-1"
    hue_lights.request = AsyncMock(side_effect=fake.request)
    hass.config_entries.async_update_entry(
        studio_entry, options={**studio_entry.options, "zone_labels": True}
    )
    await hass.async_block_till_done()
    return fake


def _mirror(entry: MockConfigEntry) -> ZoneMirror:
    return entry.runtime_data.zones


def _label(hass: HomeAssistant, name: str) -> lr.LabelEntry | None:
    return lr.async_get(hass).async_get_label_by_name(name)


def _carrying(hass: HomeAssistant, label: lr.LabelEntry) -> set[str]:
    return {
        e.entity_id
        for e in er.async_get(hass).entities.values()
        if label.label_id in e.labels
    }


def _set_labels(hass: HomeAssistant, entity_id: str, *labels: lr.LabelEntry) -> None:
    er.async_get(hass).async_update_entity(
        entity_id, labels={label.label_id for label in labels}
    )


async def test_bridge_to_labels(
    hass: HomeAssistant,
    zones: FakeZones,
    studio_entry: MockConfigEntry,
    hue_lights: MagicMock,
) -> None:
    """A zone gets its label; the Hue app's changes reach it."""
    mirror = _mirror(studio_entry)
    await mirror.async_pass()
    label = _label(hass, "Hue zone: TV")
    assert label is not None
    assert _carrying(hass, label) == {"light.strip"}

    # In the Hue app: the bulb joins, the zone is renamed.
    zones.members["res-zone"] = ["res-strip", "res-bulb"]
    zones.zones["res-zone"].metadata.name = "Sofa"
    await mirror.async_pass()
    label = lr.async_get(hass).async_get_label(label.label_id)
    assert label.name == "Hue zone: Sofa"
    assert _carrying(hass, label) == {"light.strip", "light.bulb"}
    hue_lights.request.assert_not_awaited()


async def test_labels_to_bridge(
    hass: HomeAssistant,
    zones: FakeZones,
    studio_entry: MockConfigEntry,
    hue_lights: MagicMock,
) -> None:
    """The label renamed or moved in HA changes the zone on the bridge."""
    mirror = _mirror(studio_entry)
    await mirror.async_pass()
    label = _label(hass, "Hue zone: TV")
    _set_labels(hass, "light.strip")
    _set_labels(hass, "light.bulb", label)
    lr.async_get(hass).async_update(label.label_id, name="Hue zone: Telly")
    await mirror.async_pass()
    assert zones.members["res-zone"] == ["res-bulb"]
    assert zones.zones["res-zone"].metadata.name == "Telly"

    # The bridge reported it back: nothing more to do.
    hue_lights.request.reset_mock()
    await mirror.async_pass()
    hue_lights.request.assert_not_awaited()

    # A label left on no light keeps the zone; the label follows it back.
    _set_labels(hass, "light.bulb")
    await mirror.async_pass()
    assert zones.members["res-zone"] == ["res-bulb"]
    assert _carrying(hass, label) == {"light.bulb"}
    hue_lights.request.assert_not_awaited()


async def test_foreign_lights(
    hass: HomeAssistant, zones: FakeZones, studio_entry: MockConfigEntry
) -> None:
    """A light that is no Hue light keeps the label and is reported."""
    mirror = _mirror(studio_entry)
    await mirror.async_pass()
    label = _label(hass, "Hue zone: TV")
    _set_labels(hass, "light.other_brand", label)
    await mirror.async_pass()
    assert zones.members["res-zone"] == ["res-strip"]
    (note,) = mirror.notes
    assert note["kind"] == "foreign"
    assert note["lights"] == ["light.other_brand"]


async def test_label_deleted_unlinks(
    hass: HomeAssistant,
    zones: FakeZones,
    studio_entry: MockConfigEntry,
    hue_lights: MagicMock,
) -> None:
    """Deleting the label leaves the zone on the bridge, unlinked, until relinked."""
    mirror = _mirror(studio_entry)
    await mirror.async_pass()
    lr.async_get(hass).async_delete(_label(hass, "Hue zone: TV").label_id)
    await mirror.async_pass()
    await mirror.async_pass()
    assert "res-zone" in zones.zones
    assert _label(hass, "Hue zone: TV") is None
    assert [n["kind"] for n in mirror.notes] == ["unlinked"]
    hue_lights.request.assert_not_awaited()

    mirror.async_relink("res-zone")
    await mirror.async_pass()
    assert _carrying(hass, _label(hass, "Hue zone: TV")) == {"light.strip"}
    assert mirror.notes == []


async def test_unlinked_zone_taken_by_a_new_label(
    hass: HomeAssistant, zones: FakeZones, studio_entry: MockConfigEntry
) -> None:
    """A label of an unlinked zone's name links it again; its lights win."""
    mirror = _mirror(studio_entry)
    await mirror.async_pass()
    lr.async_get(hass).async_delete(_label(hass, "Hue zone: TV").label_id)
    await mirror.async_pass()
    label = lr.async_get(hass).async_create("Hue zone: TV")
    _set_labels(hass, "light.bulb", label)
    await mirror.async_pass()
    await mirror.async_pass()
    assert list(zones.zones) == ["res-zone"]
    assert zones.members["res-zone"] == ["res-bulb"]


async def test_new_label_makes_a_zone(
    hass: HomeAssistant, zones: FakeZones, studio_entry: MockConfigEntry
) -> None:
    """A label "Hue zone: <name>" on Hue lights makes that zone."""
    mirror = _mirror(studio_entry)
    await mirror.async_pass()
    label = lr.async_get(hass).async_create("Hue zone: Desk")
    _set_labels(hass, "light.bulb", label)
    await mirror.async_pass()
    (new,) = [z for z in zones.zones.values() if z.metadata.name == "Desk"]
    assert zones.members[new.id] == ["res-bulb"]
    # Once the bridge reports it, it is paired: no second zone.
    await mirror.async_pass()
    assert len(zones.zones) == 2


async def test_zone_deleted_takes_its_label(
    hass: HomeAssistant, zones: FakeZones, studio_entry: MockConfigEntry
) -> None:
    mirror = _mirror(studio_entry)
    await mirror.async_pass()
    del zones.zones["res-zone"]
    await mirror.async_pass()
    assert _label(hass, "Hue zone: TV") is None


async def test_option_off(
    hass: HomeAssistant, hue_lights: MagicMock, studio_entry: MockConfigEntry
) -> None:
    """Off by default: no labels."""
    hue_lights.groups.zone.__iter__.side_effect = lambda: iter([])
    await _mirror(studio_entry).async_pass()
    assert not [
        label
        for label in lr.async_get(hass).async_list_labels()
        if label.name.startswith("Hue zone")
    ]


async def test_zones_subscribe(
    hass: HomeAssistant,
    zones: FakeZones,
    studio_entry: MockConfigEntry,
    hass_ws_client: WebSocketGenerator,
) -> None:
    mirror = _mirror(studio_entry)
    await mirror.async_pass()
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/zones/subscribe"})
    assert (await client.receive_json())["success"]
    assert (await client.receive_json())["event"] == {"notes": []}


async def test_create_zone_returns_its_entity(
    hass: HomeAssistant, zones: FakeZones, hue_lights: MagicMock
) -> None:
    """create_zone answers with the zone's light once `hue` has added it."""
    hue_entry = hass.config_entries.async_entries("hue")[0]
    er.async_get(hass).async_get_or_create(
        "light",
        "hue",
        "grp-res-zone-1",
        config_entry=hue_entry,
        suggested_object_id="kitchen",
    )
    result = await hass.services.async_call(
        DOMAIN,
        "create_zone",
        {"entity_id": ["light.bulb"], "name": "Kitchen"},
        blocking=True,
        return_response=True,
    )
    assert result == {"zone_id": "res-zone-1", "entity_id": "light.kitchen"}
