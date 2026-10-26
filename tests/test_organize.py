"""Bridge scenes in HA's lists: label, category by Hue room, area (organize.py)."""

from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

from aiohue.v2.models.resource import ResourceIdentifier, ResourceTypes
from aiohue.v2.models.room import RoomArchetype
from aiohue.v2.models.scene import SceneMetadata
from homeassistant.core import HomeAssistant
from homeassistant.helpers import (
    area_registry as ar,
    category_registry as cr,
    entity_registry as er,
    label_registry as lr,
)
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.util import dt as dt_util
import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio.automations import async_organize
from custom_components.hue_studio.const import HUE_DOMAIN, SIGNAL_CONFIG_UPDATED

from .conftest import ROOMS, SCENES, make_scene


async def _organize(hass: HomeAssistant) -> None:
    """Let a pass run (it is debounced)."""
    async_dispatcher_send(hass, SIGNAL_CONFIG_UPDATED)
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=10))
    await hass.async_block_till_done()


@pytest.fixture
async def living_room(
    hass: HomeAssistant, hue_entry: MockConfigEntry, hue_lights: MagicMock
) -> str:
    """The Hue room of the scenes as a light group, matching an area exactly."""
    area = ar.async_get(hass).async_create("Living room")
    entities = er.async_get(hass)
    entities.async_get_or_create(
        "light", HUE_DOMAIN, "grp-room", config_entry=hue_entry
    )
    hass.states.async_set(
        "light.hue_grp_room",
        "on",
        {
            "is_hue_group": True,
            "hue_type": "room",
            "entity_id": ["light.strip", "light.bulb"],
        },
    )
    for light in ("light.strip", "light.bulb"):
        entities.async_update_entity(light, area_id=area.id)
    await _organize(hass)
    return area.id


def _scene_category(hass: HomeAssistant, category_id: str | None) -> str | None:
    if category_id is None:
        return None
    category = cr.async_get(hass).async_get_category(
        scope="scene", category_id=category_id
    )
    return category.name if category else None


async def test_scenes_organized(hass: HomeAssistant, living_room: str) -> None:
    """Every bridge scene: the label, its room's category and area."""
    label = lr.async_get(hass).async_get_label_by_name("Hue Studio")
    assert label is not None
    entities = er.async_get(hass)
    for scene in ("scene.sunset", "scene.plain"):
        entry = entities.async_get(scene)
        assert label.label_id in entry.labels
        assert _scene_category(hass, entry.categories.get("scene")) == "Living room"
        assert entry.area_id == living_room
    (category,) = cr.async_get(hass).async_list_categories(scope="scene")
    assert category.icon == "mdi:sofa-outline"


def _with_metadata(resource_id: str, **metadata: object) -> object:
    scene = make_scene(resource_id)
    scene.metadata = SceneMetadata(name="Sunset", **metadata)
    return scene


@pytest.fixture
def preset(monkeypatch: pytest.MonkeyPatch) -> None:
    """`scene.sunset` is a preset: it carries a picture of the Hue app's gallery."""
    picture = ResourceIdentifier(rid="img-1", rtype=ResourceTypes.PUBLIC_IMAGE)
    monkeypatch.setitem(SCENES, "res-scene", _with_metadata("res-scene", image=picture))


