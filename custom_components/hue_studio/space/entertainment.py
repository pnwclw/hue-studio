"""Entertainment areas of the bridges (CLIP v2 `entertainment_configuration`).

They are not rooms or zones: a set of lights with positions that the Sync Box, the Hue
app's sync or a game streams to. Listed, created, changed (name, type, lights) and
deleted here; their positions are edited with the arrange screen (`positions.py`).
Nothing can change while an area streams.
"""

from __future__ import annotations

from typing import Any

from aiohttp import ClientError
from aiohue import HueBridgeV2
from aiohue.errors import AiohueException
from aiohue.v2.models.entertainment_configuration import (
    EntertainmentConfiguration,
    EntertainmentConfigurationType,
    EntertainmentStatus,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send

from ..const import DOMAIN, SIGNAL_ENTERTAINMENT_UPDATED
from ..lights.bridge import LIGHT_DOMAIN, async_bridges

TYPES = [t.value for t in EntertainmentConfigurationType]
NAME_MAX = 32
ENDPOINT = "clip/v2/resource/entertainment_configuration"


def entertainment_services(bridge: HueBridgeV2) -> dict[str, str]:
    """Light id -> its entertainment service id (lights that can stream)."""
    return {
        service.renderer_reference.rid: service.id
        for service in bridge.config.entertainment
        if service.renderer_reference is not None
    }


def _light_ids(hass: HomeAssistant, hue_entry_id: str) -> dict[str, str]:
    """Light resource id -> entity id, for the lights of one bridge."""
    return {
        entry.unique_id: entry.entity_id
        for entry in er.async_entries_for_config_entry(er.async_get(hass), hue_entry_id)
        if entry.domain == LIGHT_DOMAIN
    }


def default_points(index: int, count: int) -> list[list[float]]:
    """Where a light added to an area starts: spread along the front, at mid height."""
    x = 0.0 if count < 2 else -0.8 + 1.6 * index / (count - 1)
    return [[round(x, 2), 0.8, 0.0]]


@callback
def async_entertainment_payload(hass: HomeAssistant) -> dict[str, Any]:
    """The entertainment areas of each bridge, for the panel.

    {hue entry id: {"name", "lights": [entity ids that can stream],
                    "areas": [{"id", "name", "type", "streaming",
                               "lights": {entity id: [[x, y, z], ...]}}]}}
    """
    payload: dict[str, Any] = {}
    for hue_entry_id, bridge in async_bridges(hass).items():
        services = entertainment_services(bridge)
        by_service = {sid: lid for lid, sid in services.items()}
        entities = _light_ids(hass, hue_entry_id)
        areas = []
        for config in bridge.config.entertainment_configuration:
            lights = {}
            for location in config.locations.service_locations:
                light = by_service.get(location.service.rid)
                if light in entities:
                    lights[entities[light]] = [
                        [p.x, p.y, p.z] for p in location.positions
                    ]
            areas.append(
                {
                    "id": config.id,
                    "name": config.metadata.name,
                    "type": config.configuration_type.value,
                    "streaming": config.status == EntertainmentStatus.ACTIVE,
                    "lights": lights,
                }
            )
        areas.sort(key=lambda a: a["name"].casefold())
        entry = hass.config_entries.async_get_entry(hue_entry_id)
        payload[hue_entry_id] = {
            "name": entry.title if entry else "Hue Bridge",
            "areas": areas,
            "lights": sorted(entities[lid] for lid in services if lid in entities),
        }
    return payload


def _bridge_of(
    hass: HomeAssistant, hue_entry_id: str | None
) -> tuple[str, HueBridgeV2]:
    bridges = async_bridges(hass)
    if hue_entry_id is None and len(bridges) == 1:
        hue_entry_id = next(iter(bridges))
    if hue_entry_id not in bridges:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="hue_entry_missing"
        )
    return hue_entry_id, bridges[hue_entry_id]


def _find(
    hass: HomeAssistant, area_id: str
) -> tuple[str, HueBridgeV2, EntertainmentConfiguration]:
    for hue_entry_id, bridge in async_bridges(hass).items():
        for config in bridge.config.entertainment_configuration:
            if config.id == area_id:
                return hue_entry_id, bridge, config
    raise ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key="unknown_entertainment_area",
        translation_placeholders={"area": area_id},
    )


