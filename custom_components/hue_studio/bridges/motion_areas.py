"""MotionAware areas (Hue Bridge Pro): lights that sense motion.

What a bridge does with them (as the Hue app uses it; the API reference says little):

- An area is a `motion_area_configuration`: a name, the Hue room or zone it is in (or
  the whole home, `bridge_home`), 3 or 4 lights as participants and whether it runs.
  Participants are `motion_area_candidate`s, one per light device that can sense
  (aiohue does not keep them, so they are read here). The bridge adds the area's two
  sensors itself: `convenience_area_motion` (for lights) and `security_area_motion`
  (for Hue Secure alerts), each with its own sensitivity (0-4).
- Calibration has no command of its own: whenever an area is switched on or its lights
  change, the bridge measures the empty room for about 30 s. Each light is `unhealthy`
  until it is done, then `healthy`. Recalibrating is switching the area off and on
  again, as the Hue app does.
- What lights do on motion in the Hue app is a "Motion Sensor" behavior on the bridge
  (a `behavior_instance` whose source is the area, or a sensor group that holds the
  area's sensor). Hue Studio shows those and can switch them off; its own response is
  a Hue Studio motion automation on the area's sensor (the native `hue` makes one
  binary sensor per area, keyed by its `security_area_motion`).
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field
import logging
import time
from typing import Any

from aiohttp import ClientError
from aiohue import HueBridgeV2
from aiohue.errors import AiohueException
from aiohue.v2.controllers.events import EventType
from aiohue.v2.models.device import Device
from aiohue.v2.models.resource import ResourceTypes
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.util.hass_dict import HassKey

from ..const import DOMAIN, SIGNAL_BRIDGES_UPDATED
from ..lights.bridge import async_bridges

_LOGGER = logging.getLogger(__name__)

ENDPOINT = "clip/v2/resource/motion_area_configuration"
CANDIDATES = "clip/v2/resource/motion_area_candidate"
NAME_MAX = 32
# The Hue app's limits: three lights at least (fewer cannot tell where motion is),
# four at most.
MIN_LIGHTS = 3
MAX_LIGHTS = 4
# How long a calibration takes on the bridge (about 30 s), with room to spare: after
# this, a light that is still not healthy has a problem.
CALIBRATION_S = 30
CALIBRATION_LIMIT_S = 120


@dataclass
class _Watch:
    """MotionAware state the bridges' objects do not keep."""

    # hue entry id -> (bridge, unsubscribe)
    watching: dict[str, tuple[HueBridgeV2, Callable[[], None]]] = field(
        default_factory=dict
    )
    # hue entry id -> candidates [{"id", "device"}]; None: not read yet
    candidates: dict[str, list[dict[str, str]]] = field(default_factory=dict)
    # area id -> when its calibration started (switched on, lights changed)
    calibration: dict[str, float] = field(default_factory=dict)
    # area id -> (enabled, participant ids) last seen
    seen: dict[str, tuple[bool, tuple[str, ...]]] = field(default_factory=dict)
    # sensor id -> (enabled, sensitivity) last seen (motion events come often)
    sensors: dict[str, tuple[Any, ...]] = field(default_factory=dict)


DATA: HassKey[_Watch] = HassKey(f"{DOMAIN}_motion_areas")


def _watch(hass: HomeAssistant) -> _Watch:
    if (watch := hass.data.get(DATA)) is None:
        watch = hass.data[DATA] = _Watch()
    return watch


def has_motion_aware(bridge: HueBridgeV2) -> bool:
    """Whether aiohue knows MotionAware on this bridge at all."""
    return getattr(bridge.config, "motion_area_configuration", None) is not None


@callback
def async_watch_bridges(hass: HomeAssistant) -> None:
    """Follow what the bridges' objects keep no signal for (idempotent): candidates,
    calibrations starting, the areas' sensors and the Hue app's responses."""
    watch = _watch(hass)
    for hue_entry_id, bridge in async_bridges(hass).items():
        watched = watch.watching.get(hue_entry_id)
        if watched is not None and watched[0] is bridge:
            continue
        if watched is not None:
            watched[1]()
        if not has_motion_aware(bridge):
            continue
        watch.watching[hue_entry_id] = (
            bridge,
            _subscribe(hass, watch, hue_entry_id, bridge),
        )
        for config in bridge.config.motion_area_configuration:
            watch.seen[config.id] = _state(config)
        hass.async_create_background_task(
            async_read_candidates(hass, hue_entry_id, bridge),
            "hue_studio_motion_candidates",
        )


