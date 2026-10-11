"""Tests for the auto light selection (pure)."""

from datetime import date, datetime

import pytest

from custom_components.hue_studio.auto_select import (
    Inputs,
    is_real_change,
    phase_of,
    select,
)

SUNRISE = datetime(2026, 3, 10, 6, 30)
SUNSET = datetime(2026, 3, 10, 18, 0)


def _inputs(hour: int, minute: int = 0, **kwargs: object) -> Inputs:
    values: dict[str, object] = {
        "now": datetime(2026, 3, 10, hour, minute),
        "sunrise": SUNRISE,
        "sunset": SUNSET,
        "elevation": 20.0,
    }
    values.update(kwargs)
    return Inputs(**values)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("hour", "minute", "phase"),
    [
        (0, 30, "night"),
        (6, 29, "night"),
        (6, 30, "morning"),  # sunrise + 0
        (7, 19, "morning"),
        (7, 20, "day"),  # sunrise + 50
        (17, 9, "day"),
        (17, 10, "golden"),  # sunset - 50
        (18, 0, "evening"),  # sunset + 0
        (22, 59, "evening"),
        (23, 0, "night"),
    ],
)
def test_phases(hour: int, minute: int, phase: str) -> None:
    """Phase boundaries come from the sun plus shifts, night from a time."""
    assert phase_of({}, _inputs(hour, minute)) == phase


def test_phase_settings() -> None:
    """Night start and shifts are settings."""
    settings = {"night_from": "21:30", "shifts": {"day": 0, "evening": 30}}
    assert phase_of(settings, _inputs(21, 29)) == "evening"
    assert phase_of(settings, _inputs(21, 30)) == "night"
    assert phase_of(settings, _inputs(6, 31)) == "day"
    assert phase_of(settings, _inputs(18, 20)) == "golden"


CONFIG = {
    "pools": {
        "day": {"all": {"clear": [["d0"], ["d1"], ["d2a", "d2b"], ["d3"]]}},
        "golden": {"all": {"clear": ["gold"]}},
        "evening": {"winter": {"clear": ["w1"]}, "all": {"clear": ["e1", "e2", "e3"]}},
        "night": {"all": {"clear": ["n1"], "gloomy": ["g1"]}},
    },
    "holidays": [
        {"from": "12-20", "to": "01-06", "phases": ["evening"], "pool": ["xmas"]}
    ],
    "excluded": ["e2"],
    "offsets": {"evening": 10},
}


def test_day_steps_and_weather() -> None:
    """The day pool is picked by sun elevation; gloomy weather is a step brighter."""
    assert select(CONFIG, _inputs(12, elevation=5)).pool == ("d1",)
    sel = select(CONFIG, _inputs(12, elevation=20, condition="rainy"))
    assert (sel.mood, sel.step, sel.pool) == ("gloomy", 3, ("d3",))
    assert select(CONFIG, _inputs(12, elevation=20, cloud=85)).pool == ("d3",)
    sel = select(CONFIG, _inputs(12, elevation=20, cloud=10))
    assert sel.scene in ("d2a", "d2b")


def test_season_holiday_exclusions() -> None:
    """A season pool wins over "all"; a holiday replaces the pool; excluded skipped."""
    march = select(CONFIG, _inputs(20))
    assert march.season == "spring"
    assert march.pool == ("e1", "e3")
    winter = select(CONFIG, _inputs(20, season_state="winter"))
    assert winter.pool == ("w1",)
    xmas = Inputs(
        now=datetime(2026, 12, 24, 20, 0),
        sunrise=SUNRISE,
        sunset=datetime(2026, 12, 24, 15, 40),
        elevation=-20,
    )
    sel = select(CONFIG, xmas)
    assert (sel.holiday, sel.scene, sel.season) == (True, "xmas", "winter")


