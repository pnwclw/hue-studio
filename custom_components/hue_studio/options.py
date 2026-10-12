"""Room/zone mapping and per-room sensors (config entry options).

Options use stable ids (registry unique ids of Hue grouped lights, area ids); the
frontend gets them translated to entity ids by `async_frontend_config`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)

from .const import (
    CONF_AUTO_ALIGN,
    CONF_FOOTER,
    CONF_FOOTER_TABS,
    CONF_GALLERY_RULES,
    CONF_GALLERY_SEASONAL,
    CONF_GROUPS,
    CONF_HUE_ENTRY_ID,
    CONF_ILLUMINANCE,
    CONF_MOTION,
    CONF_ROOMS,
    CONF_TEMPERATURE,
    DOMAIN,
    GROUP_AUTO,
    GROUP_ZONE,
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
def _async_hue_light_areas(hass: HomeAssistant) -> dict[str, str | None]:
    """Every Hue light (not room/zone) entity id -> its area (entity, else device)."""
    devices = dr.async_get(hass)
    areas: dict[str, str | None] = {}
    for entry in er.async_get(hass).entities.values():
        if entry.domain != LIGHT_DOMAIN or entry.platform != HUE_DOMAIN:
            continue
        state = hass.states.get(entry.entity_id)
        if state is not None and state.attributes.get(ATTR_IS_HUE_GROUP):
            continue
        area_id = entry.area_id
        if area_id is None and entry.device_id:
            device = devices.async_get(entry.device_id)
            area_id = device.area_id if device else None
        areas[entry.entity_id] = area_id
    return areas


@callback
def async_light_areas(hass: HomeAssistant) -> list[ar.AreaEntry]:
    """HA areas that contain at least one Hue light, in area registry order."""
    used = set(_async_hue_light_areas(hass).values())
    return [area for area in ar.async_get(hass).async_list_areas() if area.id in used]


@callback
def async_auto_areas(hass: HomeAssistant, groups: list[HueGroup]) -> dict[str, str]:
    """Hue group unique id -> the area it becomes the room of automatically.

    Same rule as the panel (`buildHome` in model.ts): in area registry order, an area
    takes the first unused group whose lights are exactly the Hue lights in the area,
    Hue rooms before zones (after alignment a room always matches its area).
    """
    light_areas = _async_hue_light_areas(hass)
    members: dict[str, set[str]] = {}
    for group in groups:
        state = hass.states.get(group.entity_id)
        ids = (state.attributes.get(ATTR_ENTITY_ID) or []) if state else []
        members[group.unique_id] = {i for i in ids if i in light_areas}
    rooms_first = sorted(groups, key=lambda g: g.hue_type != "room")
    auto: dict[str, str] = {}
    for area in ar.async_get(hass).async_list_areas():
        in_area = {i for i, a in light_areas.items() if a == area.id}
        if not in_area:
            continue
        match = next(
            (
                g.unique_id
                for g in rooms_first
                if g.unique_id not in auto and members[g.unique_id] == in_area
            ),
            None,
        )
        if match is not None:
            auto[match] = area.id
    return auto


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
            CONF_ILLUMINANCE: value.get(CONF_ILLUMINANCE, []),
        }
        for key, value in options[CONF_ROOMS].items()
        if (frontend_key := room_key(key)) is not None
    }
    return {
        CONF_GROUPS: groups,
        CONF_ROOMS: rooms,
        CONF_AUTO_ALIGN: any(
            entry.options.get(CONF_AUTO_ALIGN, False)
            for entry in hass.config_entries.async_entries(DOMAIN)
        ),
        # Panel settings (same on every bridge entry): the first entry that has them.
        CONF_FOOTER: _panel_option(hass, CONF_FOOTER, False),
        CONF_FOOTER_TABS: _panel_option(hass, CONF_FOOTER_TABS, []),
        CONF_GALLERY_SEASONAL: _panel_option(hass, CONF_GALLERY_SEASONAL, False),
        CONF_GALLERY_RULES: _panel_option(hass, CONF_GALLERY_RULES, {}),
    }


def _panel_option(hass: HomeAssistant, key: str, default: Any) -> Any:
    for entry in hass.config_entries.async_entries(DOMAIN):
        if key in entry.options:
            return entry.options[key]
    return default


# ---- changed from the panel (Settings → Integration settings) ----


def _studio_entry(hass: HomeAssistant, hue_entry_id: str | None) -> Any:
    """The Hue Studio entry of a bridge (the first one without an id)."""
    for entry in hass.config_entries.async_entries(DOMAIN):
        if CONF_HUE_ENTRY_ID in entry.data and (
            hue_entry_id is None or entry.data[CONF_HUE_ENTRY_ID] == hue_entry_id
        ):
            return entry
    raise ServiceValidationError(
        translation_domain=DOMAIN, translation_key="hue_entry_missing"
    )


@callback
def async_set_group_area(
    hass: HomeAssistant, entity_id: str, target: str | None
) -> None:
    """Which area a Hue room/zone belongs to: an area id, None (a zone of its own) or
    "auto" (the area with exactly its lights). Like the options' room mapping, only
    deviations from the automatic match are stored."""
    registry = er.async_get(hass)
    reg = registry.async_get(entity_id)
    groups = async_hue_groups(hass, reg.config_entry_id if reg else None)
    group = next((g for g in groups if g.entity_id == entity_id), None)
    if reg is None or group is None:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="not_hue_group",
            translation_placeholders={"entity_id": entity_id},
        )
    entry = _studio_entry(hass, reg.config_entry_id)
    stored = dict(entry.options.get(CONF_GROUPS, {}))
    auto = async_auto_areas(hass, groups)
    if target not in (None, GROUP_AUTO):
        if ar.async_get(hass).async_get_area(target) is None:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="unknown_ha_area",
                translation_placeholders={"area": target},
            )
        taken = {
            uid: area for uid, area in stored.items() if uid != group.unique_id
        } | {uid: a for uid, a in auto.items() if uid not in stored}
        if target in {a for uid, a in taken.items() if uid != group.unique_id}:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="area_taken",
                translation_placeholders={"area": target},
            )
    if target == GROUP_AUTO or target == auto.get(group.unique_id):
        stored.pop(group.unique_id, None)
    elif target is None:
        stored[group.unique_id] = GROUP_ZONE
    else:
        stored[group.unique_id] = target
    hass.config_entries.async_update_entry(
        entry, options={**entry.options, CONF_GROUPS: stored}
    )


@callback
def async_set_room_sensors(
    hass: HomeAssistant, room: str, sensors: dict[str, list[str]]
) -> None:
    """Motion, temperature and light sensors of a room ("area.<id>" or
    "hue.<group entity id>", as the panel keys rooms); all empty: back to defaults."""
    kind, _, ident = room.partition(".")
    if kind == "hue":
        reg = er.async_get(hass).async_get(ident)
        if reg is None:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="not_hue_group",
                translation_placeholders={"entity_id": ident},
            )
        key, owner = f"hue.{reg.unique_id}", _studio_entry(hass, reg.config_entry_id)
    elif kind == "area":
        key, owner = room, _studio_entry(hass, None)
    else:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="unknown_ha_area",
            translation_placeholders={"area": room},
        )
    value = {
        k: sensors.get(k, []) for k in (CONF_MOTION, CONF_TEMPERATURE, CONF_ILLUMINANCE)
    }
    for entry in hass.config_entries.async_entries(DOMAIN):
        if CONF_HUE_ENTRY_ID not in entry.data:
            continue
        rooms = dict(entry.options.get(CONF_ROOMS, {}))
        if entry is owner and any(value.values()):
            rooms[key] = value
        else:
            rooms.pop(key, None)
        hass.config_entries.async_update_entry(
            entry, options={**entry.options, CONF_ROOMS: rooms}
        )