@callback
def async_stop_watching(hass: HomeAssistant) -> None:
    """Stop following the bridges (Hue Studio unloads)."""
    if (watch := hass.data.pop(DATA, None)) is None:
        return
    for _, unsubscribe in watch.watching.values():
        unsubscribe()


def _state(config: Any) -> tuple[bool, tuple[str, ...]]:
    return bool(config.enabled), tuple(p.resource.rid for p in config.participants)


def _subscribe(
    hass: HomeAssistant, watch: _Watch, hue_entry_id: str, bridge: HueBridgeV2
) -> Callable[[], None]:
    def changed() -> None:
        async_dispatcher_send(hass, SIGNAL_BRIDGES_UPDATED)

    @callback
    def area_changed(event_type: EventType, item: Any) -> None:
        if event_type == EventType.RESOURCE_DELETED:
            watch.seen.pop(item.id, None)
            watch.calibration.pop(item.id, None)
            return
        state = _state(item)
        before = watch.seen.get(item.id)
        watch.seen[item.id] = state
        # Switched on, or other lights: the bridge calibrates.
        if state[0] and (before is None or not before[0] or before[1] != state[1]):
            watch.calibration[item.id] = time.time()
        known = _known(watch, hue_entry_id)
        if any(p.resource.rid not in known for p in item.participants):
            hass.async_create_background_task(
                async_read_candidates(hass, hue_entry_id, bridge),
                "hue_studio_motion_candidates",
            )
        # connections.py signals the change itself.

    @callback
    def sensor_changed(event_type: EventType, item: Any) -> None:
        value = (getattr(item, "enabled", None), _sensitivity_value(item))
        deleted = event_type == EventType.RESOURCE_DELETED
        if deleted or watch.sensors.get(item.id) != value:
            watch.sensors[item.id] = value
            changed()

    @callback
    def device_changed(event_type: EventType, item: Any) -> None:
        # A light added or deleted: the candidates change with it.
        if isinstance(item, Device):
            hass.async_create_background_task(
                async_read_candidates(hass, hue_entry_id, bridge),
                "hue_studio_motion_candidates",
            )

    unsubs = [
        bridge.config.motion_area_configuration.subscribe(area_changed),
        bridge.config.behavior_instance.subscribe(lambda *_: changed()),
        bridge.config.service_group.subscribe(lambda *_: changed()),
        bridge.devices.subscribe(
            device_changed,
            event_filter=(EventType.RESOURCE_ADDED, EventType.RESOURCE_DELETED),
        ),
    ]
    for controller in (
        bridge.sensors.convenience_area_motion,
        bridge.sensors.security_area_motion,
    ):
        unsubs.append(controller.subscribe(sensor_changed))

    def unsubscribe() -> None:
        for unsub in unsubs:
            unsub()

    return unsubscribe


def _known(watch: _Watch, hue_entry_id: str) -> set[str]:
    return {c["id"] for c in watch.candidates.get(hue_entry_id) or []}


async def async_read_candidates(
    hass: HomeAssistant, hue_entry_id: str, bridge: HueBridgeV2
) -> None:
    """Read which lights can sense motion (aiohue does not keep them)."""
    try:
        items = await bridge.request("get", CANDIDATES)
    except (AiohueException, ClientError, TimeoutError) as err:
        _LOGGER.debug("MotionAware candidates not read: %s", err)
        return
    found = [
        {"id": item["id"], "device": item["owner"]["rid"]}
        for item in items
        if isinstance(item, dict) and isinstance(item.get("owner"), dict)
    ]
    watch = _watch(hass)
    if watch.candidates.get(hue_entry_id) != found:
        watch.candidates[hue_entry_id] = found
        async_dispatcher_send(hass, SIGNAL_BRIDGES_UPDATED)


def _sensitivity_value(sensor: Any) -> int | None:
    value = getattr(getattr(sensor, "sensitivity", None), "sensitivity", None)
    return value if isinstance(value, int) else None


def _service(config: Any, rtype: ResourceTypes) -> str | None:
    return next((s.rid for s in config.services if s.rtype == rtype), None)


