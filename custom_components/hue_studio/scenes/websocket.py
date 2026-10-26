"""Scenes: what the scene entities do not show, and the scene backups."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from aiohue.v2.controllers.events import EventType
from aiohue.v2.models.scene import Scene
from homeassistant.components import websocket_api
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv, entity_registry as er
import voluptuous as vol

from ..lights.bridge import HUE_DOMAIN, async_bridges
from .backup import async_list as async_list_scene_backups
from .bridge import (
    SCENE_DOMAIN,
    HueScene,
    async_all_scenes,
    async_resolve_scenes,
    scene_info,
)
from .covers import COVERS
from .preview import async_end as async_end_preview, async_show, async_start


@callback
def async_setup_websocket(hass: HomeAssistant) -> None:
    """Register the WebSocket commands of scenes."""
    for command in (
        ws_subscribe_scenes,
        ws_scene_backups,
        ws_scene_cover,
        ws_preview_start,
        ws_preview_show,
        ws_preview_end,
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

    @callback
    def on_cover(scene_id: str) -> None:
        """A scene got a picture of its own (or lost it)."""
        for scene in async_all_scenes(hass):
            if scene.resource.id == scene_id:
                info = scene_info(hass, scene)
                sent[scene.entity_id] = info
                connection.send_message(
                    websocket_api.event_message(
                        msg["id"], {"scenes": {scene.entity_id: info}}
                    )
                )

    unsubscribers: list[Callable[[], None]] = [
        bridge.scenes.scene.subscribe(
            on_scene_update(key),
            event_filter=(EventType.RESOURCE_ADDED, EventType.RESOURCE_UPDATED),
        )
        for key, bridge in bridges.items()
    ]
    unsubscribers.append(hass.data[COVERS].async_listen(on_cover))

    @callback
    def on_entity(event: Event[er.EventEntityRegistryUpdatedData]) -> None:
        """A new scene, whichever comes last: `hue` adding its entity (on its own
        connection to the bridge) or our connection hearing of the scene."""
        if event.data["action"] != "create":
            return
        entity_id = event.data["entity_id"]
        if not entity_id.startswith(f"{SCENE_DOMAIN}."):
            return
        for scene in async_all_scenes(hass):
            if scene.entity_id == entity_id:
                info = sent[entity_id] = scene_info(hass, scene)
                connection.send_message(
                    websocket_api.event_message(
                        msg["id"], {"scenes": {entity_id: info}}
                    )
                )

    unsubscribers.append(
        hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, on_entity)
    )

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


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/scenes/cover",
        vol.Required("entity_id"): cv.entity_id,
        # An image uploaded to Home Assistant (/api/image/upload); None: its colors.
        vol.Required("image"): vol.Any(None, vol.All(cv.string, vol.Length(max=64))),
    }
)
@callback
def ws_scene_cover(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Give a scene a picture of its own (covers.py).

    Result: {"replaced": the image it had, or None} — the caller deletes it
    (image/delete), as Home Assistant's own picture pickers do.
    """
    try:
        (scene,) = async_resolve_scenes(hass, [msg["entity_id"]])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, str(err))
        return
    replaced = hass.data[COVERS].async_set(scene.resource.id, msg["image"])
    connection.send_result(msg["id"], {"replaced": replaced})


TOKEN = vol.All(cv.string, vol.Length(min=1, max=64))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/preview/start",
        vol.Required("token"): TOKEN,
        vol.Required("entity_id"): vol.Any(cv.entity_id, [cv.entity_id]),
    }
)
@websocket_api.async_response
async def ws_preview_start(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """A scene's card opens on a room: remember what its lights show (preview.py).

    A connection that closes before hue_studio/preview/end puts the lights back.
    Result: {"lights": count}.
    """
    token = msg["token"]

    @callback
    def gone() -> None:
        hass.async_create_task(async_end_preview(hass, token, keep=False, detach=False))

    @callback
    def detach() -> None:
        connection.subscriptions.pop(msg["id"], None)

    try:
        count = await async_start(hass, token, msg["entity_id"], detach)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], websocket_api.ERR_INVALID_FORMAT, str(err))
        return
    connection.subscriptions[msg["id"]] = gone
    connection.send_result(msg["id"], {"lights": count})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/preview/show",
        vol.Required("token"): TOKEN,
        # What apply_palette takes: gallery_scene, points or mirek, layout, brightness.
        vol.Required("colors"): dict,
    }
)
@websocket_api.async_response
async def ws_preview_show(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Show the card in the middle on the room's lights."""
    try:
        await async_show(hass, msg["token"], msg["colors"])
    except (HomeAssistantError, vol.Invalid) as err:
        connection.send_error(msg["id"], websocket_api.ERR_INVALID_FORMAT, str(err))
        return
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/preview/end",
        vol.Required("token"): TOKEN,
        vol.Optional("keep", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_preview_end(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """The card closes: keep what is shown (saved, set once) or put the lights back."""
    await async_end_preview(hass, msg["token"], keep=msg["keep"])
    connection.send_result(msg["id"])
