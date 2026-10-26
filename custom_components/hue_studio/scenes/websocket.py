"""Scenes: what the scene entities do not show, and the scene backups."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from aiohue.v2.controllers.events import EventType
from aiohue.v2.models.scene import Scene
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
import voluptuous as vol

from ..lights.bridge import HUE_DOMAIN, async_bridges
from .backup import async_list as async_list_scene_backups
from .bridge import SCENE_DOMAIN, HueScene, async_all_scenes, scene_info


@callback
def async_setup_websocket(hass: HomeAssistant) -> None:
    """Register the WebSocket commands of scenes."""
    for command in (
        ws_subscribe_scenes,
        ws_scene_backups,
    ):
        websocket_api.async_register_command(hass, command)


@websocket_api.websocket_command({vol.Required("type"): "hue_studio/scenes/subscribe"})
@callback
def ws_subscribe_scenes(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Send what the scene entities don't show (active status, palette, auto-play).

    Event payload: {"scenes": {entity_id: info}} — the first event is complete, later
    ones carry only scenes whose info changed (recalling a scene changes two: the new
    one becomes active, the previous one inactive).
    """
    scenes = async_all_scenes(hass)
    sent: dict[str, dict[str, Any]] = {s.entity_id: scene_info(hass, s) for s in scenes}
    bridges = {id(bridge): bridge for bridge in async_bridges(hass).values()}
    registry = er.async_get(hass)

    def on_scene_update(bridge_key: int) -> Callable[[EventType, Scene | None], None]:
        @callback
        def handle(event_type: EventType, resource: Scene | None) -> None:
            if resource is None or not isinstance(resource, Scene):
                return
            entity_id = registry.async_get_entity_id(
                SCENE_DOMAIN, HUE_DOMAIN, resource.id
            )
            if entity_id is None:
                return
            info = scene_info(hass, HueScene(entity_id, bridges[bridge_key], resource))
            if sent.get(entity_id) == info:
                return
            sent[entity_id] = info
            connection.send_message(
                websocket_api.event_message(msg["id"], {"scenes": {entity_id: info}})
            )

        return handle

    unsubscribers: list[Callable[[], None]] = [
        bridge.scenes.scene.subscribe(
            on_scene_update(key), event_filter=EventType.RESOURCE_UPDATED
        )
        for key, bridge in bridges.items()
    ]

    @callback
    def unsubscribe() -> None:
        for unsub in unsubscribers:
            unsub()

    connection.subscriptions[msg["id"]] = unsubscribe
    connection.send_result(msg["id"])
    connection.send_message(websocket_api.event_message(msg["id"], {"scenes": sent}))


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "hue_studio/scenes/backups"})
@websocket_api.async_response
async def ws_scene_backups(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """The scene backups, newest first.

    Result: {"backups": [{"file", "created", "scenes", "bridges": [names]}]}
    (made and restored with the export_scenes and import_scenes services).
    """
    backups = await async_list_scene_backups(hass)
    connection.send_result(msg["id"], {"backups": backups})
