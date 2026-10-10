"""Tests for Hue Studio services."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from aiohue.errors import AiohueException
from aiohue.v2.models.resource import ResourceIdentifier, ResourceTypes
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import entity_registry as er
import pytest

from custom_components.hue_studio.const import DOMAIN

from .conftest import LIGHTS, SCENES


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


async def test_set_effect(hass: HomeAssistant, hue_lights: MagicMock) -> None:
    """Effects carry color, speed (percent -> 0-1) and are checked per light."""
    await hass.services.async_call(
        DOMAIN,
        "set_effect",
        {
            "entity_id": "light.strip",
            "effect": "candle",
            "speed": 50,
            "xy_color": [0.55, 0.4],
            "brightness": 70,
        },
        blocking=True,
    )
    put = _sent(hue_lights)["res-strip"]
    action = put.effects_v2.action
    assert action.effect.value == "candle"
    assert action.parameters.speed == 0.5
    assert (action.parameters.color.xy.x, action.parameters.color.xy.y) == (0.55, 0.4)
    assert put.dimming.brightness == 70

    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN,
            "set_effect",
            {"entity_id": "light.strip", "effect": "prism"},
            blocking=True,
        )


async def test_set_effect_off_when_idle(
    hass: HomeAssistant, hue_lights: MagicMock
) -> None:
    """Stopping an effect that does not run sends no effect at all."""
    await hass.services.async_call(
        DOMAIN,
        "set_effect",
        {"entity_id": "light.bulb", "effect": "no_effect"},
        blocking=True,
    )
    put = _sent(hue_lights)["res-bulb"]
    assert put.effects_v2 is None
    assert put.on.on is True


async def test_save_scene(hass: HomeAssistant, hue_lights: MagicMock) -> None:
    """The scene stores what its lights show now, plus name and dynamics."""
    await hass.services.async_call(
        DOMAIN,
        "save_scene",
        {
            "entity_id": "scene.sunset",
            "name": "Dusk",
            "speed": 25,
            "auto_dynamic": True,
        },
        blocking=True,
    )
    scene_id, put = hue_lights.scenes.scene.update.call_args.args
    assert scene_id == "res-scene"
    assert put.metadata.name == "Dusk"
    assert put.speed == 0.25
    assert put.auto_dynamic is True
    strip, bulb = (a.action for a in put.actions)
    # The strip shows a 2-point gradient, the bulb a color (mirek is not valid).
    assert [(p.color.xy.x, p.color.xy.y) for p in strip.gradient.points] == [
        (0.6, 0.35),
        (0.2, 0.3),
    ]
    assert (bulb.color.xy.x, bulb.color.xy.y) == (0.5, 0.4)
    assert bulb.dimming.brightness == 50

    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN, "save_scene", {"entity_id": "scene.missing"}, blocking=True
        )


async def test_reset_scene(hass: HomeAssistant, hue_lights: MagicMock) -> None:
    """The palette is spread over the lights; the gradient light gets all its points."""
    await hass.services.async_call(
        DOMAIN, "reset_scene", {"entity_id": "scene.sunset"}, blocking=True
    )
    put = hue_lights.scenes.scene.update.call_args.args[1]
    strip, bulb = (a.action for a in put.actions)
    # 5 points from a 3-color palette: stretched, not repeated.
    assert [(p.color.xy.x, p.color.xy.y) for p in strip.gradient.points] == [
        (0.6, 0.35),
        (0.6, 0.35),
        (0.2, 0.3),
        (0.2, 0.3),
        (0.4, 0.4),
    ]
    # The second light starts at the second palette color.
    assert (bulb.color.xy.x, bulb.color.xy.y) == (0.2, 0.3)
    assert bulb.dimming.brightness == 60
    hue_lights.scenes.scene.recall.assert_awaited_once_with("res-scene")

    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN, "reset_scene", {"entity_id": "scene.plain"}, blocking=True
        )


async def test_recall_scene(hass: HomeAssistant, hue_lights: MagicMock) -> None:
    """Dynamic and static playback map to the bridge's recall actions."""
    for dynamic, expected in ((True, "dynamic_palette"), (False, "static")):
        await hass.services.async_call(
            DOMAIN,
            "recall_scene",
            {"entity_id": "scene.sunset", "dynamic": dynamic},
            blocking=True,
        )
        put = hue_lights.scenes.scene.update.call_args.args[1]
        assert put.recall.action.value == expected


