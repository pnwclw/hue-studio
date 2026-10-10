"""Auto light at work: the current selection of every area and who controls its lights.

The selection (`auto_select.py`) is recomputed every minute and whenever an input
changes (weather, light sensor, season entity, settings). When to show it is up to
Home Assistant automations: they call `hue_studio.apply_auto_light`. What Hue Studio
keeps track of is control:

- "auto": auto light may change the lights;
- "manual": someone else changed them (a dashboard, the Hue app, a switch, another
  service) outside the quiet window after auto light's own command; auto light leaves
  them alone until control is set back to "auto" (the select entity, or
  `apply_auto_light` with `resume`);
- "off": auto light is off for the area (stored).
"""

from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta
import logging
import time
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.const import (
    EVENT_HOMEASSISTANT_STOP,
    EVENT_STATE_CHANGED,
    STATE_OFF,
    STATE_ON,
)
from homeassistant.core import (
    Event,
    EventStateChangedData,
    HomeAssistant,
    ServiceCall,
    callback,
)
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import (
    area_registry as ar,
    config_validation as cv,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.helpers.dispatcher import (
    async_dispatcher_connect,
    async_dispatcher_send,
)
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.sun import get_astral_event_date, get_astral_location
from homeassistant.util import dt as dt_util
from homeassistant.util.hass_dict import HassKey
import voluptuous as vol

from . import auto_select
from .auto_light import (
    CONTROL_AUTO,
    CONTROL_MANUAL,
    CONTROL_OFF,
    SIGNAL_AUTO_LIGHT_UPDATED,
    AutoLightStore,
    auto_light_store,
)
from .const import DOMAIN
from .gallery import async_gallery_scenes
from .lights import ATTR_IS_HUE_GROUP, LIGHT_DOMAIN, async_all_lights
from .rooms import light_area

_LOGGER = logging.getLogger(__name__)

# An area's state changed (selection or control): f"{SIGNAL_AREA}_{area_id}".
SIGNAL_AREA = f"{DOMAIN}_auto_light_area"
# Areas were added or removed.
SIGNAL_AREAS = f"{DOMAIN}_auto_light_areas"
# Any area's state changed (for the panel's subscription).
SIGNAL_ANY_AREA = f"{DOMAIN}_auto_light_any_area"
# Entity keys of an area (auto_entity.py) -> their platform.
ENTITY_KEYS = {
    "light_control": "select",
    "light_phase": "sensor",
    "light_scene": "sensor",
    "light_brightness": "sensor",
    "light_offset": "number",
    "next_light_scene": "button",
}
REFRESH_INTERVAL = timedelta(minutes=1)
# Changes within this long after auto light's own command are its own.
QUIET_SECONDS = 15
# Attributes compared to tell a real change from the bridge settling.
COMPARED = ("brightness", "xy_color", "color_mode", "color_temp_kelvin")


@dataclass(slots=True)
class AreaState:
    """Runtime state of one area."""

    selection: auto_select.Selection | None = None
    manual: bool = False
    # time.monotonic() of auto light's last command.
    applied_at: float = -1e9


class AutoLightManager:
    """Selections and control of every area with auto light settings."""

    def __init__(self, hass: HomeAssistant, store: AutoLightStore) -> None:
        """Create the manager (start it with `async_start`)."""
        self.hass = hass
        self.store = store
        self.areas: dict[str, AreaState] = {}
        self._unsubs: list[Callable[[], None]] = []
        self._inputs: set[str] = set()
        # Gallery scene id -> name, for scenes without a name of their own.
        self.gallery_names: dict[str, str] = {}

    def scene_name(self, area_id: str, scene: str) -> str:
        """The name of a scene: the area's own for it, else the gallery's."""
        names = (self.store.areas.get(area_id) or {}).get("names") or {}
        return names.get(scene) or self.gallery_names.get(scene, scene)

    # ---- life cycle ----

    @callback
    def async_start(self) -> None:
        """Compute now, then keep up with time, inputs and the lights."""

        @callback
        def tick(_: datetime) -> None:
            self.async_refresh()

        self._unsubs.append(
            async_track_time_interval(self.hass, tick, REFRESH_INTERVAL)
        )
        self._unsubs.append(
            async_dispatcher_connect(
                self.hass, SIGNAL_AUTO_LIGHT_UPDATED, self._async_store_changed
            )
        )
        self._unsubs.append(
            self.hass.bus.async_listen(
                EVENT_STATE_CHANGED, self._async_state_changed, self._watched
            )
        )
        self._async_store_changed()

    @callback
    def async_stop(self) -> None:
        """Stop listening."""
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()

    @callback
    def _async_store_changed(self) -> None:
        known = set(self.areas)
        for area_id in self.store.areas:
            self.areas.setdefault(area_id, AreaState())
        for area_id in known - set(self.store.areas):
            del self.areas[area_id]
        self._inputs = {
            entity_id
            for area_id in self.store.areas
            for key in ("weather", "light_sensor", "season")
            if (entity_id := self._settings(area_id).get(key))
        }
        if set(self.areas) != known:
            async_dispatcher_send(self.hass, SIGNAL_AREAS)
        self.async_refresh()

    # ---- selection ----

    @callback
    def _async_changed(self, area_id: str) -> None:
        async_dispatcher_send(self.hass, f"{SIGNAL_AREA}_{area_id}")
        async_dispatcher_send(self.hass, SIGNAL_ANY_AREA)

    @callback
    def panel_state(self, area_id: str) -> dict[str, Any]:
        """What the panel shows of an area: its selection and who controls it."""
        state = self.areas.get(area_id)
        selection = state.selection if state else None
        info: dict[str, Any] = {"control": self.control(area_id)}
        if selection is not None:
            info |= {
                "phase": selection.phase,
                "pool_phase": selection.pool_phase,
                "season": selection.season,
                "mood": selection.mood,
                "holiday": selection.holiday,
                "scene": selection.scene,
                "scene_name": self.scene_name(area_id, selection.scene)
                if selection.scene
                else None,
                "brightness": selection.brightness,
                "step": selection.step,
                "pool": list(selection.pool),
            }
        return info

    def _settings(self, area_id: str) -> dict[str, Any]:
        return (self.store.areas.get(area_id) or {}).get("settings") or {}

    def _number(self, entity_id: str | None, attribute: str | None = None) -> Any:
        state = self.hass.states.get(entity_id) if entity_id else None
        if state is None:
            return None
        value = state.attributes.get(attribute) if attribute else state.state
        try:
            return float(value)
        except TypeError, ValueError:
            return None

    def inputs(self, area_id: str, now: datetime | None = None) -> auto_select.Inputs:
        """What the selection of an area depends on, right now."""
        now = dt_util.as_local(now or dt_util.now())
        settings = self._settings(area_id)
        location, elevation = get_astral_location(self.hass)
        sun_elevation = location.solar_elevation(now, elevation)
        day = now.date()
        sunrise = get_astral_event_date(self.hass, "sunrise", day)
        sunset = get_astral_event_date(self.hass, "sunset", day)
        weather = self.hass.states.get(settings.get("weather") or "")
        season = self.hass.states.get(settings.get("season") or "")
        return auto_select.Inputs(
            now=now,
            sunrise=dt_util.as_local(sunrise) if sunrise else None,
            sunset=dt_util.as_local(sunset) if sunset else None,
            elevation=sun_elevation,
            season_state=season.state if season else None,
            condition=weather.state if weather else None,
            cloud=self._number(settings.get("weather"), "cloud_coverage")
            if weather
            else None,
            lux=self._number(settings.get("light_sensor")),
        )

    @callback
    def async_refresh(self, area_id: str | None = None) -> None:
        """Recompute selections; tell the entities of areas that changed."""
        for area in [area_id] if area_id else list(self.areas):
            state = self.areas.get(area)
            config = self.store.areas.get(area)
            if state is None or config is None:
                continue
            selection = auto_select.select(config, self.inputs(area), config["skip"])
            if selection != state.selection:
                state.selection = selection
                self._async_changed(area)

    # ---- control ----

    def control(self, area_id: str) -> str:
        """Who controls the area's lights: auto, manual or off."""
        config = self.store.areas.get(area_id) or {}
        if config.get("control") == CONTROL_OFF:
            return CONTROL_OFF
        state = self.areas.get(area_id)
        return CONTROL_MANUAL if state and state.manual else CONTROL_AUTO

    async def async_set_control(self, area_id: str, control: str) -> None:
        """Set control from the outside (the select entity, a service)."""
        state = self.areas[area_id]
        config = self.store.area(area_id)
        stored = CONTROL_OFF if control == CONTROL_OFF else CONTROL_AUTO
        state.manual = control == CONTROL_MANUAL
        if config["control"] != stored:
            config["control"] = stored
            await self.store.async_set(area_id, config)
        self._async_changed(area_id)

    @callback
    def _watched(self, data: EventStateChangedData) -> bool:
        """Event filter: inputs of a selection, and lights while there are areas."""
        entity_id = data["entity_id"]
        return entity_id in self._inputs or (
            bool(self.areas) and entity_id.startswith(f"{LIGHT_DOMAIN}.")
        )

    @callback
    def _async_state_changed(self, event: Event[EventStateChangedData]) -> None:
        entity_id = event.data["entity_id"]
        if entity_id in self._inputs:
            self.async_refresh()
            return
        old, new = event.data["old_state"], event.data["new_state"]
        if (
            old is None
            or new is None
            or old.state not in (STATE_ON, STATE_OFF)
            or new.state not in (STATE_ON, STATE_OFF)
            or new.attributes.get(ATTR_IS_HUE_GROUP)
        ):
            return
        entry = er.async_get(self.hass).async_get(entity_id)
        if entry is None or entry.platform != "hue":
            return
        area_id = light_area(entry, dr.async_get(self.hass))
        state = self.areas.get(area_id or "")
        if state is None or state.manual or self.control(area_id) != CONTROL_AUTO:
            return
        if time.monotonic() - state.applied_at < QUIET_SECONDS:
            return
        before = {"state": old.state, **{k: old.attributes.get(k) for k in COMPARED}}
        after = {"state": new.state, **{k: new.attributes.get(k) for k in COMPARED}}
        if auto_select.is_real_change(before, after):
            _LOGGER.debug("%s changed by hand: %s is manual now", entity_id, area_id)
            state.manual = True
            self._async_changed(area_id)

    # ---- acting ----

    def area_lights(self, area_id: str) -> list[str]:
        """Hue light entities in the area."""
        entities = er.async_get(self.hass)
        devices = dr.async_get(self.hass)
        return [
            light.entity_id
            for light in async_all_lights(self.hass)
            if (entry := entities.async_get(light.entity_id))
            and light_area(entry, devices) == area_id
        ]

    async def async_apply(
        self,
        area_id: str,
        *,
        transition: float | None = None,
        force: bool = False,
        resume: bool = False,
    ) -> bool:
        """Show the area's selection on its Hue lights.

        Nothing happens while control is manual or off (unless `force`); `resume`
        hands a manual area back to auto light first. Returns whether it applied.
        """
        state = self.areas[area_id]
        if resume and state.manual:
            await self.async_set_control(area_id, CONTROL_AUTO)
        if not force and self.control(area_id) != CONTROL_AUTO:
            return False
        self.async_refresh(area_id)
        selection = state.selection
        lights = self.area_lights(area_id)
        if selection is None or selection.scene is None or not lights:
            return False
        data: dict[str, Any] = {
            "entity_id": lights,
            "gallery_scene": selection.scene,
            "brightness": selection.brightness,
        }
        if transition is not None:
            data["transition"] = transition
        if mode := self._settings(area_id).get("gradient_mode"):
            data["mode"] = mode
        state.applied_at = time.monotonic()
        await self.hass.services.async_call(
            DOMAIN, "apply_palette", data, blocking=True
        )
        # The lights report back after the call: the quiet window starts now.
        state.applied_at = time.monotonic()
        return True

    async def async_next_scene(self, area_id: str) -> None:
        """Another scene from the pool, for the rest of the day and phase."""
        state = self.areas[area_id]
        self.async_refresh(area_id)
        selection = state.selection
        if selection is None:
            return
        config = self.store.area(area_id)
        skip = config["skip"]
        same = skip.get("date") == selection.light_day.isoformat() and (
            skip.get("phase") == selection.pool_phase
        )
        config["skip"] = {
            "date": selection.light_day.isoformat(),
            "phase": selection.pool_phase,
            "n": (int(skip.get("n") or 0) if same else 0) + 1,
        }
        await self.store.async_set(area_id, config)

    async def async_set_offset(self, area_id: str, value: int) -> None:
        """Set the brightness offset of the current (pool) phase."""
        state = self.areas[area_id]
        self.async_refresh(area_id)
        if state.selection is None:
            return
        config = self.store.area(area_id)
        config["offsets"][state.selection.pool_phase] = value
        await self.store.async_set(area_id, config)


_MANAGER: HassKey[AutoLightManager] = HassKey(f"{DOMAIN}_auto_light_manager")

SERVICE_APPLY = "apply_auto_light"
ATTR_AREA = "area"
ATTR_TRANSITION = "transition"
ATTR_FORCE = "force"
ATTR_RESUME = "resume"


def auto_light_manager(hass: HomeAssistant) -> AutoLightManager:
    """The manager (set up with the integration)."""
    return hass.data[_MANAGER]


async def async_setup_auto_control(hass: HomeAssistant) -> None:
    """Start the manager; register `apply_auto_light` and the settings command."""
    manager = hass.data[_MANAGER] = AutoLightManager(hass, auto_light_store(hass))
    gallery = await async_gallery_scenes(hass)
    manager.gallery_names = {key: scene["name"] for key, scene in gallery.items()}
    manager.async_start()

    @callback
    def stop(_: Event) -> None:
        manager.async_stop()

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, stop)

    async def apply(call: ServiceCall) -> None:
        for area_id in call.data[ATTR_AREA]:
            if area_id not in manager.areas:
                raise ServiceValidationError(
                    translation_domain=DOMAIN,
                    translation_key="no_auto_light",
                    translation_placeholders={"area": area_id},
                )
        for area_id in call.data[ATTR_AREA]:
            await manager.async_apply(
                area_id,
                transition=call.data.get(ATTR_TRANSITION),
                force=call.data[ATTR_FORCE],
                resume=call.data[ATTR_RESUME],
            )

    hass.services.async_register(
        DOMAIN,
        SERVICE_APPLY,
        apply,
        schema=vol.Schema(
            {
                vol.Required(ATTR_AREA): vol.All(cv.ensure_list, [cv.string]),
                vol.Optional(ATTR_TRANSITION): vol.All(
                    vol.Coerce(float), vol.Range(min=0, max=6000)
                ),
                vol.Optional(ATTR_FORCE, default=False): cv.boolean,
                vol.Optional(ATTR_RESUME, default=False): cv.boolean,
            }
        ),
    )
    websocket_api.async_register_command(hass, ws_auto_light_settings)
    websocket_api.async_register_command(hass, ws_subscribe_auto_light)
    websocket_api.async_register_command(hass, ws_auto_light_update)
    websocket_api.async_register_command(hass, ws_auto_light_remove)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/auto_light/settings",
        vol.Required("area_id"): str,
        vol.Required("settings"): dict,
    }
)
@websocket_api.async_response
async def ws_auto_light_settings(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Merge settings into an area's auto light (an area without any gets it now).

    A key set to None is removed (back to the default).
    """
    store = auto_light_store(hass)
    area_id = msg["area_id"]
    if ar.async_get(hass).async_get_area(area_id) is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, area_id)
        return
    config = store.area(area_id)
    settings = {**config["settings"], **msg["settings"]}
    config["settings"] = {k: v for k, v in settings.items() if v is not None}
    try:
        await store.async_set(area_id, config)
    except vol.Invalid as err:
        connection.send_error(msg["id"], websocket_api.ERR_INVALID_FORMAT, str(err))
        return
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {vol.Required("type"): "hue_studio/auto_light/subscribe"}
)
@callback
def ws_subscribe_auto_light(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Send auto light settings and state now and whenever they change.

    Event payload (always complete):
        {"areas": {area_id: settings (auto_light.py)},
         "state": {area_id: {"control", "phase", "pool_phase", "season", "mood",
                             "holiday", "scene", "scene_name", "brightness", "step",
                             "pool"}},
         "entities": {area_id: {entity key: entity_id}}}
    """
    manager = auto_light_manager(hass)
    entities = er.async_get(hass)
    last: dict[str, Any] = {}

    @callback
    def send() -> None:
        payload = {
            "areas": manager.store.areas,
            "state": {
                area_id: manager.panel_state(area_id) for area_id in manager.areas
            },
            "entities": {
                area_id: {
                    key: entity_id
                    for key, platform in ENTITY_KEYS.items()
                    if (
                        entity_id := entities.async_get_entity_id(
                            platform, DOMAIN, f"auto_light_{area_id}_{key}"
                        )
                    )
                }
                for area_id in manager.areas
            },
        }
        if payload == last.get("payload"):
            return
        last["payload"] = deepcopy(payload)
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    @callback
    def registry_changed(_: Event) -> None:
        send()

    unsubs = [
        async_dispatcher_connect(hass, SIGNAL_AUTO_LIGHT_UPDATED, send),
        async_dispatcher_connect(hass, SIGNAL_ANY_AREA, send),
        # Entities are registered a moment after an area appears.
        hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, registry_changed),
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
        vol.Required("type"): "hue_studio/auto_light/update",
        vol.Required("area_id"): str,
        vol.Optional("holidays"): list,
        vol.Optional("excluded"): [str],
    }
)
@websocket_api.async_response
async def ws_auto_light_update(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Replace an area's holidays or excluded scenes (pools: auto_light_pool)."""
    store = auto_light_store(hass)
    area_id = msg["area_id"]
    if area_id not in store.areas:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, area_id)
        return
    config = store.area(area_id)
    for key in ("holidays", "excluded"):
        if key in msg:
            config[key] = msg[key]
    try:
        await store.async_set(area_id, config)
    except vol.Invalid as err:
        connection.send_error(msg["id"], websocket_api.ERR_INVALID_FORMAT, str(err))
        return
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "hue_studio/auto_light/remove",
        vol.Required("area_id"): str,
    }
)
@websocket_api.async_response
async def ws_auto_light_remove(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Take auto light away from an area: its settings, entities and device."""
    area_id = msg["area_id"]
    await auto_light_store(hass).async_remove(area_id)
    devices = dr.async_get(hass)
    if device := devices.async_get_device({(DOMAIN, f"auto_light_{area_id}")}):
        devices.async_remove_device(device.id)
    connection.send_result(msg["id"])
