"""Room/zone mapping and per-room sensors (config entry options).

Options use stable ids (registry unique ids of Hue grouped lights, area ids); the
frontend gets them translated to entity ids by `async_frontend_config`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)

from .const import (
    CONF_GROUPS,
    CONF_MOTION,
    CONF_ROOMS,
    CONF_TEMPERATURE,
    DOMAIN,
    GROUP_AUTO,
    HUE_DOMAIN,
)
from .lights import ATTR_IS_HUE_GROUP, LIGHT_DOMAIN

ATTR_HUE_TYPE = "hue_type"


@dataclass(frozen=True, slots=True)
class HueGroup:
    """A Hue room or zone as the native integration exposes it (a light entity)."""

    unique_id: str
    entity_id: str
    name: str
    hue_type: str  # "room" | "zone"


@callback
def async_hue_groups(
    hass: HomeAssistant, hue_entry_id: str | None = None
) -> list[HueGroup]:
    """Hue rooms and zones (grouped lights) known to HA, sorted by name.

    With `hue_entry_id`, only groups of that bridge (native `hue` config entry).
    """
    groups: list[HueGroup] = []
    for entry in er.async_get(hass).entities.values():
        if entry.domain != LIGHT_DOMAIN or entry.platform != HUE_DOMAIN:
            continue
        if hue_entry_id is not None and entry.config_entry_id != hue_entry_id:
            continue
        state = hass.states.get(entry.entity_id)
        if state is None or not state.attributes.get(ATTR_IS_HUE_GROUP):
            continue
        groups.append(
            HueGroup(
                entry.unique_id,
                entry.entity_id,
                state.name,
                state.attributes.get(ATTR_HUE_TYPE, "room"),
            )
        )
    return sorted(groups, key=lambda g: g.name.casefold())


@callback
def async_light_areas(hass: HomeAssistant) -> list[ar.AreaEntry]:
    """HA areas that contain at least one Hue light, in area registry order."""
    entities = er.async_get(hass)
    devices = dr.async_get(hass)
    used: set[str] = set()
    for entry in entities.entities.values():
        if entry.domain != LIGHT_DOMAIN or entry.platform != HUE_DOMAIN:
            continue
        state = hass.states.get(entry.entity_id)
        if state is not None and state.attributes.get(ATTR_IS_HUE_GROUP):
            continue
        area_id = entry.area_id
        if area_id is None and entry.device_id:
            device = devices.async_get(entry.device_id)
            area_id = device.area_id if device else None
        if area_id:
            used.add(area_id)
    return [area for area in ar.async_get(hass).async_list_areas() if area.id in used]


@callback
def async_merged_options(hass: HomeAssistant) -> dict[str, Any]:
    """Options of all Hue Studio entries merged (one entry per bridge)."""
    groups: dict[str, str] = {}
    rooms: dict[str, dict[str, list[str]]] = {}
    for entry in hass.config_entries.async_entries(DOMAIN):
        groups.update(entry.options.get(CONF_GROUPS, {}))
        rooms.update(entry.options.get(CONF_ROOMS, {}))
    return {CONF_GROUPS: groups, CONF_ROOMS: rooms}


@callback
def async_frontend_config(hass: HomeAssistant) -> dict[str, Any]:
    """Options with unique ids replaced by entity ids, as the panel uses them."""
    options = async_merged_options(hass)
    by_unique_id = {g.unique_id: g.entity_id for g in async_hue_groups(hass)}

    def room_key(key: str) -> str | None:
        kind, _, ident = key.partition(".")
        if kind == "hue":
            entity_id = by_unique_id.get(ident)
            return f"hue.{entity_id}" if entity_id else None
        return key

    groups = {
        by_unique_id[uid]: target
        for uid, target in options[CONF_GROUPS].items()
        if uid in by_unique_id and target != GROUP_AUTO
    }
    rooms = {
        frontend_key: {
            CONF_MOTION: value.get(CONF_MOTION, []),
            CONF_TEMPERATURE: value.get(CONF_TEMPERATURE, []),
        }
        for key, value in options[CONF_ROOMS].items()
        if (frontend_key := room_key(key)) is not None
    }
    return {CONF_GROUPS: groups, CONF_ROOMS: rooms}
