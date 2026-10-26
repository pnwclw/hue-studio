"""A gallery scene shown on a room's lights while its card is open, the Hue app's way.

Opening a scene's card remembers what the room's lights show (on the bridge: on,
brightness, color or white, gradient, effect); each card that comes to the middle is
shown on them (`apply_palette`). Closing the card without saving or setting the scene
puts the lights back as they were, and so does a panel that goes away mid-way (its
WebSocket connection closing). "Save to my scenes" and "Set once" keep what is shown.
Kept in memory only.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
import logging
from typing import Any

from aiohttp import ClientError
from aiohue import HueBridgeV2
from aiohue.errors import AiohueException
from aiohue.util import dataclass_to_dict
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.util.hass_dict import HassKey

from ..const import DOMAIN
from ..lights.targets import async_target_lights
from .bridge import capture_action

_LOGGER = logging.getLogger(__name__)

PREVIEWS: HassKey[dict[str, Preview]] = HassKey(f"{DOMAIN}_previews")


@dataclass(slots=True)
class Preview:
    """A card open on a room: where its scenes are shown, and what to put back."""

    target: str | list[str]
    # (bridge, light resource id, its state as a light PUT body)
    lights: list[tuple[HueBridgeV2, str, dict[str, Any]]] = field(default_factory=list)
    # Stops watching the panel's connection (it no longer has to put the lights back).
    detach: Callable[[], None] | None = None


async def async_start(
    hass: HomeAssistant,
    token: str,
    target: str | list[str],
    detach: Callable[[], None] | None = None,
) -> int:
    """Remember what the target's lights show; how many lights that is."""
    call = ServiceCall(hass, DOMAIN, "preview", {"entity_id": target})
    # Lights an entertainment area streams to are left alone (the stream wins anyway).
    lights = await async_target_lights(hass, call)
    hass.data.setdefault(PREVIEWS, {})[token] = Preview(
        target,
        [
            (
                light.bridge,
                light.resource.id,
                dataclass_to_dict(capture_action(light.resource), skip_none=True),
            )
            for light in lights
        ],
        detach,
    )
    return len(lights)


async def async_show(hass: HomeAssistant, token: str, colors: dict[str, Any]) -> None:
    """Show a scene on the lights (a palette as `apply_palette` takes it)."""
    if (preview := hass.data.get(PREVIEWS, {}).get(token)) is None:
        return
    await hass.services.async_call(
        DOMAIN, "apply_palette", {"entity_id": preview.target, **colors}, blocking=True
    )


async def async_end(
    hass: HomeAssistant, token: str, *, keep: bool, detach: bool = True
) -> None:
    """Close the card: keep what is shown, or put the lights back as they were
    (`detach` off: the connection is going away and lets go of its watch itself)."""
    if (preview := hass.data.get(PREVIEWS, {}).pop(token, None)) is None:
        return
    if detach and preview.detach is not None:
        preview.detach()
    if keep:
        return
    for bridge, rid, body in preview.lights:
        try:
            await bridge.request("put", f"clip/v2/resource/light/{rid}", json=body)
        except (AiohueException, ClientError, TimeoutError) as err:
            _LOGGER.warning("Could not put light %s back after a preview: %s", rid, err)
