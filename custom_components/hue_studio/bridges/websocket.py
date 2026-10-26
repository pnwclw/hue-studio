"""Bridges: what each is and holds, adding one, renaming it, MotionAware areas."""

from __future__ import annotations

from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
import voluptuous as vol

from ..const import SIGNAL_BRIDGES_UPDATED
from ..core.ws import subscribe, ws_call
from .info import (
    NAME_MAX as BRIDGE_NAME_MAX,
    async_bridges_payload,
    async_rename_bridge,
)
from .motion_areas import (
    MAX_LIGHTS as MOTION_MAX_LIGHTS,
    NAME_MAX as MOTION_NAME_MAX,
    async_create as async_create_motion_area,
    async_delete as async_delete_motion_area,
    async_recalibrate as async_recalibrate_motion_area,
    async_set_response as async_set_motion_response,
    async_update as async_update_motion_area,
    async_watch_bridges as async_watch_motion_areas,
)
from .setup import BridgeDiscovery, LinkFailed, async_link, async_track_hue_entries


@callback
def async_setup_websocket(hass: HomeAssistant) -> None:
    """Register the WebSocket commands of bridges."""
    for command in (
        ws_subscribe_bridges,
        ws_discover_bridges,
        ws_link_bridge,
        ws_set_motion_area,
        ws_create_motion_area,
        ws_update_motion_area,
        ws_recalibrate_motion_area,
        ws_delete_motion_area,
        ws_set_motion_response,
        ws_rename_bridge,
    ):
        websocket_api.async_register_command(hass, command)


