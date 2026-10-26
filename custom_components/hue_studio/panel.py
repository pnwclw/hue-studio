"""The `/hue` sidebar panel and the static files it is served from."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration

from .const import DOMAIN
from .scenes.pictures import GalleryPictureView

FRONTEND_DIR = Path(__file__).parent / "frontend"
STATIC_URL = f"/{DOMAIN}_static"
PANEL_URL_PATH = "hue"
PANEL_COMPONENT = "hue-studio-panel"
PANEL_ICON = "mdi:lightbulb-group"
PANEL_TITLE = "Hue"

# Loaded on every HA page: the more-info override and dashboard cards (each part on its
# own, see src/entries/hue-studio-extra.ts).
EXTRA_MODULE = "hue-studio-extra.js"

_STATIC_REGISTERED = f"{DOMAIN}_static_registered"
_EXTRA_JS = f"{DOMAIN}_extra_js"


async def async_register_panel(hass: HomeAssistant) -> None:
    """Serve the frontend files and add the panel to the sidebar."""
    if not hass.data.get(_STATIC_REGISTERED):
        # aiohttp cannot unregister routes, so this happens once per HA run.
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(FRONTEND_DIR), cache_headers=False)]
        )
        hass.http.register_view(GalleryPictureView(hass))
        hass.data[_STATIC_REGISTERED] = True

    if PANEL_URL_PATH in hass.data.get(frontend.DATA_PANELS, {}):
        return
    integration = await async_get_integration(hass, DOMAIN)
    # Loaded on every HA page: opens our dialog instead of more-info for Hue lights.
    # If it fails to load or throws, HA's own more-info dialog opens as usual.
    hass.data[_EXTRA_JS] = f"{STATIC_URL}/{EXTRA_MODULE}?v={integration.version}"
    frontend.add_extra_js_url(hass, hass.data[_EXTRA_JS])
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_COMPONENT,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        # The version busts the browser cache after every update.
        module_url=f"{STATIC_URL}/hue-studio-panel.js?v={integration.version}",
        # The panel pads the status bar / home indicator itself (full-bleed header and
        # tab bar like the Hue app). Without this HA pads `ha-panel-custom` by the safe
        # areas and a full-height panel overflows the screen in the mobile app.
        handle_safe_area=True,
    )


def async_unregister_panel(hass: HomeAssistant) -> None:
    """Remove the panel from the sidebar and the more-info override."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
    if url := hass.data.pop(_EXTRA_JS, None):
        frontend.remove_extra_js_url(hass, url)
