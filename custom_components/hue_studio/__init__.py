"""Hue Studio: Hue-app-style light control on top of the native Hue integration."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from aiohttp import ClientError
from aiohue import HueBridgeV2, LinkButtonNotPressed, Unauthorized
from aiohue.errors import BridgeBusy
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryError, ConfigEntryNotReady
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.typing import ConfigType

from .const import (
    CONF_HUE_ENTRY_ID,
    DOMAIN,
    HUE_CONF_API_KEY,
    SIGNAL_CONFIG_UPDATED,
)
from .panel import async_register_panel, async_unregister_panel
from .services import async_setup_services
from .websocket import async_setup_websocket

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

CONNECT_TIMEOUT = 10


@dataclass
class HueStudioData:
    """Runtime data of a Hue Studio config entry."""

    bridge: HueBridgeV2


type HueStudioConfigEntry = ConfigEntry[HueStudioData]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register services and the WebSocket API (once, independent of entries)."""
    async_setup_services(hass)
    async_setup_websocket(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: HueStudioConfigEntry) -> bool:
    """Connect to the bridge of the linked native Hue config entry."""
    hue_entry = hass.config_entries.async_get_entry(entry.data[CONF_HUE_ENTRY_ID])
    if hue_entry is None:
        raise ConfigEntryError(
            translation_domain=DOMAIN, translation_key="hue_entry_missing"
        )

    host: str = hue_entry.data[CONF_HOST]
    bridge = HueBridgeV2(host, hue_entry.data[HUE_CONF_API_KEY])
    try:
        async with asyncio.timeout(CONNECT_TIMEOUT):
            await bridge.initialize()
    except (LinkButtonNotPressed, Unauthorized) as err:
        await bridge.close()
        raise ConfigEntryError(
            translation_domain=DOMAIN, translation_key="bridge_auth_failed"
        ) from err
    except (TimeoutError, ClientError, BridgeBusy) as err:
        await bridge.close()
        raise ConfigEntryNotReady(
            translation_domain=DOMAIN,
            translation_key="bridge_unreachable",
            translation_placeholders={"host": host},
        ) from err

    entry.runtime_data = HueStudioData(bridge=bridge)
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    await async_register_panel(hass)
    return True


async def _async_options_updated(
    hass: HomeAssistant, entry: HueStudioConfigEntry
) -> None:
    """Options changed: no reload needed, just tell open panels."""
    async_dispatcher_send(hass, SIGNAL_CONFIG_UPDATED)


async def async_unload_entry(hass: HomeAssistant, entry: HueStudioConfigEntry) -> bool:
    """Close the bridge connection; drop the panel with the last entry."""
    await entry.runtime_data.bridge.close()
    if not any(
        other.entry_id != entry.entry_id
        for other in hass.config_entries.async_loaded_entries(DOMAIN)
    ):
        async_unregister_panel(hass)
    return True
