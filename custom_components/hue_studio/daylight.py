"""Light of the day: what lights should show now (pure, no Home Assistant).

Behind two kinds of light of `hue_studio.apply_light` (automations.py): the scene of
the day and natural light. Their settings are global (the Hue Studio entry's options:
sources, phase times, scene tags), an automation adds its own (extra or skipped
scenes, its own phase times, brightness); `resolve` puts both together. The rules:

- Phases: night from a set time until sunrise + a shift; morning until sunrise + a
  shift; day until sunset - a shift; golden until sunset + a shift; then evening.
- Season: an entity whose state is winter/spring/summer/autumn, else the month
  (meteorological seasons).
- Weather: "gloomy" for fog, rain, snow, storms or overcast (or cloud cover from
  80 %), else "clear".
- Mood: what the user wants now (relax, cozy, …), or none: the day decides.
- Scene tags: every scene of the pool has tags — the phases, seasons, weather and
  moods it fits (an empty list: any). Hue Studio ships tags for the gallery
  (scene_tags.json); the user's tags of a scene replace them, an empty one takes it
  out of the pool.
- The pool: with a mood, the scenes of that mood, narrowed to the season, phase and
  weather as long as something is left. Without one, the scenes of the phase (a
  phase without scenes behaves like the phase before it: its scenes, brightness and
  offset), narrowed to the season and weather as long as something is left.
- Scene of the day: the pool cycled by the day number; the light day starts with the
  morning, so the scene does not change at midnight.
- Brightness: fixed per phase, or the curve (day: the darker outside, the brighter;
  morning and evening follow the sun), plus the personal offset of the phase.
- Natural light (style "natural", the Hue app's Natural light): no scenes, a white of
  its own per phase instead — cool in the morning and during the day, warm towards the
  evening and at night — with the same brightness rules.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
import math
from typing import Any

PHASES = ("morning", "day", "golden", "evening", "night")
SEASONS = ("winter", "spring", "summer", "autumn")
WEATHER = ("clear", "gloomy")
MOODS = ("relax", "cozy", "focus", "romantic", "party", "festive")
# Tags of a scene: the values of each it fits (an empty or missing list: any).
TAGS = {"phases": PHASES, "seasons": SEASONS, "weather": WEATHER, "moods": MOODS}
STYLES = ("scenes", "natural")
STYLE_NATURAL = "natural"
# Natural light: color temperature per phase (like the Hue app's Energize, Concentrate,
# Read, Relax and Nightlight); settings["kelvin"] overrides it.
NATURAL_KELVIN = {
    "morning": 5000,
    "day": 4300,
    "golden": 2900,
    "evening": 2200,
    "night": 2000,
}
KELVIN_MIN = 2000
KELVIN_MAX = 6500

GLOOMY_CONDITIONS = frozenset(
    {
        "fog",
        "rainy",
        "pouring",
        "snowy",
        "snowy-rainy",
        "hail",
        "lightning",
        "lightning-rainy",
        "cloudy",
    }
)
GLOOMY_CLOUD = 80
DEFAULT_CLOUD = 50.0
MONTH_SEASONS = {12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring"}
MONTH_SEASONS |= {5: "spring", 6: "summer", 7: "summer", 8: "summer"}

# Default phase shifts in minutes (relative to sunrise/sunset) and night start.
DEFAULT_SHIFTS = {"morning": 0, "day": 50, "golden": 50, "evening": 0}
DEFAULT_NIGHT_FROM = time(23, 0)
NOON = 12 * 60

# Global settings that phase times and sources come from (an automation may have its
# own phase times).
PHASE_SETTINGS = ("night_from", "shifts")
SOURCES = ("weather", "season", "light_sensor")


@dataclass(frozen=True, slots=True)
class Inputs:
    """The world right now."""

    now: datetime  # local time
    sunrise: datetime | None  # today's, local
    sunset: datetime | None
    elevation: float
    season_state: str | None = None
    condition: str | None = None
    cloud: float | None = None
    lux: float | None = None
    mood: str | None = None


@dataclass(frozen=True, slots=True)
class Selection:
    """What the area should show."""

    phase: str
    # The phase whose scenes, offset and brightness are used (see module docstring).
    pool_phase: str
    season: str
    weather: str
    # The mood the pool came from (None: the day decided).
    mood: str | None
    scene: str | None
    pool: tuple[str, ...]
    brightness: int
    light_day: date
    # Natural light: the white to show (no scene).
    kelvin: int | None = None


def _minutes(moment: datetime | None, fallback: int) -> int:
    return moment.hour * 60 + moment.minute if moment else fallback


def phase_of(settings: Mapping[str, Any], inputs: Inputs) -> str:
    """The phase of the day."""
    shifts = {**DEFAULT_SHIFTS, **(settings.get("shifts") or {})}
    night_from = parse_time(settings.get("night_from")) or DEFAULT_NIGHT_FROM
    hm = inputs.now.hour * 60 + inputs.now.minute
    nfm = night_from.hour * 60 + night_from.minute
    rise = _minutes(inputs.sunrise, 6 * 60)
    sunset = _minutes(inputs.sunset, 18 * 60)
    night = (hm >= nfm or hm < NOON) if nfm >= NOON else (nfm <= hm < NOON)
    night = night and not (hm < NOON and hm >= rise + shifts["morning"])
    if night:
        return "night"
    if hm < rise + shifts["day"] and hm < NOON:
        return "morning"
    if hm < sunset - shifts["golden"]:
        return "day"
    if hm < sunset + shifts["evening"]:
        return "golden"
    return "evening"


def season_of(inputs: Inputs, day: date) -> str:
    """The season: from the season entity when it reports one, else the month."""
    if inputs.season_state in SEASONS:
        return inputs.season_state
    return MONTH_SEASONS.get(day.month, "autumn")


def weather_of(inputs: Inputs) -> str:
    """Clear or gloomy weather."""
    cloud = DEFAULT_CLOUD if inputs.cloud is None else inputs.cloud
    if inputs.condition in GLOOMY_CONDITIONS or cloud >= GLOOMY_CLOUD:
        return "gloomy"
    return "clear"


def light_day(phase: str, now: datetime) -> date:
    """The day a scene belongs to: after midnight, the night is still yesterday's."""
    if phase == "night" and now.hour * 60 + now.minute < NOON:
        return (now - timedelta(days=1)).date()
    return now.date()


