"""The `/hue` sidebar panel and the static files it is served from."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration

from .const import DOMAIN

FRONTEND_DIR = Path(__file__).parent / "frontend"
STATIC_URL = f"/{DOMAIN}_static"
PANEL_URL_PATH = "hue"
PANEL_COMPONENT = "hue-studio-panel"
PANEL_ICON = "mdi:lightbulb-group"
PANEL_TITLE = "Hue"

_STATIC_REGISTERED = f"{DOMAIN}_static_registered"


async def async_register_panel(hass: HomeAssistant) -> None:
    """Serve the frontend files and add the panel to the sidebar."""
    if not hass.data.get(_STATIC_REGISTERED):
        # aiohttp cannot unregister routes, so this happens once per HA run.
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(FRONTEND_DIR), cache_headers=False)]
        )
        hass.data[_STATIC_REGISTERED] = True

    if PANEL_URL_PATH in hass.data.get(frontend.DATA_PANELS, {}):
        return
    integration = await async_get_integration(hass, DOMAIN)
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_COMPONENT,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        # The version busts the browser cache after every update.
        module_url=f"{STATIC_URL}/hue-studio-panel.js?v={integration.version}",
    )


def async_unregister_panel(hass: HomeAssistant) -> None:
    """Remove the panel from the sidebar."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
