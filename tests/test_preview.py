"""Tests for a gallery scene shown on a room's lights while its card is open."""

from unittest.mock import MagicMock

from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.typing import WebSocketGenerator


def _put_back(bridge: MagicMock) -> dict[str, dict]:
    """Map light resource id -> body of every light PUT sent with `request`."""
    return {
        call.args[1].rsplit("/", 1)[1]: call.kwargs["json"]
        for call in bridge.request.mock_calls
        if call.args[:1] == ("put",) and "/light/" in call.args[1]
    }


async def test_preview_shows_and_puts_back(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator, hue_lights: MagicMock
) -> None:
    """Each card shown goes to the lights; closing it unsaved puts them back."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "hue_studio/preview/start", "token": "t1", "entity_id": "light.room"}
    )
    start = await client.receive_json()
    assert start["success"], start
    assert start["result"] == {"lights": 2}

    await client.send_json_auto_id(
        {
            "type": "hue_studio/preview/show",
            "token": "t1",
            "colors": {"points": [[0.6, 0.35], [0.2, 0.3]]},
        }
    )
    assert (await client.receive_json())["success"]
    assert {c.args[0] for c in hue_lights.lights.update.mock_calls} == {
        "res-strip",
        "res-bulb",
    }
    assert _put_back(hue_lights) == {}

    await client.send_json_auto_id({"type": "hue_studio/preview/end", "token": "t1"})
    assert (await client.receive_json())["success"]
    back = _put_back(hue_lights)
    assert back["res-bulb"] == {
        "on": {"on": True},
        "dimming": {"brightness": 50.0},
        "color": {"xy": {"x": 0.5, "y": 0.4}},
    }
    assert [p["color"]["xy"] for p in back["res-strip"]["gradient"]["points"]] == [
        {"x": 0.6, "y": 0.35},
        {"x": 0.2, "y": 0.3},
    ]


async def test_preview_kept(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator, hue_lights: MagicMock
) -> None:
    """Saved or set once: what is shown stays, nothing is put back."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "hue_studio/preview/start", "token": "t2", "entity_id": "light.bulb"}
    )
    assert (await client.receive_json())["success"]
    await client.send_json_auto_id(
        {"type": "hue_studio/preview/end", "token": "t2", "keep": True}
    )
    assert (await client.receive_json())["success"]
    await client.close()
    await hass.async_block_till_done()
    assert _put_back(hue_lights) == {}


async def test_preview_put_back_when_the_panel_goes(
    hass: HomeAssistant, hass_ws_client: WebSocketGenerator, hue_lights: MagicMock
) -> None:
    """A connection that closes mid-way puts the lights back too."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "hue_studio/preview/start", "token": "t3", "entity_id": "light.bulb"}
    )
    assert (await client.receive_json())["success"]
    await client.close()
    await hass.async_block_till_done()
    assert set(_put_back(hue_lights)) == {"res-bulb"}