# ---- scene tags ----


def clean_tags(tags: Mapping[str, Any] | None) -> dict[str, list[str]]:
    """Tags with known values only, in a fixed order, without empty lists."""
    clean: dict[str, list[str]] = {}
    for key, values in TAGS.items():
        given = set((tags or {}).get(key) or ())
        if picked := [v for v in values if v in given]:
            clean[key] = picked
    return clean


def global_tags(
    defaults: Mapping[str, Mapping[str, Any]],
    user: Mapping[str, Mapping[str, Any]],
    use_defaults: bool = True,
) -> dict[str, dict[str, list[str]]]:
    """Tags of every scene in the pool: the user's, else the ready-made ones.

    A scene the user gave empty tags is out of the pool; with `use_defaults` off,
    only scenes the user tagged are in it.
    """
    merged: dict[str, dict[str, list[str]]] = {}
    for scene in [*(defaults if use_defaults else ()), *user]:
        tags = clean_tags(user[scene] if scene in user else defaults[scene])
        if tags:
            merged[scene] = tags
        else:
            merged.pop(scene, None)
    return merged


def _fits(tags: Mapping[str, list[str]], key: str, value: str) -> bool:
    return not tags.get(key) or value in tags[key]


def _narrow(
    pool: list[str],
    tags: Mapping[str, Mapping[str, list[str]]],
    narrowing: Iterable[tuple[str, str]],
) -> list[str]:
    """The pool narrowed step by step, skipping steps that would leave nothing."""
    for key, value in narrowing:
        if narrowed := [s for s in pool if _fits(tags[s], key, value)]:
            pool = narrowed
    return pool


