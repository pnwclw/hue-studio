"""Tests for auto light at work: entities, apply_auto_light, manual control."""

from typing import Any
from unittest.mock import MagicMock

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)
import pytest
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio import auto_control
from custom_components.hue_studio.auto_light import STORAGE_KEY
from custom_components.hue_studio.const import DOMAIN

# The night pool only: every phase falls back to it.
OFFICE = {"pools": {"night": {"all": {"clear": ["rest", "relax"]}}}}


@pytest.fixture
def office(hass: HomeAssistant, hass_storage: dict[str, Any]) -> None:
    """An "office" area with auto light settings in the format of an older version
    (no settings, control or skip), stored before the integration is set up.
    """
    ar.async_get(hass).async_create("Office")
    hass_storage[STORAGE_KEY] = {
        "version": 1,
        "key": STORAGE_KEY,
        "data": {"areas": {"office": OFFICE}},
    }


@pytest.fixture
async def auto(hass: HomeAssistant, office: None, hue_lights: MagicMock) -> MagicMock:
    """Both Hue lights in the office; returns the mocked bridge."""
    entities = er.async_get(hass)
    for entity_id in ("light.bulb", "light.strip"):
        entities.async_update_entity(entity_id, area_id="office")
    await hass.async_block_till_done()
    return hue_lights


def _sent(bridge: MagicMock) -> dict[str, Any]:
    return {c.args[0]: c.args[1] for c in bridge.lights.update.mock_calls}


async def _apply(hass: HomeAssistant, **data: Any) -> None:
    await hass.services.async_call(
        DOMAIN, "apply_auto_light", {"area": "office", **data}, blocking=True
    )


async def test_entities(hass: HomeAssistant, auto: MagicMock) -> None:
    """One device in the area with phase, scene, brightness, control, offset, next."""
    phase = hass.states.get("sensor.office_light_phase")
    assert phase.state in ("morning", "day", "golden", "evening", "night")
    scene = hass.states.get("sensor.office_light_scene")
    assert scene.state in ("Rest", "Relax")
    assert scene.attributes["entity_picture"].startswith(
        "/hue_studio_static/gallery/thumb/r"
    )
    assert scene.attributes["pool_phase"] == "night"
    assert hass.states.get("select.office_light_control").state == "auto"
    assert hass.states.get("number.office_light_offset").state == "0"
    assert hass.states.get("button.office_next_light_scene") is not None
    brightness = hass.states.get("sensor.office_light_brightness")
    assert brightness.attributes["unit_of_measurement"] == "%"

    entry = er.async_get(hass).async_get("select.office_light_control")
    device = dr.async_get(hass).async_get(entry.device_id)
    assert device.area_id == "office"


async def test_apply_and_manual(
    hass: HomeAssistant, auto: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Applying shows the scene; a change by anyone else makes the area manual."""
    await _apply(hass, transition=5)
    sent = _sent(auto)
    assert set(sent) == {"res-bulb", "res-strip"}
    level = float(hass.states.get("sensor.office_light_brightness").state)
    assert sent["res-bulb"].dimming.brightness == level
    assert sent["res-bulb"].dynamics.duration == 5000

    # Within the quiet window: our own command echoing back.
    hass.states.async_set("light.bulb", "off")
    await hass.async_block_till_done()
    assert hass.states.get("select.office_light_control").state == "auto"

    monkeypatch.setattr(auto_control, "QUIET_SECONDS", 0)
    hass.states.async_set("light.bulb", "on", {"brightness": 200})
    await hass.async_block_till_done()
    assert hass.states.get("select.office_light_control").state == "manual"

    auto.lights.update.reset_mock()
    await _apply(hass)
    auto.lights.update.assert_not_called()
    await _apply(hass, resume=True)
    assert auto.lights.update.call_count == 2
    assert hass.states.get("select.office_light_control").state == "auto"


async def test_off_and_force(hass: HomeAssistant, auto: MagicMock) -> None:
    """ "off" is stored and blocks applying, unless forced."""
    await hass.services.async_call(
        "select",
        "select_option",
        {"entity_id": "select.office_light_control", "option": "off"},
        blocking=True,
    )
    assert hass.states.get("select.office_light_control").state == "off"
    await _apply(hass)
    auto.lights.update.assert_not_called()
    await _apply(hass, force=True)
    assert auto.lights.update.call_count == 2
    store = auto_control.auto_light_manager(hass).store
    assert store.areas["office"]["control"] == "off"


async def test_next_scene_and_offset(hass: HomeAssistant, auto: MagicMock) -> None:
    """ "Next scene" moves on in the pool; the offset changes the brightness."""
    before = hass.states.get("sensor.office_light_scene").state
    await hass.services.async_call(
        "button",
        "press",
        {"entity_id": "button.office_next_light_scene"},
        blocking=True,
    )
    await hass.async_block_till_done()
    assert hass.states.get("sensor.office_light_scene").state != before
    # The bulb and strip are on (fixture), so the new scene is shown at once.
    assert auto.lights.update.call_count == 2

    level = int(hass.states.get("sensor.office_light_brightness").state)
    await hass.services.async_call(
        "number",
        "set_value",
        {"entity_id": "number.office_light_offset", "value": -10},
        blocking=True,
    )
    await hass.async_block_till_done()
    assert hass.states.get("number.office_light_offset").state == "-10"
    assert int(hass.states.get("sensor.office_light_brightness").state) == max(
        1, level - 10
    )


async def test_errors_and_settings(
    hass: HomeAssistant, auto: MagicMock, hass_ws_client: WebSocketGenerator
) -> None:
    """Unknown areas are refused; settings are merged through the WebSocket API."""
    with pytest.raises(ServiceValidationError) as err:
        await hass.services.async_call(
            DOMAIN, "apply_auto_light", {"area": "nowhere"}, blocking=True
        )
    assert err.value.translation_key == "no_auto_light"

    client = await hass_ws_client(hass)

    async def settings(area_id: str, value: dict[str, Any]) -> bool:
        await client.send_json_auto_id(
            {
                "type": "hue_studio/auto_light/settings",
                "area_id": area_id,
                "settings": value,
            }
        )
        return (await client.receive_json())["success"]

    assert await settings(
        "office", {"night_from": "22:15", "brightness": {"night": 40}}
    )
    store = auto_control.auto_light_manager(hass).store
    assert store.areas["office"]["settings"]["night_from"] == "22:15"
    assert await settings("office", {"night_from": None})
    assert "night_from" not in store.areas["office"]["settings"]
    assert not await settings("office", {"night_from": "late"})
    assert not await settings("nowhere", {})
