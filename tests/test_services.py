"""Tests for Hue Studio services."""

from unittest.mock import MagicMock

from aiohue.errors import AiohueException
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
import pytest

from custom_components.hue_studio.const import DOMAIN


def _sent(bridge: MagicMock) -> dict[str, object]:
    """Map resource id -> LightPut of every update sent to the bridge."""
    return {call.args[0]: call.args[1] for call in bridge.lights.update.mock_calls}


async def test_apply_palette_points(hass: HomeAssistant, hue_lights: MagicMock) -> None:
    """A gradient light gets all points; a plain light gets one color."""
    await hass.services.async_call(
        DOMAIN,
        "apply_palette",
        {
            "entity_id": ["light.bulb", "light.strip"],
            "points": [[0.6, 0.35], [0.2, 0.3], [0.4, 0.4]],
            "brightness": 50,
        },
        blocking=True,
    )
    sent = _sent(hue_lights)
    bulb, strip = sent["res-bulb"], sent["res-strip"]
    assert bulb.on.on is True
    assert bulb.dimming.brightness == 50
    assert (bulb.color.xy.x, bulb.color.xy.y) == (0.6, 0.35)
    assert bulb.gradient is None
    assert [(p.color.xy.x, p.color.xy.y) for p in strip.gradient.points] == [
        (0.6, 0.35),
        (0.2, 0.3),
        (0.4, 0.4),
    ]


async def test_apply_palette_expands_hue_group(
    hass: HomeAssistant, hue_lights: MagicMock
) -> None:
    """A Hue room is expanded to its member lights, in the room's order."""
    await hass.services.async_call(
        DOMAIN,
        "apply_palette",
        {"entity_id": "light.room", "points": [[0.6, 0.35]]},
        blocking=True,
    )
    assert [c.args[0] for c in hue_lights.lights.update.mock_calls] == [
        "res-strip",
        "res-bulb",
    ]


async def test_apply_palette_gallery_white(
    hass: HomeAssistant, hue_lights: MagicMock
) -> None:
    """A white gallery scene sets color temperature, clamped to the light's range."""
    await hass.services.async_call(
        DOMAIN,
        "apply_palette",
        {"entity_id": "light.bulb", "gallery_scene": "relax"},
        blocking=True,
    )
    put = _sent(hue_lights)["res-bulb"]
    assert put.color_temperature.mirek == 451
    assert put.dimming.brightness == 56


async def test_apply_palette_errors(hass: HomeAssistant, hue_lights: MagicMock) -> None:
    """Unknown scenes and non-Hue lights are rejected before anything is sent."""
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN,
            "apply_palette",
            {"entity_id": "light.bulb", "gallery_scene": "nope"},
            blocking=True,
        )
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN,
            "apply_palette",
            {"entity_id": "light.other_brand", "mirek": 300},
            blocking=True,
        )
    hue_lights.lights.update.assert_not_called()

    hue_lights.lights.update.side_effect = AiohueException
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            DOMAIN,
            "apply_palette",
            {"entity_id": "light.bulb", "mirek": 300},
            blocking=True,
        )


async def test_set_gradient(hass: HomeAssistant, hue_lights: MagicMock) -> None:
    """Gradient points and mode go to gradient lights only."""
    await hass.services.async_call(
        DOMAIN,
        "set_gradient",
        {
            "entity_id": "light.strip",
            "points": [[0.6, 0.35], [0.2, 0.3]],
            "mode": "random_pixelated",
        },
        blocking=True,
    )
    put = _sent(hue_lights)["res-strip"]
    assert put.gradient.mode.value == "random_pixelated"
    assert len(put.gradient.points) == 2

    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN,
            "set_gradient",
            {"entity_id": "light.bulb", "points": [[0.6, 0.35], [0.2, 0.3]]},
            blocking=True,
        )
