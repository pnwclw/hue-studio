"""What a service call names (Hue lights by entity, area, device or label) and the
values the services share."""

from __future__ import annotations

import logging

from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.target import (
    TargetSelection,
    async_extract_referenced_entity_ids,
)
import voluptuous as vol

from ..const import DOMAIN, HUE_DOMAIN
from ..sync_box.coordinator import async_streaming_lights
from .bridge import LIGHT_DOMAIN, HueLight, async_resolve_lights

_LOGGER = logging.getLogger(__name__)

ATTR_BRIGHTNESS = "brightness"
ATTR_TRANSITION = "transition"
ATTR_SPEED = "speed"


XY_POINT = vol.All(
    vol.ExactSequence([vol.Coerce(float), vol.Coerce(float)]),
    vol.Length(min=2, max=2),
    lambda p: [min(1.0, max(0.0, v)) for v in p],
)
BRIGHTNESS = vol.All(vol.Coerce(float), vol.Range(min=1, max=100))
MIREK = vol.All(vol.Coerce(int), vol.Range(min=153, max=500))
# Percent, like the native `hue.activate_scene`; the bridge wants 0-1.
SPEED = vol.All(vol.Coerce(float), vol.Range(min=0, max=100))
# Seconds; the bridge takes up to 6000 s in 100 ms steps.
TRANSITION = vol.All(vol.Coerce(float), vol.Range(min=0, max=6000))


async def async_target_lights(
    hass: HomeAssistant, call: ServiceCall, *, skip_streaming: bool = True
) -> list[HueLight]:
    """Resolve the service target; explicitly listed entities keep their order.

    Areas, devices and labels contribute their Hue lights (and Hue rooms/zones) only;
    an explicitly listed light that is not a Hue light is an error. Lights that an
    entertainment area streams to right now (Sync Box, PC or TV sync) are left alone:
    the stream would overwrite the command anyway.
    """
    selected = async_extract_referenced_entity_ids(
        hass, TargetSelection(call.data), expand_group=False
    )
    registry = er.async_get(hass)
    indirect = {
        entity_id
        for entity_id in selected.indirectly_referenced
        if (entry := registry.async_get(entity_id)) is not None
        and entry.domain == LIGHT_DOMAIN
        and entry.platform == HUE_DOMAIN
    }
    found = selected.referenced | indirect
    explicit = [e for e in explicit_ids(call) if e in found]
    ordered = explicit + sorted(found.difference(explicit))
    if not ordered:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="no_lights"
        )
    lights = async_resolve_lights(hass, ordered)
    if skip_streaming and (streaming := async_streaming_lights(hass)):
        skipped = [light.entity_id for light in lights if light.entity_id in streaming]
        if skipped:
            _LOGGER.debug("Skipping lights that are syncing: %s", skipped)
            lights = [light for light in lights if light.entity_id not in streaming]
            if not lights:
                raise ServiceValidationError(
                    translation_domain=DOMAIN,
                    translation_key="lights_syncing",
                    translation_placeholders={"entity_id": ", ".join(skipped)},
                )
    return lights


def explicit_ids(call: ServiceCall) -> list[str]:
    """Entity ids listed in the call (not "all", not area/device targets)."""
    ids = call.data.get(ATTR_ENTITY_ID, [])
    return [] if isinstance(ids, str) else list(ids)
