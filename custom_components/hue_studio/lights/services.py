"""Light services the native `hue` integration does not have: palettes, gradients and
effects with their parameters."""

from __future__ import annotations

from typing import Any

from aiohttp import ClientError
from aiohue.errors import AiohueException
from aiohue.v2.models.feature import (
    ColorFeatureBase,
    ColorFeaturePut,
    ColorPoint,
    ColorTemperatureFeaturePut,
    DimmingFeaturePut,
    DynamicsFeaturePut,
    EffectsFeaturePut,
    EffectStatus,
    EffectsV2ActionPut,
    EffectsV2FeaturePut,
    EffectsV2ParametersPut,
    GradientFeatureBase,
    GradientMode,
    GradientPoint,
    OnFeature,
)
from aiohue.v2.models.light import LightPut
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
import voluptuous as vol

from ..const import DOMAIN
from ..space.positions import async_light_positions, spatial_colors
from .bridge import NOT_EFFECTS, HueLight, supported_effects
from .palettes import (
    ATTR_GALLERY_SCENE,
    ATTR_MIREK,
    ATTR_PALETTE,
    ATTR_POINTS,
    async_palette,
)
from .targets import (
    ATTR_BRIGHTNESS,
    ATTR_SPEED,
    ATTR_TRANSITION,
    BRIGHTNESS,
    MIREK,
    SPEED,
    TRANSITION,
    XY_POINT,
    async_target_lights,
)

SERVICE_APPLY_PALETTE = "apply_palette"
SERVICE_SET_GRADIENT = "set_gradient"
SERVICE_SET_EFFECT = "set_effect"

ATTR_MODE = "mode"
ATTR_EFFECT = "effect"
ATTR_XY_COLOR = "xy_color"
ATTR_LAYOUT = "layout"
LAYOUTS = ("classic", "spatial")


EFFECTS = [effect.value for effect in EffectStatus if effect != EffectStatus.UNKNOWN]


APPLY_PALETTE_SCHEMA = vol.All(
    cv.make_entity_service_schema(
        {
            # "gallery:<id>", "b64:<json palette>" or a gallery id.
            vol.Exclusive(ATTR_PALETTE, "palette"): cv.string,
            vol.Exclusive(ATTR_GALLERY_SCENE, "palette"): cv.string,
            vol.Exclusive(ATTR_POINTS, "palette"): vol.All(
                [XY_POINT], vol.Length(min=1, max=5)
            ),
            vol.Exclusive(ATTR_MIREK, "palette"): MIREK,
            vol.Optional(ATTR_BRIGHTNESS): BRIGHTNESS,
            vol.Optional(ATTR_TRANSITION): TRANSITION,
            # How gradient lights lay the colors out (if they support the mode).
            vol.Optional(ATTR_MODE): vol.In([mode.value for mode in GradientMode]),
            # "spatial": colors by where the lights stand (positions.py).
            vol.Optional(ATTR_LAYOUT, default="classic"): vol.In(LAYOUTS),
        }
    ),
    cv.has_at_least_one_key(ATTR_PALETTE, ATTR_GALLERY_SCENE, ATTR_POINTS, ATTR_MIREK),
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


@callback
def async_setup_services(hass: HomeAssistant) -> None:
    """Register the light services."""

    async def apply_palette(call: ServiceCall) -> None:
        lights = await async_target_lights(hass, call)
        palette = await async_palette(hass, call.data)
        brightness = call.data.get(ATTR_BRIGHTNESS, palette.get("brightness"))
        transition = call.data.get(ATTR_TRANSITION)
        mode = call.data.get(ATTR_MODE)
        spatial = (
            _spatial(hass, lights, palette)
            if call.data.get(ATTR_LAYOUT) == "spatial"
            else {}
        )
        # Sequential on purpose: one command per light, at most a handful per room;
        # aiohue additionally caps concurrent requests and retries on 429.
        for index, light in enumerate(lights):
            if (colors := spatial.get(light.resource.id)) is not None:
                put = _colors_put(light, colors, brightness, mode)
            else:
                put = _palette_put(light, palette, index, brightness, mode)
            if transition is not None:
                put.dynamics = DynamicsFeaturePut(duration=round(transition * 1000))
            await _async_update(light, put)

    async def set_gradient(call: ServiceCall) -> None:
        lights = await async_target_lights(hass, call)
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

    async def set_effect(call: ServiceCall) -> None:
        lights = await async_target_lights(hass, call)
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

    hass.services.async_register(
        DOMAIN, SERVICE_APPLY_PALETTE, apply_palette, schema=APPLY_PALETTE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_GRADIENT, set_gradient, schema=SET_GRADIENT_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_EFFECT, set_effect, schema=SET_EFFECT_SCHEMA
    )


def _base_put(brightness: float | None) -> LightPut:
    put = LightPut(on=OnFeature(on=True))
    if brightness is not None:
        put.dimming = DimmingFeaturePut(brightness=brightness)
    return put


def _palette_put(
    light: HueLight,
    palette: dict[str, Any],
    index: int,
    brightness: float | None,
    mode: str | None = None,
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
        supported = {m.value for m in resource.gradient.mode_values}
        put.gradient = _gradient(light, points, mode if mode in supported else None)
    elif resource.color is not None:
        x, y = points[index % len(points)]
        put.color = ColorFeaturePut(xy=ColorPoint(x, y))
    return put


def _spatial(
    hass: HomeAssistant, lights: list[HueLight], palette: dict[str, Any]
) -> dict[str, list[tuple[float, float]]]:
    """Colors per light (resource id) by position; lights without one are left out."""
    if palette["kind"] != "gradient" or len(palette["points"]) < 2:
        return {}
    positions = async_light_positions(hass, lights)
    counts = {
        light.resource.id: light.resource.gradient.points_capable
        if light.resource.gradient and light.resource.gradient.points_capable >= 2
        else 1
        for light in lights
    }
    points = [(x, y) for x, y in palette["points"]]
    return spatial_colors(points, positions, counts)


def _colors_put(
    light: HueLight,
    colors: list[tuple[float, float]],
    brightness: float | None,
    mode: str | None,
) -> LightPut:
    """Exact colors for one light: a gradient, or one color."""
    put = _base_put(brightness)
    resource = light.resource
    if resource.gradient is not None and len(colors) >= 2:
        supported = {m.value for m in resource.gradient.mode_values}
        put.gradient = _gradient(
            light, [list(c) for c in colors], mode if mode in supported else None
        )
    elif resource.color is not None:
        put.color = ColorFeaturePut(xy=ColorPoint(*colors[0]))
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


async def _async_update(light: HueLight, put: LightPut) -> None:
    try:
        await light.bridge.lights.update(light.resource.id, put)
    except (AiohueException, ClientError, TimeoutError) as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="command_failed",
            translation_placeholders={"entity_id": light.entity_id},
        ) from err
