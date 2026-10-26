"""Tests for the global light of the day: settings, tags, mood, phase, merging."""

from typing import Any
from unittest.mock import MagicMock

from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import device_registry as dr, entity_registry as er
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    mock_restore_cache,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio.automations import daylight, pool
from custom_components.hue_studio.const import CONF_DAYLIGHT, DOMAIN


async def _subscribe(client: Any) -> dict[str, Any]:
    await client.send_json_auto_id({"type": "hue_studio/daylight/subscribe"})
    assert (await client.receive_json())["success"]
    return (await client.receive_json())["event"]


async def test_ready_made_tags(hass: HomeAssistant) -> None:
    """Every gallery scene has ready-made tags; each phase has scenes in any season."""
    defaults = await pool.async_default_tags(hass)
    gallery = await pool.async_gallery_scenes(hass)
    assert set(defaults) == set(gallery)
    for phase in daylight.PHASES:
        for season in daylight.SEASONS:
            for weather in daylight.WEATHER:
                found, pool_phase, _ = daylight.pool_of(
                    defaults, phase, season, weather, None
                )
                assert pool_phase == phase
                assert len(found) >= 5, (phase, season, weather)
    for mood in daylight.MOODS:
        assert any(mood in t.get("moods", ()) for t in defaults.values()), mood


async def test_subscribe_and_settings(
    hass: HomeAssistant, hue_lights: MagicMock, hass_ws_client: WebSocketGenerator
) -> None:
    """The panel sees and changes sources, phase times and tags."""
    hass.states.async_set("weather.home", "rainy", {"cloud_coverage": 90})
    client = await hass_ws_client(hass)
    event = await _subscribe(client)
    assert event["sources"]["weather"] == "weather.home"
    assert event["now"]["weather"] == "gloomy"
    assert event["settings"] == {"defaults": True}
    assert event["mood_entity"] == "select.hue_studio_mood"
    assert event["phase_entity"] == "sensor.hue_studio_phase"
    assert event["tags"]["rest"] == event["defaults"]["rest"]

    other = await hass_ws_client(hass)
    await other.send_json_auto_id(
        {"type": "hue_studio/daylight/set", "night_from": "22:30", "weather": None}
    )
    assert (await other.receive_json())["success"]
    event = (await client.receive_json())["event"]
    assert event["settings"] == {"night_from": "22:30", "defaults": True}

    await other.send_json_auto_id(
        {"type": "hue_studio/daylight/tags", "scene": "rest", "tags": {}}
    )
    assert (await other.receive_json())["success"]
    await other.send_json_auto_id(
        {
            "type": "hue_studio/daylight/tags",
            "scene": "miami",
            "tags": {"phases": ["evening"], "moods": ["party"]},
        }
    )
    assert (await other.receive_json())["success"]
    await hass.async_block_till_done()
    options = pool.async_settings(hass)
    assert options["tags"] == {
        "rest": {},
        "miami": {"phases": ["evening"], "moods": ["party"]},
    }
    tags = (await _subscribe(await hass_ws_client(hass)))["tags"]
    assert "rest" not in tags
    assert tags["miami"] == {"phases": ["evening"], "moods": ["party"]}

    await other.send_json_auto_id(
        {"type": "hue_studio/daylight/tags", "scene": "rest", "tags": None}
    )
    assert (await other.receive_json())["success"]
    assert "rest" not in pool.async_settings(hass)["tags"]


async def test_merge_pools(
    hass: HomeAssistant, hue_lights: MagicMock, hass_ws_client: WebSocketGenerator
) -> None:
    """Old pools move into the global pool; the first time it is just theirs."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "hue_studio/daylight/merge",
            "pools": {"evening": {"all": {"clear": ["rest", "mine"]}}},
            "holidays": [{"from": "12-24", "to": "12-26", "pool": ["jolly"]}],
        }
    )
    assert (await client.receive_json())["result"] == {"scenes": 3}
    settings = pool.async_settings(hass)
    assert settings["defaults"] is False
    assert settings["tags"]["mine"] == {"phases": ["evening"]}
    # The next automation's pools are added to what is there.
    await client.send_json_auto_id(
        {
            "type": "hue_studio/daylight/merge",
            "pools": {"night": {"winter": {"clear": ["mine", "other"]}}},
        }
    )
    assert (await client.receive_json())["result"] == {"scenes": 2}
    settings = pool.async_settings(hass)
    assert settings["defaults"] is False
    assert settings["tags"]["mine"] == {"phases": ["evening", "night"]}
    assert settings["tags"]["other"] == {"phases": ["night"], "seasons": ["winter"]}
    assert settings["tags"]["jolly"] == {"moods": ["festive"]}


async def test_phase_and_mood_entities(
    hass: HomeAssistant,
    hue_entry: MockConfigEntry,
    studio_entry: MockConfigEntry,
    mock_bridge: MagicMock,
) -> None:
    """The phase sensor and the mood select (restored) belong to Hue Studio's device."""
    mock_restore_cache(hass, [State("select.hue_studio_mood", "cozy")])
    assert await hass.config_entries.async_setup(studio_entry.entry_id)
    await hass.async_block_till_done()
    phase = hass.states.get("sensor.hue_studio_phase")
    assert phase is not None
    assert phase.state in daylight.PHASES
    assert phase.attributes["season"] in daylight.SEASONS
    assert hass.states.get("select.hue_studio_mood").state == "cozy"
    assert pool.async_mood(hass) == "cozy"

    await hass.services.async_call(
        "select",
        "select_option",
        {"entity_id": "select.hue_studio_mood", "option": "auto"},
        blocking=True,
    )
    assert pool.async_mood(hass) is None
    assert hass.states.get("select.hue_studio_mood").state == "auto"

    entry = er.async_get(hass).async_get("sensor.hue_studio_phase")
    device = dr.async_get(hass).async_get(entry.device_id)
    assert (DOMAIN, pool.DEVICE_ID) in device.identifiers
    assert await hass.config_entries.async_unload(studio_entry.entry_id)


async def test_settings_change_phase(
    hass: HomeAssistant, hue_lights: MagicMock
) -> None:
    """Global phase times reach the phase sensor."""
    pool.async_update_settings(hass, {"night_from": "00:00"})
    await hass.async_block_till_done()
    assert hass.config_entries.async_entries(DOMAIN)[0].options[CONF_DAYLIGHT] == {
        "night_from": "00:00"
    }
    assert hass.states.get("sensor.hue_studio_phase").state in daylight.PHASES
