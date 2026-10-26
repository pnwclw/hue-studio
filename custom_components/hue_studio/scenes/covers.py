"""A picture of your own for a scene of your own.

The bridge holds a scene's picture only as one of the Hue app's gallery pictures
(`metadata.image`), so a photo is uploaded to Home Assistant itself (its `image_upload`,
the same as an area's or a person's picture) and kept here by the bridge scene's id.
Without one the panel draws the scene from its colors; an icon is the scene entity's own
(Home Assistant's entity settings).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store
from homeassistant.util.hass_dict import HassKey

from ..const import DOMAIN

STORAGE_KEY = f"{DOMAIN}.scene_covers"
STORAGE_VERSION = 1
# The size Home Assistant serves an uploaded picture at (it keeps the ratio).
SERVE_SIZE = "512x512"


class Covers:
    """Bridge scene id -> uploaded image id, and who wants to know of changes."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize (call `async_load` before use)."""
        self.store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.images: dict[str, str] = {}
        self.listeners: list[Callable[[str], None]] = []

    async def async_load(self) -> None:
        """Read the pictures."""
        data = await self.store.async_load() or {}
        self.images = dict(data.get("images", {}))

    @callback
    def async_set(self, scene_id: str, image: str | None) -> str | None:
        """Give a scene a picture (None: its colors again); returns the one replaced."""
        old = self.images.pop(scene_id, None)
        if image:
            self.images[scene_id] = image
        if old == image:
            return None
        self.store.async_delay_save(lambda: {"images": self.images}, 1)
        for listener in list(self.listeners):
            listener(scene_id)
        return old

    @callback
    def async_listen(self, listener: Callable[[str], None]) -> Callable[[], None]:
        """Call `listener(scene_id)` whenever a scene's picture changes."""
        self.listeners.append(listener)
        return lambda: self.listeners.remove(listener)


COVERS: HassKey[Covers] = HassKey(f"{DOMAIN}_scene_covers")


async def async_setup_covers(hass: HomeAssistant) -> None:
    """Load the pictures once (before the scenes are described)."""
    covers = Covers(hass)
    await covers.async_load()
    hass.data[COVERS] = covers


@callback
def cover_url(hass: HomeAssistant, scene_id: str) -> str | None:
    """Where a scene's own picture is served (Home Assistant's own, no login needed)."""
    covers = hass.data.get(COVERS)
    image = covers.images.get(scene_id) if covers else None
    return f"/api/image/serve/{image}/{SERVE_SIZE}" if image else None
