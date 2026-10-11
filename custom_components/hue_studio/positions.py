"""Where lights are in a room, and palettes spread by it (SpatialAware, no Bridge Pro).

Positions use the bridge's entertainment coordinates: x from left (-1) to right (1), y
from back (-1) to front (1), z from floor (-1) to ceiling (1). A light has one point;
a gradient light strip has two (its ends), as entertainment areas store them.

- Source: for each HA area, the entertainment configuration holding most of the area's
  Hue lights gives their positions (what the Hue app's entertainment setup placed);
  other lights get positions set in Hue Studio (`helpers.storage.Store`).
- Saving: lights of that configuration are written back to the bridge (not while it
  streams), the rest go to the Store.
- Spatial palettes: the palette is laid out along the room's longest side, and each
  light shows the colors where it stands (a strip the stretch between its ends).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
import logging
from typing import Any

from aiohttp import ClientError
from aiohue import HueBridgeV2
from aiohue.errors import AiohueException
from aiohue.v2.models.entertainment_configuration import (
    EntertainmentConfiguration,
    EntertainmentStatus,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.util.hass_dict import HassKey

from .const import DOMAIN
from .lights import HueLight, async_all_lights
from .rooms import light_area

_LOGGER = logging.getLogger(__name__)

STORAGE_KEY = f"{DOMAIN}.positions"
STORAGE_VERSION = 1
SIGNAL_POSITIONS_UPDATED = f"{DOMAIN}_positions_updated"
_DATA: HassKey[PositionStore] = HassKey(f"{DOMAIN}_positions")

type Point = tuple[float, float, float]
type XY = tuple[float, float]


# ---------- pure: spreading a palette by position ----------


def palette_at(points: Sequence[XY], t: float) -> XY:
    """The palette as a gradient (its points evenly spaced): the color at t (0-1)."""
    if len(points) == 1:
        return points[0]
    t = min(max(t, 0.0), 1.0) * (len(points) - 1)
    index = min(int(t), len(points) - 2)
    frac = t - index
    (x1, y1), (x2, y2) = points[index], points[index + 1]
    return (x1 + (x2 - x1) * frac, y1 + (y2 - y1) * frac)


def spatial_colors(
    palette: Sequence[XY],
    positions: dict[str, list[Point]],
    counts: dict[str, int],
) -> dict[str, list[XY]]:
    """Colors per light: `counts[light]` colors (1 for a plain light, its gradient
    points for a gradient light) taken from where the light stands.

    The palette runs along the axis (x or y) on which the lights spread most; a light's
    colors span the stretch between its first and last point (one point: one place).
    """
    flat = [p for points in positions.values() for p in points]
    if not flat or not palette:
        return {}
    spread_x = max(p[0] for p in flat) - min(p[0] for p in flat)
    spread_y = max(p[1] for p in flat) - min(p[1] for p in flat)
    axis = 0 if spread_x >= spread_y else 1
    low = min(p[axis] for p in flat)
    span = max(p[axis] for p in flat) - low

    def t_of(point: Point) -> float:
        return 0.5 if span == 0 else (point[axis] - low) / span

    colors: dict[str, list[XY]] = {}
    for light, points in positions.items():
        if not points:
            continue
        count = max(1, counts.get(light, 1))
        start, end = t_of(points[0]), t_of(points[-1])
        if count == 1:
            colors[light] = [palette_at(palette, (start + end) / 2)]
        else:
            colors[light] = [
                palette_at(palette, start + (end - start) * k / (count - 1))
                for k in range(count)
            ]
    return colors


# ---------- the Store: positions set in Hue Studio ----------


class PositionStore:
    """Positions of lights outside entertainment areas, by light resource id."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Create the store (load it with `async_load`)."""
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, STORAGE_KEY, private=False
        )
        self.lights: dict[str, list[list[float]]] = {}

    async def async_load(self) -> None:
        """Read the stored positions."""
        data = await self._store.async_load() or {}
        self.lights = data.get("lights", {})

    async def async_update(self, changes: dict[str, list[list[float]] | None]) -> None:
        """Set (or, with None, forget) positions of lights."""
        for rid, points in changes.items():
            if points is None:
                self.lights.pop(rid, None)
            else:
                self.lights[rid] = points
        await self._store.async_save({"lights": self.lights})
        async_dispatcher_send(self.hass, SIGNAL_POSITIONS_UPDATED)


async def async_setup_positions(hass: HomeAssistant) -> None:
    """Load the position store."""
    store = hass.data[_DATA] = PositionStore(hass)
    await store.async_load()


def position_store(hass: HomeAssistant) -> PositionStore:
    """The position store (loaded with the integration)."""
    return hass.data[_DATA]


# ---------- an area's lights and where they are ----------


@dataclass(slots=True)
class AreaSpace:
    """The Hue lights of an area with their positions."""

    area_id: str
    lights: list[HueLight]
    # light resource id -> points ([] when unknown)
    positions: dict[str, list[Point]]
    # light resource id -> "bridge" | "store" | None
    sources: dict[str, str | None]
    config: EntertainmentConfiguration | None
    bridge: HueBridgeV2 | None


def _service_lights(bridge: HueBridgeV2) -> dict[str, str]:
    """Entertainment service id -> light id."""
    return {
        service.id: service.renderer_reference.rid
        for service in bridge.config.entertainment
        if service.renderer_reference is not None
    }


