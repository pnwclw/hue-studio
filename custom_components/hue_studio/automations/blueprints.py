"""Automations like the Hue app's, run by Home Assistant.

Hue Studio runs no automations of its own. It ships blueprints, one per Hue app type
(`blueprints/automation/hue_studio/`), and puts them into HA's blueprint folder on
setup. The panel writes automations that use them through HA's automation config API,
so HA stores, runs and edits them (Settings → Automations shows a form for each).
What the blueprints call is `hue_studio.apply_light`: a scene, a white, natural light,
the scene of the day or off, for the Hue lights of some rooms (HA areas).

Natural light and the scene of the day start from the global light of the day
(pool.py: scene pool, phase times, sources, mood); the automation adds its own
(`scene_of_the_day`: extra and skipped scenes, its own phase times, brightness, see
daylight.py). Once shown, they keep up with the day ("living" light): every minute,
and at once when the mood or the global settings change, the selection is worked out
again and shown when it changed, until someone changes the lights, they go off, or
another `apply_light` takes them over. That is kept in memory only; after a restart
the next run starts it again.

Markers: our automations use a blueprint under `hue_studio/` and an id
`hue_studio_<type>_<suffix>` (the id stays when an automation is taken over in HA's
editor). They get the "Hue Studio" label and automation category and the area of
their one room, without overwriting what the user set.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
import filecmp
import logging
from pathlib import Path
import shutil
import time
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.components.automation import (
    DATA_COMPONENT as AUTOMATION_COMPONENT,
    DOMAIN as AUTOMATION_DOMAIN,
    EVENT_AUTOMATION_RELOADED,
    automations_with_area,
    automations_with_blueprint,
    automations_with_entity,
)
from homeassistant.const import (
    EVENT_HOMEASSISTANT_STOP,
    EVENT_STATE_CHANGED,
    SERVICE_RELOAD,
    STATE_OFF,
    STATE_ON,
)
from homeassistant.core import (
    Event,
    EventStateChangedData,
    HomeAssistant,
    ServiceCall,
    callback,
)
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import (
    area_registry as ar,
    category_registry as cr,
    config_validation as cv,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store
from homeassistant.util.hass_dict import HassKey
import voluptuous as vol

from ..const import DOMAIN, SIGNAL_CONFIG_UPDATED
from ..lights.adaptive import async_mark_manual
from ..lights.bridge import ATTR_IS_HUE_GROUP, LIGHT_DOMAIN, async_all_lights
from ..rooms.areas import light_area
from ..scenes.bridge import (
    async_resolve_scenes,
    async_show_on_lights,
    light_entity_ids,
    scene_lights,
)
from ..scenes.gallery import async_gallery_scenes
from ..scenes.organize import async_enabled as async_organize_enabled, async_label
from ..services import BRIGHTNESS, TRANSITION, async_target_lights
from . import daylight, pool

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

SERVICE_APPLY_LIGHT = "apply_light"
LIGHT_SCENE = "scene"
LIGHT_WHITE = "white"
LIGHT_NATURAL = "natural"
LIGHT_AUTO = "auto"
LIGHT_OFF = "off"
LIGHTS = (LIGHT_SCENE, LIGHT_WHITE, LIGHT_NATURAL, LIGHT_AUTO, LIGHT_OFF)
DEFAULT_KELVIN = 2700
KELVIN = vol.All(
    vol.Coerce(int), vol.Range(min=daylight.KELVIN_MIN, max=daylight.KELVIN_MAX)
)

# Living light: how fast a change of the day is shown, and one of the mood.
LIVING_TRANSITION = 60.0
MOOD_TRANSITION = 2.0
# Changes within this long after our own command, plus its transition (the bridge
# reports the brightness on the way every ~10 s), are its own.
QUIET_SECONDS = 15
# Attributes compared to tell a real change from the bridge settling.
COMPARED = ("brightness", "xy_color", "color_mode", "color_temp_kelvin")

# The old auto light kept its settings here; read once to offer them to new automations.
LEGACY_STORAGE_KEY = f"{DOMAIN}.auto_light"

PHASES = daylight.PHASES
SEASON_KEYS = ("all", *daylight.SEASONS)
MAX_OFFSET = 60
IDS = vol.All(cv.ensure_list, [cv.string])

# An automation's own settings of the scene of the day and natural light, on top of
# the global ones (pool.py, daylight.resolve).
DAY_CONFIG = vol.Schema(
    {
        # Scenes this automation adds to the pool, and skips.
        vol.Optional("include", default=list): IDS,
        vol.Optional("exclude", default=list): IDS,
        # Before 0.10 every automation had pools of its own; until the panel moves
        # them into the global pool they are used as they are.
        vol.Optional("pools"): {
            vol.In(PHASES): {vol.In(SEASON_KEYS): {vol.In(daylight.WEATHER): list}}
        },
        vol.Optional("holidays"): [
            vol.Schema(
                {
                    vol.Required("from"): cv.matches_regex(r"^\d\d-\d\d$"),
                    vol.Required("to"): cv.matches_regex(r"^\d\d-\d\d$"),
                    vol.Optional("phases", default=list): [vol.In(PHASES)],
                    vol.Optional("pool", default=list): IDS,
                },
                extra=vol.REMOVE_EXTRA,
            )
        ],
        vol.Optional("excluded"): IDS,
        vol.Optional("offsets", default=dict): {
            vol.In(PHASES): vol.All(
                vol.Coerce(int), vol.Range(min=-MAX_OFFSET, max=MAX_OFFSET)
            )
        },
        vol.Optional("settings", default=dict): vol.Schema(
            {
                # Phase times of its own (else the global ones).
                vol.Optional("night_from"): cv.matches_regex(r"^\d\d:\d\d$"),
                vol.Optional("shifts"): pool.SHIFTS,
                # Before 0.10: sources of its own (now global).
                vol.Optional("weather"): vol.Any(None, cv.entity_id),
                vol.Optional("light_sensor"): vol.Any(None, cv.entity_id),
                vol.Optional("season"): vol.Any(None, cv.entity_id),
                vol.Optional("brightness"): {
                    vol.In(PHASES): vol.All(vol.Coerce(int), vol.Range(min=1, max=100))
                },
                vol.Optional("gradient_mode"): vol.Any(None, cv.string),
                vol.Optional("kelvin"): {vol.In(PHASES): KELVIN},
            },
            extra=vol.REMOVE_EXTRA,
        ),
    },
    extra=vol.REMOVE_EXTRA,
)


def _optional(validator: Any) -> Any:
    """Blueprint inputs left empty arrive as None or ""."""
    return vol.Any(vol.All(vol.Any(None, ""), lambda _: None), validator)


APPLY_LIGHT_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Optional("light", default=LIGHT_SCENE): vol.In(LIGHTS),
        vol.Optional("scenes", default=list): vol.Any(
            vol.All(vol.Any(None, ""), lambda _: []), cv.entity_ids
        ),
        vol.Optional("kelvin"): _optional(KELVIN),
        vol.Optional("brightness"): _optional(BRIGHTNESS),
        vol.Optional("transition"): _optional(TRANSITION),
        vol.Optional("scene_of_the_day", default=dict): vol.Any(
            vol.All(vol.Any(None, ""), lambda _: DAY_CONFIG({})), DAY_CONFIG
        ),
        # Lights that are off start at the lowest brightness (wake up): the
        # transition is a fade in, not a fade from their last state.
        vol.Optional("from_dark", default=False): cv.boolean,
        # Nothing happens while any of the lights is on (motion: keep what is shown).
        vol.Optional("only_if_off", default=False): cv.boolean,
        # Lights that are on go off instead (mimic presence).
        vol.Optional("toggle", default=False): cv.boolean,
        # Natural light and the scene of the day keep up with the day.
        vol.Optional("follow", default=True): cv.boolean,
    }
)


# ---- the light of the day ----


def day_config(config: dict[str, Any], natural: bool) -> dict[str, Any]:
    """An automation's validated settings; natural light is the "natural" style."""
    config = DAY_CONFIG(config)
    if natural:
        config["settings"]["style"] = daylight.STYLE_NATURAL
    return config