def test_fallback_to_earlier_phase() -> None:
    """A phase without a pool behaves like the phase before it (pool, brightness)."""
    sel = select(CONFIG, _inputs(7, elevation=2))
    assert (sel.phase, sel.pool_phase, sel.pool) == ("morning", "night", ("n1",))
    garland = {"pools": {"evening": {"all": {"clear": ["g"]}}}}
    sel = select(garland, _inputs(23, 30))
    assert (sel.phase, sel.pool_phase, sel.scene) == ("night", "evening", "g")


def test_scene_of_the_day_and_next() -> None:
    """The pool is cycled by day; "next scene" counts on that day and pool phase."""
    first = select(CONFIG, _inputs(20)).scene
    skip = {"date": "2026-03-10", "phase": "evening", "n": 1}
    second = select(CONFIG, _inputs(20), skip).scene
    assert {first, second} == {"e1", "e3"}
    assert select(CONFIG, _inputs(20), {**skip, "phase": "day"}).scene == first
    assert select(CONFIG, _inputs(20), {**skip, "date": "2026-03-09"}).scene == first


def test_light_day_after_midnight() -> None:
    """The night after midnight belongs to the day before (no change at 00:00)."""
    before = select(CONFIG, Inputs(datetime(2026, 3, 10, 23, 30), SUNRISE, SUNSET, -30))
    after = select(CONFIG, Inputs(datetime(2026, 3, 11, 0, 30), SUNRISE, SUNSET, -30))
    assert before.light_day == after.light_day == date(2026, 3, 10)


@pytest.mark.parametrize(
    ("inputs", "brightness"),
    [
        (_inputs(12, lux=0), 100),
        (_inputs(12, lux=100), 65),
        (_inputs(12, lux=1000), 60),
        (_inputs(12), 88),  # no light sensor: 75 + 0.25 * 50 (default cloud)
        (_inputs(7, elevation=0), 30),  # morning uses the night pool: night = 30
        (_inputs(17, 30), 75),  # golden
        (_inputs(17, 30, condition="fog"), 80),
        (_inputs(20, elevation=-1), 80),  # evening 70 + offset 10
        (_inputs(20, elevation=-18), 55),  # evening 45 + 10
        (_inputs(23, 30), 30),
    ],
)
def test_brightness(inputs: Inputs, brightness: int) -> None:
    """The brightness curve of the legacy templates, plus offsets."""
    assert select(CONFIG, inputs).brightness == brightness


def test_fixed_brightness_and_morning_curve() -> None:
    """A fixed brightness per phase replaces the curve; the morning follows the sun."""
    config = {**CONFIG, "settings": {"brightness": {"evening": 80}}}
    assert select(config, _inputs(20)).brightness == 90  # 80 + offset 10
    morning = {"pools": {"morning": {"all": {"clear": ["m"]}}}}
    assert select(morning, _inputs(7, elevation=0)).brightness == 55
    assert select(morning, _inputs(7, elevation=0, condition="snowy")).brightness == 65


def test_real_changes() -> None:
    """On/off and visible changes count; the bridge's small corrections do not."""
    on = {"state": "on", "brightness": 128, "xy_color": (0.5, 0.4), "color_mode": "xy"}
    assert not is_real_change(on, {**on, "brightness": 130, "xy_color": (0.51, 0.4)})
    assert is_real_change(on, {**on, "brightness": 140})
    assert is_real_change(on, {**on, "xy_color": (0.3, 0.3)})
    assert is_real_change(on, {**on, "color_mode": "color_temp"})
    assert is_real_change(on, {"state": "off"})
    assert not is_real_change({"state": "off"}, {"state": "off", "brightness": 1})


def test_natural_light() -> None:
    """Natural light: no scenes, a white per phase (overridable), usual brightness."""
    natural = {"settings": {"style": "natural", "kelvin": {"evening": 2400}}}
    day = select(natural, _inputs(12))
    assert (day.scene, day.pool, day.kelvin, day.pool_phase) == (None, (), 4300, "day")
    assert day.brightness == select({}, _inputs(12)).brightness
    assert select(natural, _inputs(20)).kelvin == 2400
    assert select(natural, _inputs(0, 30)).kelvin == 2000
    assert select(CONFIG, _inputs(12)).kelvin is None