def _sensitivity(controller: Any, rid: str | None) -> dict[str, int] | None:
    """{"value", "max"} of an area's sensor."""
    sensor = controller.get(rid) if rid else None
    value = _sensitivity_value(sensor)
    if value is None:
        return None
    top = getattr(sensor.sensitivity, "sensitivity_max", None)
    return {"value": value, "max": top if isinstance(top, int) else max(value, 4)}


def _group(bridge: HueBridgeV2, rid: str) -> tuple[str, str | None]:
    """(type, name) of an area's group: a room, a zone or the whole home."""
    if (room := bridge.groups.room.get(rid)) is not None:
        return "room", room.metadata.name
    if (zone := bridge.groups.zone.get(rid)) is not None:
        return "zone", zone.metadata.name
    return "home", None


def _responses(bridge: HueBridgeV2, config: Any) -> list[dict[str, Any]]:
    """The Hue app's "what happens on motion" of an area: bridge behaviors whose
    source is the area or a sensor group holding one of its sensors."""
    services = {s.rid for s in config.services}
    sources = {config.id} | {
        group.id
        for group in bridge.config.service_group
        if any(child.rid in services for child in group.children)
    }
    found = []
    for behavior in bridge.config.behavior_instance:
        configuration = behavior.configuration or {}
        source = (configuration.get("source") or {}).get("rid")
        motion = (configuration.get("motion") or {}).get("motion_service") or {}
        if source not in sources and motion.get("rid") not in services:
            continue
        when = (configuration.get("motion") or {}).get("when") or {}
        found.append(
            {
                "id": behavior.id,
                "name": getattr(behavior.metadata, "name", None),
                "enabled": bool(behavior.enabled),
                "slots": len(when.get("timeslots") or []),
            }
        )
    return found


@callback
def async_bridge_payload(
    hass: HomeAssistant, hue_entry_id: str, bridge: HueBridgeV2
) -> dict[str, Any]:
    """MotionAware of one bridge, for the bridges payload:

    {"motion_areas": [{"id", "name", "group", "group_id", "group_type", "enabled",
                       "health", "calibrating", "calibration_started",
                       "lights": [{"id", "entity_id", "device", "health"}],
                       "sensitivity": {"value", "max"} | None,
                       "security_sensitivity": {"value", "max"} | None,
                       "sensor", "responses": [{"id", "name", "enabled", "slots"}]}],
     "motion_lights": [{"id", "device", "entity_id", "name"}] | None,
     "motion_groups": [{"id", "type", "name", "lights": [candidate ids]}]}

    `group_type`: "room", "zone" or "home" (the whole home). A light's `health` is
    None until the bridge says. `calibrating`: switched on or given other lights less
    than two minutes ago and not every light healthy yet. `sensor`: the native
    binary sensor. `motion_lights`: the lights that can sense (None until read).
    `motion_groups`: the bridge's rooms and zones with the lights of theirs that can.
    """
    watch = _watch(hass)
    entities = {
        e.unique_id: e.entity_id
        for e in er.async_entries_for_config_entry(er.async_get(hass), hue_entry_id)
    }
    candidates = watch.candidates.get(hue_entry_id)
    device_of = {c["id"]: c["device"] for c in candidates or []}

    def light_of(device_id: str | None) -> str | None:
        device = bridge.devices.get(device_id) if device_id else None
        if device is None:
            return None
        return next((entities[r] for r in device.lights if r in entities), None)

    def device_name(device_id: str) -> str | None:
        device = bridge.devices.get(device_id)
        return device.metadata.name if device else None

    now = time.time()
    areas = []
    for config in bridge.config.motion_area_configuration:
        group_type, group_name = _group(bridge, config.group.rid)
        lights = [
            {
                "id": p.resource.rid,
                "device": device_of.get(p.resource.rid),
                "entity_id": light_of(device_of.get(p.resource.rid)),
                "health": p.status.health.value
                if p.status.health.value != "unknown"
                else None,
            }
            for p in config.participants
        ]
        started = watch.calibration.get(config.id)
        calibrating = (
            bool(config.enabled)
            and started is not None
            and now - started < CALIBRATION_LIMIT_S
            and any(light["health"] != "healthy" for light in lights)
        )
        security = _service(config, ResourceTypes.SECURITY_AREA_MOTION)
        areas.append(
            {
                "id": config.id,
                "name": config.name,
                "group": group_name,
                "group_id": config.group.rid,
                "group_type": group_type,
                "enabled": bool(config.enabled),
                "health": config.health.value,
                "calibrating": calibrating,
                "calibration_started": started if calibrating else None,
                "lights": lights,
                "sensitivity": _sensitivity(
                    bridge.sensors.convenience_area_motion,
                    _service(config, ResourceTypes.CONVENIENCE_AREA_MOTION),
                ),
                "security_sensitivity": _sensitivity(
                    bridge.sensors.security_area_motion, security
                ),
                "sensor": entities.get(security) if security else None,
                "responses": _responses(bridge, config),
            }
        )
    groups = []
    if candidates is not None:
        by_device = {c["device"]: c["id"] for c in candidates}
        for room in bridge.groups.room:
            members = [by_device[c.rid] for c in room.children if c.rid in by_device]
            groups.append(
                {
                    "id": room.id,
                    "type": "room",
                    "name": room.metadata.name,
                    "lights": members,
                }
            )
        for zone in bridge.groups.zone:
            devices = []
            for child in zone.children:
                light = bridge.lights.get(child.rid)
                owner = light.owner.rid if light is not None else None
                if owner in by_device and by_device[owner] not in devices:
                    devices.append(by_device[owner])
            groups.append(
                {
                    "id": zone.id,
                    "type": "zone",
                    "name": zone.metadata.name,
                    "lights": devices,
                }
            )
    return {
        "motion_areas": areas,
        "motion_lights": [
            {
                "id": c["id"],
                "device": c["device"],
                "entity_id": light_of(c["device"]),
                "name": device_name(c["device"]),
            }
            for c in candidates
        ]
        if candidates is not None
        else None,
        "motion_groups": groups,
    }