async def async_day_selection(
    hass: HomeAssistant, local: dict[str, Any]
) -> tuple[daylight.Selection, dict[str, Any]]:
    """What an automation's light of the day shows now, and the settings behind it."""
    config = await pool.async_config(hass, local)
    inputs = pool.daylight_inputs(hass, config["settings"])
    return daylight.select(config, inputs), config


async def _async_show(
    hass: HomeAssistant,
    lights: list[str],
    selection: daylight.Selection,
    config: dict[str, Any],
    *,
    brightness: float | None = None,
    transition: float | None = None,
) -> bool:
    """Show a selection (through `apply_palette`); False when it has nothing to show."""
    data: dict[str, Any] = {
        "entity_id": lights,
        "brightness": selection.brightness if brightness is None else brightness,
    }
    if selection.kelvin is not None:
        data["mirek"] = round(1_000_000 / selection.kelvin)
    elif selection.scene is not None:
        data["gallery_scene"] = selection.scene
        if mode := config["settings"].get("gradient_mode"):
            data["mode"] = mode
    else:
        return False
    if transition is not None:
        data["transition"] = transition
    await hass.services.async_call(DOMAIN, "apply_palette", data, blocking=True)
    return True


@dataclass(slots=True, eq=False)
class Living:
    """Lights that keep up with the day."""

    lights: tuple[str, ...]
    # The automation's own settings (the global ones are read every time).
    local: dict[str, Any]
    config: dict[str, Any]
    selection: daylight.Selection
    # time.monotonic() until which light changes are our own command settling.
    quiet_until: float = -1e9

    def quiet(self, transition: float | None) -> None:
        """Ignore the lights' reports while a command of ours settles."""
        self.quiet_until = time.monotonic() + QUIET_SECONDS + (transition or 0)


