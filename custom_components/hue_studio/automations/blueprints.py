"""Automations like the Hue app's, run by Home Assistant.

Hue Studio runs no automations of its own. It ships blueprints, one per Hue app type
(`blueprints/automation/hue_studio/`), and puts them into HA's blueprint folder on
setup. The panel writes automations that use them through HA's automation config API,
so HA stores, runs and edits them (Settings → Automations shows a form for each).
What the blueprints call is `hue_studio.apply_light` (light.py).

Markers: our automations use a blueprint under `hue_studio/` and an id
`hue_studio_<type>_<suffix>` (the id stays when an automation is taken over in HA's
editor). They get the "Hue Studio" label and automation category and the area of
their one room, without overwriting what the user set.
"""

from __future__ import annotations

import filecmp
import logging
from pathlib import Path
import shutil
from typing import Any

from homeassistant.components.automation import (
    DATA_COMPONENT as AUTOMATION_COMPONENT,
    DOMAIN as AUTOMATION_DOMAIN,
    automations_with_area,
    automations_with_blueprint,
    automations_with_entity,
)
from homeassistant.const import EVENT_HOMEASSISTANT_STOP, SERVICE_RELOAD
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import (
    area_registry as ar,
    category_registry as cr,
    device_registry as dr,
    entity_registry as er,
)

from ..const import DOMAIN
from ..lights.bridge import ATTR_IS_HUE_GROUP, LIGHT_DOMAIN, async_all_lights
from ..rooms.areas import light_area
from ..scenes.organize import async_enabled as async_organize_enabled, async_label
from .light import LIVING, LivingLights

_LOGGER = logging.getLogger(__name__)

# Blueprints: blueprints/automation/<BLUEPRINT_DIR>/<type>.yaml (here and in HA).
BLUEPRINT_DIR = DOMAIN


TYPES = (
    "wake_up",
    "go_to_sleep",
    "coming_home",
    "leaving_home",
    "mimic_presence",
    "schedule",
    "motion",
)


ID_PREFIX = f"{DOMAIN}_"


CATEGORY_NAME = "Hue Studio"


CATEGORY_ICON = "mdi:lightbulb-group"


# The old auto light kept its settings here; read once to offer them to new automations.
LEGACY_STORAGE_KEY = f"{DOMAIN}.auto_light"


def _copy_blueprints(source: Path, target: Path) -> list[str]:
    """Copy our blueprints into HA's folder; the types whose file changed."""
    target.mkdir(parents=True, exist_ok=True)
    changed = []
    for path in sorted(source.glob("*.yaml")):
        dest = target / path.name
        if dest.exists() and filecmp.cmp(path, dest, shallow=False):
            continue
        shutil.copyfile(path, dest)
        changed.append(path.stem)
    return changed


async def async_install_blueprints(hass: HomeAssistant) -> list[str]:
    """Put the blueprints in place; automations using changed ones are reloaded."""
    source = Path(__file__).parent.parent / "blueprints" / "automation" / BLUEPRINT_DIR
    target = Path(hass.config.path("blueprints", "automation", BLUEPRINT_DIR))
    changed = await hass.async_add_executor_job(_copy_blueprints, source, target)
    if changed and any(
        automations_with_blueprint(hass, blueprint_path(kind)) for kind in changed
    ):
        await hass.services.async_call(AUTOMATION_DOMAIN, SERVICE_RELOAD)
    return changed


def blueprint_path(kind: str) -> str:
    """A blueprint's path as automations refer to it."""
    return f"{BLUEPRINT_DIR}/{kind}.yaml"


def our_automations(hass: HomeAssistant) -> dict[str, dict[str, Any]]:
    """Our automations: entity id -> id, type, custom, areas, groups, lights.

    Those using one of our blueprints, and those whose id says they were made by Hue
    Studio and were taken over in HA's editor since ("custom"). `areas`, `groups` and
    `lights` are the areas, Hue rooms/zones (group light entities) and single Hue lights
    they control, as HA sees their targets, so the panel can list them by room without
    reading their configs.
    """
    found: dict[str, dict[str, Any]] = {}
    for kind in TYPES:
        for entity_id in automations_with_blueprint(hass, blueprint_path(kind)):
            found[entity_id] = {"type": kind, "custom": False}
    for state in hass.states.async_all(AUTOMATION_DOMAIN):
        config_id = str(state.attributes.get("id") or "")
        if state.entity_id in found:
            found[state.entity_id]["id"] = config_id or None
        elif config_id.startswith(ID_PREFIX):
            kind = next(
                (k for k in TYPES if config_id.startswith(f"{ID_PREFIX}{k}_")), None
            )
            found[state.entity_id] = {"id": config_id, "type": kind, "custom": True}
    for info in found.values():
        info["areas"] = []
        info["groups"] = []
        info["lights"] = []
    for area in ar.async_get(hass).async_list_areas():
        for entity_id in automations_with_area(hass, area.id):
            if entity_id in found:
                found[entity_id]["areas"].append(area.id)
    for state in hass.states.async_all(LIGHT_DOMAIN):
        if state.attributes.get(ATTR_IS_HUE_GROUP):
            for entity_id in automations_with_entity(hass, state.entity_id):
                if entity_id in found:
                    found[entity_id]["groups"].append(state.entity_id)
    for light in async_all_lights(hass):
        for entity_id in automations_with_entity(hass, light.entity_id):
            if entity_id in found:
                found[entity_id]["lights"].append(light.entity_id)
    return found


