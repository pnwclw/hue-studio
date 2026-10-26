"""The entry's options: what the panel shows and how Hue Studio behaves."""

from __future__ import annotations

from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_connect
import voluptuous as vol

from ..const import (
    CONF_AUTO_ALIGN,
    CONF_FOOTER,
    CONF_FOOTER_TABS,
    CONF_GALLERY_RULES,
    CONF_GALLERY_SEASONAL,
    CONF_ORGANIZE,
    CONF_ZONE_LABELS,
    FOOTER_MAX_TABS,
    GALLERY_SEASONS,
    SIGNAL_CONFIG_UPDATED,
)
from ..rooms.areas import async_track_rooms
from .options import (
    async_frontend_config,
    async_set_group_area,
    async_set_room_sensors,
    async_update_options,
)


@callback
def async_setup_websocket(hass: HomeAssistant) -> None:
    """Register the WebSocket commands of the entry's options."""
    for command in (
        ws_subscribe_config,
        ws_set_config,
        ws_set_group_area,
        ws_set_room_sensors,
    ):
        websocket_api.async_register_command(hass, command)


@websocket_api.websocket_command({vol.Required("type"): "hue_studio/config/subscribe"})
@callback
def ws_subscribe_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Send the room mapping and room sensors now and whenever options change, and
    the rooms' and zones' icons whenever the bridges change them.

    Event payload:
        {"groups": {group entity_id: "zone" | area_id},
         "rooms": {"area.<id>" | "hue.<group entity_id>":
                   {"motion": [entity_id], "temperature": [entity_id]}},
         "icons": {group entity_id: icon}, …}
    """
    sent: dict[str, Any] = {}

    @callback
    def send() -> None:
        payload = async_frontend_config(hass)
        if payload == sent:
            return
        sent.clear()
        sent.update(payload)
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    unsubs = [
        async_dispatcher_connect(hass, SIGNAL_CONFIG_UPDATED, send),
        async_track_rooms(hass, send),
    ]

    @callback
    def unsubscribe() -> None:
        for unsub in unsubs:
            unsub()

    connection.subscriptions[msg["id"]] = unsubscribe
    connection.send_result(msg["id"])
    send()


# "MM-DD": a day of any year (a date window of a scene gallery category).
MONTH_DAY = r"^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$"


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/config/set",
        vol.Optional(CONF_AUTO_ALIGN): bool,
        vol.Optional(CONF_ORGANIZE): bool,
        vol.Optional(CONF_ZONE_LABELS): bool,
        vol.Optional(CONF_FOOTER): bool,
        vol.Optional(CONF_FOOTER_TABS): vol.All(
            [cv.string], vol.Length(max=FOOTER_MAX_TABS)
        ),
        vol.Optional(CONF_GALLERY_SEASONAL): bool,
        vol.Optional(CONF_GALLERY_RULES): {
            cv.string: {
                vol.Optional("seasons"): vol.All(
                    [vol.In(GALLERY_SEASONS)], vol.Length(max=len(GALLERY_SEASONS))
                ),
                vol.Optional("window"): vol.All(
                    [vol.Match(MONTH_DAY)], vol.Length(min=2, max=2)
                ),
            }
        },
    }
)
@callback
def ws_set_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Change options of the Hue Studio entry from the panel's settings.

    Open panels get them through hue_studio/config/subscribe.
    """
    changes = {
        k: v
        for k, v in msg.items()
        if k
        in (
            CONF_AUTO_ALIGN,
            CONF_ORGANIZE,
            CONF_ZONE_LABELS,
            CONF_FOOTER,
            CONF_FOOTER_TABS,
            CONF_GALLERY_SEASONAL,
            CONF_GALLERY_RULES,
        )
    }
    try:
        async_update_options(hass, changes)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "not_set_up", str(err))
        return
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/config/set_group",
        vol.Required("entity_id"): cv.entity_id,
        # An area id, None (a zone of its own) or "auto".
        vol.Required("area_id"): vol.Any(None, str),
    }
)
@callback
def ws_set_group_area(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Which area a Hue room/zone belongs to (the options' room mapping)."""
    try:
        async_set_group_area(hass, msg["entity_id"], msg["area_id"])
    except ServiceValidationError as err:
        connection.send_error(msg["id"], websocket_api.ERR_INVALID_FORMAT, str(err))
        return
    connection.send_result(msg["id"])


SENSOR_IDS = vol.All([cv.entity_id], vol.Length(max=10))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/config/set_room_sensors",
        # "area.<area id>" or "hue.<group entity id>"
        vol.Required("room"): str,
        vol.Optional("motion", default=list): SENSOR_IDS,
        vol.Optional("temperature", default=list): SENSOR_IDS,
        vol.Optional("illuminance", default=list): SENSOR_IDS,
    }
)
@callback
def ws_set_room_sensors(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Sensors of a room (the options' room sensors); all empty: the defaults."""
    try:
        async_set_room_sensors(
            hass,
            msg["room"],
            {k: msg[k] for k in ("motion", "temperature", "illuminance")},
        )
    except ServiceValidationError as err:
        connection.send_error(msg["id"], websocket_api.ERR_INVALID_FORMAT, str(err))
        return
    connection.send_result(msg["id"])
