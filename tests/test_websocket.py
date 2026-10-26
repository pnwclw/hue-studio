"""Tests for the Hue Studio WebSocket API."""

from unittest.mock import MagicMock

from aiohue.v2.models.feature import (
    ColorFeatureBase,
    ColorPoint,
    ColorTemperatureFeatureBase,
    GradientFeatureBase,
    GradientPoint,
    OnFeature,
)
from aiohue.v2.models.scene import Action, ActionAction, SceneActiveStatus
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
import pytest
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio.scenes.bridge import light_colors

from .conftest import LIGHTS, SCENES, make_light, make_scene


async def test_subscribe_lights(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator, hue_lights: MagicMock
) -> None:
    """The first event has every light; bridge updates push only changes."""
    hue_lights.lights.get_device.return_value = MagicMock(
        product_data=MagicMock(product_name="Hue lightstrip plus")
    )
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/lights/subscribe"})
    assert (await client.receive_json())["success"]

    lights = (await client.receive_json())["event"]["lights"]
    assert set(lights) == {"light.bulb", "light.strip"}
    assert lights["light.bulb"]["gamut_type"] == "C"
    assert lights["light.bulb"]["gamut"][0] == [0.6915, 0.3083]
    assert lights["light.bulb"]["mirek"] == [153, 454]
    assert lights["light.bulb"]["gradient"] is None
    assert lights["light.strip"]["gradient"]["points_capable"] == 5
    assert lights["light.strip"]["gradient"]["points"] == [[0.6, 0.35], [0.2, 0.3]]
    assert lights["light.strip"]["effects"] == ["candle", "fire"]
    assert lights["light.strip"]["effect"] is None
    assert lights["light.strip"]["dynamics"] == {"status": "none", "speed": 0.5}
    assert lights["light.strip"]["archetype"] == "hue_lightstrip"
    assert lights["light.strip"]["product"] == "Hue lightstrip plus"

    on_update = hue_lights.lights.subscribe.call_args.args[0]
    # Unchanged info is not re-sent; a new gradient is.
    on_update("update", LIGHTS["res-bulb"])
    changed = make_light("res-strip", gradient_points=5)
    changed.gradient.points.reverse()
    on_update("update", changed)
    event = (await client.receive_json())["event"]
    assert list(event["lights"]) == ["light.strip"]
    assert event["lights"]["light.strip"]["gradient"]["points"][0] == [0.2, 0.3]


async def test_subscribe_scenes(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator, hue_lights: MagicMock
) -> None:
    """Scenes come with status, palette and their lights; changes are pushed."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/scenes/subscribe"})
    assert (await client.receive_json())["success"]

    scenes = (await client.receive_json())["event"]["scenes"]
    assert set(scenes) == {"scene.sunset", "scene.plain"}
    sunset = scenes["scene.sunset"]
    assert sunset["active"] == "static"
    assert sunset["image"] is None
    assert sunset["custom"] is True
    assert sunset["dynamic"] is True
    assert sunset["resettable"] is True
    assert sunset["palette"][0] == [0.6, 0.35]
    assert sunset["lights"] == ["light.strip", "light.bulb"]
    assert scenes["scene.plain"]["resettable"] is False

    on_update = hue_lights.scenes.scene.subscribe.call_args.args[0]
    changed = make_scene("res-scene")
    changed.status.active = SceneActiveStatus.INACTIVE
    on_update("update", changed)
    event = (await client.receive_json())["event"]
    assert event["scenes"]["scene.sunset"]["active"] == "inactive"


async def test_subscribe_scenes_new_entity(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    hue_lights: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A new scene is sent once both `hue` has its entity and we have the scene."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/scenes/subscribe"})
    assert (await client.receive_json())["success"]
    await client.receive_json()

    monkeypatch.setitem(SCENES, "res-new", make_scene("res-new"))
    er.async_get(hass).async_get_or_create(
        "scene",
        "hue",
        "res-new",
        config_entry=hass.config_entries.async_entries("hue")[0],
        suggested_object_id="fresh",
    )
    event = (await client.receive_json())["event"]
    assert list(event["scenes"]) == ["scene.fresh"]
    assert event["scenes"]["scene.fresh"]["custom"] is True

    # The other order: the entity is there before our connection hears of the scene.
    er.async_get(hass).async_get_or_create(
        "scene",
        "hue",
        "res-later",
        config_entry=hass.config_entries.async_entries("hue")[0],
        suggested_object_id="later",
    )
    later = make_scene("res-later")
    monkeypatch.setitem(SCENES, "res-later", later)
    hue_lights.scenes.scene.subscribe.call_args.args[0]("add", later)
    event = (await client.receive_json())["event"]
    assert list(event["scenes"]) == ["scene.later"]


async def test_scene_colors_and_cover(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator, hue_lights: MagicMock
) -> None:
    """A scene shows its lights' colors; a picture of its own is pushed and dropped."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/scenes/subscribe"})
    assert (await client.receive_json())["success"]
    scenes = (await client.receive_json())["event"]["scenes"]
    # The fixture's lights are only switched on: no colors, no whites, no picture.
    assert scenes["scene.plain"]["colors"] == []
    assert scenes["scene.plain"]["whites"] == []
    assert scenes["scene.plain"]["cover"] is None

    other = await hass_ws_client(hass)
    await other.send_json_auto_id(
        {"type": "hue_studio/scenes/cover", "entity_id": "scene.plain", "image": "abc"}
    )
    result = await other.receive_json()
    assert result["success"]
    assert result["result"] == {"replaced": None}
    event = (await client.receive_json())["event"]
    assert event["scenes"]["scene.plain"]["cover"] == "/api/image/serve/abc/512x512"

    await other.send_json_auto_id(
        {"type": "hue_studio/scenes/cover", "entity_id": "scene.plain", "image": None}
    )
    assert (await other.receive_json())["result"] == {"replaced": "abc"}
    event = (await client.receive_json())["event"]
    assert event["scenes"]["scene.plain"]["cover"] is None

    await other.send_json_auto_id(
        {"type": "hue_studio/scenes/cover", "entity_id": "scene.nope", "image": "x"}
    )
    assert not (await other.receive_json())["success"]


def test_light_colors() -> None:
    """Colors (gradient points too) and whites of the lights that are on, no repeats."""
    scene = make_scene("res-scene", palette=False)
    strip, bulb = scene.actions
    strip.action.gradient = GradientFeatureBase(
        points=[
            GradientPoint(color=ColorFeatureBase(xy=ColorPoint(0.6, 0.35))),
            GradientPoint(color=ColorFeatureBase(xy=ColorPoint(0.2, 0.3))),
        ]
    )
    bulb.action.color = ColorFeatureBase(xy=ColorPoint(0.6, 0.35))
    off = Action(
        target=bulb.target,
        action=ActionAction(
            on=OnFeature(on=False),
            color_temperature=ColorTemperatureFeatureBase(mirek=400),
        ),
    )
    white = Action(
        target=bulb.target,
        action=ActionAction(
            on=OnFeature(on=True),
            color_temperature=ColorTemperatureFeatureBase(mirek=366),
        ),
    )
    scene.actions = [strip, bulb, off, white]
    assert light_colors(scene) == ([[0.6, 0.35], [0.2, 0.3]], [366])
