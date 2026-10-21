"""Our scenes and automations in Home Assistant's own lists (roadmap G2).

Every bridge scene (a `scene` of the native `hue`, smart scenes too, recognized by its
platform and bridge scene id, so one made in the Hue app counts too) gets the "Hue
Studio" label, a category named after its Hue room or zone with the icon of its
archetype (HA's scene list grouped by room, like the Hue app) and the area of its room;
our automations get the label, the "Hue Studio" category and the area of their one room
(automations.py). Everything goes through HA's registries.

The user's choice wins: we fill only what is empty or still ours, and never touch a
label, category or area the user set. What is ours is remembered
(`hue_studio.organize`): the scenes organized once (a label or category the user
removes stays removed), the categories we made (one renamed by the user is theirs from
then on) and the areas we set. A Hue room renamed on the bridge moves its scenes to a
category of the new name while theirs is still ours; our categories nobody uses any
more are removed. The "Organize in Home Assistant" option turns it off and leaves
everything as it is.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
import logging
from typing import Any

from aiohue import HueBridgeV2
from aiohue.v2.models.resource import ResourceTypes
from aiohue.v2.models.scene import Scene
from aiohue.v2.models.smart_scene import SmartScene
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import (
    category_registry as cr,
    device_registry as dr,
    entity_registry as er,
    label_registry as lr,
)
from homeassistant.helpers.debounce import Debouncer
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.storage import Store

from .alignment import archetype_icon
from .const import CONF_ORGANIZE, DOMAIN, HUE_DOMAIN, SIGNAL_CONFIG_UPDATED
from .lights import async_bridges
from .options import async_group_areas, async_options
from .rooms import async_track_rooms
from .scenes import SCENE_DOMAIN

_LOGGER = logging.getLogger(__name__)

STORAGE_KEY = f"{DOMAIN}.organize"
STORAGE_VERSION = 1
SAVE_DELAY = 10
# New scene entities settle (the native integration adds them after the bridge event).
COOLDOWN = 2.0

LABEL_NAME = "Hue Studio"
LABEL_ICON = "mdi:lightbulb-group"


@callback
def async_enabled(hass: HomeAssistant) -> bool:
    """Whether "Organize in Home Assistant" is on (the default)."""
    return async_options(hass).get(CONF_ORGANIZE, True) is not False


@callback
def async_label(hass: HomeAssistant) -> lr.LabelEntry:
    """The "Hue Studio" label (made when first needed)."""
    labels = lr.async_get(hass)
    return labels.async_get_label_by_name(LABEL_NAME) or labels.async_create(
        LABEL_NAME, icon=LABEL_ICON
    )


@callback
def _async_bridge_scenes(
    hass: HomeAssistant,
) -> Iterator[tuple[er.RegistryEntry, HueBridgeV2, Scene | SmartScene]]:
    """Every Hue scene entity, smart scenes too, with its bridge and resource."""
    bridges = async_bridges(hass)
    for entry in list(er.async_get(hass).entities.values()):
        if (
            entry.domain != SCENE_DOMAIN
            or entry.platform != HUE_DOMAIN
            or (bridge := bridges.get(entry.config_entry_id or "")) is None
        ):
            continue
        resource = bridge.scenes.scene.get(
            entry.unique_id
        ) or bridge.scenes.smart_scene.get(entry.unique_id)
        if resource is not None:
            yield entry, bridge, resource


def _scene_group(
    bridge: HueBridgeV2, resource: Scene | SmartScene
) -> tuple[str, str | None, str] | None:
    """The scene's Hue room or zone: name, grouped light id, icon (its archetype's)."""
    ref = resource.group
    groups = bridge.groups
    if ref.rtype == ResourceTypes.ROOM:
        group, zone = groups.room.get(ref.rid), False
    elif ref.rtype == ResourceTypes.ZONE:
        group, zone = groups.zone.get(ref.rid), True
    else:
        return None
    if group is None:
        return None
    grouped_light = next(
        (s.rid for s in group.services if s.rtype == ResourceTypes.GROUPED_LIGHT),
        None,
    )
    archetype = getattr(group.metadata, "archetype", None)
    icon = archetype_icon(getattr(archetype, "value", archetype), zone=zone)
    return group.metadata.name, grouped_light, icon


class Organizer:
    """Label, category and area of every bridge scene, kept up with the bridges."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize (call `async_load` before use)."""
        self.hass = hass
        self.store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        # Scene unique id -> {"area": the area we set, or None}.
        self.scenes: dict[str, dict[str, Any]] = {}
        # Category id (scope "scene") -> the name we gave it.
        self.categories: dict[str, str] = {}
        self._debouncer: Debouncer[None] = Debouncer(
            hass,
            _LOGGER,
            cooldown=COOLDOWN,
            immediate=False,
            function=self.async_organize,
        )

    async def async_load(self) -> None:
        """Read what is ours."""
        data = await self.store.async_load() or {}
        self.scenes = data.get("scenes", {})
        self.categories = data.get("categories", {})

    def _data(self) -> dict[str, Any]:
        return {"scenes": self.scenes, "categories": self.categories}

    @callback
    def async_schedule(self, *_: Any) -> None:
        """Organize again soon (changes come in bursts)."""
        self._debouncer.async_schedule_call()

    @callback
    def async_cancel(self) -> None:
        """Stop pending work."""
        self._debouncer.async_cancel()

    @callback
    def async_organize(self) -> None:
        """One pass over every bridge scene."""
        if not async_enabled(self.hass):
            return
        hass = self.hass
        entities = er.async_get(hass)
        devices = dr.async_get(hass)
        categories = cr.async_get(hass)
        before = {
            "scenes": {k: dict(v) for k, v in self.scenes.items()},
            "categories": dict(self.categories),
        }

        # A category the user renamed (or deleted) is theirs.
        for category_id, name in list(self.categories.items()):
            category = categories.async_get_category(
                scope=SCENE_DOMAIN, category_id=category_id
            )
            if category is None or category.name != name:
                del self.categories[category_id]

        group_areas = async_group_areas(hass)
        label: lr.LabelEntry | None = None
        for entry, bridge, resource in _async_bridge_scenes(hass):
            known = self.scenes.get(entry.unique_id)
            group = _scene_group(bridge, resource)
            changes: dict[str, Any] = {}

            if known is None:
                label = label or async_label(hass)
                if label.label_id not in entry.labels:
                    changes["labels"] = {*entry.labels, label.label_id}

            category_id = entry.categories.get(SCENE_DOMAIN)
            if group is not None and (
                (category_id is None and known is None)
                or (
                    category_id in self.categories
                    and self.categories[category_id] != group[0]
                )
            ):
                wanted = self._category(categories, group[0], group[2])
                if wanted != category_id:
                    changes["categories"] = {**entry.categories, SCENE_DOMAIN: wanted}

            # The room's area; the scene's device (its Hue room or zone) may already
            # be in it, then the entity needs none of its own.
            device = devices.async_get(entry.device_id) if entry.device_id else None
            device_area = device.area_id if device else None
            room_area = group_areas.get(group[1]) if group and group[1] else None
            wanted_area = room_area if room_area != device_area else None
            area = known["area"] if known else None
            ours = entry.area_id == area
            if ours and entry.area_id != wanted_area:
                changes["area_id"] = wanted_area
            if ours:
                area = wanted_area

            self.scenes[entry.unique_id] = {"area": area}
            if changes:
                entities.async_update_entity(entry.entity_id, **changes)

        # Scenes gone from HA are forgotten (a bridge that is away keeps its own).
        for unique_id in list(self.scenes):
            if (
                entities.async_get_entity_id(SCENE_DOMAIN, HUE_DOMAIN, unique_id)
                is None
            ):
                del self.scenes[unique_id]
        self._remove_unused(categories, entities)

        if self._data() != before:
            self.store.async_delay_save(self._data, SAVE_DELAY)

    def _category(self, categories: cr.CategoryRegistry, name: str, icon: str) -> str:
        """The scene category of this name: ours, the user's, or a new one of ours."""
        for category_id, ours in self.categories.items():
            if ours == name:
                return category_id
        existing = next(
            (
                c
                for c in categories.async_list_categories(scope=SCENE_DOMAIN)
                if c.name == name
            ),
            None,
        )
        if existing is not None:
            return existing.category_id
        category = categories.async_create(scope=SCENE_DOMAIN, name=name, icon=icon)
        self.categories[category.category_id] = name
        return category.category_id

    def _remove_unused(
        self, categories: cr.CategoryRegistry, entities: er.EntityRegistry
    ) -> None:
        """Our categories that no entity uses any more go."""
        if not self.categories:
            return
        used = {
            entry.categories.get(SCENE_DOMAIN)
            for entry in entities.entities.values()
            if entry.domain == SCENE_DOMAIN
        }
        for category_id in [c for c in self.categories if c not in used]:
            del self.categories[category_id]
            if categories.async_get_category(
                scope=SCENE_DOMAIN, category_id=category_id
            ):
                categories.async_delete(scope=SCENE_DOMAIN, category_id=category_id)


async def async_track_organize(hass: HomeAssistant) -> Callable[[], None]:
    """Organize the bridge scenes now and whenever they, rooms, areas or the Hue
    Studio entry's options (room mapping, the option itself) change."""
    organizer = Organizer(hass)
    await organizer.async_load()

    @callback
    def registry_updated(event: Event[er.EventEntityRegistryUpdatedData]) -> None:
        if event.data["action"] == "create" and event.data["entity_id"].startswith(
            f"{SCENE_DOMAIN}."
        ):
            organizer.async_schedule()

    stops = [
        async_track_rooms(hass, organizer.async_schedule),
        hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, registry_updated),
        async_dispatcher_connect(hass, SIGNAL_CONFIG_UPDATED, organizer.async_schedule),
    ]
    organizer.async_schedule()

    @callback
    def stop() -> None:
        for unsub in stops:
            unsub()
        organizer.async_cancel()

    return stop