class LivingLights:
    """Natural light and scenes of the day that keep up with the day."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Create it (start with `async_start`)."""
        self.hass = hass
        self.by_light: dict[str, Living] = {}
        self._unsubs: list[Callable[[], None]] = []

    @callback
    def async_start(self) -> None:
        """Follow the clock and the lights."""
        self._unsubs.append(
            async_track_time_interval(self.hass, self._async_tick, pool.TICK)
        )
        for signal, transition in (
            (SIGNAL_CONFIG_UPDATED, LIVING_TRANSITION),
            (pool.SIGNAL_MOOD_UPDATED, MOOD_TRANSITION),
        ):
            self._unsubs.append(
                async_dispatcher_connect(
                    self.hass, signal, self._async_later(transition)
                )
            )
        self._unsubs.append(
            self.hass.bus.async_listen(
                EVENT_STATE_CHANGED, self._async_state_changed, self._watched
            )
        )

    @callback
    def async_stop(self) -> None:
        """Stop following anything."""
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        self.by_light.clear()

    def groups(self) -> list[Living]:
        """Every group once."""
        return list({id(g): g for g in self.by_light.values()}.values())

    @callback
    def follow(self, living: Living) -> None:
        """Start following lights (they leave the groups they were in)."""
        self.release(living.lights)
        for entity_id in living.lights:
            self.by_light[entity_id] = living

    @callback
    def release(self, entity_ids: list[str] | tuple[str, ...]) -> None:
        """Stop following the groups of these lights (all of their lights)."""
        for entity_id in entity_ids:
            if (living := self.by_light.get(entity_id)) is None:
                continue
            for light in living.lights:
                if self.by_light.get(light) is living:
                    del self.by_light[light]

    def _async_later(self, transition: float) -> Callable[[], None]:
        @callback
        def update() -> None:
            self.hass.async_create_task(
                self.async_update(transition), "hue_studio_living_light"
            )

        return update

    async def _async_tick(self, _: datetime) -> None:
        await self.async_update(LIVING_TRANSITION)

    async def async_update(self, transition: float) -> None:
        """Show what changed since the last time."""
        for living in self.groups():
            selection, config = await async_day_selection(self.hass, living.local)
            living.config = config
            old = living.selection
            if (selection.scene, selection.kelvin, selection.brightness) == (
                old.scene,
                old.kelvin,
                old.brightness,
            ):
                continue
            living.selection = selection
            living.quiet(transition)
            try:
                await _async_show(
                    self.hass,
                    list(living.lights),
                    selection,
                    config,
                    transition=transition,
                )
            except HomeAssistantError as err:
                _LOGGER.warning("Light of the day not shown: %s", err)
            living.quiet(transition)

    @callback
    def _watched(self, data: EventStateChangedData) -> bool:
        return data["entity_id"] in self.by_light

    @callback
    def _async_state_changed(self, event: Event[EventStateChangedData]) -> None:
        entity_id = event.data["entity_id"]
        living = self.by_light.get(entity_id)
        old, new = event.data["old_state"], event.data["new_state"]
        if living is None or old is None or new is None:
            return
        if new.state not in (STATE_ON, STATE_OFF):
            return
        if new.state == STATE_ON and time.monotonic() < living.quiet_until:
            return
        before = {"state": old.state, **{k: old.attributes.get(k) for k in COMPARED}}
        after = {"state": new.state, **{k: new.attributes.get(k) for k in COMPARED}}
        if daylight.is_real_change(before, after):
            _LOGGER.debug("%s changed: stops keeping up with the day", entity_id)
            self.release(living.lights)


