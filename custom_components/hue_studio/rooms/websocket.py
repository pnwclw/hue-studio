"""Rooms and zones: the alignment plan, a light's area, zone labels."""

from __future__ import annotations

from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers.dispatcher import async_dispatcher_connect
import voluptuous as vol

from ..core.connections import async_studio_entry
from .areas import async_rooms_payload, async_set_light_area, async_track_rooms
from .zones import SIGNAL_ZONES_UPDATED, ZoneMirror


@callback
def async_setup_websocket(hass: HomeAssistant) -> None:
    """Register the WebSocket commands of rooms and zones."""
    for command in (
        ws_subscribe_rooms,
        ws_set_light_area,
        ws_subscribe_zones,
        ws_relink_zone,
    ):
        websocket_api.async_register_command(hass, command)


@websocket_api.websocket_command({vol.Required("type"): "hue_studio/rooms/subscribe"})
@callback
def ws_subscribe_rooms(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Send the room alignment plan (nothing is changed) now and whenever it changes.

    Event payload (always complete), entity ids throughout:
        {"changed": bool,
         "rooms": [{"area", "name", "create", "rename", "current_name",
                    "group": room entity | None, "lights": [...], "bridge"}],
         "moves": [{"lights", "area", "from": room name | None, "from_group",
                    "from_area": area whose room the lights are in now | None}],
         "empty": [{"name", "group", "scenes": count}],
         "scenes": [{"entity_id", "name", "group_name", "lost", "missing"}],
         "conflicts": [light entity ids],
         "hue_rooms": {light entity id: its Hue room's name},
         "bridges": {hue entry id: bridge name},
         "bridge_of": {light, room, zone or scene entity id: hue entry id},
         "split_areas": {area id: [hue entry ids]} — areas with lights on several
                        bridges (an area belongs to one bridge)}
    Each room has its "bridge" (hue entry id) too.
    """
    last: dict[str, Any] = {}

    @callback
    def send() -> None:
        payload = async_rooms_payload(hass)
        if payload == last.get("payload"):
            return
        last["payload"] = payload
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    connection.subscriptions[msg["id"]] = async_track_rooms(hass, send)
    connection.send_result(msg["id"])
    send()


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/lights/set_area",
        vol.Required("entity_id"): str,
        vol.Required("area_id"): vol.Any(str, None),
    }
)
@callback
def ws_set_light_area(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Put a Hue light into an HA area (its device, like HA's "Assign area")."""
    try:
        async_set_light_area(hass, msg["entity_id"], msg["area_id"])
    except ServiceValidationError as err:
        connection.send_error(msg["id"], websocket_api.ERR_INVALID_FORMAT, str(err))
        return
    connection.send_result(msg["id"])


def _zone_mirror(hass: HomeAssistant) -> ZoneMirror | None:
    entry = async_studio_entry(hass)
    return getattr(getattr(entry, "runtime_data", None), "zones", None)


@websocket_api.websocket_command({vol.Required("type"): "hue_studio/zones/subscribe"})
@callback
def ws_subscribe_zones(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Send what the zone labels need from the user, now and whenever it changes.

    Event payload: {"notes": [{"kind": "unlinked" | "foreign", "zone": zone id,
    "name", "entity_id": the zone's light or None, "lights": [entity ids] (foreign)}]}
    """

    @callback
    def send() -> None:
        mirror = _zone_mirror(hass)
        notes = mirror.notes if mirror else []
        connection.send_message(
            websocket_api.event_message(msg["id"], {"notes": notes})
        )

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(
        hass, SIGNAL_ZONES_UPDATED, send
    )
    connection.send_result(msg["id"])
    send()


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "hue_studio/zones/relink", vol.Required("zone"): str}
)
@callback
def ws_relink_zone(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Mirror a zone whose label was deleted again (it gets a label of its name)."""
    if (mirror := _zone_mirror(hass)) is not None:
        mirror.async_relink(msg["zone"])
    connection.send_result(msg["id"])