def _config_points(
    bridge: HueBridgeV2, config: EntertainmentConfiguration
) -> dict[str, list[Point]]:
    """Light id -> its points in an entertainment configuration."""
    lights = _service_lights(bridge)
    return {
        lights[location.service.rid]: [(p.x, p.y, p.z) for p in location.positions]
        for location in config.locations.service_locations
        if location.service.rid in lights
    }


@callback
def async_area_spaces(hass: HomeAssistant) -> dict[str, AreaSpace]:
    """Every HA area with Hue lights, with their positions."""
    entities = er.async_get(hass)
    devices = dr.async_get(hass)
    store = position_store(hass)
    by_area: dict[str, list[HueLight]] = {}
    for light in async_all_lights(hass):
        entry = entities.async_get(light.entity_id)
        if entry and (area_id := light_area(entry, devices)):
            by_area.setdefault(area_id, []).append(light)

    spaces: dict[str, AreaSpace] = {}
    for area_id, lights in by_area.items():
        bridge = lights[0].bridge
        ids = {light.resource.id for light in lights if light.bridge is bridge}
        best: tuple[int, EntertainmentConfiguration | None] = (0, None)
        for config in bridge.config.entertainment_configuration:
            covered = len(ids & set(_config_points(bridge, config)))
            if covered > best[0]:
                best = (covered, config)
        config = best[1]
        from_bridge = _config_points(bridge, config) if config else {}
        positions: dict[str, list[Point]] = {}
        sources: dict[str, str | None] = {}
        for light in lights:
            rid = light.resource.id
            if rid in from_bridge:
                positions[rid], sources[rid] = from_bridge[rid], "bridge"
            elif rid in store.lights:
                positions[rid] = [tuple(p) for p in store.lights[rid]]  # type: ignore[misc]
                sources[rid] = "store"
            else:
                positions[rid], sources[rid] = [], None
        spaces[area_id] = AreaSpace(area_id, lights, positions, sources, config, bridge)
    return spaces


@callback
def async_positions_payload(hass: HomeAssistant) -> dict[str, Any]:
    """What the panel's position editor needs, with entity ids."""
    payload: dict[str, Any] = {}
    for area_id, space in async_area_spaces(hass).items():
        config = space.config
        payload[area_id] = {
            "lights": {
                light.entity_id: {
                    "positions": [list(p) for p in space.positions[light.resource.id]],
                    "source": space.sources[light.resource.id],
                }
                for light in space.lights
            },
            "configuration": {
                "id": config.id,
                "name": config.metadata.name,
                "streaming": config.status == EntertainmentStatus.ACTIVE,
            }
            if config
            else None,
        }
    return payload


async def async_set_positions(
    hass: HomeAssistant, area_id: str, changes: dict[str, list[list[float]]]
) -> None:
    """Save positions of an area's lights (entity id -> points).

    Lights of the area's entertainment configuration are written to the bridge (one
    PUT with all its locations), the others to the Store.
    """
    space = async_area_spaces(hass).get(area_id)
    if space is None:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="unknown_ha_area",
            translation_placeholders={"area": area_id},
        )
    by_entity = {light.entity_id: light for light in space.lights}
    unknown = [entity_id for entity_id in changes if entity_id not in by_entity]
    if unknown:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="not_hue_light",
            translation_placeholders={"entity_id": ", ".join(unknown)},
        )
    to_bridge: dict[str, list[list[float]]] = {}
    to_store: dict[str, list[list[float]] | None] = {}
    for entity_id, points in changes.items():
        rid = by_entity[entity_id].resource.id
        clean = [[min(max(float(v), -1.0), 1.0) for v in p[:3]] for p in points]
        if space.sources[rid] == "bridge":
            to_bridge[rid] = clean
        else:
            to_store[rid] = clean
    if to_bridge and space.config is not None and space.bridge is not None:
        await _async_write_bridge(space.bridge, space.config, to_bridge)
    if to_store:
        await position_store(hass).async_update(to_store)


async def _async_write_bridge(
    bridge: HueBridgeV2,
    config: EntertainmentConfiguration,
    changes: dict[str, list[list[float]]],
) -> None:
    """PUT the configuration's locations with some lights moved."""
    if config.status == EntertainmentStatus.ACTIVE:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="positions_streaming",
            translation_placeholders={"name": config.metadata.name},
        )
    lights = _service_lights(bridge)
    locations = []
    for location in config.locations.service_locations:
        light = lights.get(location.service.rid)
        points = changes.get(light) if light else None
        if points is None or len(points) != len(location.positions):
            # The bridge keeps a strip's two ends; a different count is not ours to set.
            points = [[p.x, p.y, p.z] for p in location.positions]
        entry: dict[str, Any] = {
            "service": {"rid": location.service.rid, "rtype": "entertainment"},
            "positions": [{"x": x, "y": y, "z": z} for x, y, z in points],
        }
        if location.equalization_factor is not None:
            entry["equalization_factor"] = location.equalization_factor
        locations.append(entry)
    try:
        await bridge.request(
            "put",
            f"clip/v2/resource/entertainment_configuration/{config.id}",
            json={"locations": {"service_locations": locations}},
        )
    except (AiohueException, ClientError, TimeoutError) as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="room_change_failed",
            translation_placeholders={"name": config.metadata.name},
        ) from err


@callback
def async_light_positions(
    hass: HomeAssistant, lights: Sequence[HueLight]
) -> dict[str, list[Point]]:
    """Positions of some lights (resource id -> points), from their areas."""
    wanted = {light.resource.id for light in lights}
    found: dict[str, list[Point]] = {}
    for space in async_area_spaces(hass).values():
        for rid, points in space.positions.items():
            if rid in wanted and points:
                found[rid] = points
    return found