_LIVING: HassKey[LivingLights] = HassKey(f"{DOMAIN}_living_lights")


def living_lights(hass: HomeAssistant) -> LivingLights:
    """Lights that keep up with the day (set up with the integration)."""
    return hass.data[_LIVING]


async def _async_apply_light(hass: HomeAssistant, call: ServiceCall) -> None:
    """`hue_studio.apply_light`: what the automations of the blueprints show."""
    data = call.data
    lights = [light.entity_id for light in await async_target_lights(hass, call)]
    on = [
        entity_id
        for entity_id in lights
        if (state := hass.states.get(entity_id)) and state.state == STATE_ON
    ]
    if data["only_if_off"] and on:
        return
    kind = LIGHT_OFF if data["toggle"] and on else data["light"]
    transition = data.get("transition")
    living = living_lights(hass)
    living.release(lights)

    if kind == LIGHT_OFF:
        off: dict[str, Any] = {"entity_id": lights}
        if transition is not None:
            off["transition"] = transition
        await hass.services.async_call(
            LIGHT_DOMAIN, "turn_off", off, blocking=True, context=call.context
        )
        return

    dark = [entity_id for entity_id in lights if entity_id not in on]
    from_dark = data["from_dark"] and dark and transition

    if kind == LIGHT_SCENE:
        scenes = data["scenes"]
        if not scenes:
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key="no_scenes"
            )
        if from_dark:
            await hass.services.async_call(
                LIGHT_DOMAIN,
                "turn_on",
                {"entity_id": dark, "brightness_pct": 1, "transition": 0},
                blocking=True,
                context=call.context,
            )
        # A scene whose lights are all chosen plays as it is set up; one of a room some
        # of whose lights are chosen shows on those only (the Hue app's way).
        brightness = data.get("brightness")
        whole: list[str] = []
        for scene in async_resolve_scenes(hass, scenes):
            if set(light_entity_ids(hass, scene_lights(scene))) <= set(lights):
                whole.append(scene.entity_id)
                continue
            shown = await async_show_on_lights(
                hass, scene, lights, brightness, transition
            )
            await async_mark_manual(hass, shown)
        if not whole:
            return
        recall: dict[str, Any] = {"entity_id": whole}
        if brightness is not None:
            recall["brightness"] = brightness
        if transition is not None:
            recall["transition"] = transition
        await hass.services.async_call(DOMAIN, "recall_scene", recall, blocking=True)
        return

    if kind == LIGHT_WHITE:
        white = {
            "mirek": round(1_000_000 / (data.get("kelvin") or DEFAULT_KELVIN)),
            "brightness": data.get("brightness") or 100,
        }
        if from_dark:
            await hass.services.async_call(
                DOMAIN,
                "apply_palette",
                {"entity_id": dark, **white, "brightness": 1, "transition": 0},
                blocking=True,
            )
        if transition is not None:
            white["transition"] = transition
        await hass.services.async_call(
            DOMAIN, "apply_palette", {"entity_id": lights, **white}, blocking=True
        )
        return

    local = day_config(data["scene_of_the_day"], kind == LIGHT_NATURAL)
    selection, config = await async_day_selection(hass, local)
    if selection.kelvin is None and selection.scene is None:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="no_scene_of_the_day"
        )
    group = Living(tuple(lights), local, config, selection)
    group.quiet(transition)
    if from_dark:
        await _async_show(hass, dark, selection, config, brightness=1, transition=0)
    await _async_show(hass, lights, selection, config, transition=transition)
    if data["follow"]:
        group.quiet(transition)
        living.follow(group)


# ---- blueprints ----


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


