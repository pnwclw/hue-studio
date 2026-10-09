"""Map light entities of the native `hue` integration to bridge resources."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from aiohue import HueBridgeV2
from aiohue.v2.models.light import Light
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er

from .const import CONF_HUE_ENTRY_ID, DOMAIN, HUE_DOMAIN

if TYPE_CHECKING:
    from . import HueStudioConfigEntry

LIGHT_DOMAIN = "light"
# State attribute set by the native integration on Hue rooms and zones.
ATTR_IS_HUE_GROUP = "is_hue_group"


@dataclass(frozen=True, slots=True)
class HueLight:
    """A Hue light entity together with its bridge resource."""

    entity_id: str
    bridge: HueBridgeV2
    resource: Light


@callback
def async_bridges(hass: HomeAssistant) -> dict[str, HueBridgeV2]:
    """Return connected bridges keyed by the id of their native `hue` entry."""
    entries: list[HueStudioConfigEntry] = hass.config_entries.async_loaded_entries(
        DOMAIN
    )
    return {e.data[CONF_HUE_ENTRY_ID]: e.runtime_data.bridge for e in entries}


@callback
def async_all_lights(hass: HomeAssistant) -> list[HueLight]:
    """Return every Hue light entity on a bridge connected to Hue Studio."""
    bridges = async_bridges(hass)
    lights: list[HueLight] = []
    for entry in er.async_get(hass).entities.values():
        if (
            entry.domain != LIGHT_DOMAIN
            or entry.platform != HUE_DOMAIN
            or entry.config_entry_id not in bridges
        ):
            continue
        bridge = bridges[entry.config_entry_id]
        if (resource := bridge.lights.get(entry.unique_id)) is not None:
            lights.append(HueLight(entry.entity_id, bridge, resource))
    return lights


@callback
def async_resolve_lights(
    hass: HomeAssistant, entity_ids: Iterable[str]
) -> list[HueLight]:
    """Resolve entity ids to Hue lights, expanding Hue rooms and zones.

    Order is preserved and duplicates are dropped, so callers can rely on it when
    spreading palette colors over lights.
    """
    bridges = async_bridges(hass)
    registry = er.async_get(hass)
    expanded: list[str] = []
    for entity_id in entity_ids:
        state = hass.states.get(entity_id)
        if state is not None and state.attributes.get(ATTR_IS_HUE_GROUP):
            expanded.extend(state.attributes.get(ATTR_ENTITY_ID) or [])
        else:
            expanded.append(entity_id)

    lights: list[HueLight] = []
    for entity_id in dict.fromkeys(expanded):
        entry = registry.async_get(entity_id)
        bridge = bridges.get(entry.config_entry_id or "") if entry else None
        resource = bridge.lights.get(entry.unique_id) if entry and bridge else None
        if entry is None or entry.platform != HUE_DOMAIN or resource is None:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="not_hue_light",
                translation_placeholders={"entity_id": entity_id},
            )
        lights.append(HueLight(entity_id, bridge, resource))
    return lights


def light_info(resource: Light) -> dict[str, Any]:
    """Describe what the frontend needs and HA does not expose: gamut and gradient."""
    info: dict[str, Any] = {"gamut": None, "gamut_type": None, "mirek": None}
    if resource.color is not None:
        info["gamut_type"] = resource.color.gamut_type.value
        if (gamut := resource.color.gamut) is not None:
            info["gamut"] = [
                [gamut.red.x, gamut.red.y],
                [gamut.green.x, gamut.green.y],
                [gamut.blue.x, gamut.blue.y],
            ]
    if resource.color_temperature is not None:
        schema = resource.color_temperature.mirek_schema
        info["mirek"] = [schema.mirek_minimum, schema.mirek_maximum]
    gradient = resource.gradient
    if gradient is not None and gradient.points_capable:
        info["gradient"] = {
            "points_capable": gradient.points_capable,
            "points": [[p.color.xy.x, p.color.xy.y] for p in gradient.points],
            "mode": gradient.mode.value,
            "modes": [mode.value for mode in gradient.mode_values],
        }
    else:
        info["gradient"] = None
    return info