def related_automations(hass: HomeAssistant, ours: set[str]) -> list[str]:
    """Other HA automations that touch Hue lights or areas with them."""
    entities = er.async_get(hass)
    devices = dr.async_get(hass)
    related: set[str] = set()
    areas: set[str] = set()
    for light in async_all_lights(hass):
        related.update(automations_with_entity(hass, light.entity_id))
        entry = entities.async_get(light.entity_id)
        if entry and (area := light_area(entry, devices)):
            areas.add(area)
    for state in hass.states.async_all(LIGHT_DOMAIN):
        if state.attributes.get(ATTR_IS_HUE_GROUP):
            related.update(automations_with_entity(hass, state.entity_id))
    for area in areas:
        related.update(
            entity_id
            for entity_id in automations_with_area(hass, area)
            if lights_area_action(hass, entity_id, area)
        )
    return sorted(related - ours)


LIGHT_ACTION_DOMAINS = {LIGHT_DOMAIN, "scene", DOMAIN}


def lights_area_action(hass: HomeAssistant, entity_id: str, area: str) -> bool:
    """Whether an action of the automation sends lights or scenes to the area.

    HA counts an area anywhere in an automation, its triggers and conditions too: a
    leak sensor's area that switches a plug off is not about light. When the actions
    can't be read, the area counts as before.
    """
    component = hass.data.get(AUTOMATION_COMPONENT)
    entity = component.get_entity(entity_id) if component else None
    script = getattr(entity, "action_script", None)
    if script is None:
        return True
    return area in _light_action_areas(script.sequence)


def _light_action_areas(config: Any) -> set[str]:
    """Areas targeted by light, scene and Hue Studio actions anywhere in a config."""
    found: set[str] = set()
    if isinstance(config, list):
        for item in config:
            found |= _light_action_areas(item)
    elif isinstance(config, dict):
        action = config.get("action") or config.get("service")
        if isinstance(action, str) and action.partition(".")[0] in LIGHT_ACTION_DOMAINS:
            for data in (config.get("target"), config.get("data")):
                areas = data.get("area_id") if isinstance(data, dict) else None
                found.update([areas] if isinstance(areas, str) else areas or [])
        for value in config.values():
            if isinstance(value, (dict, list)):
                found |= _light_action_areas(value)
    return found


@callback
def async_organize(
    hass: HomeAssistant, entity_id: str, area_id: str | None = None
) -> None:
    """Label, category and area for one of our automations; the user's values stay."""
    entities = er.async_get(hass)
    entry = entities.async_get(entity_id)
    if entry is None or not async_organize_enabled(hass):
        return
    label = async_label(hass)
    categories = cr.async_get(hass)
    category = next(
        (
            c
            for c in categories.async_list_categories(scope=AUTOMATION_DOMAIN)
            if c.name == CATEGORY_NAME
        ),
        None,
    ) or categories.async_create(
        scope=AUTOMATION_DOMAIN, name=CATEGORY_NAME, icon=CATEGORY_ICON
    )
    changes: dict[str, Any] = {}
    if label.label_id not in entry.labels:
        changes["labels"] = {*entry.labels, label.label_id}
    if AUTOMATION_DOMAIN not in entry.categories:
        changes["categories"] = {
            **entry.categories,
            AUTOMATION_DOMAIN: category.category_id,
        }
    if area_id and entry.area_id is None:
        changes["area_id"] = area_id
    if changes:
        entities.async_update_entity(entity_id, **changes)


@callback
def _async_remove_auto_light_devices(hass: HomeAssistant) -> None:
    """The old auto light's devices and entities (per area) are gone for good."""
    devices = dr.async_get(hass)
    for device in list(devices.devices):
        # Identifiers are (domain, id), or longer in devices of some old integrations.
        if any(
            len(ident) > 1
            and ident[0] == DOMAIN
            and str(ident[1]).startswith("auto_light_")
            for ident in device.identifiers
        ):
            devices.async_remove_device(device.id)
    entities = er.async_get(hass)
    for entry in list(entities.entities.values()):
        if entry.platform == DOMAIN and entry.unique_id.startswith("auto_light_"):
            entities.async_remove(entry.entity_id)


async def async_setup_automations(hass: HomeAssistant) -> None:
    """Blueprints in place, living light, our automations organized as they come."""
    _async_remove_auto_light_devices(hass)
    living = hass.data[LIVING] = LivingLights(hass)
    living.async_start()

    @callback
    def stop(_: Event) -> None:
        living.async_stop()

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, stop)

    @callback
    def registry_updated(event: Event[er.EventEntityRegistryUpdatedData]) -> None:
        # New automations with our id get the label and category at once (the panel
        # adds the area); one taken over in HA keeps its id and with it the markers.
        if event.data["action"] != "create":
            return
        entity_id = event.data["entity_id"]
        entry = er.async_get(hass).async_get(entity_id)
        if (
            entry is not None
            and entry.domain == AUTOMATION_DOMAIN
            and entry.unique_id.startswith(ID_PREFIX)
        ):
            async_organize(hass, entity_id)

    hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, registry_updated)

    try:
        await async_install_blueprints(hass)
    except OSError as err:
        _LOGGER.error("Could not install the Hue Studio blueprints: %s", err)
