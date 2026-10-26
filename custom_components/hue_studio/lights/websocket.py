"""Lights: what HA's light entities do not show (gamut, gradients, effects)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from aiohue import HueBridgeV2
from aiohue.v2.controllers.events import EventType
from aiohue.v2.models.light import Light
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
import voluptuous as vol

from .bridge import (
    HUE_DOMAIN,
    LIGHT_DOMAIN,
    async_all_lights,
    light_info,
    light_product,
)


@callback
def async_setup_websocket(hass: HomeAssistant) -> None:
    """Register the WebSocket commands of lights."""
    for command in (ws_subscribe_lights,):
        websocket_api.async_register_command(hass, command)


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
        light.entity_id: light_info(
            light.resource, light_product(light.bridge, light.resource)
        )
        for light in lights
    }
    registry = er.async_get(hass)

    def on_light_update(
        bridge: HueBridgeV2,
    ) -> Callable[[EventType, Light | None], None]:
        @callback
        def update(event_type: EventType, resource: Light | None) -> None:
            if resource is None:
                return
            entity_id = registry.async_get_entity_id(
                LIGHT_DOMAIN, HUE_DOMAIN, resource.id
            )
            if entity_id is None:
                return
            info = light_info(resource, light_product(bridge, resource))
            if sent.get(entity_id) == info:
                return
            sent[entity_id] = info
            connection.send_message(
                websocket_api.event_message(msg["id"], {"lights": {entity_id: info}})
            )

        return update

    unsubscribers: list[Callable[[], None]] = [
        bridge.lights.subscribe(
            on_light_update(bridge), event_filter=EventType.RESOURCE_UPDATED
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
