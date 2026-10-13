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

from .bridges import (
    SIGNAL_BRIDGES_UPDATED,
    async_bridges_payload,
    async_set_motion_area,
)
from .const import (
    CONF_AUTO_ALIGN,
    CONF_FOOTER,
    CONF_FOOTER_TABS,
    CONF_GALLERY_RULES,
    CONF_GALLERY_SEASONAL,
    CONF_HUE_ENTRY_ID,
    DOMAIN,
    FOOTER_MAX_TABS,
    GALLERY_SEASONS,
    SIGNAL_CONFIG_UPDATED,
    SIGNAL_ENTERTAINMENT_UPDATED,
)
from .devices import (
    MAX_SERIALS,
    SIGNAL_DEVICES_UPDATED,
    async_devices_payload,
    async_identify,
    async_search,
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
from .options import (
    async_frontend_config,
    async_set_group_area,
    async_set_room_sensors,
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
from .sync import async_sync_boxes


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
    for command in (
        ws_subscribe_entertainment,
        ws_create_entertainment,
        ws_update_entertainment,
        ws_delete_entertainment,
        ws_entertainment_positions,
        ws_subscribe_bridges,
        ws_set_motion_area,
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
    """Send the room mapping and room sensors now and whenever options change.

    Event payload:
        {"groups": {group entity_id: "zone" | area_id},
         "rooms": {"area.<id>" | "hue.<group entity_id>":
                   {"motion": [entity_id], "temperature": [entity_id]}}}
    """

    @callback
    def send() -> None:
        connection.send_message(
            websocket_api.event_message(msg["id"], async_frontend_config(hass))
        )

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(
        hass, SIGNAL_CONFIG_UPDATED, send
    )
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
    # Area lights and streaming flags come from the bridge.
    unsubscribers.append(
        async_dispatcher_connect(hass, SIGNAL_ENTERTAINMENT_UPDATED, send)
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
                    "group": room entity | None, "lights": [...]}],
         "moves": [{"lights", "area", "from": room name | None, "from_group",
                    "from_area": area whose room the lights are in now | None}],
         "empty": [{"name", "group", "scenes": count}],
         "scenes": [{"entity_id", "name", "group_name", "lost", "missing"}],
         "conflicts": [light entity ids],
         "hue_rooms": {light entity id: its Hue room's name}}
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
    """Change options from the panel's settings (every bridge entry alike).

    The same options as the options flow; open panels get them through
    hue_studio/config/subscribe.
    """
    changes = {
        k: v
        for k, v in msg.items()
        if k
        in (
            CONF_AUTO_ALIGN,
            CONF_FOOTER,
            CONF_FOOTER_TABS,
            CONF_GALLERY_SEASONAL,
            CONF_GALLERY_RULES,
        )
    }
    for entry in hass.config_entries.async_entries(DOMAIN):
        if CONF_HUE_ENTRY_ID in entry.data:
            hass.config_entries.async_update_entry(
                entry, options={**entry.options, **changes}
            )
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


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/devices/search",
        vol.Optional("hue_entry_id"): str,
        vol.Optional("serials", default=list): vol.All(
            [cv.string], vol.Length(max=MAX_SERIALS)
        ),
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
        connection, msg, async_search(hass, msg.get("hue_entry_id"), msg["serials"])
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
    }
)
@websocket_api.async_response
async def ws_setup_device(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Name a Hue device, put it into an area and its lights into that Hue room
    (a motion sensor's sensitivity too)."""
    await _ws_call(
        connection,
        msg,
        async_setup_device(
            hass,
            msg["device"],
            msg.get("name"),
            msg.get("area_id"),
            msg.get("sensitivity"),
        ),
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
        if data == last.get("payload"):
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
        [SIGNAL_ENTERTAINMENT_UPDATED],
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
    _subscribe(
        hass,
        connection,
        msg,
        lambda: async_bridges_payload(hass),
        [SIGNAL_BRIDGES_UPDATED],
    )


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
    """Switch a MotionAware area on or off."""
    await _ws_call(
        connection, msg, async_set_motion_area(hass, msg["area_id"], msg["enabled"])
    )


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
