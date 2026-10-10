"""Tests for a Sync Box used through the HACS `huesyncbox` integration."""

from typing import Any
from unittest.mock import MagicMock, patch

from homeassistant.config_entries import (
    SOURCE_USER,
    SOURCE_ZEROCONF,
    ConfigEntryState,
)
from homeassistant.const import CONF_HOST
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import device_registry as dr, entity_registry as er
import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_mock_service,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio.const import (
    CONF_KIND,
    CONF_SYNC_ENTRY_ID,
    DOMAIN,
    KIND_SYNC_BOX_LINK,
)

from .conftest import ENTERTAINMENT, make_entertainment
from .test_sync_box import BOX_HOST, BOX_ID, _zeroconf

INTEGRATION = "huesyncbox"

# The integration's entities: (domain, key, state, attributes).
ENTITIES: list[tuple[str, str, str, dict[str, Any]]] = [
    ("switch", "power", "on", {}),
    ("switch", "light_sync", "off", {}),
    ("select", "sync_mode", "video", {"options": ["video", "music", "game"]}),
    (
        "select",
        "intensity",
        "high",
        {"options": ["subtle", "moderate", "high", "intense"]},
    ),
    (
        "select",
        "hdmi_input",
        "Media player",
        {"options": ["Media player", "HDMI 2", "HDMI 3", "PC"]},
    ),
    ("select", "entertainment_area", "TV area", {"options": ["Desk", "TV area"]}),
    ("number", "brightness", "50", {}),
    ("sensor", "hdmi1_status", "linked", {}),
    ("sensor", "hdmi2_status", "unplugged", {}),
    ("sensor", "hdmi3_status", "unplugged", {}),
    ("sensor", "hdmi4_status", "plugged", {}),
    ("sensor", "content_info", "3840 x 2160 @ 60000 - HDR10", {}),
]


@pytest.fixture
def sync_entry(hass: HomeAssistant) -> MockConfigEntry:
    """A loaded `huesyncbox` entry with its device and entities."""
    entry = MockConfigEntry(domain=INTEGRATION, title="Sync Box", unique_id=BOX_ID)
    entry.add_to_hass(hass)
    entry.mock_state(hass, ConfigEntryState.LOADED)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(INTEGRATION, BOX_ID)},
        name="Sync Box",
        model="Hue Play HDMI Sync Box 8K",
    )
    registry = er.async_get(hass)
    for domain, key, state, attributes in ENTITIES:
        registered = registry.async_get_or_create(
            domain,
            INTEGRATION,
            f"{key}_{BOX_ID}",
            config_entry=entry,
            device_id=device.id,
            suggested_object_id=f"sync_box_{key}",
        )
        hass.states.async_set(registered.entity_id, state, attributes)
    return entry


@pytest.fixture
def set_sync_state(hass: HomeAssistant) -> list[ServiceCall]:
    """Calls of the integration's service."""
    return async_mock_service(hass, INTEGRATION, "set_sync_state")


@pytest.fixture
def link_entry(hass: HomeAssistant, sync_entry: MockConfigEntry) -> MockConfigEntry:
    """A Hue Studio entry using the integration's box."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Sync Box",
        unique_id=BOX_ID,
        data={CONF_KIND: KIND_SYNC_BOX_LINK, CONF_SYNC_ENTRY_ID: sync_entry.entry_id},
    )
    entry.add_to_hass(hass)
    return entry


@pytest.fixture
async def linked_box(
    hass: HomeAssistant,
    hue_lights: MagicMock,
    link_entry: MockConfigEntry,
    set_sync_state: list[ServiceCall],
) -> MockConfigEntry:
    """The bridge and the linked box set up."""
    assert await hass.config_entries.async_setup(link_entry.entry_id)
    await hass.async_block_till_done()
    return link_entry


# ---- config flow ----


async def _sync_box_menu(hass: HomeAssistant) -> dict:
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    return await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "sync_box"}
    )


async def test_flow_use_integration(
    hass: HomeAssistant, sync_entry: MockConfigEntry
) -> None:
    """With the integration present, the Sync Box menu offers both ways."""
    result = await _sync_box_menu(hass)
    assert result["type"] is FlowResultType.MENU
    assert result["menu_options"] == ["sync_box_pair", "sync_box_integration"]

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "sync_box_integration"}
    )
    assert result["step_id"] == "sync_box_integration"
    with patch("custom_components.hue_studio.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {CONF_SYNC_ENTRY_ID: sync_entry.entry_id}
        )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"] == {
        CONF_KIND: KIND_SYNC_BOX_LINK,
        CONF_SYNC_ENTRY_ID: sync_entry.entry_id,
    }
    assert result["result"].unique_id == BOX_ID
    assert not result["result"].supports_options


async def test_discovered_box_of_integration_is_linked(
    hass: HomeAssistant, sync_entry: MockConfigEntry
) -> None:
    """A discovered box the integration has is linked, not paired a second time."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_ZEROCONF}, data=_zeroconf()
    )
    assert result["step_id"] == "sync_box_use_integration"
    with patch("custom_components.hue_studio.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"][CONF_KIND] == KIND_SYNC_BOX_LINK


