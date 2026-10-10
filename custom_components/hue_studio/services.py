"""Services: what the native `hue` integration cannot do.

Palettes, gradients, effects with their parameters, editing scenes, and the Sync Box.
"""

from __future__ import annotations

import logging
from typing import Any

from aiohttp import ClientError
from aiohue.errors import AiohueException
from aiohue.v2.models.feature import (
    ColorFeatureBase,
    ColorFeaturePut,
    ColorPoint,
    ColorTemperatureFeaturePut,
    DimmingFeaturePut,
    EffectsFeaturePut,
    EffectStatus,
    EffectsV2ActionPut,
    EffectsV2FeaturePut,
    EffectsV2ParametersPut,
    GradientFeatureBase,
    GradientMode,
    GradientPoint,
    OnFeature,
    RecallAction,
    RecallFeature,
)
from aiohue.v2.models.light import LightPut
from aiohue.v2.models.scene import SceneMetadataPut, ScenePut
from aiohuesyncbox import ExecutionMode, HdmiSource
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.service import async_extract_entity_ids
import voluptuous as vol

from .adaptive import async_mark_manual
from .const import CONF_KIND, DOMAIN, KIND_SYNC_BOX
from .gallery import async_get_gallery_scene
from .lights import NOT_EFFECTS, HueLight, async_resolve_lights, supported_effects
from .scenes import (
    SCENE_DOMAIN,
    HueScene,
    async_resolve_scenes,
    captured_actions,
    is_resettable,
    light_entity_ids,
    palette_actions,
    scene_lights,
)
from .sync import (
    INTENSITIES,
    SYNC_MODES,
    SyncBoxCoordinator,
    async_streaming_lights,
    hue_target,
    inputs,
    pct_to_api,
)

_LOGGER = logging.getLogger(__name__)

SERVICE_APPLY_PALETTE = "apply_palette"
SERVICE_SET_GRADIENT = "set_gradient"
SERVICE_SET_EFFECT = "set_effect"
SERVICE_SAVE_SCENE = "save_scene"
SERVICE_RESET_SCENE = "reset_scene"
SERVICE_RECALL_SCENE = "recall_scene"
SERVICE_SET_SYNC = "set_sync"

ATTR_GALLERY_SCENE = "gallery_scene"
ATTR_POINTS = "points"
ATTR_MIREK = "mirek"
ATTR_BRIGHTNESS = "brightness"
ATTR_MODE = "mode"
ATTR_EFFECT = "effect"
ATTR_SPEED = "speed"
ATTR_XY_COLOR = "xy_color"
ATTR_NAME = "name"
ATTR_AUTO_DYNAMIC = "auto_dynamic"
ATTR_SHUFFLE = "shuffle"
ATTR_RECALL = "recall"
ATTR_DYNAMIC = "dynamic"
ATTR_POWER = "power"
ATTR_SYNC = "sync"
ATTR_INTENSITY = "intensity"
ATTR_INPUT = "input"
ATTR_AREA = "entertainment_area"

XY_POINT = vol.All(
    vol.ExactSequence([vol.Coerce(float), vol.Coerce(float)]),
    vol.Length(min=2, max=2),
    lambda p: [min(1.0, max(0.0, v)) for v in p],
)
BRIGHTNESS = vol.All(vol.Coerce(float), vol.Range(min=1, max=100))
MIREK = vol.All(vol.Coerce(int), vol.Range(min=153, max=500))
# Percent, like the native `hue.activate_scene`; the bridge wants 0-1.
SPEED = vol.All(vol.Coerce(float), vol.Range(min=0, max=100))
EFFECTS = [effect.value for effect in EffectStatus if effect != EffectStatus.UNKNOWN]

APPLY_PALETTE_SCHEMA = vol.All(
    cv.make_entity_service_schema(
        {
            vol.Exclusive(ATTR_GALLERY_SCENE, "palette"): cv.string,
            vol.Exclusive(ATTR_POINTS, "palette"): vol.All(
                [XY_POINT], vol.Length(min=1, max=5)
            ),
            vol.Exclusive(ATTR_MIREK, "palette"): MIREK,
            vol.Optional(ATTR_BRIGHTNESS): BRIGHTNESS,
        }
    ),
    cv.has_at_least_one_key(ATTR_GALLERY_SCENE, ATTR_POINTS, ATTR_MIREK),
)

