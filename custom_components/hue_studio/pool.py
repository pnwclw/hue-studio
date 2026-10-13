"""The global light of the day: scene pool, phase times, sources and mood.

What natural light and the scene of the day of every automation start from (see
daylight.py for the rules). Kept in the Hue Studio entry's options (`daylight`),
changed from the panel:

- sources: a weather entity (else the first one HA has), a season entity (else the
  Season integration's, else the month) and an optional light sensor;
- phase times: when night starts and the shifts of the other phases;
- scene tags: Hue Studio's ready-made tags of the gallery (scene_tags.json, on unless
  `defaults` is off) and the user's own tags of single scenes, which replace them (an
  empty one takes a scene out of the pool).

The mood is not a setting but a state: the "Mood" select of the Hue Studio entry
(restored after a restart); the "Phase of the day" sensor shows the phase, season and
weather everybody works with. Both change living lights at once (automations.py).
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta
import json
from pathlib import Path
from typing import Any

from astral import sun as astral_sun
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import (
    async_dispatcher_connect,
    async_dispatcher_send,
)
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.sun import get_astral_event_date, get_astral_observer
from homeassistant.util import dt as dt_util
from homeassistant.util.hass_dict import HassKey
import voluptuous as vol

from . import daylight
from .connections import SETTINGS_URL
from .const import CONF_DAYLIGHT, DOMAIN, SIGNAL_CONFIG_UPDATED
from .gallery import async_gallery_scenes
from .options import async_options, async_update_options

TAGS_FILE = Path(__file__).parent / "scene_tags.json"
# The mood changed (the select); options changes come with SIGNAL_CONFIG_UPDATED.
SIGNAL_MOOD_UPDATED = f"{DOMAIN}_mood_updated"
MOOD_AUTO = "auto"
# The device of the entry's own entities (phase, mood).
DEVICE_ID = "light_of_the_day"
MOOD_UNIQUE_ID = "light_of_the_day_mood"
PHASE_UNIQUE_ID = "light_of_the_day_phase"
# How often the light of the day is worked out again.
TICK = timedelta(minutes=1)
MAX_SHIFT = 240
SEASON_PLATFORM = "season"
WEATHER_DOMAIN = "weather"

SHIFTS = vol.Schema(
    {
        vol.In(tuple(daylight.DEFAULT_SHIFTS)): vol.All(
            vol.Coerce(int), vol.Range(min=-MAX_SHIFT, max=MAX_SHIFT)
        )
    }
)
TAGS = vol.Schema(
    {vol.Optional(key): [vol.In(values)] for key, values in daylight.TAGS.items()},
    extra=vol.REMOVE_EXTRA,
)
# What the panel may change (None: back to the default).
SETTINGS = {
    vol.Optional("weather"): vol.Any(None, cv.entity_id),
    vol.Optional("season"): vol.Any(None, cv.entity_id),
    vol.Optional("light_sensor"): vol.Any(None, cv.entity_id),
    vol.Optional("night_from"): vol.Any(None, cv.matches_regex(r"^\d\d:\d\d$")),
    vol.Optional("shifts"): vol.Any(None, SHIFTS),
    vol.Optional("defaults"): bool,
}

_DEFAULT_TAGS: HassKey[dict[str, dict[str, list[str]]]] = HassKey(
    f"{DOMAIN}_default_tags"
)
_MOOD: HassKey[dict[str, str | None]] = HassKey(f"{DOMAIN}_mood")


def device_info() -> DeviceInfo:
    """The service device that holds the phase sensor and the mood select."""
    return DeviceInfo(
        identifiers={(DOMAIN, DEVICE_ID)},
        name="Hue Studio",
        manufacturer="Hue Studio",
        entry_type=DeviceEntryType.SERVICE,
        configuration_url=SETTINGS_URL,
    )


async def async_default_tags(hass: HomeAssistant) -> dict[str, dict[str, list[str]]]:
    """Hue Studio's ready-made tags of the gallery scenes, loading the file once."""
    if (tags := hass.data.get(_DEFAULT_TAGS)) is None:
        raw = await hass.async_add_executor_job(_load_tags)
        tags = hass.data[_DEFAULT_TAGS] = {
            scene: daylight.clean_tags(value) for scene, value in raw.items()
        }
    return tags


def _load_tags() -> dict[str, Any]:
    return json.loads(TAGS_FILE.read_text(encoding="utf-8"))["scenes"]


@callback
def async_settings(hass: HomeAssistant) -> dict[str, Any]:
    """The global settings (empty before Hue Studio is added)."""
    return dict(async_options(hass).get(CONF_DAYLIGHT) or {})


@callback
def async_mood(hass: HomeAssistant) -> str | None:
    """The mood now (None: the day decides)."""
    return hass.data.setdefault(_MOOD, {"mood": None})["mood"]


