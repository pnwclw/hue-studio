"""Tests for auto light settings (Store, services, import of the legacy file)."""

import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import area_registry as ar
import pytest
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio.const import DOMAIN

LEGACY = {
    "palettes": [{"id": "read", "name": "Read", "kind": "white", "mirek": 346}],
    "rooms": {
        "office": {
            "light": "light.example_desk",
            "auto": {
                "pools": {
                    "day": {"all": {"clear": [["read"], [], [], []]}},
                    "evening": {"winter": {"clear": ["rest"], "gloomy": []}},
                },
                "holidays": [
                    {"from": "12-01", "to": "01-06", "phases": ["evening"], "pool": []}
                ],
                "names": {"rest": "Rest"},
                "excluded": ["relax"],
                "offsets": {"night": -10},
            },
        },
        "attic": {"name": "Attic", "light": "light.example_lamp", "auto": {}},
        "garden": {"light": "light.example_lamp", "auto": {"pools": {}}},
    },
}


async def _call(
    hass: HomeAssistant, service: str, data: dict[str, Any], response: bool = False
) -> Any:
    return await hass.services.async_call(
        DOMAIN, service, data, blocking=True, return_response=response
    )


@pytest.fixture
def office(hass: HomeAssistant) -> str:
    """An area whose id is the legacy room key."""
    return ar.async_get(hass).async_create("Office").id


async def test_import_legacy(
    hass: HomeAssistant,
    hass_storage: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    hue_lights: MagicMock,
    office: str,
) -> None:
    """Rooms with auto light become areas (by id or name); the rest is reported."""
    garden = ar.async_get(hass).async_create("Garden").id
    await hass.async_add_executor_job(
        Path(hass.config.path("lights.json")).write_text, json.dumps(LEGACY)
    )
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/auto_light/subscribe"})
    assert (await client.receive_json())["success"]
    assert (await client.receive_json())["event"] == {"areas": {}}

    result = await _call(hass, "import_legacy", {}, response=True)
    assert result == {"imported": [office, garden], "skipped": [], "palettes": 1}
    stored = hass_storage["hue_studio.auto_light"]["data"]["areas"]
    assert stored[office]["excluded"] == ["relax"]
    assert stored[office]["offsets"] == {"night": -10}
    assert stored[garden]["pools"] == {}
    event = (await client.receive_json())["event"]
    assert office in event["areas"]

    # Existing areas are kept unless told to overwrite.
    result = await _call(hass, "import_legacy", {}, response=True)
    assert result["imported"] == []
    assert result["skipped"] == ["office", "garden"]

    with pytest.raises(ServiceValidationError) as err:
        await _call(hass, "import_legacy", {"path": "missing.json"}, response=True)
    assert err.value.translation_key == "legacy_unreadable"


async def test_edit_auto_light(
    hass: HomeAssistant,
    hass_storage: dict[str, Any],
    hue_lights: MagicMock,
    office: str,
) -> None:
    """Pools, exclusions and offsets, like the legacy commands."""
    await _call(
        hass,
        "auto_light_pool",
        {
            "area": "Office",
            "phase": "day",
            "season": "all",
            "step": 2,
            "scenes": ["read", "read", "rest"],
        },
    )
    await _call(
        hass,
        "auto_light_pool",
        {
            "area": office,
            "phase": "evening",
            "season": "winter",
            "step": "gloomy",
            "scenes": ["relax"],
        },
    )
    await _call(hass, "auto_light_exclude", {"area": office, "scene": "rest"})
    assert await _call(
        hass,
        "auto_light_offset",
        {"area": office, "phase": "night", "delta": -50},
        response=True,
    ) == {"offset": -50}
    assert await _call(
        hass,
        "auto_light_offset",
        {"area": office, "phase": "night", "delta": -50},
        response=True,
    ) == {"offset": -60}

    config = hass_storage["hue_studio.auto_light"]["data"]["areas"][office]
    day = config["pools"]["day"]["all"]
    assert day["clear"] == day["gloomy"] == [[], [], ["read", "rest"], []]
    assert config["pools"]["evening"]["winter"] == {"gloomy": ["relax"]}
    assert config["names"] == {"read": "Read", "rest": "Rest", "relax": "Relax"}
    assert config["excluded"] == ["rest"]
    assert config["offsets"] == {"night": -60}

    await _call(
        hass, "auto_light_exclude", {"area": office, "scene": "rest", "excluded": False}
    )
    assert (
        hass_storage["hue_studio.auto_light"]["data"]["areas"][office]["excluded"] == []
    )


@pytest.mark.parametrize(
    ("data", "key"),
    [
        ({"area": "nowhere", "scene": "rest"}, "unknown_ha_area"),
        ({"area": "office", "scene": "nope"}, "unknown_gallery_scene"),
    ],
)
async def test_exclude_rejects(
    hass: HomeAssistant,
    hue_lights: MagicMock,
    office: str,
    data: dict[str, str],
    key: str,
) -> None:
    """Unknown areas and scenes are rejected."""
    with pytest.raises(ServiceValidationError) as err:
        await _call(hass, "auto_light_exclude", data)
    assert err.value.translation_key == key


async def test_pool_rejects_bad_step(
    hass: HomeAssistant, hue_lights: MagicMock, office: str
) -> None:
    """Day pools take steps 0-3, the other phases clear/gloomy."""
    for phase, step in (("day", "clear"), ("evening", "1")):
        with pytest.raises(ServiceValidationError) as err:
            await _call(
                hass,
                "auto_light_pool",
                {
                    "area": office,
                    "phase": phase,
                    "season": "all",
                    "step": step,
                    "scenes": [],
                },
            )
        assert err.value.translation_key == "auto_light_bad_step"
