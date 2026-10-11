"""Auto light: what an area should show now (pure, no Home Assistant).

Phase of the day from the sun, a scene pool by phase, season, weather and holidays,
the scene of the day from it, and a brightness. The rules are those of the legacy
templates this replaces, generalized:

- Phases: night from a set time until sunrise + a shift; morning until sunrise + a
  shift; day until sunset - a shift; golden until sunset + a shift; then evening.
- Season: an entity whose state is winter/spring/summer/autumn, else the month
  (meteorological seasons).
- Mood: "gloomy" for fog, rain, snow, storms or overcast (or cloud cover from 80 %).
- Pools: pools[phase][season | "all"][mood | "clear"]; the day phase has four pools,
  one per brightness step (sun elevation < 0, < 12, < 25, above; gloomy weather is a
  step brighter). A holiday covering the date replaces the pool. Excluded scenes are
  skipped unless nothing else is left. A phase without a pool behaves like the phase
  before it: its pool, brightness and offset (an evening garland keeps its evening
  scenes and brightness at night).
- Scene of the day: the pool cycled by the day number (+ "next scene" presses); the
  light day starts with the morning, so the scene does not change at midnight.
- Brightness: fixed per phase, or the curve (day: the darker outside, the brighter;
  morning and evening follow the sun), plus the personal offset of the phase.
- Natural light (style "natural", the Hue app's Natural light): no scenes, a white of
  its own per phase instead — cool in the morning and during the day, warm towards the
  evening and at night — with the same brightness rules.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
import math
from typing import Any

PHASES = ("morning", "day", "golden", "evening", "night")
SEASONS = ("winter", "spring", "summer", "autumn")
MOODS = ("clear", "gloomy")
DAY_STEPS = 4
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


@dataclass(frozen=True, slots=True)
class Selection:
    """What the area should show."""

    phase: str
    # The phase whose pool, offset and brightness are used (see module docstring).
    pool_phase: str
    season: str
    mood: str
    holiday: bool
    scene: str | None
    pool: tuple[str, ...]
    brightness: int
    light_day: date
    step: int | None = None
    # Natural light: the white to show (no scene).
    kelvin: int | None = None


def _minutes(moment: datetime | None, fallback: int) -> int:
    return moment.hour * 60 + moment.minute if moment else fallback


def phase_of(settings: dict[str, Any], inputs: Inputs) -> str:
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


def mood_of(inputs: Inputs) -> str:
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


def _step(elevation: float, mood: str) -> int:
    step = 0 if elevation < 0 else 1 if elevation < 12 else 2 if elevation < 25 else 3
    if mood == "gloomy" and elevation >= 0:
        step = min(step + 1, DAY_STEPS - 1)
    return step


def _in_holiday(holiday: dict[str, Any], phase: str, md: str) -> bool:
    if phase not in (holiday.get("phases") or []):
        return False
    start, end = holiday["from"], holiday["to"]
    return start <= md <= end if start <= end else (md >= start or md <= end)


def _pool(
    config: dict[str, Any], phase: str, season: str, mood: str, step: int, md: str
) -> tuple[list[str], bool]:
    """The raw pool of a phase (and whether a holiday supplied it)."""
    by_phase = (config.get("pools") or {}).get(phase) or {}
    by_season = by_phase.get(season) or by_phase.get("all") or {}
    raw = by_season.get(mood) or by_season.get("clear") or []
    if phase == "day":
        raw = raw[min(step, len(raw) - 1)] if raw else []
    pool, holiday = list(raw), False
    for entry in config.get("holidays") or []:
        if _in_holiday(entry, phase, md):
            pool, holiday = list(entry.get("pool") or []), True
    return pool, holiday


def _brightness(config: dict[str, Any], phase: str, mood: str, inputs: Inputs) -> int:
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
        value += 10 if mood == "gloomy" else 0
    elif phase == "golden":
        value = 80 if mood == "gloomy" else 75
    elif phase == "evening":
        value = min(max(70 + (e + 1) * 25 / 17, 45), 70)
    else:
        value = 30
    value += (config.get("offsets") or {}).get(phase, 0)
    # Half up, like the templates (Python's round() rounds half to even).
    return min(max(math.floor(value + 0.5), 1), 100)


def select(
    config: dict[str, Any], inputs: Inputs, skip: dict[str, Any] | None = None
) -> Selection:
    """What an area with these auto light settings should show now.

    `skip` is {"date": "YYYY-MM-DD", "phase": pool phase, "n": presses of "next
    scene"}; it counts only on that light day and in that pool phase.
    """
    settings = config.get("settings") or {}
    phase = phase_of(settings, inputs)
    day = light_day(phase, inputs.now)
    season = season_of(inputs, day)
    mood = mood_of(inputs)
    step = _step(inputs.elevation, mood)
    md = day.strftime("%m-%d")

    if settings.get("style") == STYLE_NATURAL:
        kelvin = {**NATURAL_KELVIN, **(settings.get("kelvin") or {})}[phase]
        return Selection(
            phase=phase,
            pool_phase=phase,
            season=season,
            mood=mood,
            holiday=False,
            scene=None,
            pool=(),
            brightness=_brightness(config, phase, mood, inputs),
            light_day=day,
            kelvin=min(max(int(kelvin), KELVIN_MIN), KELVIN_MAX),
        )

    pool: list[str] = []
    holiday = False
    pool_phase = phase
    index = PHASES.index(phase)
    for back in range(len(PHASES)):
        candidate = PHASES[(index - back) % len(PHASES)]
        pool, holiday = _pool(config, candidate, season, mood, step, md)
        if pool:
            pool_phase = candidate
            break
    excluded = set(config.get("excluded") or [])
    pool = [s for s in pool if s not in excluded] or pool

    presses = 0
    if skip and skip.get("date") == day.isoformat() and skip.get("phase") == pool_phase:
        presses = int(skip.get("n") or 0)
    number = day.year * 366 + day.timetuple().tm_yday
    scene = pool[(number + presses) % len(pool)] if pool else None

    return Selection(
        phase=phase,
        pool_phase=pool_phase,
        season=season,
        mood=mood,
        holiday=holiday,
        scene=scene,
        pool=tuple(pool),
        brightness=_brightness(config, pool_phase, mood, inputs),
        light_day=day,
        step=step if pool_phase == "day" else None,
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