async def test_pairing_box_of_integration_offers_link(
    hass: HomeAssistant, sync_entry: MockConfigEntry
) -> None:
    """Pairing by address also switches to the link when the integration has it."""
    result = await _sync_box_menu(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "sync_box_pair"}
    )
    with patch(
        "custom_components.hue_studio.config_flow.async_get_box_id",
        return_value=(BOX_ID, "Sync Box"),
    ):
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {CONF_HOST: BOX_HOST}
        )
    assert result["step_id"] == "sync_box_use_integration"


async def test_one_box_one_way(
    hass: HomeAssistant, link_entry: MockConfigEntry
) -> None:
    """A linked box is neither paired again nor offered for linking again."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_ZEROCONF}, data=_zeroconf("192.0.2.21")
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"
    assert CONF_HOST not in link_entry.data

    result = await _sync_box_menu(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "sync_box_integration"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"


# ---- setup ----


async def test_setup_waits_for_integration(
    hass: HomeAssistant, link_entry: MockConfigEntry, sync_entry: MockConfigEntry
) -> None:
    """Until the integration is loaded, setup is retried."""
    sync_entry.mock_state(hass, ConfigEntryState.SETUP_RETRY)
    await hass.config_entries.async_setup(link_entry.entry_id)
    assert link_entry.state is ConfigEntryState.SETUP_RETRY


async def test_setup_integration_entry_gone(hass: HomeAssistant) -> None:
    """Without the integration's entry, setup fails."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={CONF_KIND: KIND_SYNC_BOX_LINK, CONF_SYNC_ENTRY_ID: "does-not-exist"},
    )
    entry.add_to_hass(hass)
    await hass.config_entries.async_setup(entry.entry_id)
    assert entry.state is ConfigEntryState.SETUP_ERROR


# ---- panel API and service ----


async def test_subscribe_linked_box(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    linked_box: MockConfigEntry,
) -> None:
    """The panel gets the same payload as for a box paired directly."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/sync/subscribe"})
    assert (await client.receive_json())["success"]

    box = (await client.receive_json())["event"]["boxes"][linked_box.entry_id]
    assert box["available"] is True
    assert box["entity_id"] == "switch.sync_box_light_sync"
    assert (box["name"], box["model"]) == ("Sync Box", "Hue Play HDMI Sync Box 8K")
    assert (box["power"], box["syncing"], box["mode"]) == (True, False, "video")
    assert (box["intensity"], box["brightness"]) == ("high", 50)
    assert box["input"] == "input1"
    assert box["inputs"][3] == {
        "id": "input4",
        "name": "PC",
        "type": None,
        "status": "plugged",
    }
    # Areas are matched with the bridge by name; "Desk" is not on the bridge.
    assert box["area"] == "ent-tv"
    assert box["areas"] == [
        {"id": "Desk", "name": "Desk", "active": False, "lights": []},
        {"id": "ent-tv", "name": "TV area", "active": False, "lights": ["light.strip"]},
    ]
    assert box["content"] == "3840 x 2160 @ 60000 - HDR10"

    # The integration's entity changes: the panel hears it at once.
    ENTERTAINMENT[:] = [
        make_entertainment("ent-tv", "TV area", ["res-strip"], active=True)
    ]
    hass.states.async_set("switch.sync_box_light_sync", "on")
    box = (await client.receive_json())["event"]["boxes"][linked_box.entry_id]
    assert box["syncing"] is True
    assert box["areas"][1]["active"] is True

    # The integration unloads: the box is unavailable.
    hass.states.async_set("switch.sync_box_power", "unavailable")
    box = (await client.receive_json())["event"]["boxes"][linked_box.entry_id]
    assert box["available"] is False


async def test_set_sync_uses_integration_service(
    hass: HomeAssistant,
    linked_box: MockConfigEntry,
    set_sync_state: list[ServiceCall],
) -> None:
    """set_sync on a linked box is one call of huesyncbox.set_sync_state."""
    sync_entry_id = linked_box.data[CONF_SYNC_ENTRY_ID]
    [device] = dr.async_entries_for_config_entry(dr.async_get(hass), sync_entry_id)
    await hass.services.async_call(
        DOMAIN,
        "set_sync",
        {
            "entity_id": "switch.sync_box_light_sync",
            "mode": "game",
            "intensity": "moderate",
            "input": "PC",
            "entertainment_area": "ent-tv",
            "brightness": 40,
        },
        blocking=True,
    )
    assert len(set_sync_state) == 1
    assert set_sync_state[0].data == {
        "device_id": device.id,
        "mode": "game",
        "intensity": "moderate",
        "input": "input4",
        "entertainment_area": "TV area",
        "brightness": 40,
    }


async def test_set_sync_unknown_input(
    hass: HomeAssistant,
    linked_box: MockConfigEntry,
    set_sync_state: list[ServiceCall],
) -> None:
    """Names the box does not have are rejected before calling the integration."""
    with pytest.raises(ServiceValidationError, match="VCR"):
        await hass.services.async_call(
            DOMAIN,
            "set_sync",
            {"entity_id": "switch.sync_box_light_sync", "input": "VCR"},
            blocking=True,
        )
    assert set_sync_state == []
