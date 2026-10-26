"""Automations: ours and the others on Hue lights, a preview, the old auto light's
settings; the global light of the day."""

from __future__ import annotations

from typing import Any

from homeassistant.components import websocket_api
from homeassistant.components.automation import (
    DOMAIN as AUTOMATION_DOMAIN,
    EVENT_AUTOMATION_RELOADED,
)
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.storage import Store
import voluptuous as vol

from ..scenes.gallery import async_gallery_scenes
from . import daylight, pool
from .blueprints import (
    LEGACY_STORAGE_KEY,
    TYPES,
    async_organize,
    our_automations,
    related_automations,
)
from .light import DAY_CONFIG, async_day_selection, day_config
from .pool import (
    SETTINGS,
    TAGS,
    async_merge_pools,
    async_next_scene,
    async_payload,
    async_set_tags,
    async_track_light_of_the_day,
    async_update_settings,
)


@callback
def async_setup_websocket(hass: HomeAssistant) -> None:
    """Register the WebSocket commands of automations and the light of the day."""
    for command in (
        ws_subscribe_automations,
        ws_organize,
        ws_preview,
        ws_legacy_auto_light,
        ws_subscribe,
        ws_set,
        ws_set_tags,
        ws_merge,
        ws_next_scene,
    ):
        websocket_api.async_register_command(hass, command)


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
@websocket_api.websocket_command({vol.Required("type"): "hue_studio/daylight/next"})
@websocket_api.async_response
async def ws_next_scene(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Another scene of the day, until the day ends (every pool steps on)."""
    try:
        await async_next_scene(hass)
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