SET_GRADIENT_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Required(ATTR_POINTS): vol.All([XY_POINT], vol.Length(min=2, max=5)),
        vol.Optional(ATTR_MODE): vol.In([mode.value for mode in GradientMode]),
        vol.Optional(ATTR_BRIGHTNESS): BRIGHTNESS,
    }
)

SET_EFFECT_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Required(ATTR_EFFECT): vol.In(EFFECTS),
        vol.Optional(ATTR_SPEED): SPEED,
        vol.Exclusive(ATTR_XY_COLOR, "color"): XY_POINT,
        vol.Exclusive(ATTR_MIREK, "color"): MIREK,
        vol.Optional(ATTR_BRIGHTNESS): BRIGHTNESS,
    }
)

SAVE_SCENE_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Optional(ATTR_NAME): vol.All(cv.string, vol.Length(min=1, max=32)),
        vol.Optional(ATTR_SPEED): SPEED,
        vol.Optional(ATTR_AUTO_DYNAMIC): cv.boolean,
    }
)

RESET_SCENE_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Optional(ATTR_SHUFFLE, default=False): cv.boolean,
        vol.Optional(ATTR_RECALL, default=True): cv.boolean,
    }
)

RECALL_SCENE_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Required(ATTR_DYNAMIC): cv.boolean,
        vol.Optional(ATTR_BRIGHTNESS): BRIGHTNESS,
    }
)

SET_SYNC_SCHEMA = vol.All(
    cv.make_entity_service_schema(
        {
            vol.Optional(ATTR_POWER): cv.boolean,
            vol.Optional(ATTR_SYNC): cv.boolean,
            vol.Optional(ATTR_MODE): vol.In(SYNC_MODES),
            vol.Optional(ATTR_INTENSITY): vol.In(INTENSITIES),
            # input1-4 or the name given to the input.
            vol.Optional(ATTR_INPUT): cv.string,
            # Id or name of an entertainment area.
            vol.Optional(ATTR_AREA): cv.string,
            vol.Optional(ATTR_BRIGHTNESS): BRIGHTNESS,
        }
    ),
    cv.has_at_least_one_key(
        ATTR_POWER,
        ATTR_SYNC,
        ATTR_MODE,
        ATTR_INTENSITY,
        ATTR_INPUT,
        ATTR_AREA,
        ATTR_BRIGHTNESS,
    ),
)


