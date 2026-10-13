"""Tests for the Hue Studio config flow."""

from unittest.mock import patch

from homeassistant.config_entries import SOURCE_USER
from homeassistant.const import CONF_HOST
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.hue_studio.const import (
    CONF_KIND,
    DOMAIN,
    HUE_CONF_API_KEY,
    HUE_CONF_API_VERSION,
    HUE_DOMAIN,
    KIND_STUDIO,
)


async def _studio_flow(hass: HomeAssistant) -> dict:
    """Start the user flow and pick "Hue Studio" in its menu."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    assert result["type"] is FlowResultType.MENU
    assert result["menu_options"] == ["bridges", "sync_box"]
    return await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "bridges"}
    )


async def test_user_flow_creates_entry(
    hass: HomeAssistant, hue_entry: MockConfigEntry
) -> None:
    """One entry for every bridge of the native integration, listed in the form."""
    MockConfigEntry(
        domain=HUE_DOMAIN,
        title="Upstairs Bridge",
        unique_id="001788fffe111111",
        data={CONF_HOST: "192.0.2.11", HUE_CONF_API_KEY: "k", HUE_CONF_API_VERSION: 2},
    ).add_to_hass(hass)
    result = await _studio_flow(hass)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "bridges"
    assert result["description_placeholders"] == {
        "bridges": "Hue Bridge, Upstairs Bridge"
    }

    with patch(
        "custom_components.hue_studio.async_setup_entry", return_value=True
    ) as mock_setup:
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
        await hass.async_block_till_done()

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Hue Studio"
    assert result["data"] == {CONF_KIND: KIND_STUDIO}
    assert result["result"].unique_id == DOMAIN
    assert len(mock_setup.mock_calls) == 1


async def test_user_flow_without_hue_bridges(hass: HomeAssistant) -> None:
    """Without a native Hue entry the flow aborts."""
    result = await _studio_flow(hass)
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "no_bridges"


async def test_user_flow_ignores_v1_bridges(hass: HomeAssistant) -> None:
    """Bridges on the legacy v1 API are not used."""
    MockConfigEntry(
        domain=HUE_DOMAIN,
        unique_id="001788fffe111111",
        data={
            CONF_HOST: "192.0.2.11",
            HUE_CONF_API_KEY: "key",
            HUE_CONF_API_VERSION: 1,
        },
    ).add_to_hass(hass)

    result = await _studio_flow(hass)
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "no_bridges"


async def test_user_flow_once_set_up_adds_sync_boxes(
    hass: HomeAssistant, studio_entry: MockConfigEntry
) -> None:
    """With Hue Studio set up, "Add" goes straight to adding a Sync Box."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "sync_box_pair"
