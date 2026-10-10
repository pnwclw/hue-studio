"""Cooperation with Adaptive Lighting (HACS: basnijholt/adaptive-lighting).

Adaptive Lighting notices manual changes made through `light.turn_on`, but our services
talk to the bridge directly, so it would overwrite a palette on its next adjustment.
After we change lights we therefore mark them as manually controlled, exactly like the
user would with `adaptive_lighting.set_manual_control`.
"""

from __future__ import annotations

from collections.abc import Iterable
import logging

from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er

_LOGGER = logging.getLogger(__name__)

AL_DOMAIN = "adaptive_lighting"
AL_SERVICE_SET_MANUAL = "set_manual_control"
# Attribute of an Adaptive Lighting switch holding its configuration (incl. "lights").
AL_ATTR_CONFIGURATION = "configuration"
AL_CONF_LIGHTS = "lights"


def adaptive_switches(hass: HomeAssistant) -> dict[str, set[str]]:
    """Adaptive Lighting main switches and the lights each one controls."""
    registry = er.async_get(hass)
    switches: dict[str, set[str]] = {}
    for entry in registry.entities.values():
        if entry.platform != AL_DOMAIN or entry.domain != "switch":
            continue
        state = hass.states.get(entry.entity_id)
        config = state.attributes.get(AL_ATTR_CONFIGURATION) if state else None
        if isinstance(config, dict) and config.get(AL_CONF_LIGHTS):
            switches[entry.entity_id] = set(config[AL_CONF_LIGHTS])
    return switches


async def async_mark_manual(hass: HomeAssistant, entity_ids: Iterable[str]) -> None:
    """Tell Adaptive Lighting that these lights (or Hue groups) were set by hand."""
    if not hass.services.has_service(AL_DOMAIN, AL_SERVICE_SET_MANUAL):
        return
    touched = set(entity_ids)
    for switch, lights in adaptive_switches(hass).items():
        if not (affected := lights & touched):
            continue
        try:
            await hass.services.async_call(
                AL_DOMAIN,
                AL_SERVICE_SET_MANUAL,
                {
                    ATTR_ENTITY_ID: switch,
                    AL_CONF_LIGHTS: sorted(affected),
                    "manual_control": True,
                },
                blocking=True,
            )
        except HomeAssistantError as err:
            # Never fail our own command because of an optional integration.
            _LOGGER.warning("Could not mark lights as manual in %s: %s", switch, err)