def _find(hass: HomeAssistant, area_id: str) -> tuple[str, HueBridgeV2, Any]:
    for hue_entry_id, bridge in async_bridges(hass).items():
        if not has_motion_aware(bridge):
            continue
        if (config := bridge.config.motion_area_configuration.get(area_id)) is not None:
            return hue_entry_id, bridge, config
    raise ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key="unknown_motion_area",
        translation_placeholders={"area": area_id},
    )


async def _request(
    bridge: HueBridgeV2, method: str, path: str, name: str, **kwargs: Any
) -> Any:
    try:
        return await bridge.request(method, path, **kwargs)
    except (AiohueException, ClientError, TimeoutError) as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="command_failed",
            translation_placeholders={"entity_id": name},
        ) from err


def _participants(
    hass: HomeAssistant, hue_entry_id: str, bridge: HueBridgeV2, lights: list[str]
) -> list[dict[str, Any]]:
    """Participants for these light entities (each must be able to sense)."""
    sensing = {
        light["entity_id"]: light["id"]
        for light in async_bridge_payload(hass, hue_entry_id, bridge)["motion_lights"]
        or []
        if light["entity_id"]
    }
    lights = list(dict.fromkeys(lights))
    if not MIN_LIGHTS <= len(lights) <= MAX_LIGHTS:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="motion_area_lights",
            translation_placeholders={"min": str(MIN_LIGHTS), "max": str(MAX_LIGHTS)},
        )
    for entity_id in lights:
        if entity_id not in sensing:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="not_motion_light",
                translation_placeholders={"entity_id": entity_id},
            )
    return [
        {"resource": {"rid": sensing[e], "rtype": "motion_area_candidate"}}
        for e in lights
    ]


def _group_ref(bridge: HueBridgeV2, group_id: str) -> dict[str, str]:
    if bridge.groups.room.get(group_id) is not None:
        return {"rid": group_id, "rtype": "room"}
    if bridge.groups.zone.get(group_id) is not None:
        return {"rid": group_id, "rtype": "zone"}
    raise ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key="unknown_hue_group",
        translation_placeholders={"group": group_id},
    )


def _bridge_of(hass: HomeAssistant, hue_entry_id: str) -> HueBridgeV2:
    bridge = async_bridges(hass).get(hue_entry_id)
    if bridge is None or not has_motion_aware(bridge):
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="no_motion_aware"
        )
    return bridge