async def test_custom_scenes_labelled(
    hass: HomeAssistant,
    preset: None,
    living_room: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Scenes of your own get the custom label once; presets do not."""
    entities = er.async_get(hass)
    custom = lr.async_get(hass).async_get_label_by_name("Hue custom scene")
    assert custom is not None
    assert custom.label_id in entities.async_get("scene.plain").labels
    assert custom.label_id not in entities.async_get("scene.sunset").labels

    # Made from your own colors with a gallery picture: marked on the bridge.
    picture = ResourceIdentifier(rid="img-1", rtype=ResourceTypes.PUBLIC_IMAGE)
    marked = _with_metadata("res-scene", image=picture, appdata="hs:custom")
    monkeypatch.setitem(SCENES, "res-scene", marked)
    labels = entities.async_get("scene.plain").labels - {custom.label_id}
    entities.async_update_entity("scene.plain", labels=labels)
    await _organize(hass)
    assert custom.label_id in entities.async_get("scene.sunset").labels
    # Removed by the user: stays removed.
    assert custom.label_id not in entities.async_get("scene.plain").labels


async def test_smart_scene(
    hass: HomeAssistant,
    hue_entry: MockConfigEntry,
    living_room: str,
    hue_lights: MagicMock,
) -> None:
    """A smart scene (natural light of the Hue app) is organized like the others."""
    smart = SimpleNamespace(
        group=ResourceIdentifier(rid="res-room", rtype=ResourceTypes.ROOM)
    )
    hue_lights.scenes.smart_scene.get.side_effect = {"res-smart": smart}.get
    entities = er.async_get(hass)
    entry = entities.async_get_or_create(
        "scene", HUE_DOMAIN, "res-smart", config_entry=hue_entry
    )
    await _organize(hass)
    entry = entities.async_get(entry.entity_id)
    assert entry.labels
    assert _scene_category(hass, entry.categories.get("scene")) == "Living room"


async def test_user_choices_stay(
    hass: HomeAssistant, living_room: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A label, category or area the user changed is never set again."""
    entities = er.async_get(hass)
    kitchen = ar.async_get(hass).async_create("Kitchen")
    mine = cr.async_get(hass).async_create(scope="scene", name="Mine")
    entities.async_update_entity(
        "scene.sunset",
        labels=set(),
        categories={"scene": mine.category_id},
        area_id=kitchen.id,
    )
    entities.async_update_entity("scene.plain", categories={})
    # Even when the room is renamed on the bridge.
    monkeypatch.setitem(
        ROOMS,
        "res-room",
        SimpleNamespace(
            **{**vars(ROOMS["res-room"]), "metadata": SimpleNamespace(name="Lounge")}
        ),
    )
    await _organize(hass)

    sunset = entities.async_get("scene.sunset")
    assert sunset.labels == set()
    assert sunset.categories == {"scene": mine.category_id}
    assert sunset.area_id == kitchen.id
    assert entities.async_get("scene.plain").categories == {}
    # Our category is not used any more: gone.
    names = {c.name for c in cr.async_get(hass).async_list_categories(scope="scene")}
    assert names == {"Mine"}


async def test_room_renamed(
    hass: HomeAssistant, living_room: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A Hue room renamed on the bridge: its scenes go to a category of the new name,
    unless the user renamed ours (then it is theirs)."""
    entities = er.async_get(hass)
    categories = cr.async_get(hass)
    room = ROOMS["res-room"]

    def rename(name: str) -> None:
        metadata = SimpleNamespace(name=name)
        monkeypatch.setitem(
            ROOMS, "res-room", SimpleNamespace(**{**vars(room), "metadata": metadata})
        )

    rename("Lounge")
    await _organize(hass)
    category_id = entities.async_get("scene.sunset").categories["scene"]
    assert _scene_category(hass, category_id) == "Lounge"
    assert [c.name for c in categories.async_list_categories(scope="scene")] == [
        "Lounge"
    ]

    categories.async_update(scope="scene", category_id=category_id, name="Our lounge")
    rename("Den")
    await _organize(hass)
    assert entities.async_get("scene.sunset").categories["scene"] == category_id
    assert _scene_category(hass, category_id) == "Our lounge"


async def test_area_follows_the_room(hass: HomeAssistant, living_room: str) -> None:
    """The area we set follows the room mapping; the room's device area needs none."""
    entities = er.async_get(hass)
    for light in ("light.strip", "light.bulb"):
        entities.async_update_entity(light, area_id=None)
    await _organize(hass)
    assert entities.async_get("scene.sunset").area_id is None


async def test_option_off(
    hass: HomeAssistant, hue_lights: MagicMock, studio_entry: MockConfigEntry
) -> None:
    """With "Organize in Home Assistant" off, nothing is touched."""
    hass.config_entries.async_update_entry(studio_entry, options={"organize": False})
    entities = er.async_get(hass)
    entities.async_get_or_create(
        "automation", "automation", "hue_studio_schedule_x", suggested_object_id="x"
    )
    await _organize(hass)
    async_organize(hass, "automation.x", None)
    assert not er.async_get(hass).async_get("scene.sunset").labels
    assert lr.async_get(hass).async_get_label_by_name("Hue Studio") is None
    assert not list(cr.async_get(hass).async_list_categories(scope="scene"))


async def test_group_icons(
    hass: HomeAssistant,
    hue_entry: MockConfigEntry,
    living_room: str,
    hue_lights: MagicMock,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """The panel gets each Hue room's and zone's icon by its Hue app archetype."""
    zone = SimpleNamespace(
        grouped_light="grp-zone",
        metadata=SimpleNamespace(name="TV", archetype=RoomArchetype.OTHER),
    )
    hue_lights.groups.room.__iter__.side_effect = lambda: iter([ROOMS["res-room"]])
    hue_lights.groups.zone.__iter__.side_effect = lambda: iter([zone])
    er.async_get(hass).async_get_or_create(
        "light", HUE_DOMAIN, "grp-zone", config_entry=hue_entry
    )
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/config/subscribe"})
    assert (await client.receive_json())["success"]
    event = (await client.receive_json())["event"]
    assert event["icons"] == {
        "light.hue_grp_room": "mdi:sofa-outline",
        "light.hue_grp_zone": "mdi:texture-box",
    }

    # A new archetype picked in the Hue app reaches the panel.
    zone.metadata.archetype = RoomArchetype.TV
    async_dispatcher_send(hass, SIGNAL_CONFIG_UPDATED)
    event = (await client.receive_json())["event"]
    assert event["icons"]["light.hue_grp_zone"] == "mdi:television"