@pytest.fixture
def hue_room(hass: HomeAssistant, hue_lights: MagicMock) -> MagicMock:
    """Make `light.room` a Hue room on the bridge (grouped light owned by a room)."""
    hue_entry = hass.config_entries.async_entries("hue")[0]
    hass.states.async_remove("light.room")
    er.async_get(hass).async_get_or_create(
        "light",
        "hue",
        "res-grouped",
        config_entry=hue_entry,
        suggested_object_id="room",
    )
    owner = ResourceIdentifier(rid="res-room", rtype=ResourceTypes.ROOM)
    hue_lights.groups.grouped_light.get.side_effect = {
        "res-grouped": SimpleNamespace(owner=owner)
    }.get
    hue_lights.groups.room.get_lights.side_effect = lambda rid: [
        LIGHTS["res-strip"],
        LIGHTS["res-bulb"],
    ]
    hue_lights.scenes.scene.__iter__.side_effect = lambda: iter(SCENES.values())
    hue_lights.request = AsyncMock(return_value=[{"rid": "res-new", "rtype": "scene"}])
    return hue_lights


async def test_create_scene_from_gallery(
    hass: HomeAssistant, hue_room: MagicMock
) -> None:
    """A gallery scene becomes a bridge scene with its palette spread over lights."""
    result = await hass.services.async_call(
        DOMAIN,
        "create_scene",
        {"entity_id": "light.room", "name": "Ocean", "gallery_scene": "rest"},
        blocking=True,
        return_response=True,
    )
    assert result == {"scene_id": "res-new"}
    method, path = hue_room.request.call_args.args
    body = hue_room.request.call_args.kwargs["json"]
    assert (method, path) == ("post", "clip/v2/resource/scene")
    assert body["metadata"] == {"name": "Ocean"}
    assert body["group"] == {"rid": "res-room", "rtype": "room"}
    assert [a["target"]["rid"] for a in body["actions"]] == ["res-strip", "res-bulb"]
    assert len(body["palette"]["color"]) == 1
    assert body["palette"]["dimming"] == [{"brightness": 35}]
    assert "color" in body["actions"][1]["action"]


async def test_create_scene_captures_lights(
    hass: HomeAssistant, hue_room: MagicMock
) -> None:
    """Without a palette, the scene stores what the lights show now."""
    await hass.services.async_call(
        DOMAIN,
        "create_scene",
        {"entity_id": "light.room", "name": "Now"},
        blocking=True,
    )
    body = hue_room.request.call_args.kwargs["json"]
    assert "palette" not in body
    assert len(body["actions"]) == 2


async def test_create_scene_rejects(hass: HomeAssistant, hue_room: MagicMock) -> None:
    """Taken names (any case) and lights that are no Hue room are rejected."""
    with pytest.raises(ServiceValidationError) as taken:
        await hass.services.async_call(
            DOMAIN,
            "create_scene",
            {"entity_id": "light.room", "name": "sunset"},
            blocking=True,
        )
    assert taken.value.translation_key == "scene_name_taken"
    with pytest.raises(ServiceValidationError) as not_group:
        await hass.services.async_call(
            DOMAIN,
            "create_scene",
            {"entity_id": "light.bulb", "name": "New"},
            blocking=True,
        )
    assert not_group.value.translation_key == "not_hue_group"
    hue_room.request.assert_not_awaited()


async def test_delete_scene(hass: HomeAssistant, hue_room: MagicMock) -> None:
    """The scene is deleted on the bridge."""
    await hass.services.async_call(
        DOMAIN, "delete_scene", {"entity_id": "scene.sunset"}, blocking=True
    )
    hue_room.request.assert_awaited_once_with(
        "delete", "clip/v2/resource/scene/res-scene"
    )
