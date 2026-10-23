"""WebSocket API for the frontend."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from aiohue import HueBridgeV2
from aiohue.v2.controllers.events import EventType
from aiohue.v2.models.light import Light
from aiohue.v2.models.scene import Scene
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
import voluptuous as vol

from .bridge_setup import (
    BridgeDiscovery,
    LinkFailed,
    async_link,
    async_track_hue_entries,
)
from .bridges import (
    NAME_MAX as BRIDGE_NAME_MAX,
    async_bridges_payload,
    async_rename_bridge,
)
from .const import (
    CONF_AUTO_ALIGN,
    CONF_FOOTER,
    CONF_FOOTER_TABS,
    CONF_GALLERY_RULES,
    CONF_GALLERY_SEASONAL,
    CONF_ORGANIZE,
    FOOTER_MAX_TABS,
    GALLERY_SEASONS,
    SIGNAL_BRIDGES_UPDATED,
    SIGNAL_CONFIG_UPDATED,
    SIGNAL_ENTERTAINMENT_UPDATED,
)
from .devices import (
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
from .entertainment import (
    TYPES as ENTERTAINMENT_TYPES,
    async_create as async_create_entertainment,
    async_delete as async_delete_entertainment,
    async_entertainment_payload,
    async_set_positions as async_set_entertainment_positions,
    async_update as async_update_entertainment,
)
from .lights import (
    HUE_DOMAIN,
    LIGHT_DOMAIN,
    async_all_lights,
    async_bridges,
    light_info,
    light_product,
)
from .migration import (
    SIGNAL_MOVE_UPDATED,
    Selection,
    async_find_lost,
    async_finish_move,
    async_forget_lost,
    async_lost_payload,
    async_move_payload,
    async_move_plan,
    async_retry_move,
    async_select,
    async_select_bridge,
    async_skip_move_device,
    async_start_move,
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
from .options import (
    async_frontend_config,
    async_set_group_area,
    async_set_room_sensors,
    async_update_options,
)
from .positions import (
    SIGNAL_POSITIONS_UPDATED,
    async_positions_payload,
    async_set_positions,
)
from .rooms import (
    async_rooms_payload,
    async_set_light_area,
    async_track_areas,
    async_track_rooms,
)
from .scenes import SCENE_DOMAIN, HueScene, async_all_scenes, scene_info
from .sync import (
    INPUTS as SYNC_INPUTS,
    LED_MODES,
    NAME_MAX as SYNC_NAME_MAX,
    BoxBridgeFailed,
    SyncBoxCoordinator,
    async_link_box_bridge,
    async_sync_boxes,
)
from .sync_follow import (
    ACTIONS as FOLLOW_ACTIONS,
    SCREEN_OFF_AFTER_MAX,
    SIGNAL_DOMAINS as FOLLOW_SIGNAL_DOMAINS,
    async_set_follow,
)


@callback
def async_setup_websocket(hass: HomeAssistant) -> None:
    """Register WebSocket commands."""
    websocket_api.async_register_command(hass, ws_subscribe_lights)
    websocket_api.async_register_command(hass, ws_subscribe_config)
    websocket_api.async_register_command(hass, ws_subscribe_scenes)
    websocket_api.async_register_command(hass, ws_subscribe_sync)
    websocket_api.async_register_command(hass, ws_subscribe_rooms)
    websocket_api.async_register_command(hass, ws_set_light_area)
    websocket_api.async_register_command(hass, ws_set_config)
    websocket_api.async_register_command(hass, ws_subscribe_positions)
    websocket_api.async_register_command(hass, ws_set_positions)
    websocket_api.async_register_command(hass, ws_subscribe_devices)
    websocket_api.async_register_command(hass, ws_search_devices)
    websocket_api.async_register_command(hass, ws_identify_device)
    websocket_api.async_register_command(hass, ws_setup_device)
    websocket_api.async_register_command(hass, ws_set_sensitivity)
    websocket_api.async_register_command(hass, ws_delete_device)
    for command in (
        ws_subscribe_entertainment,
        ws_create_entertainment,
        ws_update_entertainment,
        ws_delete_entertainment,
        ws_entertainment_positions,
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
        ws_move_plan,
        ws_move,
        ws_move_retry,
        ws_move_finish,
        ws_move_skip,
        ws_subscribe_move,
        ws_subscribe_lost,
        ws_find_lost,
        ws_forget_lost,
        ws_configure_sync_box,
        ws_follow_sync_box,
        ws_link_sync_box_bridge,
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


# "MM-DD": a day of any year (a date window of a scene gallery category).
MONTH_DAY = r"^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$"


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/config/set",
        vol.Optional(CONF_AUTO_ALIGN): bool,
        vol.Optional(CONF_ORGANIZE): bool,
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


async def _ws_call(
    connection: websocket_api.ActiveConnection, msg: dict[str, Any], call: Any
) -> None:
    try:
        await call
    except (HomeAssistantError, ServiceValidationError) as err:
        connection.send_error(msg["id"], websocket_api.ERR_INVALID_FORMAT, str(err))
        return
    connection.send_result(msg["id"])


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
    await _ws_call(
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
    await _ws_call(connection, msg, async_identify(hass, msg["device"]))


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
    await _ws_call(
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
    await _ws_call(connection, msg, async_delete_device(hass, msg["device"]))


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
    await _ws_call(
        connection,
        msg,
        async_set_sensitivity(hass, msg["device"], msg["sensitivity"]),
    )


def _subscribe(
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
    _subscribe(
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
    await _ws_call(
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
    await _ws_call(
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
    await _ws_call(connection, msg, async_delete_entertainment(hass, msg["area_id"]))


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
    await _ws_call(
        connection,
        msg,
        async_set_entertainment_positions(hass, msg["area_id"], msg["positions"]),
    )


@websocket_api.websocket_command({vol.Required("type"): "hue_studio/bridges/subscribe"})
@callback
def ws_subscribe_bridges(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """The bridges and their MotionAware areas (bridges.async_bridges_payload)."""
    async_watch_motion_areas(hass)
    _subscribe(
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
    await _ws_call(
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
    await _ws_call(
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
    await _ws_call(connection, msg, async_recalibrate_motion_area(hass, msg["area_id"]))


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
    await _ws_call(connection, msg, async_delete_motion_area(hass, msg["area_id"]))


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
    await _ws_call(
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
    await _ws_call(
        connection, msg, async_rename_bridge(hass, msg["hue_entry_id"], msg["name"])
    )


# What a move to another bridge names: a whole bridge, an area's Hue room or some
# lights; the bridge they go to, and (lights only) the area they go into.
MOVE_SCHEMA = {
    vol.Required("target"): str,
    vol.Exclusive("bridge", "what"): str,
    vol.Exclusive("area", "what"): str,
    vol.Exclusive("lights", "what"): vol.All([cv.entity_id], vol.Length(min=1)),
    vol.Optional("to_area"): str,
}
SERIALS = vol.All([cv.string], vol.Length(max=MAX_SERIALS))
# How each device of a move is found: by Zigbee MAC, its serial number and/or the
# install code of its QR code.
PREPARED = vol.All(
    [
        {
            vol.Required("mac"): vol.Match(MAC_PATTERN),
            vol.Optional("serial"): vol.Match(r"^[0-9A-Fa-f]{6}$"),
            vol.Optional("code"): vol.Match(r"^[0-9A-Fa-f]{36}$"),
        }
    ],
    vol.Length(max=500),
)


def _selection(hass: HomeAssistant, msg: dict[str, Any]) -> Selection:
    if "bridge" in msg:
        return async_select_bridge(hass, msg["bridge"], msg["target"])
    return async_select(
        hass,
        msg["target"],
        area=msg.get("area"),
        lights=msg.get("lights"),
        to_area=msg.get("to_area"),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "hue_studio/bridges/move_plan", **MOVE_SCHEMA}
)
@callback
def ws_move_plan(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """What moving a bridge, a room or lights to another bridge would do
    (migration.async_move_plan); nothing changes."""
    try:
        plan = async_move_plan(hass, _selection(hass, msg))
    except HomeAssistantError as err:
        connection.send_error(msg["id"], websocket_api.ERR_INVALID_FORMAT, str(err))
        return
    connection.send_result(msg["id"], plan)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/bridges/move",
        **MOVE_SCHEMA,
        vol.Optional("prepared", default=list): PREPARED,
    }
)
@websocket_api.async_response
async def ws_move(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Start moving a bridge, a room or lights to another bridge, device by device
    (watched with hue_studio/bridges/move/subscribe)."""
    try:
        selection = _selection(hass, msg)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], websocket_api.ERR_INVALID_FORMAT, str(err))
        return
    await _ws_call(
        connection,
        msg,
        async_start_move(hass, selection, msg["prepared"]),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/bridges/move/retry",
        vol.Optional("prepared", default=list): PREPARED,
        vol.Optional("target"): str,
        vol.Optional("release", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_move_retry(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Search again for the device a move has not found (a serial number or QR code
    given now; `release`: let go by the old bridge first), or on another bridge
    (`target`: the old one, while none has been found)."""
    await _ws_call(
        connection,
        msg,
        async_retry_move(
            hass, msg["prepared"], msg.get("target"), release=msg["release"]
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "hue_studio/bridges/move/skip"})
@websocket_api.async_response
async def ws_move_skip(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Go on without the device not found (it stays on the old bridge, or is kept
    among the lost devices)."""
    await _ws_call(connection, msg, async_skip_move_device(hass))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "hue_studio/bridges/lost/subscribe"}
)
@callback
def ws_subscribe_lost(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Devices a move let go that no bridge took (migration.async_lost_payload)."""
    _subscribe(
        hass, connection, msg, lambda: async_lost_payload(hass), [SIGNAL_MOVE_UPDATED]
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/bridges/lost/find",
        vol.Required("mac"): vol.Match(MAC_PATTERN),
        vol.Required("target"): str,
        vol.Optional("prepared", default=list): PREPARED,
    }
)
@websocket_api.async_response
async def ws_find_lost(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Look for a lost device on a bridge (a move of that device, watched with
    hue_studio/bridges/move/subscribe)."""
    await _ws_call(
        connection,
        msg,
        async_find_lost(hass, msg["mac"], msg["target"], msg["prepared"]),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/bridges/lost/forget",
        vol.Required("mac"): vol.Match(MAC_PATTERN),
    }
)
@websocket_api.async_response
async def ws_forget_lost(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Stop keeping a lost device."""
    await _ws_call(connection, msg, async_forget_lost(hass, msg["mac"]))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "hue_studio/bridges/move/finish"}
)
@websocket_api.async_response
async def ws_move_finish(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Forget a finished move, or stop waiting for lights it has not found."""
    await _ws_call(connection, msg, async_finish_move(hass))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "hue_studio/bridges/move/subscribe"}
)
@callback
def ws_subscribe_move(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """The move to another bridge, as it goes (migration.async_move_payload; null:
    none)."""
    _subscribe(
        hass,
        connection,
        msg,
        lambda: async_move_payload(hass),
        [SIGNAL_MOVE_UPDATED],
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/sync/configure",
        vol.Required("entry_id"): str,
        vol.Optional("name"): vol.All(str, vol.Length(min=1, max=SYNC_NAME_MAX)),
        vol.Optional("led"): vol.In(list(LED_MODES)),
        vol.Optional("tv_power"): bool,
        vol.Optional("bluetooth"): bool,
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
    await _ws_call(
        connection,
        msg,
        box.async_configure(
            name=msg.get("name"),
            led=msg.get("led"),
            tv_power=msg.get("tv_power"),
            bluetooth=msg.get("bluetooth"),
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
