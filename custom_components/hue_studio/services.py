"""Services: what the native `hue` integration cannot do.

Each part registers its own: lights, scenes, rooms and zones, the Sync Box, and
`apply_light` of automations.
"""

from __future__ import annotations

from homeassistant.core import HomeAssistant, callback

from .automations.light import async_setup_services as async_setup_automation_services
from .lights.services import async_setup_services as async_setup_light_services
from .rooms.services import async_setup_services as async_setup_room_services
from .scenes.services import async_setup_services as async_setup_scene_services
from .sync_box.services import async_setup_services as async_setup_sync_services


@callback
def async_setup_services(hass: HomeAssistant) -> None:
    """Register the integration services."""
    async_setup_light_services(hass)
    async_setup_scene_services(hass)
    async_setup_room_services(hass)
    async_setup_sync_services(hass)
    async_setup_automation_services(hass)