def _locations(
    hass: HomeAssistant,
    hue_entry_id: str,
    bridge: HueBridgeV2,
    lights: list[str],
    keep: dict[str, list[list[float]]],
) -> list[dict[str, Any]]:
    """service_locations for these light entities (kept points, else defaults)."""
    services = entertainment_services(bridge)
    by_entity = {eid: lid for lid, eid in _light_ids(hass, hue_entry_id).items()}
    locations = []
    for index, entity_id in enumerate(lights):
        light = by_entity.get(entity_id)
        if light not in services:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="not_entertainment_light",
                translation_placeholders={"entity_id": entity_id},
            )
        points = keep.get(entity_id) or default_points(index, len(lights))
        locations.append(
            {
                "service": {"rid": services[light], "rtype": "entertainment"},
                "positions": [{"x": x, "y": y, "z": z} for x, y, z in points],
            }
        )
    return locations


async def _request(
    hass: HomeAssistant,
    bridge: HueBridgeV2,
    method: str,
    path: str,
    name: str,
    **kw: Any,
) -> None:
    try:
        await bridge.request(method, path, **kw)
    except (AiohueException, ClientError, TimeoutError) as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="entertainment_failed",
            translation_placeholders={"name": name},
        ) from err
    async_dispatcher_send(hass, SIGNAL_ENTERTAINMENT_UPDATED)


def _check_idle(config: EntertainmentConfiguration) -> None:
    if config.status == EntertainmentStatus.ACTIVE:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="positions_streaming",
            translation_placeholders={"name": config.metadata.name},
        )


async def async_create(
    hass: HomeAssistant,
    hue_entry_id: str | None,
    name: str,
    area_type: str,
    lights: list[str],
) -> None:
    """A new entertainment area of these lights (spread along the front)."""
    hue_entry_id, bridge = _bridge_of(hass, hue_entry_id)
    name = name.strip()[:NAME_MAX]
    body = {
        "type": "entertainment_configuration",
        "metadata": {"name": name},
        "configuration_type": area_type,
        "locations": {
            "service_locations": _locations(hass, hue_entry_id, bridge, lights, {})
        },
    }
    await _request(hass, bridge, "post", ENDPOINT, name, json=body)


async def async_update(
    hass: HomeAssistant,
    area_id: str,
    *,
    name: str | None = None,
    area_type: str | None = None,
    lights: list[str] | None = None,
) -> None:
    """Rename an area, change its type or its lights (kept lights keep their places)."""
    hue_entry_id, bridge, config = _find(hass, area_id)
    _check_idle(config)
    body: dict[str, Any] = {}
    if name is not None and name.strip():
        body["metadata"] = {"name": name.strip()[:NAME_MAX]}
    if area_type is not None:
        body["configuration_type"] = area_type
    if lights is not None:
        current = async_entertainment_payload(hass)[hue_entry_id]["areas"]
        keep = next((a["lights"] for a in current if a["id"] == area_id), {})
        body["locations"] = {
            "service_locations": _locations(hass, hue_entry_id, bridge, lights, keep)
        }
    if body:
        await _request(
            hass,
            bridge,
            "put",
            f"{ENDPOINT}/{area_id}",
            config.metadata.name,
            json=body,
        )


async def async_delete(hass: HomeAssistant, area_id: str) -> None:
    """Remove an entertainment area from the bridge."""
    _, bridge, config = _find(hass, area_id)
    _check_idle(config)
    await _request(
        hass, bridge, "delete", f"{ENDPOINT}/{area_id}", config.metadata.name
    )


async def async_set_positions(
    hass: HomeAssistant, area_id: str, positions: dict[str, list[list[float]]]
) -> None:
    """Move lights of an area (entity id -> points, -1..1)."""
    hue_entry_id, bridge, config = _find(hass, area_id)
    _check_idle(config)
    current = async_entertainment_payload(hass)[hue_entry_id]["areas"]
    keep = next((a["lights"] for a in current if a["id"] == area_id), {})
    clean = {
        entity_id: [[min(max(float(v), -1.0), 1.0) for v in p[:3]] for p in points]
        for entity_id, points in positions.items()
    }
    lights = list(keep)
    unknown = [e for e in clean if e not in keep]
    if unknown:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="not_entertainment_light",
            translation_placeholders={"entity_id": ", ".join(unknown)},
        )
    body = {
        "locations": {
            "service_locations": _locations(
                hass, hue_entry_id, bridge, lights, {**keep, **clean}
            )
        }
    }
    await _request(
        hass, bridge, "put", f"{ENDPOINT}/{area_id}", config.metadata.name, json=body
    )
