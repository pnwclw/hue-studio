"""Tests for the settings (room mapping, room sensors) and the config WS API."""

from unittest.mock import MagicMock

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, entity_registry as er
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_mock_service,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio.const import DOMAIN, HUE_DOMAIN


async def _ws(client, **msg) -> dict:
    await client.send_json_auto_id(msg)
    return await client.receive_json()


async def test_config_pushed_to_panel(
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

    panel = await hass_ws_client(hass)
    await panel.send_json_auto_id({"type": "hue_studio/config/subscribe"})
    assert (await panel.receive_json())["success"]
    assert (await panel.receive_json())["event"] == {
        "groups": {},
        "rooms": {},
        "auto_align": False,
        "organize": True,
        "zone_labels": False,
        "footer": False,
        "footer_tabs": [],
        "gallery_seasonal": False,
        "gallery_rules": {},
        "icons": {},
    }

    client = await hass_ws_client(hass)
    for msg in (
        {
            "type": "hue_studio/config/set_group",
            "entity_id": group.entity_id,
            "area_id": office.id,
        },
        {
            "type": "hue_studio/config/set_room_sensors",
            "room": f"area.{office.id}",
            "motion": ["binary_sensor.office_motion"],
            "temperature": ["sensor.office_t"],
            "illuminance": ["sensor.office_lux"],
        },
        {"type": "hue_studio/config/set", "auto_align": True},
    ):
        assert (await _ws(client, **msg))["success"]
    await hass.async_block_till_done()
    assert studio_entry.options == {
        "auto_align": True,
        "groups": {"grp-room": office.id},
        "rooms": {
            f"area.{office.id}": {
                "motion": ["binary_sensor.office_motion"],
                "temperature": ["sensor.office_t"],
                "illuminance": ["sensor.office_lux"],
            }
        },
    }

    # Pushed to the panel with entity ids instead of unique ids.
    for _ in range(3):
        event = (await panel.receive_json())["event"]
    assert event["groups"] == {group.entity_id: office.id}
    assert event["auto_align"] is True
    assert event["rooms"][f"area.{office.id}"]["motion"] == [
        "binary_sensor.office_motion"
    ]
    assert event["rooms"][f"area.{office.id}"]["illuminance"] == ["sensor.office_lux"]


async def test_groups_follow_automatic_match(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    hue_entry: MockConfigEntry,
    studio_entry: MockConfigEntry,
    hue_lights: MagicMock,
) -> None:
    """The area with the same lights is automatic; only deviations are stored."""
    registry = er.async_get(hass)
    office = ar.async_get(hass).async_create("Office")
    registry.async_update_entity("light.bulb", area_id=office.id)
    groups = {}
    for unique_id, name in (("grp-office", "Office"), ("grp-tv", "TV")):
        group = registry.async_get_or_create(
            "light", HUE_DOMAIN, unique_id, config_entry=hue_entry
        )
        groups[unique_id] = group.entity_id
        hass.states.async_set(
            group.entity_id,
            "on",
            {"is_hue_group": True, "friendly_name": name, "entity_id": ["light.bulb"]}
            if unique_id == "grp-office"
            else {"is_hue_group": True, "friendly_name": name},
        )
    client = await hass_ws_client(hass)

    async def set_group(unique_id: str, area_id: str | None) -> dict:
        return await _ws(
            client,
            type="hue_studio/config/set_group",
            entity_id=groups[unique_id],
            area_id=area_id,
        )

    # The automatic match stores nothing: the mapping stays automatic.
    assert (await set_group("grp-office", office.id))["success"]
    assert studio_entry.options["groups"] == {}

    # An area may hold another group too (a zone in that room, as in Home Assistant).
    assert (await set_group("grp-tv", office.id))["success"]
    assert studio_entry.options["groups"] == {"grp-tv": office.id}
    assert (await set_group("grp-tv", "auto"))["success"]
    assert studio_entry.options["groups"] == {}

    # Leaving an automatic match makes the group a zone; back again removes it.
    assert (await set_group("grp-office", None))["success"]
    assert studio_entry.options["groups"] == {"grp-office": "zone"}
    assert (await set_group("grp-office", office.id))["success"]
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