@callback
def async_set_mood(hass: HomeAssistant, mood: str | None) -> None:
    """Set the mood (the select does it); living lights follow at once."""
    mood = mood if mood in daylight.MOODS else None
    state = hass.data.setdefault(_MOOD, {"mood": None})
    if state["mood"] == mood:
        return
    state["mood"] = mood
    async_dispatcher_send(hass, SIGNAL_MOOD_UPDATED)


@callback
def async_sources(hass: HomeAssistant, settings: dict[str, Any]) -> dict[str, Any]:
    """The entities the light of the day reads: the chosen ones, else found ones."""
    weather = settings.get("weather")
    if not weather:
        weather = next(iter(sorted(hass.states.async_entity_ids(WEATHER_DOMAIN))), None)
    season = settings.get("season") or season_entity(hass)
    return {
        "weather": weather,
        "season": season,
        "light_sensor": settings.get("light_sensor") or None,
    }


@callback
def season_entity(hass: HomeAssistant) -> str | None:
    """A sensor of HA's Season integration that reports a season, if there is one."""
    for entry in er.async_get(hass).entities.values():
        if entry.platform != SEASON_PLATFORM:
            continue
        state = hass.states.get(entry.entity_id)
        if state is not None and state.state in daylight.SEASONS:
            return entry.entity_id
    return None


def daylight_inputs(
    hass: HomeAssistant, settings: dict[str, Any], now: datetime | None = None
) -> daylight.Inputs:
    """What the light of the day depends on, right now (`settings`: resolved ones)."""
    now = dt_util.as_local(now or dt_util.now())
    sunrise = get_astral_event_date(hass, "sunrise", now.date())
    sunset = get_astral_event_date(hass, "sunset", now.date())
    sources = async_sources(hass, settings)
    weather = hass.states.get(sources["weather"] or "")
    season = hass.states.get(sources["season"] or "")
    return daylight.Inputs(
        now=now,
        sunrise=dt_util.as_local(sunrise) if sunrise else None,
        sunset=dt_util.as_local(sunset) if sunset else None,
        elevation=astral_sun.elevation(get_astral_observer(hass), now),
        season_state=season.state if season else None,
        condition=weather.state if weather else None,
        cloud=_number(weather.attributes.get("cloud_coverage")) if weather else None,
        lux=_number(_state(hass, sources["light_sensor"])),
        mood=async_mood(hass),
    )


def _state(hass: HomeAssistant, entity_id: str | None) -> str | None:
    state = hass.states.get(entity_id) if entity_id else None
    return state.state if state else None


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except TypeError, ValueError:
        return None


async def async_config(hass: HomeAssistant, local: dict[str, Any]) -> dict[str, Any]:
    """The settings `daylight.select` works with for an automation's own ones."""
    return daylight.resolve(async_settings(hass), local, await async_default_tags(hass))


async def async_selection(
    hass: HomeAssistant, local: dict[str, Any] | None = None
) -> daylight.Selection:
    """What the light of the day (global, or of an automation) shows now."""
    config = await async_config(hass, local or {})
    return daylight.select(config, daylight_inputs(hass, config["settings"]))


def selection_info(selection: daylight.Selection) -> dict[str, Any]:
    """A selection for the panel."""
    return {
        "phase": selection.phase,
        "pool_phase": selection.pool_phase,
        "season": selection.season,
        "weather": selection.weather,
        "mood": selection.mood,
        "scene": selection.scene,
        "pool": list(selection.pool),
        "brightness": selection.brightness,
        "kelvin": selection.kelvin,
    }


# ---- changes ----


@callback
def async_update_settings(hass: HomeAssistant, changes: dict[str, Any]) -> None:
    """Change global settings; None goes back to the default."""
    settings = async_settings(hass)
    for key, value in changes.items():
        if value is None:
            settings.pop(key, None)
        else:
            settings[key] = value
    async_update_options(hass, {CONF_DAYLIGHT: settings})


@callback
def async_set_tags(
    hass: HomeAssistant, scene: str, tags: dict[str, list[str]] | None
) -> None:
    """A scene's tags (empty: out of the pool; None: back to the ready-made ones)."""
    settings = async_settings(hass)
    user = dict(settings.get("tags") or {})
    if tags is None:
        user.pop(scene, None)
    else:
        user[scene] = daylight.clean_tags(tags)
    async_update_settings(hass, {"tags": user})


async def async_merge_pools(
    hass: HomeAssistant, pools: dict[str, Any], holidays: list[dict[str, Any]]
) -> int:
    """Move the pools of an automation (before 0.10) into the global pool.

    Their scenes keep the tags they have and get those of where they were. The
    first time, the ready-made tags are turned off: the pool is what the user had
    put together (they can be turned on again). The number of scenes merged.
    """
    settings = async_settings(hass)
    found = daylight.tags_from_pools(pools, holidays)
    if not found:
        return 0
    first = not settings.get("merged")
    use_defaults = settings.get("defaults", True) and not first
    user = dict(settings.get("tags") or {})
    current = daylight.global_tags(await async_default_tags(hass), user, use_defaults)
    for scene, tags in found.items():
        if (had := current.get(scene)) is not None:
            # Fitting any value on either side (no list) fits any value together.
            tags = {
                key: [*had[key], *tags[key]] if key in had and key in tags else []
                for key in daylight.TAGS
            }
        user[scene] = daylight.clean_tags(tags)
    async_update_settings(
        hass, {"tags": user, "defaults": use_defaults, "merged": True}
    )
    return len(found)


