"""Palettes a service names: a gallery scene, colors, a white, or inline JSON
("gallery:<id>", "b64:<json>")."""

from __future__ import annotations

import base64
import json
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
import voluptuous as vol

from ..const import DOMAIN
from ..scenes.gallery import async_get_gallery_scene
from .targets import ATTR_BRIGHTNESS, BRIGHTNESS, MIREK, XY_POINT

ATTR_PALETTE = "palette"
ATTR_GALLERY_SCENE = "gallery_scene"
ATTR_POINTS = "points"
ATTR_MIREK = "mirek"


INLINE_PALETTE = vol.Any(
    vol.Schema(
        {
            vol.Required("kind"): "white",
            vol.Required(ATTR_MIREK): MIREK,
            vol.Optional(ATTR_BRIGHTNESS): BRIGHTNESS,
        },
        extra=vol.REMOVE_EXTRA,
    ),
    vol.Schema(
        {
            vol.Optional("kind", default="gradient"): "gradient",
            vol.Required(ATTR_POINTS): vol.All([XY_POINT], vol.Length(min=1, max=5)),
            vol.Optional(ATTR_BRIGHTNESS): BRIGHTNESS,
        },
        extra=vol.REMOVE_EXTRA,
    ),
)


async def async_palette(hass: HomeAssistant, data: dict[str, Any]) -> dict[str, Any]:
    """Return a palette dict: {"kind": "gradient", "points": [...]} or white."""
    if (reference := data.get(ATTR_PALETTE)) is not None:
        if reference.startswith("b64:"):
            return _inline_palette(reference[4:])
        data = {ATTR_GALLERY_SCENE: reference.removeprefix("gallery:")}
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


def _inline_palette(encoded: str) -> dict[str, Any]:
    """A palette passed as base64 JSON: {"kind": "white", "mirek"} or with "points"."""
    try:
        palette = json.loads(base64.b64decode(encoded, validate=True))
        return INLINE_PALETTE(palette)
    except (ValueError, TypeError, vol.Invalid) as err:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="bad_palette"
        ) from err