# ---- automations in HA ----


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
    """Blueprints, `apply_light`, living light and the WebSocket API."""
    _async_remove_auto_light_devices(hass)
    living = hass.data[_LIVING] = LivingLights(hass)
    living.async_start()

    @callback
    def stop(_: Event) -> None:
        living.async_stop()

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, stop)

    async def apply_light(call: ServiceCall) -> None:
        await _async_apply_light(hass, call)

    hass.services.async_register(
        DOMAIN, SERVICE_APPLY_LIGHT, apply_light, schema=APPLY_LIGHT_SCHEMA
    )

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

    for command in (
        ws_subscribe_automations,
        ws_organize,
        ws_preview,
        ws_legacy_auto_light,
    ):
        websocket_api.async_register_command(hass, command)


# ---- WebSocket API ----


@websocket_api.websocket_command(
    {vol.Required("type"): "hue_studio/automations/subscribe"}
)
@callback
def ws_subscribe_automations(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Our automations and the others that touch Hue lights, now and on changes.

    Event payload: {"automations": {entity_id: {"id", "type", "custom", "areas",
                    "groups"}}, "related": [entity_id], "types": [type], "reloads": n}
    The panel reads the stored configs through HA's automation config API (what HA's
    editor reads), again whenever `reloads` changes (an automation was saved here or
    in HA's editor).
    """
    last: dict[str, Any] = {}
    reloads = [0]

    @callback
    def send(*_: Any) -> None:
        ours = our_automations(hass)
        payload = {
            "automations": ours,
            "related": related_automations(hass, set(ours)),
            "types": list(TYPES),
            "reloads": reloads[0],
        }
        if payload == last.get("payload"):
            return
        last["payload"] = payload
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    @callback
    def registry_changed(event: Event[er.EventEntityRegistryUpdatedData]) -> None:
        if event.data["entity_id"].startswith(f"{AUTOMATION_DOMAIN}."):
            send()

    @callback
    def reloaded(_: Event) -> None:
        reloads[0] += 1
        send()

    unsubs = [
        hass.bus.async_listen(EVENT_AUTOMATION_RELOADED, reloaded),
        hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, registry_changed),
    ]

    @callback
    def unsubscribe() -> None:
        for unsub in unsubs:
            unsub()

    connection.subscriptions[msg["id"]] = unsubscribe
    connection.send_result(msg["id"])
    send()


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/automations/organize",
        vol.Required("entity_id"): cv.entity_id,
        vol.Optional("area_id"): vol.Any(None, str),
    }
)
@callback
def ws_organize(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Label, category and area of an automation the panel just saved."""
    if er.async_get(hass).async_get(msg["entity_id"]) is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, msg["entity_id"])
        return
    async_organize(hass, msg["entity_id"], msg.get("area_id"))
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/automations/preview",
        vol.Optional("scene_of_the_day", default=dict): dict,
        vol.Optional("natural", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_preview(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """What natural light or a scene of the day with these settings (an automation's
    own, on top of the global ones) shows now."""
    try:
        local = day_config(msg["scene_of_the_day"], msg["natural"])
    except vol.Invalid as err:
        connection.send_error(msg["id"], websocket_api.ERR_INVALID_FORMAT, str(err))
        return
    selection, _ = await async_day_selection(hass, local)
    info = pool.selection_info(selection)
    if selection.scene:
        gallery = await async_gallery_scenes(hass)
        info["scene_name"] = (gallery.get(selection.scene) or {}).get("name")
    connection.send_result(msg["id"], info)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "hue_studio/automations/legacy_auto_light"}
)
@websocket_api.async_response
async def ws_legacy_auto_light(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Settings of the old auto light per area, to start a scene of the day from.

    Result: {area_id: {"natural": bool, "config": scene_of_the_day settings}}.
    """
    data = await Store[dict[str, Any]](hass, 1, LEGACY_STORAGE_KEY).async_load() or {}
    areas: dict[str, Any] = {}
    for area_id, config in (data.get("areas") or {}).items():
        try:
            areas[area_id] = {
                "natural": (config.get("settings") or {}).get("style")
                == daylight.STYLE_NATURAL,
                "config": DAY_CONFIG(config),
            }
        except vol.Invalid, AttributeError:
            continue
    connection.send_result(msg["id"], areas)
