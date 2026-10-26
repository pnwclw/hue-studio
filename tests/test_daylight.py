"""Tests for the light of the day (pure)."""

from datetime import date, datetime

import pytest

from custom_components.hue_studio.automations.daylight import (
    PHASES,
    Inputs,
    global_tags,
    is_legacy,
    is_real_change,
    phase_of,
    resolve,
    select,
    tags_from_pools,
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


TAGS = {
    "m1": {"phases": ["morning"]},
    "d1": {"phases": ["day"], "weather": ["clear"]},
    "d2": {"phases": ["day"], "weather": ["gloomy"]},
    "d3": {"phases": ["day"], "seasons": ["summer"]},
    "g1": {"phases": ["golden"]},
    "e1": {"phases": ["evening"]},
    "e2": {"phases": ["evening"], "moods": ["cozy"]},
    "e3": {"phases": ["evening"], "seasons": ["winter"]},
    "n1": {"phases": ["night"]},
    "party": {"moods": ["party"]},
    "party_winter": {"moods": ["party"], "seasons": ["winter"]},
}
CONFIG = {"tags": TAGS, "offsets": {"evening": 10}}


def test_pool_by_phase_season_weather() -> None:
    """The phase's scenes, narrowed to the season and weather while any are left."""
    sel = select(CONFIG, _inputs(12, cloud=10))
    assert (sel.weather, sel.pool) == ("clear", ("d1",))
    assert select(CONFIG, _inputs(12, condition="rainy")).pool == ("d2",)
    # Narrowing to the season would leave nothing for the day in March: skipped.
    assert select(CONFIG, _inputs(12, cloud=85)).pool == ("d2",)
    march = select(CONFIG, _inputs(20))
    assert (march.season, march.pool, march.mood) == ("spring", ("e1", "e2"), None)
    winter = select(CONFIG, _inputs(20, season_state="winter"))
    assert winter.pool == ("e1", "e2", "e3")
    # Scenes of moods only never show by the day.
    assert "party" not in winter.pool


def test_mood() -> None:
    """A mood takes its scenes, narrowed to season, phase and weather if possible."""
    sel = select(CONFIG, _inputs(20, mood="party"))
    assert (sel.mood, sel.pool_phase) == ("party", "evening")
    sel = select(CONFIG, _inputs(20, mood="party", season_state="summer"))
    assert sel.pool == ("party",)
    sel = select(CONFIG, _inputs(20, mood="party", season_state="winter"))
    assert sel.pool == ("party", "party_winter")
    assert select(CONFIG, _inputs(20, mood="cozy")).pool == ("e2",)
    # A mood without scenes: the day decides.
    sel = select(CONFIG, _inputs(20, mood="festive"))
    assert (sel.mood, sel.pool) == (None, ("e1", "e2"))


def test_fallback_to_earlier_phase() -> None:
    """A phase without scenes behaves like the phase before it (pool, brightness)."""
    config = {"tags": {"n1": {"phases": ["night"]}, "e": {"phases": ["evening"]}}}
    sel = select(config, _inputs(7, elevation=2))
    assert (sel.phase, sel.pool_phase, sel.pool) == ("morning", "night", ("n1",))
    garland = {"tags": {"g": {"phases": ["evening"]}}}
    sel = select(garland, _inputs(23, 30))
    assert (sel.phase, sel.pool_phase, sel.scene) == ("night", "evening", "g")


def test_scene_of_the_day() -> None:
    """The pool is cycled by day."""
    today = select(CONFIG, _inputs(20)).scene
    tomorrow = select(
        CONFIG, Inputs(datetime(2026, 3, 11, 20), SUNRISE, SUNSET, 20.0)
    ).scene
    assert {today, tomorrow} == {"e1", "e2"}


def test_global_tags() -> None:
    """The user's tags replace the ready-made ones; empty ones take a scene out."""
    defaults = {"a": {"phases": ["day"]}, "b": {"phases": ["night"]}}
    user = {"b": {}, "c": {"moods": ["party", "nonsense"]}}
    assert global_tags(defaults, user) == {
        "a": {"phases": ["day"]},
        "c": {"moods": ["party"]},
    }
    assert global_tags(defaults, user, use_defaults=False) == {
        "c": {"moods": ["party"]}
    }


def test_resolve() -> None:
    """Global settings plus an automation's own: phase times, extra and skipped."""
    defaults = {"a": {"phases": ["day"]}, "b": {"moods": ["party"]}, "x": {}}
    glob = {"night_from": "22:00", "weather": "weather.home", "tags": {"a": {}}}
    local = {
        "include": ["a", "b", "z"],
        "exclude": ["b"],
        "settings": {"shifts": {"day": 10}, "brightness": {"day": 50}},
    }
    config = resolve(glob, local, defaults)
    assert config["settings"] == {
        "night_from": "22:00",
        "weather": "weather.home",
        "shifts": {"day": 10},
        "brightness": {"day": 50},
    }
    # "a" was taken out globally: this automation adds it back with its ready-made
    # tags; "z" has none, so it fits every phase.
    assert config["tags"] == {"a": {"phases": ["day"]}, "z": {"phases": list(PHASES)}}
    own = resolve(glob, {"settings": {"night_from": "21:00"}}, defaults)
    assert own["settings"]["night_from"] == "21:00"


def test_legacy_pools() -> None:
    """Pools of an automation before 0.10 become tags putting scenes where they were."""
    pools = {
        "day": {"all": {"clear": [["d0"], ["d1"], [], ["d0"]]}},
        "evening": {
            "winter": {"clear": ["w1"]},
            "all": {"clear": ["e1"], "gloomy": ["g1"]},
        },
    }
    holidays = [{"from": "12-20", "to": "01-06", "phases": ["evening"], "pool": ["x"]}]
    tags = tags_from_pools(pools, holidays)
    assert tags == {
        "d0": {"phases": ["day"]},
        "d1": {"phases": ["day"]},
        "w1": {"phases": ["evening"], "seasons": ["winter"]},
        "e1": {
            "phases": ["evening"],
            "seasons": ["spring", "summer", "autumn"],
            "weather": ["clear"],
        },
        "g1": {
            "phases": ["evening"],
            "seasons": ["spring", "summer", "autumn"],
            "weather": ["gloomy"],
        },
        "x": {"moods": ["festive"]},
    }
    old = {"pools": pools, "excluded": ["d1"]}
    assert is_legacy(old)
    config = resolve({"tags": {"other": {"phases": ["day"]}}}, old, {})
    assert set(config["tags"]) == {"d0", "w1", "e1", "g1"}


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
        (_inputs(7, elevation=0), 30),  # morning has no scenes: the night's 30
        (_inputs(17, 30), 75),  # golden
        (_inputs(17, 30, condition="fog"), 80),
        (_inputs(20, elevation=-1), 80),  # evening 70 + offset 10
        (_inputs(20, elevation=-18), 55),  # evening 45 + 10
        (_inputs(23, 30), 30),
    ],
)
def test_brightness(inputs: Inputs, brightness: int) -> None:
    """The brightness curve of the legacy templates, plus offsets."""
    config = {**CONFIG, "tags": {k: v for k, v in TAGS.items() if k != "m1"}}
    assert select(config, inputs).brightness == brightness


def test_fixed_brightness_and_morning_curve() -> None:
    """A fixed brightness per phase replaces the curve; the morning follows the sun."""
    config = {**CONFIG, "settings": {"brightness": {"evening": 80}}}
    assert select(config, _inputs(20)).brightness == 90  # 80 + offset 10
    morning = {"tags": {"m": {"phases": ["morning"]}}}
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
