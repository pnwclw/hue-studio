"""WebSocket API for the frontend: each part registers its own commands."""

from __future__ import annotations

from homeassistant.core import HomeAssistant, callback

from .automations.pool import async_setup_pool_websocket as async_setup_daylight
from .bridges.websocket import async_setup_websocket as async_setup_bridges
from .core.websocket import async_setup_websocket as async_setup_config
from .devices.websocket import async_setup_websocket as async_setup_devices
from .lights.websocket import async_setup_websocket as async_setup_lights
from .rooms.websocket import async_setup_websocket as async_setup_rooms
from .scenes.websocket import async_setup_websocket as async_setup_scenes
from .space.websocket import async_setup_websocket as async_setup_space
from .sync_box.websocket import async_setup_websocket as async_setup_sync_boxes


@callback
def async_setup_websocket(hass: HomeAssistant) -> None:
    """Register WebSocket commands."""
    for setup in (
        async_setup_config,
        async_setup_lights,
        async_setup_scenes,
        async_setup_rooms,
        async_setup_space,
        async_setup_devices,
        async_setup_bridges,
        async_setup_sync_boxes,
        async_setup_daylight,
    ):
        setup(hass)
