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
    assert (await client.receive_json())["event"] == {
        "groups": {},
        "rooms": {},
        "auto_align": False,
    }

    flow = hass.config_entries.options
    result = await flow.async_init(studio_entry.entry_id)
    assert result["type"] is FlowResultType.MENU

    # Hue room -> HA area
    result = await flow.async_configure(result["flow_id"], {"next_step_id": "groups"})
    assert result["step_id"] == "groups"
    result = await flow.async_configure(result["flow_id"], {"Downstairs": office.id})
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

    # Rooms follow areas automatically
    result = await flow.async_configure(
        result["flow_id"], {"next_step_id": "alignment"}
    )
    assert result["step_id"] == "alignment"
    result = await flow.async_configure(result["flow_id"], {"auto_align": True})
    assert result["type"] is FlowResultType.MENU

    result = await flow.async_configure(result["flow_id"], {"next_step_id": "save"})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert studio_entry.options == {
        "auto_align": True,
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
    assert event["auto_align"] is True
    assert event["rooms"][f"area.{office.id}"]["motion"] == [
        "binary_sensor.office_motion"
    ]


def _suggested(result: dict, field: str) -> str | None:
    """The value a form field is prefilled with."""
    for key in result["data_schema"].schema:
        if key == field:
            return (key.description or {}).get("suggested_value")
    raise KeyError(field)


async def _groups_step(hass: HomeAssistant, entry: MockConfigEntry) -> dict:
    flow = hass.config_entries.options
    result = await flow.async_init(entry.entry_id)
    return await flow.async_configure(result["flow_id"], {"next_step_id": "groups"})


async def _save(hass: HomeAssistant, result: dict) -> None:
    await hass.config_entries.options.async_configure(
        result["flow_id"], {"next_step_id": "save"}
    )


async def test_groups_prefilled_with_automatic_match(
    hass: HomeAssistant,
    hue_entry: MockConfigEntry,
    studio_entry: MockConfigEntry,
    hue_lights: MagicMock,
) -> None:
    """Rows start at the area with the same lights; only deviations are stored."""
    registry = er.async_get(hass)
    office = ar.async_get(hass).async_create("Office")
    registry.async_update_entity("light.bulb", area_id=office.id)
    for unique_id, name in (("grp-office", "Office"), ("grp-tv", "TV")):
        group = registry.async_get_or_create(
            "light", HUE_DOMAIN, unique_id, config_entry=hue_entry
        )
        hass.states.async_set(
            group.entity_id,
            "on",
            {"is_hue_group": True, "friendly_name": name, "entity_id": ["light.bulb"]}
            if unique_id == "grp-office"
            else {"is_hue_group": True, "friendly_name": name},
        )
    flow = hass.config_entries.options

    # Accepting the prefilled rows stores nothing: the mapping stays automatic.
    result = await _groups_step(hass, studio_entry)
    assert _suggested(result, "Office") == office.id
    assert _suggested(result, "TV") is None
    result = await flow.async_configure(result["flow_id"], {"Office": office.id})
    await _save(hass, result)
    assert studio_entry.options["groups"] == {}

    # Two groups for one area is an error.
    result = await _groups_step(hass, studio_entry)
    result = await flow.async_configure(
        result["flow_id"], {"Office": office.id, "TV": office.id}
    )
    assert result["errors"] == {"TV": "area_taken"}

    # Clearing an automatic match makes the group a zone; back again removes it.
    result = await flow.async_configure(result["flow_id"], {})
    await _save(hass, result)
    assert studio_entry.options["groups"] == {"grp-office": "zone"}
    result = await _groups_step(hass, studio_entry)
    assert _suggested(result, "Office") is None
    result = await flow.async_configure(result["flow_id"], {"Office": office.id})
    await _save(hass, result)
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
