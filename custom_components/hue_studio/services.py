"""Services: what the native `hue` integration cannot do (palettes, gradients)."""

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
    GradientFeatureBase,
    GradientMode,
    GradientPoint,
    OnFeature,
)
from aiohue.v2.models.light import LightPut
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.service import async_extract_entity_ids
import voluptuous as vol

from .adaptive import async_mark_manual
from .const import DOMAIN
from .gallery import async_get_gallery_scene
from .lights import HueLight, async_resolve_lights

SERVICE_APPLY_PALETTE = "apply_palette"
SERVICE_SET_GRADIENT = "set_gradient"

ATTR_GALLERY_SCENE = "gallery_scene"
ATTR_POINTS = "points"
ATTR_MIREK = "mirek"
ATTR_BRIGHTNESS = "brightness"
ATTR_MODE = "mode"

XY_POINT = vol.All(
    vol.ExactSequence([vol.Coerce(float), vol.Coerce(float)]),
    vol.Length(min=2, max=2),
    lambda p: [min(1.0, max(0.0, v)) for v in p],
)
BRIGHTNESS = vol.All(vol.Coerce(float), vol.Range(min=1, max=100))
MIREK = vol.All(vol.Coerce(int), vol.Range(min=153, max=500))

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

    hass.services.async_register(
        DOMAIN, SERVICE_APPLY_PALETTE, apply_palette, schema=APPLY_PALETTE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_GRADIENT, set_gradient, schema=SET_GRADIENT_SCHEMA
    )


async def _async_target_lights(
    hass: HomeAssistant, call: ServiceCall
) -> list[HueLight]:
    """Resolve the service target; explicitly listed entities keep their order."""
    found = await async_extract_entity_ids(call, expand_group=False)
    explicit = [e for e in _explicit_ids(call) if e in found]
    ordered = explicit + sorted(found.difference(explicit))
    if not ordered:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="no_lights"
        )
    return async_resolve_lights(hass, ordered)


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


async def _async_update(light: HueLight, put: LightPut) -> None:
    try:
        await light.bridge.lights.update(light.resource.id, put)
    except (AiohueException, ClientError, TimeoutError) as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="command_failed",
            translation_placeholders={"entity_id": light.entity_id},
        ) from err