@callback
def async_setup_services(hass: HomeAssistant) -> None:
    """Register the integration services."""

    async def apply_palette(call: ServiceCall) -> None:
        lights = await _async_target_lights(hass, call)
        palette = await _async_palette(hass, call.data)
        brightness = call.data.get(ATTR_BRIGHTNESS, palette.get("brightness"))
        # Sequential on purpose: one command per light, at most a handful per room;
        # aiohue additionally caps concurrent requests and retries on 429.
        for index, light in enumerate(lights):
            await _async_update(light, _palette_put(light, palette, index, brightness))
        await async_mark_manual(hass, _touched(call, lights))

    async def set_gradient(call: ServiceCall) -> None:
        lights = await _async_target_lights(hass, call)
        points = call.data[ATTR_POINTS]
        for light in lights:
            if light.resource.gradient is None:
                raise ServiceValidationError(
                    translation_domain=DOMAIN,
                    translation_key="not_gradient_light",
                    translation_placeholders={"entity_id": light.entity_id},
                )
        for light in lights:
            put = _base_put(call.data.get(ATTR_BRIGHTNESS))
            put.gradient = _gradient(light, points, call.data.get(ATTR_MODE))
            await _async_update(light, put)
        await async_mark_manual(hass, _touched(call, lights))

    async def set_effect(call: ServiceCall) -> None:
        lights = await _async_target_lights(hass, call)
        effect = EffectStatus(call.data[ATTR_EFFECT])
        if effect != EffectStatus.NO_EFFECT:
            for light in lights:
                if effect not in supported_effects(light.resource):
                    raise ServiceValidationError(
                        translation_domain=DOMAIN,
                        translation_key="effect_not_supported",
                        translation_placeholders={
                            "entity_id": light.entity_id,
                            "effect": effect.value,
                        },
                    )
        for light in lights:
            await _async_update(light, _effect_put(light, effect, call.data))
        await async_mark_manual(hass, _touched(call, lights))

    async def save_scene(call: ServiceCall) -> None:
        """Store what the scene's lights show now (plus name/speed/auto-play)."""
        for scene in await _async_target_scenes(hass, call):
            put = ScenePut(actions=captured_actions(scene))
            if ATTR_NAME in call.data:
                put.metadata = SceneMetadataPut(name=call.data[ATTR_NAME])
            if ATTR_SPEED in call.data:
                put.speed = call.data[ATTR_SPEED] / 100
            if ATTR_AUTO_DYNAMIC in call.data:
                put.auto_dynamic = call.data[ATTR_AUTO_DYNAMIC]
            await _async_update_scene(scene, put)

    async def reset_scene(call: ServiceCall) -> None:
        """Rebuild the scene from its palette and show it."""
        scenes = await _async_target_scenes(hass, call)
        for scene in scenes:
            if not is_resettable(scene.resource):
                raise ServiceValidationError(
                    translation_domain=DOMAIN,
                    translation_key="scene_not_resettable",
                    translation_placeholders={"entity_id": scene.entity_id},
                )
        for scene in scenes:
            actions = palette_actions(scene, call.data[ATTR_SHUFFLE])
            await _async_update_scene(scene, ScenePut(actions=actions))
            if call.data[ATTR_RECALL]:
                try:
                    await scene.bridge.scenes.scene.recall(scene.resource.id)
                except (AiohueException, ClientError, TimeoutError) as err:
                    raise HomeAssistantError(
                        translation_domain=DOMAIN,
                        translation_key="command_failed",
                        translation_placeholders={"entity_id": scene.entity_id},
                    ) from err
                await async_mark_manual(
                    hass, light_entity_ids(hass, scene_lights(scene))
                )

    async def recall_scene(call: ServiceCall) -> None:
        """Play a scene dynamically or statically (ignoring its auto-play)."""
        dynamic = call.data[ATTR_DYNAMIC]
        action = RecallAction.DYNAMIC_PALETTE if dynamic else RecallAction.STATIC
        for scene in await _async_target_scenes(hass, call):
            recall = RecallFeature(action=action)
            if (brightness := call.data.get(ATTR_BRIGHTNESS)) is not None:
                recall.dimming = DimmingFeaturePut(brightness=brightness)
            await _async_update_scene(scene, ScenePut(recall=recall))
            await async_mark_manual(hass, light_entity_ids(hass, scene_lights(scene)))

    async def set_sync(call: ServiceCall) -> None:
        """Change a Sync Box in one command (power, sync, mode, input, …)."""
        for coordinator in await _async_target_boxes(hass, call):
            await coordinator.async_set_state(**_sync_changes(coordinator, call.data))

    hass.services.async_register(
        DOMAIN, SERVICE_SET_SYNC, set_sync, schema=SET_SYNC_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_RECALL_SCENE, recall_scene, schema=RECALL_SCENE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_APPLY_PALETTE, apply_palette, schema=APPLY_PALETTE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_EFFECT, set_effect, schema=SET_EFFECT_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SAVE_SCENE, save_scene, schema=SAVE_SCENE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_RESET_SCENE, reset_scene, schema=RESET_SCENE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_GRADIENT, set_gradient, schema=SET_GRADIENT_SCHEMA
    )


async def _async_target_lights(
    hass: HomeAssistant, call: ServiceCall
) -> list[HueLight]:
    """Resolve the service target; explicitly listed entities keep their order.

    Lights that an entertainment area streams to right now (Sync Box, PC or TV sync)
    are left alone: the stream would overwrite the command anyway.
    """
    found = await async_extract_entity_ids(call, expand_group=False)
    explicit = [e for e in _explicit_ids(call) if e in found]
    ordered = explicit + sorted(found.difference(explicit))
    if not ordered:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="no_lights"
        )
    lights = async_resolve_lights(hass, ordered)
    if streaming := async_streaming_lights(hass):
        skipped = [light.entity_id for light in lights if light.entity_id in streaming]
        if skipped:
            _LOGGER.debug("Skipping lights that are syncing: %s", skipped)
            lights = [light for light in lights if light.entity_id not in streaming]
            if not lights:
                raise ServiceValidationError(
                    translation_domain=DOMAIN,
                    translation_key="lights_syncing",
                    translation_placeholders={"entity_id": ", ".join(skipped)},
                )
    return lights


