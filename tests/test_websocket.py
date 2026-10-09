"""Tests for the Hue Studio WebSocket API."""

from unittest.mock import MagicMock

from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from .conftest import LIGHTS, make_light


async def test_subscribe_lights(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator, hue_lights: MagicMock
) -> None:
    """The first event has every light; bridge updates push only changes."""
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

    on_update = hue_lights.lights.subscribe.call_args.args[0]
    # Unchanged info is not re-sent; a new gradient is.
    on_update("update", LIGHTS["res-bulb"])
    changed = make_light("res-strip", gradient_points=5)
    changed.gradient.points.reverse()
    on_update("update", changed)
    event = (await client.receive_json())["event"]
    assert list(event["lights"]) == ["light.strip"]
    assert event["lights"]["light.strip"]["gradient"]["points"][0] == [0.2, 0.3]
