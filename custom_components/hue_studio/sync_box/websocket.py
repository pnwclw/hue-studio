"""Sync Boxes: their state, settings, inputs, following the picture, their bridge."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_connect
import voluptuous as vol

from ..const import SIGNAL_BRIDGES_UPDATED, SIGNAL_ENTERTAINMENT_UPDATED
from ..core.ws import ws_call
from .coordinator import (
    DEVICE_ACTIONS as SYNC_DEVICE_ACTIONS,
    INPUT_NAME_MAX as SYNC_INPUT_NAME_MAX,
    INPUTS as SYNC_INPUTS,
    LED_MODES,
    NAME_MAX as SYNC_NAME_MAX,
    PORT_TYPES as SYNC_PORT_TYPES,
    BoxBridgeFailed,
    SyncBoxCoordinator,
    async_link_box_bridge,
    async_sync_boxes,
)
from .follow import (
    ACTIONS as FOLLOW_ACTIONS,
    SCREEN_OFF_AFTER_MAX,
    SIGNAL_DOMAINS as FOLLOW_SIGNAL_DOMAINS,
    WAKE_DOMAINS as FOLLOW_WAKE_DOMAINS,
    async_set_follow,
)


@callback
def async_setup_websocket(hass: HomeAssistant) -> None:
    """Register the WebSocket commands of sync boxes."""
    for command in (
        ws_subscribe_sync,
        ws_configure_sync_box,
        ws_sync_box_behavior,
        ws_sync_box_input,
        ws_follow_sync_box,
        ws_link_sync_box_bridge,
    ):
        websocket_api.async_register_command(hass, command)


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
    boxes = async_sync_boxes(hass)
    last: dict[str, Any] = {}

    @callback
    def send() -> None:
        info = {entry_id: box.panel_info() for entry_id, box in boxes.items()}
        if info == last.get("boxes"):
            return
        last["boxes"] = info
        connection.send_message(websocket_api.event_message(msg["id"], {"boxes": info}))

    unsubscribers: list[Callable[[], None]] = [
        box.async_add_listener(send) for box in boxes.values()
    ]
    # Area lights and streaming flags come from the bridges.
    unsubscribers.extend(
        async_dispatcher_connect(hass, signal, send)
        for signal in (SIGNAL_ENTERTAINMENT_UPDATED, SIGNAL_BRIDGES_UPDATED)
    )

    @callback
    def unsubscribe() -> None:
        for unsub in unsubscribers:
            unsub()

    connection.subscriptions[msg["id"]] = unsubscribe
    connection.send_result(msg["id"])
    send()


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/sync/configure",
        vol.Required("entry_id"): str,
        vol.Optional("name"): vol.All(str, vol.Length(min=1, max=SYNC_NAME_MAX)),
        vol.Optional("led"): vol.In(list(LED_MODES)),
        vol.Optional("tv_power"): bool,
        vol.Optional("bluetooth"): bool,
        vol.Optional("auto_update"): bool,
        vol.Optional("action"): vol.In(list(SYNC_DEVICE_ACTIONS)),
        vol.Optional("background"): {vol.In(["video", "game"]): bool},
    }
)
@websocket_api.async_response
async def ws_configure_sync_box(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """A Sync Box's own settings (paired directly only)."""
    box = async_sync_boxes(hass).get(msg["entry_id"])
    if not isinstance(box, SyncBoxCoordinator):
        connection.send_error(
            msg["id"],
            websocket_api.ERR_NOT_FOUND,
            "Not a Sync Box paired with Hue Studio",
        )
        return
    await ws_call(
        connection,
        msg,
        box.async_configure(
            name=msg.get("name"),
            led=msg.get("led"),
            tv_power=msg.get("tv_power"),
            bluetooth=msg.get("bluetooth"),
            auto_update=msg.get("auto_update"),
            action=msg.get("action"),
            background=msg.get("background"),
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/sync/behavior",
        vol.Required("entry_id"): str,
        vol.Optional("cec_power"): bool,
        vol.Optional("hpd_power"): bool,
        vol.Optional("usb_power"): bool,
        vol.Optional("hpd_switch"): bool,
        vol.Optional("inactivity"): vol.All(int, vol.Range(min=0, max=10000)),
        vol.Optional("arc_bypass"): bool,
        vol.Optional("inputs"): {
            vol.In(SYNC_INPUTS): {
                vol.Optional("cec_switch"): bool,
                vol.Optional("hpd_switch"): bool,
                vol.Optional("auto_sync"): bool,
            }
        },
    }
)
@websocket_api.async_response
async def ws_sync_box_behavior(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """A Sync Box's automatic control and audio pass-through (paired directly only)."""
    box = async_sync_boxes(hass).get(msg["entry_id"])
    if not isinstance(box, SyncBoxCoordinator):
        connection.send_error(
            msg["id"],
            websocket_api.ERR_NOT_FOUND,
            "Not a Sync Box paired with Hue Studio",
        )
        return
    keys = (
        "cec_power",
        "hpd_power",
        "usb_power",
        "hpd_switch",
        "inactivity",
        "arc_bypass",
        "inputs",
    )
    changes = {key: msg[key] for key in keys if key in msg}
    await ws_call(connection, msg, box.async_set_behavior(**changes))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/sync/input",
        vol.Required("entry_id"): str,
        vol.Required("input"): vol.In(SYNC_INPUTS),
        vol.Optional("name"): vol.All(str, vol.Length(min=1, max=SYNC_INPUT_NAME_MAX)),
        # Its type (the Hue Sync app's icon); "type" is the message's own.
        vol.Optional("port_type"): vol.In(SYNC_PORT_TYPES),
    }
)
@websocket_api.async_response
async def ws_sync_box_input(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """An HDMI input's name and type (its icon), on the box (paired directly only)."""
    box = async_sync_boxes(hass).get(msg["entry_id"])
    if not isinstance(box, SyncBoxCoordinator):
        connection.send_error(
            msg["id"],
            websocket_api.ERR_NOT_FOUND,
            "Not a Sync Box paired with Hue Studio",
        )
        return
    await ws_call(
        connection,
        msg,
        box.async_set_input(
            msg["input"], name=msg.get("name"), port_type=msg.get("port_type")
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/sync/follow",
        vol.Required("entry_id"): str,
        # Input -> what its picture starts and the entity telling it (merged; None,
        # or no action: the input is not followed).
        vol.Optional("follow"): {
            vol.In(SYNC_INPUTS): vol.Any(
                None,
                {
                    vol.Optional("action"): vol.Any(None, vol.In(FOLLOW_ACTIONS)),
                    vol.Optional("signal"): vol.Any(
                        None, cv.entity_domain(FOLLOW_SIGNAL_DOMAINS)
                    ),
                    vol.Optional("wake"): vol.Any(
                        None, cv.entity_domain(FOLLOW_WAKE_DOMAINS)
                    ),
                },
            )
        },
        # The screen linked with the box (None: none).
        vol.Optional("screen"): vol.Any(
            None,
            {
                vol.Optional("entity_id"): cv.entity_domain("media_player"),
                vol.Optional("source"): vol.Any(None, str),
                vol.Optional("off_after"): vol.All(
                    int, vol.Range(min=0, max=SCREEN_OFF_AFTER_MAX)
                ),
            },
        ),
    }
)
@callback
def ws_follow_sync_box(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """What a Sync Box does when an input gets a picture, and its screen (paired
    directly only)."""
    box = async_sync_boxes(hass).get(msg["entry_id"])
    if not isinstance(box, SyncBoxCoordinator):
        connection.send_error(
            msg["id"],
            websocket_api.ERR_NOT_FOUND,
            "Not a Sync Box paired with Hue Studio",
        )
        return
    async_set_follow(
        hass,
        box,
        follow=msg.get("follow"),
        screen=msg.get("screen"),
        unlink_screen="screen" in msg and msg["screen"] is None,
    )
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/sync/link_bridge",
        vol.Required("entry_id"): str,
        vol.Required("hue_entry_id"): str,
    }
)
@callback
def ws_link_sync_box_bridge(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Move a Sync Box (paired directly) to another bridge, while subscribed.

    Events: {"step": "press", "timeout": s} (waiting for the bridge's button),
    {"step": "connecting"}, then {"step": "done", "area"} or {"step": "failed",
    "reason"}. Unsubscribing gives up.
    """
    box = async_sync_boxes(hass).get(msg["entry_id"])
    if not isinstance(box, SyncBoxCoordinator):
        connection.send_error(
            msg["id"],
            websocket_api.ERR_NOT_FOUND,
            "Not a Sync Box paired with Hue Studio",
        )
        return

    @callback
    def step(data: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], data))

    async def run() -> None:
        try:
            area = await async_link_box_bridge(hass, box, msg["hue_entry_id"], step)
        except BoxBridgeFailed as err:
            step({"step": "failed", "reason": err.reason})
            return
        except HomeAssistantError:
            step({"step": "failed", "reason": "box"})
            return
        step({"step": "done", "area": area})

    connection.send_result(msg["id"])
    task = hass.async_create_background_task(run(), "hue_studio_link_sync_box")
    connection.subscriptions[msg["id"]] = task.cancel
