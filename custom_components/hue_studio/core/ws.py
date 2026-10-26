"""Helpers the WebSocket commands share: a subscription that sends a payload as it
changes, a call answered with its result or error."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from ..rooms.areas import async_track_areas


async def ws_call(
    connection: websocket_api.ActiveConnection, msg: dict[str, Any], call: Any
) -> None:
    try:
        await call
    except (HomeAssistantError, ServiceValidationError) as err:
        connection.send_error(msg["id"], websocket_api.ERR_INVALID_FORMAT, str(err))
        return
    connection.send_result(msg["id"])


def subscribe(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    payload: Callable[[], Any],
    signals: list[str],
) -> None:
    """Send `payload()` now and whenever one of the signals (or an area) changes."""
    last: dict[str, Any] = {}

    @callback
    def send() -> None:
        data = payload()
        # The first payload always goes out, even None ("nothing").
        if "payload" in last and data == last["payload"]:
            return
        last["payload"] = data
        connection.send_message(websocket_api.event_message(msg["id"], data))

    unsubs = [async_dispatcher_connect(hass, s, send) for s in signals]
    unsubs.append(async_track_areas(hass, send))

    @callback
    def unsubscribe() -> None:
        for unsub in unsubs:
            unsub()

    connection.subscriptions[msg["id"]] = unsubscribe
    connection.send_result(msg["id"])
    send()
