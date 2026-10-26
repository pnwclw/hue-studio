"""Tests for adding a Hue bridge from the panel (bridge_setup.py)."""

from collections.abc import Generator
from ipaddress import ip_address
from unittest.mock import AsyncMock, MagicMock, patch

from aiohue import LinkButtonNotPressed
from aiohue.discovery import DiscoveredHueBridge
from aiohue.util import normalize_bridge_id
from homeassistant.config_entries import SOURCE_ZEROCONF
from homeassistant.const import CONF_HOST
from homeassistant.core import HomeAssistant
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo
from homeassistant.setup import async_setup_component
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio.bridges import setup as bridge_setup
from custom_components.hue_studio.bridges.setup import (
    BridgeDiscovery,
    FoundBridge,
    LinkFailed,
    async_link,
)
from custom_components.hue_studio.const import (
    DOMAIN,
    HUE_CONF_API_KEY,
    HUE_DOMAIN,
)

from .conftest import BRIDGE_HOST, BRIDGE_ID

NEW_ID = "001788000001"
NEW_HOST = "192.0.2.20"
HUE_FLOW = "homeassistant.components.hue.config_flow"


@pytest.fixture(autouse=True)
async def unload_hue_entries(hass: HomeAssistant, mock_native_hue_setup: None):
    """Unload the native entries while their unload is still patched."""
    yield
    for entry in hass.config_entries.async_entries(HUE_DOMAIN):
        await hass.config_entries.async_unload(entry.entry_id)


@pytest.fixture
def new_bridge() -> Generator[MagicMock]:
    """A new bridge at NEW_HOST; its button is pressed on the second try."""
    with (
        patch(f"{HUE_FLOW}.discover_nupnp", AsyncMock(return_value=[])),
        patch(
            f"{HUE_FLOW}.discover_bridge",
            AsyncMock(return_value=DiscoveredHueBridge(NEW_HOST, NEW_ID, True)),
        ),
        patch(
            f"{HUE_FLOW}.create_app_key",
            AsyncMock(side_effect=[LinkButtonNotPressed("press it"), "new-app-key"]),
        ) as create_app_key,
        patch.object(bridge_setup, "LINK_RETRY", 0),
    ):
        yield create_app_key


def _hue_flows(hass: HomeAssistant) -> list[dict]:
    return hass.config_entries.flow.async_progress_by_handler(HUE_DOMAIN)


async def test_link_new_bridge(hass: HomeAssistant, new_bridge: MagicMock) -> None:
    """A bridge at an address: the native flow links it (the button on second try)."""
    steps: list[dict] = []
    entry = await async_link(hass, steps.append, host=NEW_HOST)
    await hass.async_block_till_done()

    assert [s["step"] for s in steps] == ["connecting", "press"]
    assert new_bridge.await_count == 2
    assert entry.domain == HUE_DOMAIN
    assert entry.unique_id == NEW_ID
    assert entry.data[CONF_HOST] == NEW_HOST
    assert entry.data[HUE_CONF_API_KEY] == "new-app-key"
    assert _hue_flows(hass) == []


async def test_link_reuses_discovered_flow(
    hass: HomeAssistant, new_bridge: MagicMock
) -> None:
    """A bridge HA discovered is linked through HA's own discovered flow."""
    discovered = await hass.config_entries.flow.async_init(
        HUE_DOMAIN,
        context={"source": SOURCE_ZEROCONF},
        data=ZeroconfServiceInfo(
            ip_address=ip_address(NEW_HOST),
            ip_addresses=[ip_address(NEW_HOST)],
            hostname="bridge.local.",
            name="Hue Bridge - 000001._hue._tcp.local.",
            port=443,
            type="_hue._tcp.local.",
            properties={"bridgeid": NEW_ID, "modelid": "BSB003"},
        ),
    )
    assert discovered["step_id"] == "link"

    with patch.object(
        hass.config_entries.flow,
        "async_init",
        wraps=hass.config_entries.flow.async_init,
    ) as flow_init:
        entry = await async_link(hass, lambda _: None, bridge_id=NEW_ID)
        await hass.async_block_till_done()

    # No flow of our own: HA's discovered one did it.
    assert flow_init.call_count == 0
    assert entry.unique_id == NEW_ID