async def _async_target_boxes(
    hass: HomeAssistant, call: ServiceCall
) -> list[SyncBoxCoordinator]:
    """Sync Boxes owning any of the targeted entities."""
    registry = er.async_get(hass)
    boxes: dict[str, SyncBoxCoordinator] = {}
    for entity_id in sorted(await async_extract_entity_ids(call)):
        entry_id = (entry := registry.async_get(entity_id)) and entry.config_entry_id
        config_entry = hass.config_entries.async_get_entry(entry_id or "")
        if (
            config_entry is None
            or config_entry.domain != DOMAIN
            or config_entry.data.get(CONF_KIND) != KIND_SYNC_BOX
            or getattr(config_entry, "runtime_data", None) is None
            or config_entry.runtime_data.sync is None
        ):
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="not_sync_box",
                translation_placeholders={"entity_id": entity_id},
            )
        boxes[config_entry.entry_id] = config_entry.runtime_data.sync
    if not boxes:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="no_sync_box"
        )
    return list(boxes.values())


def _sync_changes(
    coordinator: SyncBoxCoordinator, data: dict[str, Any]
) -> dict[str, Any]:
    """`execution.set_state` arguments for a set_sync call (one command)."""
    if data.get(ATTR_POWER) is False:
        return {"mode": ExecutionMode.POWERSAVE}
    state = coordinator.state
    changes: dict[str, Any] = {}
    if (mode := data.get(ATTR_MODE)) is not None and data.get(ATTR_SYNC) is not False:
        changes["mode"] = ExecutionMode(mode)
    elif (sync := data.get(ATTR_SYNC)) is not None:
        changes["sync_active"] = sync
    elif data.get(ATTR_POWER) and not state.power:
        changes["mode"] = ExecutionMode.PASSTHROUGH
    if (intensity := data.get(ATTR_INTENSITY)) is not None:
        changes.update(coordinator.intensity_changes(intensity, mode))
    if (source := data.get(ATTR_INPUT)) is not None:
        changes["hdmi_source"] = HdmiSource(_input_id(coordinator, source))
    if (area := data.get(ATTR_AREA)) is not None:
        changes["hue_target"] = hue_target(_area_id(coordinator, area))
    if (brightness := data.get(ATTR_BRIGHTNESS)) is not None:
        changes["brightness"] = pct_to_api(brightness)
    return changes


def _input_id(coordinator: SyncBoxCoordinator, value: str) -> str:
    for key, port in inputs(coordinator.api).items():
        if value in (key, port.name):
            return key
    raise ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key="unknown_input",
        translation_placeholders={"input": value},
    )


def _area_id(coordinator: SyncBoxCoordinator, value: str) -> str:
    for group in coordinator.api.hue.groups:
        if value in (group.id, group.name):
            return group.id
    raise ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key="unknown_area",
        translation_placeholders={"area": value},
    )


async def _async_target_scenes(
    hass: HomeAssistant, call: ServiceCall
) -> list[HueScene]:
    """Resolve the service target to Hue scenes."""
    found = await async_extract_entity_ids(call)
    ids = sorted(e for e in found if e.startswith(f"{SCENE_DOMAIN}."))
    if not ids:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="no_scenes"
        )
    return async_resolve_scenes(hass, ids)


async def _async_palette(hass: HomeAssistant, data: dict[str, Any]) -> dict[str, Any]:
    """Return a palette dict: {"kind": "gradient", "points": [...]} or white."""
    if (scene_id := data.get(ATTR_GALLERY_SCENE)) is not None:
        scene = await async_get_gallery_scene(hass, scene_id)
        if scene is None:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="unknown_gallery_scene",
                translation_placeholders={"scene": scene_id},
            )
        return scene
    if ATTR_MIREK in data:
        return {"kind": "white", "mirek": data[ATTR_MIREK]}
    return {"kind": "gradient", "points": data[ATTR_POINTS]}


def _touched(call: ServiceCall, lights: list[HueLight]) -> list[str]:
    """Lights we changed plus the groups the caller named (AL may list either)."""
    return [light.entity_id for light in lights] + _explicit_ids(call)


