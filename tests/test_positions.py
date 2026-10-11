"""Tests for light positions and spatial palettes."""

from typing import Any
from unittest.mock import AsyncMock, MagicMock

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, entity_registry as er
import pytest
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio.const import DOMAIN
from custom_components.hue_studio.positions import (
    async_positions_payload,
    palette_at,
    spatial_colors,
)

from .conftest import ENTERTAINMENT, make_entertainment


def test_palette_at() -> None:
    """The palette is a gradient with evenly spaced points."""
    palette = [(0.0, 0.0), (1.0, 0.5), (0.5, 1.0)]
    assert palette_at(palette, 0) == (0.0, 0.0)
    assert palette_at(palette, 0.25) == (0.5, 0.25)
    assert palette_at(palette, 1) == (0.5, 1.0)
    assert palette_at(palette, 2) == (0.5, 1.0)
    assert palette_at([(0.3, 0.3)], 0.7) == (0.3, 0.3)


def test_spatial_colors() -> None:
    """Colors follow the longest side; a strip spans the stretch between its ends."""
    palette = [(0.0, 0.0), (1.0, 1.0)]
    positions = {
        "left": [(-1.0, 0.0, 0.0)],
        "right": [(1.0, 0.2, 0.0)],
        "strip": [(-1.0, 0.1, 0.0), (0.0, 0.1, 0.0)],
        "unknown": [],
    }
    colors = spatial_colors(palette, positions, {"strip": 3})
    assert colors["left"] == [(0.0, 0.0)]
    assert colors["right"] == [(1.0, 1.0)]
    assert colors["strip"] == [(0.0, 0.0), (0.25, 0.25), (0.5, 0.5)]
    assert "unknown" not in colors
    # Lights spread front to back: the y axis is used.
    by_depth = spatial_colors(
        palette, {"a": [(0.0, -1.0, 0.0)], "b": [(0.1, 1.0, 0.0)]}, {}
    )
    assert by_depth == {"a": [(0.0, 0.0)], "b": [(1.0, 1.0)]}
    # All in one place: the middle of the palette.
    assert spatial_colors(palette, {"a": [(0.0, 0.0, 0.0)]}, {}) == {"a": [(0.5, 0.5)]}


@pytest.fixture
async def office(hass: HomeAssistant, hue_lights: MagicMock) -> MagicMock:
    """Both lights in an "office" area; the strip is in the "TV area" (x = 0)."""
    ar.async_get(hass).async_create("Office")
    entities = er.async_get(hass)
    for entity_id in ("light.bulb", "light.strip"):
        entities.async_update_entity(entity_id, area_id="office")
    hue_lights.request = AsyncMock(return_value=[])
    await hass.async_block_till_done()
    return hue_lights


async def _ws(client: Any, **msg: Any) -> dict[str, Any]:
    await client.send_json_auto_id(msg)
    while "event" in (reply := await client.receive_json()):
        pass
    return reply


async def test_positions_and_saving(
    hass: HomeAssistant, office: MagicMock, hass_ws_client: WebSocketGenerator
) -> None:
    """Positions come from the entertainment area; saving goes back where they live."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/positions/subscribe"})
    assert (await client.receive_json())["success"]
    area = (await client.receive_json())["event"]["office"]
    assert area["configuration"] == {
        "id": "ent-tv",
        "name": "TV area",
        "streaming": False,
    }
    assert area["lights"]["light.strip"] == {
        "positions": [[0.0, 0.5, 0.0]],
        "source": "bridge",
    }
    assert area["lights"]["light.bulb"] == {"positions": [], "source": None}

    reply = await _ws(
        client,
        type="hue_studio/positions/set",
        area_id="office",
        positions={
            "light.bulb": [[0.8, -0.5, 2.0]],
            "light.strip": [[-0.5, 0.9, 0.1]],
        },
    )
    assert reply["success"]
    # The strip goes to the bridge, the bulb (clipped to the room) to the store.
    method, path = office.request.call_args.args
    assert (method, path) == (
        "put",
        "clip/v2/resource/entertainment_configuration/ent-tv",
    )
    assert office.request.call_args.kwargs["json"] == {
        "locations": {
            "service_locations": [
                {
                    "service": {"rid": "ent-res-strip", "rtype": "entertainment"},
                    "positions": [{"x": -0.5, "y": 0.9, "z": 0.1}],
                    "equalization_factor": 1.0,
                }
            ]
        }
    }
    payload = async_positions_payload(hass)
    assert payload["office"]["lights"]["light.bulb"] == {
        "positions": [[0.8, -0.5, 1.0]],
        "source": "store",
    }

    # Not while the area streams.
    ENTERTAINMENT[:] = [
        make_entertainment("ent-tv", "TV area", ["res-strip"], active=True)
    ]
    reply = await _ws(
        client,
        type="hue_studio/positions/set",
        area_id="office",
        positions={"light.strip": [[0.0, 0.0, 0.0]]},
    )
    assert not reply["success"]


async def test_spatial_palette(
    hass: HomeAssistant, office: MagicMock, hass_ws_client: WebSocketGenerator
) -> None:
    """With layout "spatial", each light gets the colors where it stands."""
    client = await hass_ws_client(hass)
    await _ws(
        client,
        type="hue_studio/positions/set",
        area_id="office",
        positions={"light.bulb": [[1.0, 0.5, 0.0]]},
    )
    await hass.services.async_call(
        DOMAIN,
        "apply_palette",
        {
            "entity_id": ["light.bulb", "light.strip"],
            "points": [[0.6, 0.35], [0.2, 0.3]],
            "layout": "spatial",
        },
        blocking=True,
    )
    sent = {c.args[0]: c.args[1] for c in office.lights.update.mock_calls}
    # The bulb stands right (x = 1): the palette's end. The strip at x = 0: its start.
    assert (sent["res-bulb"].color.xy.x, sent["res-bulb"].color.xy.y) == (0.2, 0.3)
    strip = [(p.color.xy.x, p.color.xy.y) for p in sent["res-strip"].gradient.points]
    assert strip == [(0.6, 0.35)] * 5