async def async_create(
    hass: HomeAssistant, hue_entry_id: str, group_id: str, lights: list[str], name: str
) -> str:
    """A new area of these lights in a Hue room or zone; the bridge calibrates it at
    once (nobody should be in the room). Returns its id."""
    bridge = _bridge_of(hass, hue_entry_id)
    if hue_entry_id not in _watch(hass).candidates:
        await async_read_candidates(hass, hue_entry_id, bridge)
    name = name.strip()[:NAME_MAX]
    body = {
        "type": "motion_area_configuration",
        "name": name,
        "group": _group_ref(bridge, group_id),
        "participants": _participants(hass, hue_entry_id, bridge, lights),
        "enabled": True,
    }
    result = await _request(bridge, "post", ENDPOINT, name, json=body)
    area_id = next((r.get("rid") for r in result or [] if isinstance(r, dict)), None)
    if area_id:
        _watch(hass).calibration[area_id] = time.time()
    async_dispatcher_send(hass, SIGNAL_BRIDGES_UPDATED)
    return area_id or ""


async def async_update(
    hass: HomeAssistant,
    area_id: str,
    *,
    name: str | None = None,
    group_id: str | None = None,
    lights: list[str] | None = None,
    enabled: bool | None = None,
    sensitivity: int | None = None,
    security_sensitivity: int | None = None,
) -> None:
    """Change an area. Other lights or switching it on make the bridge calibrate it."""
    hue_entry_id, bridge, config = _find(hass, area_id)
    body: dict[str, Any] = {}
    if name is not None and name.strip() and name.strip() != config.name:
        body["name"] = name.strip()[:NAME_MAX]
    if group_id is not None and group_id != config.group.rid:
        body["group"] = _group_ref(bridge, group_id)
    if lights is not None:
        participants = _participants(hass, hue_entry_id, bridge, lights)
        if [p["resource"]["rid"] for p in participants] != [
            p.resource.rid for p in config.participants
        ]:
            body["participants"] = participants
    if enabled is not None and enabled != config.enabled:
        body["enabled"] = enabled
    if body:
        await _request(bridge, "put", f"{ENDPOINT}/{area_id}", config.name, json=body)
        if "participants" in body or body.get("enabled"):
            _watch(hass).calibration[area_id] = time.time()
    for rtype, value in (
        (ResourceTypes.CONVENIENCE_AREA_MOTION, sensitivity),
        (ResourceTypes.SECURITY_AREA_MOTION, security_sensitivity),
    ):
        if value is None or (rid := _service(config, rtype)) is None:
            continue
        controller = (
            bridge.sensors.convenience_area_motion
            if rtype == ResourceTypes.CONVENIENCE_AREA_MOTION
            else bridge.sensors.security_area_motion
        )
        current = _sensitivity(controller, rid)
        if current is None:
            continue
        value = max(0, min(value, current["max"]))
        if value != current["value"]:
            await _request(
                bridge,
                "put",
                f"clip/v2/resource/{rtype.value}/{rid}",
                config.name,
                json={"sensitivity": {"sensitivity": value}},
            )
    async_dispatcher_send(hass, SIGNAL_BRIDGES_UPDATED)


async def async_recalibrate(hass: HomeAssistant, area_id: str) -> None:
    """Calibrate an area again (the Hue app's way: off, then on)."""
    _, bridge, config = _find(hass, area_id)
    path = f"{ENDPOINT}/{area_id}"
    if config.enabled:
        await _request(bridge, "put", path, config.name, json={"enabled": False})
        # The bridge stops the area before it can start it again.
        await asyncio.sleep(1)
    await _request(bridge, "put", path, config.name, json={"enabled": True})
    _watch(hass).calibration[area_id] = time.time()
    async_dispatcher_send(hass, SIGNAL_BRIDGES_UPDATED)


async def async_delete(hass: HomeAssistant, area_id: str) -> None:
    """Remove an area; the bridge removes its sensors and the Hue app's response."""
    _, bridge, config = _find(hass, area_id)
    await _request(bridge, "delete", f"{ENDPOINT}/{area_id}", config.name)
    async_dispatcher_send(hass, SIGNAL_BRIDGES_UPDATED)


async def async_set_response(
    hass: HomeAssistant, behavior_id: str, enabled: bool
) -> None:
    """Switch the Hue app's response to an area (a bridge behavior) on or off."""
    for bridge in async_bridges(hass).values():
        if (behavior := bridge.config.behavior_instance.get(behavior_id)) is None:
            continue
        await _request(
            bridge,
            "put",
            f"clip/v2/resource/behavior_instance/{behavior_id}",
            getattr(behavior.metadata, "name", None) or behavior_id,
            json={"enabled": enabled},
        )
        async_dispatcher_send(hass, SIGNAL_BRIDGES_UPDATED)
        return
    raise ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key="unknown_motion_response",
        translation_placeholders={"id": behavior_id},
    )