# ---- updates ----


@callback
def async_track_light_of_the_day(
    hass: HomeAssistant, action: Callable[[], None]
) -> Callable[[], None]:
    """Call `action` (a callback) on every change of the settings or the mood and
    every minute."""

    @callback
    def tick(_: datetime) -> None:
        action()

    unsubs = [
        async_dispatcher_connect(hass, SIGNAL_CONFIG_UPDATED, action),
        async_dispatcher_connect(hass, SIGNAL_MOOD_UPDATED, action),
        async_track_time_interval(hass, tick, TICK),
    ]

    @callback
    def unsubscribe() -> None:
        for unsub in unsubs:
            unsub()

    return unsubscribe


# ---- WebSocket API ----


@callback
def async_setup_pool_websocket(hass: HomeAssistant) -> None:
    """Register the commands of the global light of the day."""
    for command in (ws_subscribe, ws_set, ws_set_tags, ws_merge):
        websocket_api.async_register_command(hass, command)


async def async_payload(hass: HomeAssistant) -> dict[str, Any]:
    """Everything the panel shows of the global light of the day."""
    settings = async_settings(hass)
    defaults = await async_default_tags(hass)
    selection = await async_selection(hass)
    info = selection_info(selection)
    if selection.scene:
        gallery = await async_gallery_scenes(hass)
        info["scene_name"] = (gallery.get(selection.scene) or {}).get("name")
    registry = er.async_get(hass)
    return {
        "settings": {
            key: settings[key]
            for key in (*daylight.SOURCES, *daylight.PHASE_SETTINGS)
            if settings.get(key) is not None
        }
        | {"defaults": settings.get("defaults", True)},
        "user_tags": settings.get("tags") or {},
        "defaults": defaults,
        "tags": daylight.global_tags(
            defaults, settings.get("tags") or {}, settings.get("defaults", True)
        ),
        "sources": async_sources(hass, settings),
        "now": info,
        "moods": list(daylight.MOODS),
        "mood_entity": registry.async_get_entity_id("select", DOMAIN, MOOD_UNIQUE_ID),
        "phase_entity": registry.async_get_entity_id("sensor", DOMAIN, PHASE_UNIQUE_ID),
    }


@websocket_api.websocket_command(
    {vol.Required("type"): "hue_studio/daylight/subscribe"}
)
@callback
def ws_subscribe(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """The global light of the day, now and whenever it changes.

    Event payload: {"settings": {weather, season, light_sensor, night_from, shifts,
    defaults}, "user_tags": {scene: tags}, "defaults": {scene: tags} (ready-made),
    "tags": {scene: tags} (the pool), "sources": {weather, season, light_sensor}
    (what is read), "now": {phase, season, weather, mood, scene, …}, "moods": [mood],
    "mood_entity", "phase_entity"}
    """
    last: dict[str, Any] = {}

    async def send() -> None:
        payload = await async_payload(hass)
        if payload == last.get("payload"):
            return
        last["payload"] = payload
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    @callback
    def changed() -> None:
        hass.async_create_task(send(), eager_start=True)

    connection.subscriptions[msg["id"]] = async_track_light_of_the_day(hass, changed)
    connection.send_result(msg["id"])
    changed()


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "hue_studio/daylight/set", **SETTINGS}
)
@callback
def ws_set(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Change global settings (sources, phase times, ready-made tags on/off)."""
    changes = {k: v for k, v in msg.items() if k not in ("type", "id")}
    try:
        async_update_settings(hass, changes)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "not_set_up", str(err))
        return
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/daylight/tags",
        vol.Required("scene"): cv.string,
        vol.Required("tags"): vol.Any(None, TAGS),
    }
)
@callback
def ws_set_tags(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """A scene's tags ({}: out of the pool; null: back to the ready-made ones)."""
    try:
        async_set_tags(hass, msg["scene"], msg["tags"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "not_set_up", str(err))
        return
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/daylight/merge",
        vol.Optional("pools", default=dict): dict,
        vol.Optional("holidays", default=list): [dict],
    }
)
@websocket_api.async_response
async def ws_merge(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Move an automation's own pools (before 0.10) into the global pool.

    Result: {"scenes": number of scenes merged}. The panel then saves the automation
    without them.
    """
    try:
        count = await async_merge_pools(hass, msg["pools"], msg["holidays"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "not_set_up", str(err))
        return
    connection.send_result(msg["id"], {"scenes": count})
