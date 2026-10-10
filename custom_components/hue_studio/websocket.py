"""WebSocket API for the frontend."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from aiohue.v2.controllers.events import EventType
from aiohue.v2.models.light import Light
from aiohue.v2.models.scene import Scene
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
import voluptuous as vol

from .const import SIGNAL_CONFIG_UPDATED, SIGNAL_ENTERTAINMENT_UPDATED
from .lights import (
    HUE_DOMAIN,
    LIGHT_DOMAIN,
    async_all_lights,
    async_bridges,
    light_info,
)
from .options import async_frontend_config
from .scenes import SCENE_DOMAIN, HueScene, async_all_scenes, scene_info
from .sync import async_sync_coordinators, sync_box_info


@callback
def async_setup_websocket(hass: HomeAssistant) -> None:
    """Register WebSocket commands."""
    websocket_api.async_register_command(hass, ws_subscribe_lights)
    websocket_api.async_register_command(hass, ws_subscribe_config)
    websocket_api.async_register_command(hass, ws_subscribe_scenes)
    websocket_api.async_register_command(hass, ws_subscribe_sync)


@websocket_api.websocket_command({vol.Required("type"): "hue_studio/config/subscribe"})
@callback
def ws_subscribe_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Send the room mapping and room sensors now and whenever options change.

    Event payload:
        {"groups": {group entity_id: "zone" | area_id},
         "rooms": {"area.<id>" | "hue.<group entity_id>":
                   {"motion": [entity_id], "temperature": [entity_id]}}}
    """

    @callback
    def send() -> None:
        connection.send_message(
            websocket_api.event_message(msg["id"], async_frontend_config(hass))
        )

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(
        hass, SIGNAL_CONFIG_UPDATED, send
    )
    connection.send_result(msg["id"])
    send()


@websocket_api.websocket_command({vol.Required("type"): "hue_studio/lights/subscribe"})
@callback
def ws_subscribe_lights(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Send gamut/gradient info of all Hue lights, then push changes.

    Event payload: {"lights": {entity_id: info}} — the first event is complete,
    later ones carry only lights whose info changed.
    """
    lights = async_all_lights(hass)
    sent: dict[str, dict[str, Any]] = {
        light.entity_id: light_info(light.resource) for light in lights
    }
    registry = er.async_get(hass)

    @callback
    def on_light_update(event_type: EventType, resource: Light | None) -> None:
        if resource is None:
            return
        entity_id = registry.async_get_entity_id(LIGHT_DOMAIN, HUE_DOMAIN, resource.id)
        if entity_id is None:
            return
        info = light_info(resource)
        if sent.get(entity_id) == info:
            return
        sent[entity_id] = info
        connection.send_message(
            websocket_api.event_message(msg["id"], {"lights": {entity_id: info}})
        )

    unsubscribers: list[Callable[[], None]] = [
        bridge.lights.subscribe(
            on_light_update, event_filter=EventType.RESOURCE_UPDATED
        )
        for bridge in {id(light.bridge): light.bridge for light in lights}.values()
    ]

    @callback
    def unsubscribe() -> None:
        for unsub in unsubscribers:
            unsub()

    connection.subscriptions[msg["id"]] = unsubscribe
    connection.send_result(msg["id"])
    connection.send_message(websocket_api.event_message(msg["id"], {"lights": sent}))


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


@websocket_api.websocket_command({vol.Required("type"): "hue_studio/sync/subscribe"})
@callback
def ws_subscribe_sync(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Send the state of every Sync Box now and whenever it changes.

    Event payload: {"boxes": {config entry id: info}}, always complete (a box is
    small). Boxes set up later appear after the panel is reopened.
    """
    coordinators = async_sync_coordinators(hass)
    last: dict[str, Any] = {}

    @callback
    def send() -> None:
        boxes = {
            entry_id: sync_box_info(hass, coordinator)
            for entry_id, coordinator in coordinators.items()
        }
        if boxes == last.get("boxes"):
            return
        last["boxes"] = boxes
        connection.send_message(
            websocket_api.event_message(msg["id"], {"boxes": boxes})
        )

    unsubscribers: list[Callable[[], None]] = [
        coordinator.async_add_listener(send) for coordinator in coordinators.values()
    ]
    # Area lights and streaming flags come from the bridge.
    unsubscribers.append(
        async_dispatcher_connect(hass, SIGNAL_ENTERTAINMENT_UPDATED, send)
    )

    @callback
    def unsubscribe() -> None:
        for unsub in unsubscribers:
            unsub()

    connection.subscriptions[msg["id"]] = unsubscribe
    connection.send_result(msg["id"])
    send()