def _explicit_ids(call: ServiceCall) -> list[str]:
    """Entity ids listed in the call (not "all", not area/device targets)."""
    ids = call.data.get(ATTR_ENTITY_ID, [])
    return [] if isinstance(ids, str) else list(ids)


def _base_put(brightness: float | None) -> LightPut:
    put = LightPut(on=OnFeature(on=True))
    if brightness is not None:
        put.dimming = DimmingFeaturePut(brightness=brightness)
    return put


def _palette_put(
    light: HueLight, palette: dict[str, Any], index: int, brightness: float | None
) -> LightPut:
    """Gradient lights get the whole palette, other lights one color each."""
    put = _base_put(brightness)
    resource = light.resource
    if palette["kind"] == "white":
        if resource.color_temperature is not None:
            schema = resource.color_temperature.mirek_schema
            mirek = min(
                schema.mirek_maximum, max(schema.mirek_minimum, palette["mirek"])
            )
            put.color_temperature = ColorTemperatureFeaturePut(mirek=mirek)
        return put
    points: list[list[float]] = palette["points"]
    if resource.gradient is not None and len(points) >= 2:
        put.gradient = _gradient(light, points, None)
    elif resource.color is not None:
        x, y = points[index % len(points)]
        put.color = ColorFeaturePut(xy=ColorPoint(x, y))
    return put


def _gradient(
    light: HueLight, points: list[list[float]], mode: str | None
) -> GradientFeatureBase:
    capable = light.resource.gradient.points_capable if light.resource.gradient else 0
    return GradientFeatureBase(
        points=[
            GradientPoint(color=ColorFeatureBase(xy=ColorPoint(x, y)))
            for x, y in points[: capable or None]
        ],
        mode=GradientMode(mode) if mode else None,
    )


def _effect_put(
    light: HueLight, effect: EffectStatus, data: dict[str, Any]
) -> LightPut:
    """Start (or stop, with no_effect) an effect; effects_v2 carries its parameters."""
    put = _base_put(data.get(ATTR_BRIGHTNESS))
    resource = light.resource
    if effect == EffectStatus.NO_EFFECT and not any(
        _running(e) for e in (resource.effects_v2, resource.effects)
    ):
        # Stopping an effect that does not run can upset the bridge (as the native
        # integration notes); just make sure the light is on.
        return put
    if resource.effects_v2 is None:
        put.effects = EffectsFeaturePut(effect=effect)
        return put
    params = EffectsV2ParametersPut()
    if (xy := data.get(ATTR_XY_COLOR)) is not None:
        params.color = ColorFeaturePut(xy=ColorPoint(*xy))
    if (mirek := data.get(ATTR_MIREK)) is not None and resource.color_temperature:
        schema = resource.color_temperature.mirek_schema
        mirek = min(schema.mirek_maximum, max(schema.mirek_minimum, mirek))
        params.color_temperature = ColorTemperatureFeaturePut(mirek=mirek)
    if (speed := data.get(ATTR_SPEED)) is not None:
        params.speed = speed / 100
    has_params = any(v is not None for v in vars(params).values())
    put.effects_v2 = EffectsV2FeaturePut(
        action=EffectsV2ActionPut(
            effect=effect,
            parameters=params
            if has_params and effect != EffectStatus.NO_EFFECT
            else None,
        )
    )
    return put


def _running(feature: Any) -> bool:
    """Whether an effects/effects_v2 feature reports a running effect."""
    if feature is None:
        return False
    status = getattr(feature.status, "effect", feature.status)
    return status not in NOT_EFFECTS


async def _async_update_scene(scene: HueScene, put: ScenePut) -> None:
    try:
        await scene.bridge.scenes.scene.update(scene.resource.id, put)
    except (AiohueException, ClientError, TimeoutError) as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="command_failed",
            translation_placeholders={"entity_id": scene.entity_id},
        ) from err


async def _async_update(light: HueLight, put: LightPut) -> None:
    try:
        await light.bridge.lights.update(light.resource.id, put)
    except (AiohueException, ClientError, TimeoutError) as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="command_failed",
            translation_placeholders={"entity_id": light.entity_id},
        ) from err
