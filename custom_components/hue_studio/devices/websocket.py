"""Devices: adding, identifying, setting up and removing Hue devices."""

from __future__ import annotations

from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_connect
import voluptuous as vol

from ..core.ws import ws_call
from ..rooms.areas import async_track_areas
from .manage import (
    LIGHT_FUNCTIONS,
    MAX_INSTALL_CODES,
    MAX_SERIALS,
    POWER_ON_PRESETS,
    SIGNAL_DEVICES_UPDATED,
    async_delete_device,
    async_devices_payload,
    async_identify,
    async_search,
    async_set_sensitivity,
    async_setup_device,
    async_watch_bridges,
)


@callback
def async_setup_websocket(hass: HomeAssistant) -> None:
    """Register the WebSocket commands of devices."""
    for command in (
        ws_subscribe_devices,
        ws_search_devices,
        ws_identify_device,
        ws_setup_device,
        ws_set_sensitivity,
        ws_delete_device,
    ):
        websocket_api.async_register_command(hass, command)


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "hue_studio/devices/subscribe"})
@callback
def ws_subscribe_devices(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Send the "Add devices" state of every bridge now and whenever it changes
    (see devices.async_devices_payload)."""
    async_watch_bridges(hass)
    last: dict[str, Any] = {}

    @callback
    def send() -> None:
        payload = async_devices_payload(hass)
        if payload == last.get("payload"):
            return
        last["payload"] = payload
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    unsubs = [
        async_dispatcher_connect(hass, SIGNAL_DEVICES_UPDATED, send),
        async_track_areas(hass, send),
    ]

    @callback
    def unsubscribe() -> None:
        for unsub in unsubs:
            unsub()

    connection.subscriptions[msg["id"]] = unsubscribe
    connection.send_result(msg["id"])
    send()


# A device's Zigbee MAC (16 hex digits, separators allowed) and install code (36 hex
# digits), read from its QR code.
MAC_PATTERN = r"^(?:[0-9A-Fa-f]{2}[:\-]?){7}[0-9A-Fa-f]{2}$"


INSTALL_CODES = vol.All(
    [
        {
            vol.Required("mac"): vol.Match(MAC_PATTERN),
            vol.Required("code"): vol.Match(r"^[0-9A-Fa-f]{36}$"),
        }
    ],
    vol.Length(max=MAX_INSTALL_CODES),
)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/devices/search",
        vol.Optional("hue_entry_id"): str,
        vol.Optional("serials", default=list): vol.All(
            [cv.string], vol.Length(max=MAX_SERIALS)
        ),
        vol.Optional("install_codes", default=list): INSTALL_CODES,
        vol.Optional("other_brands", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_search_devices(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Let new Hue devices join the bridge (all bridges without an entry id)."""
    await ws_call(
        connection,
        msg,
        async_search(
            hass,
            msg.get("hue_entry_id"),
            msg["serials"],
            msg["other_brands"],
            msg["install_codes"],
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "hue_studio/devices/identify", vol.Required("device"): str}
)
@websocket_api.async_response
async def ws_identify_device(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Make a Hue device show itself."""
    await ws_call(connection, msg, async_identify(hass, msg["device"]))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/devices/setup",
        vol.Required("device"): str,
        vol.Optional("name"): vol.Any(None, str),
        vol.Optional("area_id"): vol.Any(None, str),
        vol.Optional("sensitivity"): vol.Any(None, vol.All(int, vol.Range(min=0))),
        vol.Optional("function"): vol.Any(None, vol.In(LIGHT_FUNCTIONS)),
        vol.Optional("power_on"): vol.Any(None, vol.In(POWER_ON_PRESETS)),
    }
)
@websocket_api.async_response
async def ws_setup_device(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Name a Hue device, put it into an area and its lights into that Hue room
    (a motion sensor's sensitivity, a light's function and power-on behavior too)."""
    await ws_call(
        connection,
        msg,
        async_setup_device(
            hass,
            msg["device"],
            msg.get("name"),
            msg.get("area_id"),
            msg.get("sensitivity"),
            msg.get("function"),
            msg.get("power_on"),
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "hue_studio/devices/delete", vol.Required("device"): str}
)
@websocket_api.async_response
async def ws_delete_device(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Remove a Hue device from its bridge."""
    await ws_call(connection, msg, async_delete_device(hass, msg["device"]))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/devices/sensitivity",
        vol.Required("device"): str,
        vol.Required("sensitivity"): vol.All(int, vol.Range(min=0)),
    }
)
@websocket_api.async_response
async def ws_set_sensitivity(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Set a motion sensor's sensitivity alone."""
    await ws_call(
        connection,
        msg,
        async_set_sensitivity(hass, msg["device"], msg["sensitivity"]),
    )