def pool_of(
    tags: Mapping[str, Mapping[str, list[str]]],
    phase: str,
    season: str,
    weather: str,
    mood: str | None,
) -> tuple[list[str], str, str | None]:
    """The pool now, the phase it belongs to and the mood it came from."""
    if mood and (pool := [s for s, t in tags.items() if mood in t.get("moods", ())]):
        narrowing = (("seasons", season), ("phases", phase), ("weather", weather))
        return _narrow(pool, tags, narrowing), phase, mood
    index = PHASES.index(phase)
    for back in range(len(PHASES)):
        candidate = PHASES[(index - back) % len(PHASES)]
        if pool := [s for s, t in tags.items() if candidate in t.get("phases", ())]:
            narrowing = (("seasons", season), ("weather", weather))
            return _narrow(pool, tags, narrowing), candidate, None
    return [], phase, None


def tags_from_pools(
    pools: Mapping[str, Any], holidays: Iterable[Mapping[str, Any]] = ()
) -> dict[str, dict[str, list[str]]]:
    """Tags that put the scenes of old pools (pools[phase][season | "all"][weather],
    four lists for the day) where they were; holiday scenes get the festive mood."""
    found: dict[str, dict[str, set[str]]] = {}

    def add(scene: str, key: str, values: Iterable[str]) -> None:
        found.setdefault(scene, {k: set() for k in TAGS})[key].update(values)

    for phase, by_season in (pools or {}).items():
        if phase not in PHASES or not isinstance(by_season, Mapping):
            continue
        own_seasons = {s for s in by_season if s in SEASONS}
        for season, by_weather in by_season.items():
            if not isinstance(by_weather, Mapping):
                continue
            # "all" stands in for the seasons without a list of their own; "clear"
            # for gloomy weather when there is no gloomy list.
            seasons = [season] if season in SEASONS else set(SEASONS) - own_seasons
            for weather, scenes in by_weather.items():
                if weather not in WEATHER:
                    continue
                kinds = (
                    [weather]
                    if weather == "gloomy" or "gloomy" in by_weather
                    else WEATHER
                )
                # The day phase had a list per sun step; anything else is one list.
                flat: list[Any] = []
                for item in scenes if isinstance(scenes, list) else ():
                    flat.extend(item if isinstance(item, list) else [item])
                for scene in (s for s in flat if isinstance(s, str)):
                    add(scene, "phases", [phase])
                    add(scene, "seasons", seasons)
                    add(scene, "weather", kinds)
    for holiday in holidays or ():
        for scene in holiday.get("pool") or ():
            add(scene, "moods", ["festive"])
    tags: dict[str, dict[str, list[str]]] = {}
    for scene, values in found.items():
        # Every season or weather is the same as none (any); phases stay, a scene
        # without them shows only for a mood.
        tags[scene] = clean_tags(
            {k: v for k, v in values.items() if k == "phases" or set(v) != set(TAGS[k])}
        )
    return tags


def is_legacy(local: Mapping[str, Any]) -> bool:
    """Whether an automation's settings still have pools of their own (before 0.10)."""
    return bool(local.get("pools") or local.get("holidays"))


