"""Tests for the options flow (room mapping, room sensors) and the config WS API."""

from unittest.mock import MagicMock

from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import area_registry as ar, entity_registry as er
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_mock_service,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio.const import DOMAIN, HUE_DOMAIN


async def test_options_flow_and_config_ws(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    hue_entry: MockConfigEntry,
    studio_entry: MockConfigEntry,
    hue_lights: MagicMock,
) -> None:
    """Map a Hue room to an area, attach sensors, and see it pushed to the panel."""
    registry = er.async_get(hass)
    group = registry.async_get_or_create(
        "light", HUE_DOMAIN, "grp-room", config_entry=hue_entry
    )
    hass.states.async_set(
        group.entity_id,
        "on",
        {"is_hue_group": True, "hue_type": "room", "friendly_name": "Downstairs"},
    )
    office = ar.async_get(hass).async_create("Office")
    registry.async_update_entity("light.bulb", area_id=office.id)

    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/config/subscribe"})
    assert (await client.receive_json())["success"]
    assert (await client.receive_json())["event"] == {"groups": {}, "rooms": {}}

    flow = hass.config_entries.options
    result = await flow.async_init(studio_entry.entry_id)
    assert result["type"] is FlowResultType.MENU

    # Hue room -> HA area
    result = await flow.async_configure(
        result["flow_id"], {"next_step_id": "group_select"}
    )
    assert result["step_id"] == "group_select"
    result = await flow.async_configure(result["flow_id"], {"group": "grp-room"})
    assert result["step_id"] == "group_target"
    result = await flow.async_configure(result["flow_id"], {"target": office.id})
    assert result["type"] is FlowResultType.MENU

    # Sensors of the Office room
    result = await flow.async_configure(
        result["flow_id"], {"next_step_id": "room_select"}
    )
    assert result["step_id"] == "room_select"
    result = await flow.async_configure(
        result["flow_id"], {"room": f"area.{office.id}"}
    )
    assert result["step_id"] == "room_sensors"
    result = await flow.async_configure(
        result["flow_id"],
        {"motion": ["binary_sensor.office_motion"], "temperature": ["sensor.office_t"]},
    )
    assert result["type"] is FlowResultType.MENU

    result = await flow.async_configure(result["flow_id"], {"next_step_id": "save"})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert studio_entry.options == {
        "groups": {"grp-room": office.id},
        "rooms": {
            f"area.{office.id}": {
                "motion": ["binary_sensor.office_motion"],
                "temperature": ["sensor.office_t"],
            }
        },
    }
    await hass.async_block_till_done()

    # Pushed to the panel with entity ids instead of unique ids.
    event = (await client.receive_json())["event"]
    assert event["groups"] == {group.entity_id: office.id}
    assert event["rooms"][f"area.{office.id}"]["motion"] == [
        "binary_sensor.office_motion"
    ]


async def test_group_back_to_automatic(
    hass: HomeAssistant,
    hue_entry: MockConfigEntry,
    studio_entry: MockConfigEntry,
    hue_lights: MagicMock,
) -> None:
    """Choosing "auto" removes the mapping."""
    registry = er.async_get(hass)
    group = registry.async_get_or_create(
        "light", HUE_DOMAIN, "grp-zone", config_entry=hue_entry
    )
    hass.states.async_set(group.entity_id, "off", {"is_hue_group": True})
    hass.config_entries.async_update_entry(
        studio_entry, options={"groups": {"grp-zone": "zone"}, "rooms": {}}
    )
    flow = hass.config_entries.options
    result = await flow.async_init(studio_entry.entry_id)
    result = await flow.async_configure(
        result["flow_id"], {"next_step_id": "group_select"}
    )
    result = await flow.async_configure(result["flow_id"], {"group": "grp-zone"})
    result = await flow.async_configure(result["flow_id"], {"target": "auto"})
    result = await flow.async_configure(result["flow_id"], {"next_step_id": "save"})
    assert studio_entry.options["groups"] == {}


async def test_adaptive_lighting_marked_manual(
    hass: HomeAssistant, hue_lights: MagicMock
) -> None:
    """After a palette, Adaptive Lighting is told the lights were set by hand."""
    calls = async_mock_service(hass, "adaptive_lighting", "set_manual_control")
    switch = er.async_get(hass).async_get_or_create(
        "switch", "adaptive_lighting", "al-office"
    )
    hass.states.async_set(
        switch.entity_id,
        "on",
        {"configuration": {"lights": ["light.bulb", "light.elsewhere"]}},
    )
    await hass.services.async_call(
        DOMAIN,
        "apply_palette",
        {"entity_id": ["light.bulb", "light.strip"], "points": [[0.6, 0.35]]},
        blocking=True,
    )
    assert len(calls) == 1
    assert calls[0].data == {
        "entity_id": switch.entity_id,
        "lights": ["light.bulb"],
        "manual_control": True,
    }