async def test_link_timeout_drops_our_flow(
    hass: HomeAssistant, new_bridge: MagicMock
) -> None:
    """Nobody pressed the button: the flow we started does not linger."""
    new_bridge.side_effect = LinkButtonNotPressed("press it")
    with (
        patch.object(bridge_setup, "LINK_TIMEOUT", 0),
        pytest.raises(LinkFailed) as err,
    ):
        await async_link(hass, lambda _: None, host=NEW_HOST)
    assert err.value.reason == "timeout"
    assert _hue_flows(hass) == []


async def test_link_unreachable_host(hass: HomeAssistant) -> None:
    """Nothing answers at the address."""
    with (
        patch(f"{HUE_FLOW}.discover_nupnp", AsyncMock(return_value=[])),
        patch(f"{HUE_FLOW}.discover_bridge", AsyncMock(return_value=None)),
        pytest.raises(LinkFailed) as err,
    ):
        await async_link(hass, lambda _: None, host=NEW_HOST)
    assert err.value.reason == "cannot_connect"
    assert _hue_flows(hass) == []


async def test_link_bridge_ha_already_has(
    hass: HomeAssistant, hue_entry: MockConfigEntry
) -> None:
    """A bridge HA has already: nothing to link (Hue Studio uses it anyway)."""
    with pytest.raises(LinkFailed) as err:
        await async_link(hass, lambda _: None, host=BRIDGE_HOST)
    assert err.value.reason == "already_added"


async def test_link_v1_bridge_refused(
    hass: HomeAssistant, new_bridge: MagicMock
) -> None:
    """A bridge that only talks the old API is linked by HA but useless here."""
    with (
        patch(
            f"{HUE_FLOW}.discover_bridge",
            AsyncMock(return_value=DiscoveredHueBridge(NEW_HOST, NEW_ID, False)),
        ),
        pytest.raises(LinkFailed) as err,
    ):
        await async_link(hass, lambda _: None, host=NEW_HOST)
    assert err.value.reason == "unsupported"


async def test_discovery_payload(
    hass: HomeAssistant, hue_entry: MockConfigEntry
) -> None:
    """New bridges only: those the native integration has are left out."""
    details = {
        NEW_HOST: FoundBridge(
            NEW_ID, NEW_HOST, "Hue Bridge Pro", "Hue Bridge Pro", True
        ),
        BRIDGE_HOST: FoundBridge(
            normalize_bridge_id(BRIDGE_ID), BRIDGE_HOST, "Ours", "Hue Bridge", True
        ),
    }

    async def watch(_hass: HomeAssistant, on_host) -> AsyncMock:
        on_host(NEW_HOST)
        return AsyncMock()

    changes = MagicMock()
    with (
        patch.object(bridge_setup, "_async_watch_mdns", watch),
        patch.object(
            bridge_setup, "_async_nupnp_hosts", AsyncMock(return_value=[BRIDGE_HOST])
        ),
        patch.object(
            bridge_setup,
            "async_bridge_details",
            AsyncMock(side_effect=lambda _h, host: details.get(host)),
        ),
    ):
        discovery = BridgeDiscovery(hass, changes)
        await discovery.async_start()
        await hass.async_block_till_done()
        payload = discovery.payload()
        await discovery.async_stop()

    assert payload == {
        "searching": False,
        "bridges": [
            {
                "id": NEW_ID,
                "host": NEW_HOST,
                "name": "Hue Bridge Pro",
                "model": "Hue Bridge Pro",
                "supported": True,
            }
        ],
    }
    assert changes.called


async def test_ws_link(
    hass: HomeAssistant,
    hue_entry: MockConfigEntry,
    new_bridge: MagicMock,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """The panel's link subscription reports the steps and the new bridge."""
    assert await async_setup_component(hass, DOMAIN, {})
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "hue_studio/bridges/link", "host": NEW_HOST}
    )
    assert (await client.receive_json())["success"]
    events = [(await client.receive_json())["event"] for _ in range(3)]
    assert [e["step"] for e in events] == ["connecting", "press", "done"]
    done = hass.config_entries.async_get_entry(events[2]["hue_entry_id"])
    assert done.unique_id == NEW_ID
    assert events[2]["name"] == done.title

    await client.send_json_auto_id(
        {"type": "hue_studio/bridges/link", "host": BRIDGE_HOST}
    )
    assert (await client.receive_json())["success"]
    assert (await client.receive_json())["event"] == {"step": "connecting"}
    assert (await client.receive_json())["event"] == {
        "step": "failed",
        "reason": "already_added",
    }