@websocket_api.websocket_command({vol.Required("type"): "hue_studio/bridges/subscribe"})
@callback
def ws_subscribe_bridges(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """The bridges and their MotionAware areas (bridges.async_bridges_payload)."""
    async_watch_motion_areas(hass)
    subscribe(
        hass,
        connection,
        msg,
        lambda: async_bridges_payload(hass),
        [SIGNAL_BRIDGES_UPDATED],
    )


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "hue_studio/bridges/discover"})
@websocket_api.async_response
async def ws_discover_bridges(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Bridges on the network that the Philips Hue integration does not have yet,
    while subscribed (bridge_setup.BridgeDiscovery.payload)."""
    last: dict[str, Any] = {}
    discovery: BridgeDiscovery

    @callback
    def send() -> None:
        data = discovery.payload()
        if data == last.get("payload"):
            return
        last["payload"] = data
        connection.send_message(websocket_api.event_message(msg["id"], data))

    discovery = BridgeDiscovery(hass, send)
    unsub_entries = async_track_hue_entries(hass, send)

    @callback
    def unsubscribe() -> None:
        unsub_entries()
        hass.async_create_background_task(
            discovery.async_stop(), "hue_studio_discovery_stop"
        )

    connection.subscriptions[msg["id"]] = unsubscribe
    connection.send_result(msg["id"])
    send()
    await discovery.async_start()


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/bridges/link",
        vol.Optional("host"): vol.All(str, vol.Strip, vol.Length(min=1)),
        vol.Optional("bridge_id"): str,
    }
)
@callback
def ws_link_bridge(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Link a bridge with the Philips Hue integration, while subscribed.

    Events: {"step": "connecting"}, {"step": "press", "timeout": s} (waiting for the
    bridge's button), then {"step": "done", "hue_entry_id", "name"} or
    {"step": "failed", "reason"}. Unsubscribing gives up. Hue Studio connects to the
    new bridge by itself (connections.py).
    """

    @callback
    def step(data: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], data))

    async def run() -> None:
        try:
            entry = await async_link(
                hass, step, host=msg.get("host"), bridge_id=msg.get("bridge_id")
            )
        except LinkFailed as err:
            step({"step": "failed", "reason": err.reason})
            return
        step({"step": "done", "hue_entry_id": entry.entry_id, "name": entry.title})

    # The result goes first: the task starts eagerly and may be done at once.
    connection.send_result(msg["id"])
    task = hass.async_create_background_task(run(), "hue_studio_link_bridge")
    connection.subscriptions[msg["id"]] = task.cancel


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/bridges/motion_area",
        vol.Required("area_id"): str,
        vol.Required("enabled"): bool,
    }
)
@websocket_api.async_response
async def ws_set_motion_area(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Switch a MotionAware area on (it calibrates) or off."""
    await ws_call(
        connection,
        msg,
        async_update_motion_area(hass, msg["area_id"], enabled=msg["enabled"]),
    )


MOTION_LIGHTS = vol.All([cv.entity_id], vol.Length(min=1, max=MOTION_MAX_LIGHTS))


MOTION_NAME = vol.All(str, vol.Strip, vol.Length(min=1, max=MOTION_NAME_MAX))


SENSITIVITY = vol.All(vol.Coerce(int), vol.Range(min=0, max=10))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/motion_areas/create",
        vol.Required("hue_entry_id"): str,
        vol.Required("group"): str,
        vol.Required("lights"): MOTION_LIGHTS,
        vol.Required("name"): MOTION_NAME,
    }
)
@websocket_api.async_response
async def ws_create_motion_area(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """A new MotionAware area in a Hue room or zone; the bridge calibrates it at once.
    Result: {"area_id"}."""
    try:
        area_id = await async_create_motion_area(
            hass, msg["hue_entry_id"], msg["group"], msg["lights"], msg["name"]
        )
    except (HomeAssistantError, ServiceValidationError) as err:
        connection.send_error(msg["id"], websocket_api.ERR_INVALID_FORMAT, str(err))
        return
    connection.send_result(msg["id"], {"area_id": area_id})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/motion_areas/update",
        vol.Required("area_id"): str,
        vol.Optional("name"): MOTION_NAME,
        vol.Optional("group"): str,
        vol.Optional("lights"): MOTION_LIGHTS,
        vol.Optional("enabled"): bool,
        vol.Optional("sensitivity"): SENSITIVITY,
        vol.Optional("security_sensitivity"): SENSITIVITY,
    }
)
@websocket_api.async_response
async def ws_update_motion_area(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Change a MotionAware area (other lights or switching it on: it calibrates)."""
    await ws_call(
        connection,
        msg,
        async_update_motion_area(
            hass,
            msg["area_id"],
            name=msg.get("name"),
            group_id=msg.get("group"),
            lights=msg.get("lights"),
            enabled=msg.get("enabled"),
            sensitivity=msg.get("sensitivity"),
            security_sensitivity=msg.get("security_sensitivity"),
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/motion_areas/recalibrate",
        vol.Required("area_id"): str,
    }
)
@websocket_api.async_response
async def ws_recalibrate_motion_area(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Calibrate a MotionAware area again (nobody should be in the room)."""
    await ws_call(connection, msg, async_recalibrate_motion_area(hass, msg["area_id"]))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/motion_areas/delete",
        vol.Required("area_id"): str,
    }
)
@websocket_api.async_response
async def ws_delete_motion_area(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Remove a MotionAware area from its bridge."""
    await ws_call(connection, msg, async_delete_motion_area(hass, msg["area_id"]))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/motion_areas/response",
        vol.Required("behavior_id"): str,
        vol.Required("enabled"): bool,
    }
)
@websocket_api.async_response
async def ws_set_motion_response(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Switch the Hue app's response to a MotionAware area on or off."""
    await ws_call(
        connection,
        msg,
        async_set_motion_response(hass, msg["behavior_id"], msg["enabled"]),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/bridges/rename",
        vol.Required("hue_entry_id"): str,
        vol.Required("name"): vol.All(str, vol.Length(min=1, max=BRIDGE_NAME_MAX)),
    }
)
@websocket_api.async_response
async def ws_rename_bridge(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Name a bridge."""
    await ws_call(
        connection, msg, async_rename_bridge(hass, msg["hue_entry_id"], msg["name"])
    )