def resolve(
    global_settings: Mapping[str, Any],
    local: Mapping[str, Any],
    defaults: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    """The settings `select` works with: global ones plus an automation's own.

    The automation's phase times win when it has them; its extra scenes (`include`)
    join its pool with their tags (all phases when they have none), skipped ones
    (`exclude`) leave it. Old settings with pools of their own use only those.
    """
    local_settings = dict(local.get("settings") or {})
    settings: dict[str, Any] = {
        key: global_settings[key]
        for key in (*PHASE_SETTINGS, *SOURCES)
        if global_settings.get(key) is not None
    }
    settings |= {k: v for k, v in local_settings.items() if v is not None}
    if is_legacy(local):
        tags = tags_from_pools(local.get("pools") or {}, local.get("holidays") or ())
    else:
        tags = global_tags(
            defaults,
            global_settings.get("tags") or {},
            global_settings.get("defaults", True),
        )
        user = global_settings.get("tags") or {}
        for scene in local.get("include") or ():
            if scene in tags:
                continue
            own = clean_tags(user.get(scene) or defaults.get(scene))
            tags[scene] = own if own.get("phases") else {**own, "phases": list(PHASES)}
    for scene in [*(local.get("exclude") or ()), *(local.get("excluded") or ())]:
        tags.pop(scene, None)
    return {
        "tags": tags,
        "offsets": dict(local.get("offsets") or {}),
        "settings": settings,
    }


# ---- brightness and the selection ----


def _brightness(
    config: dict[str, Any], phase: str, weather: str, inputs: Inputs
) -> int:
    fixed = ((config.get("settings") or {}).get("brightness") or {}).get(phase)
    e = inputs.elevation
    if fixed is not None:
        value = float(fixed)
    elif phase == "day":
        if inputs.lux is not None:
            value = 100 - 0.35 * inputs.lux
        else:
            cloud = DEFAULT_CLOUD if inputs.cloud is None else inputs.cloud
            value = 75 + 0.25 * cloud
        value = min(max(value, 60), 100)
    elif phase == "morning":
        value = min(max(40 + (e + 6) / 12 * 30, 40), 70)
        value += 10 if weather == "gloomy" else 0
    elif phase == "golden":
        value = 80 if weather == "gloomy" else 75
    elif phase == "evening":
        value = min(max(70 + (e + 1) * 25 / 17, 45), 70)
    else:
        value = 30
    value += (config.get("offsets") or {}).get(phase, 0)
    # Half up, like the templates (Python's round() rounds half to even).
    return min(max(math.floor(value + 0.5), 1), 100)


def select(config: dict[str, Any], inputs: Inputs) -> Selection:
    """What lights with these settings (see `resolve`) should show now."""
    settings = config.get("settings") or {}
    phase = phase_of(settings, inputs)
    day = light_day(phase, inputs.now)
    season = season_of(inputs, day)
    weather = weather_of(inputs)

    if settings.get("style") == STYLE_NATURAL:
        kelvin = {**NATURAL_KELVIN, **(settings.get("kelvin") or {})}[phase]
        return Selection(
            phase=phase,
            pool_phase=phase,
            season=season,
            weather=weather,
            mood=None,
            scene=None,
            pool=(),
            brightness=_brightness(config, phase, weather, inputs),
            light_day=day,
            kelvin=min(max(int(kelvin), KELVIN_MIN), KELVIN_MAX),
        )

    pool, pool_phase, mood = pool_of(
        config.get("tags") or {}, phase, season, weather, inputs.mood
    )
    number = day.year * 366 + day.timetuple().tm_yday
    scene = pool[number % len(pool)] if pool else None

    return Selection(
        phase=phase,
        pool_phase=pool_phase,
        season=season,
        weather=weather,
        mood=mood,
        scene=scene,
        pool=tuple(pool),
        brightness=_brightness(config, pool_phase, weather, inputs),
        light_day=day,
    )


def parse_time(value: Any) -> time | None:
    """ "HH:MM" (or a time) -> time; anything else -> None."""
    if isinstance(value, time):
        return value
    try:
        hours, minutes = str(value).split(":")[:2]
        return time(int(hours), int(minutes))
    except TypeError, ValueError:
        return None


# A light state that differs from the one before by more than these is a change of
# its own; less is the bridge settling (a color sent a few seconds late, rounding).
TOLERANCE_BRIGHTNESS = 3  # of 255
TOLERANCE_XY = 0.02
TOLERANCE_KELVIN = 100


def is_real_change(old: dict[str, Any], new: dict[str, Any]) -> bool:
    """Whether a light changed by more than the bridge's own corrections.

    `old`/`new`: {"state": "on" | "off", **attributes}.
    """
    if old.get("state") != new.get("state"):
        return True
    if new.get("state") != "on":
        return False
    if abs(int(new.get("brightness") or 0) - int(old.get("brightness") or 0)) > (
        TOLERANCE_BRIGHTNESS
    ):
        return True
    a = old.get("xy_color") or (0, 0)
    b = new.get("xy_color") or (0, 0)
    if math.dist(a, b) > TOLERANCE_XY:
        return True
    if old.get("color_mode") != new.get("color_mode"):
        return True
    kelvin = abs(
        int(old.get("color_temp_kelvin") or 0) - int(new.get("color_temp_kelvin") or 0)
    )
    return kelvin > TOLERANCE_KELVIN
