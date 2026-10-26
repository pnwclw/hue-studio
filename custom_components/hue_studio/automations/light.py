"""`hue_studio.apply_light`, what the blueprints call: a scene, a white, natural light,
the scene of the day or off, for the Hue lights of some rooms (HA areas).

Natural light and the scene of the day start from the global light of the day
(pool.py: scene pool, phase times, sources, mood); the automation adds its own
(`scene_of_the_day`: extra and skipped scenes, its own phase times, brightness, see
daylight.py). Once shown, they keep up with the day ("living" light): every minute,
and at once when the mood or the global settings change, the selection is worked out
again and shown when it changed, until someone changes the lights, they go off, or
another `apply_light` takes them over. That is kept in memory only; after a restart
the next run starts it again.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
import logging
import time
from typing import Any

from homeassistant.const import EVENT_STATE_CHANGED, STATE_OFF, STATE_ON
from homeassistant.core import (
    Event,
    EventStateChangedData,
    HomeAssistant,
    ServiceCall,
    callback,
)
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.util.hass_dict import HassKey
import voluptuous as vol

from ..const import DOMAIN, SIGNAL_CONFIG_UPDATED
from ..lights.bridge import LIGHT_DOMAIN
from ..lights.targets import BRIGHTNESS, TRANSITION, async_target_lights
from ..scenes.bridge import (
    async_resolve_scenes,
    async_show_on_lights,
    light_entity_ids,
    scene_lights,
)
from . import daylight, pool

_LOGGER = logging.getLogger(__name__)

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


LIVING: HassKey[LivingLights] = HassKey(f"{DOMAIN}_living_lights")


def living_lights(hass: HomeAssistant) -> LivingLights:
    """Lights that keep up with the day (set up with the integration)."""
    return hass.data[LIVING]


async def async_apply_light(hass: HomeAssistant, call: ServiceCall) -> None:
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
            await async_show_on_lights(hass, scene, lights, brightness, transition)
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


@callback
def async_setup_services(hass: HomeAssistant) -> None:
    """Register `apply_light`."""

    async def apply_light(call: ServiceCall) -> None:
        await async_apply_light(hass, call)

    hass.services.async_register(
        DOMAIN, SERVICE_APPLY_LIGHT, apply_light, schema=APPLY_LIGHT_SCHEMA
    )
