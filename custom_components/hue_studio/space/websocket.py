"""Space: where lights are, and entertainment areas."""

from __future__ import annotations

from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_connect
import voluptuous as vol

from ..const import SIGNAL_BRIDGES_UPDATED, SIGNAL_ENTERTAINMENT_UPDATED
from ..core.ws import subscribe, ws_call
from ..rooms.areas import async_track_areas
from .entertainment import (
    TYPES as ENTERTAINMENT_TYPES,
    async_create as async_create_entertainment,
    async_delete as async_delete_entertainment,
    async_entertainment_payload,
    async_set_positions as async_set_entertainment_positions,
    async_update as async_update_entertainment,
)
from .positions import (
    SIGNAL_POSITIONS_UPDATED,
    async_positions_payload,
    async_set_positions,
)


@callback
def async_setup_websocket(hass: HomeAssistant) -> None:
    """Register the WebSocket commands of space."""
    for command in (
        ws_subscribe_positions,
        ws_set_positions,
        ws_subscribe_entertainment,
        ws_create_entertainment,
        ws_update_entertainment,
        ws_delete_entertainment,
        ws_entertainment_positions,
    ):
        websocket_api.async_register_command(hass, command)


@websocket_api.websocket_command(
    {vol.Required("type"): "hue_studio/positions/subscribe"}
)
@callback
def ws_subscribe_positions(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Send where the Hue lights of each area are, now and whenever it changes.

    Event payload (always complete):
        {area_id: {"lights": {entity_id: {"positions": [[x, y, z], ...],
                                          "source": "bridge" | "store" | None}},
                   "configuration": {"id", "name", "streaming"} | None}}
    """
    last: dict[str, Any] = {}

    @callback
    def send() -> None:
        payload = async_positions_payload(hass)
        if payload == last.get("payload"):
            return
        last["payload"] = payload
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    unsubs = [
        async_dispatcher_connect(hass, SIGNAL_POSITIONS_UPDATED, send),
        # Entertainment areas changed (positions written, streaming started/stopped).
        async_dispatcher_connect(hass, SIGNAL_ENTERTAINMENT_UPDATED, send),
        async_dispatcher_connect(hass, SIGNAL_BRIDGES_UPDATED, send),
        async_track_areas(hass, send),
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
        vol.Required("type"): "hue_studio/positions/set",
        vol.Required("area_id"): str,
        vol.Required("positions"): {
            str: vol.All(
                [vol.All([vol.Coerce(float)], vol.Length(min=3, max=3))],
                vol.Length(min=1, max=2),
            )
        },
    }
)
@websocket_api.async_response
async def ws_set_positions(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Save positions of an area's lights: to the bridge or the Store (positions.py)."""
    try:
        await async_set_positions(hass, msg["area_id"], msg["positions"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], websocket_api.ERR_INVALID_FORMAT, str(err))
        return
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {vol.Required("type"): "hue_studio/entertainment/subscribe"}
)
@callback
def ws_subscribe_entertainment(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Entertainment areas of the bridges (see async_entertainment_payload)."""
    subscribe(
        hass,
        connection,
        msg,
        lambda: async_entertainment_payload(hass),
        [SIGNAL_ENTERTAINMENT_UPDATED, SIGNAL_BRIDGES_UPDATED],
    )


ENTERTAINMENT_LIGHTS = vol.All([cv.entity_id], vol.Length(min=1, max=20))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/entertainment/create",
        vol.Optional("hue_entry_id"): str,
        vol.Required("name"): vol.All(str, vol.Length(min=1)),
        vol.Optional("area_type", default="screen"): vol.In(ENTERTAINMENT_TYPES),
        vol.Required("lights"): ENTERTAINMENT_LIGHTS,
    }
)
@websocket_api.async_response
async def ws_create_entertainment(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """A new entertainment area."""
    await ws_call(
        connection,
        msg,
        async_create_entertainment(
            hass, msg.get("hue_entry_id"), msg["name"], msg["area_type"], msg["lights"]
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/entertainment/update",
        vol.Required("area_id"): str,
        vol.Optional("name"): str,
        vol.Optional("area_type"): vol.In(ENTERTAINMENT_TYPES),
        vol.Optional("lights"): ENTERTAINMENT_LIGHTS,
    }
)
@websocket_api.async_response
async def ws_update_entertainment(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Rename an entertainment area, change its type or lights."""
    await ws_call(
        connection,
        msg,
        async_update_entertainment(
            hass,
            msg["area_id"],
            name=msg.get("name"),
            area_type=msg.get("area_type"),
            lights=msg.get("lights"),
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/entertainment/delete",
        vol.Required("area_id"): str,
    }
)
@websocket_api.async_response
async def ws_delete_entertainment(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Remove an entertainment area."""
    await ws_call(connection, msg, async_delete_entertainment(hass, msg["area_id"]))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/entertainment/positions",
        vol.Required("area_id"): str,
        vol.Required("positions"): {
            cv.entity_id: [vol.All([vol.Coerce(float)], vol.Length(min=3, max=3))]
        },
    }
)
@websocket_api.async_response
async def ws_entertainment_positions(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Move lights of an entertainment area."""
    await ws_call(
        connection,
        msg,
        async_set_entertainment_positions(hass, msg["area_id"], msg["positions"]),
    )
