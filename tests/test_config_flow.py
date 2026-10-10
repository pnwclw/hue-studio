"""Tests for the Hue Studio config flow."""

from unittest.mock import patch

from homeassistant.config_entries import SOURCE_USER
from homeassistant.const import CONF_HOST
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.hue_studio.const import (
    CONF_HUE_ENTRY_ID,
    DOMAIN,
    HUE_CONF_API_KEY,
    HUE_CONF_API_VERSION,
    HUE_DOMAIN,
)

from .conftest import BRIDGE_ID


async def _bridge_flow(hass: HomeAssistant) -> dict:
    """Start the user flow and pick "Hue bridge" in its menu."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    assert result["type"] is FlowResultType.MENU
    assert result["menu_options"] == ["bridge", "sync_box"]
    return await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "bridge"}
    )


async def test_user_flow_creates_entry(
    hass: HomeAssistant, hue_entry: MockConfigEntry
) -> None:
    """Picking a Hue bridge creates an entry keyed by the bridge id."""
    result = await _bridge_flow(hass)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "bridge"

    with patch(
        "custom_components.hue_studio.async_setup_entry", return_value=True
    ) as mock_setup:
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {CONF_HUE_ENTRY_ID: hue_entry.entry_id}
        )
        await hass.async_block_till_done()

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == hue_entry.title
    assert result["data"] == {CONF_HUE_ENTRY_ID: hue_entry.entry_id}
    assert result["result"].unique_id == BRIDGE_ID
    assert len(mock_setup.mock_calls) == 1


async def test_user_flow_without_hue_bridges(hass: HomeAssistant) -> None:
    """Without a native Hue entry the flow aborts."""
    result = await _bridge_flow(hass)
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "no_bridges"


async def test_user_flow_ignores_v1_bridges(hass: HomeAssistant) -> None:
    """Bridges on the legacy v1 API are not offered."""
    MockConfigEntry(
        domain=HUE_DOMAIN,
        unique_id="001788fffe111111",
        data={
            CONF_HOST: "192.0.2.11",
            HUE_CONF_API_KEY: "key",
            HUE_CONF_API_VERSION: 1,
        },
    ).add_to_hass(hass)

    result = await _bridge_flow(hass)
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "no_bridges"


async def test_user_flow_all_bridges_configured(
    hass: HomeAssistant, studio_entry: MockConfigEntry
) -> None:
    """A bridge that already has a Hue Studio entry is not offered again."""
    result = await _bridge_flow(hass)
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"
