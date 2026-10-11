"""The bridges as the panel's settings show them, and their MotionAware areas.

MotionAware areas (`motion_area_configuration`, Bridge Pro) use lights as motion
sensors; they are set up in the Hue app. Here they are listed with their health and
can be switched on and off.
"""

from __future__ import annotations

from typing import Any

from aiohttp import ClientError
from aiohue.errors import AiohueException
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import DOMAIN
from .lights import LIGHT_DOMAIN, async_bridges

SIGNAL_BRIDGES_UPDATED = f"{DOMAIN}_bridges_updated"


@callback
def async_bridges_payload(hass: HomeAssistant) -> dict[str, Any]:
    """{hue entry id: {"name", "host", "id", "model", "software",
                        "motion_areas": [{"id", "name", "group", "enabled", "health",
                                          "lights": [{"entity_id", "health"}]}] | None}}
    `motion_areas` is None when the bridge has no MotionAware (no Bridge Pro)."""
    payload: dict[str, Any] = {}
    for hue_entry_id, bridge in async_bridges(hass).items():
        entry = hass.config_entries.async_get_entry(hue_entry_id)
        device = bridge.config.bridge_device
        lights = {
            e.unique_id: e.entity_id
            for e in er.async_entries_for_config_entry(er.async_get(hass), hue_entry_id)
            if e.domain == LIGHT_DOMAIN
        }
        areas: list[dict[str, Any]] | None = None
        configs = getattr(bridge.config, "motion_area_configuration", None)
        items = list(configs) if configs is not None else []
        if items:
            areas = []
            for config in items:
                group = bridge.groups.room.get(
                    config.group.rid
                ) or bridge.groups.zone.get(config.group.rid)
                areas.append(
                    {
                        "id": config.id,
                        "name": config.name,
                        "group": group.metadata.name if group else None,
                        "enabled": config.enabled,
                        "health": config.health.value,
                        "lights": [
                            {
                                "entity_id": lights.get(p.resource.rid),
                                "health": p.status.health.value,
                            }
                            for p in config.participants
                        ],
                    }
                )
        payload[hue_entry_id] = {
            "name": entry.title if entry else "Hue Bridge",
            "host": entry.data.get("host") if entry else None,
            "id": bridge.config.bridge_id,
            "model": device.product_data.product_name if device else None,
            "software": device.product_data.software_version if device else None,
            "motion_areas": areas,
        }
    return payload


async def async_set_motion_area(
    hass: HomeAssistant, area_id: str, enabled: bool
) -> None:
    """Switch a MotionAware area on or off."""
    for bridge in async_bridges(hass).values():
        configs = getattr(bridge.config, "motion_area_configuration", None)
        if configs is None or configs.get(area_id) is None:
            continue
        try:
            await bridge.request(
                "put",
                f"clip/v2/resource/motion_area_configuration/{area_id}",
                json={"enabled": enabled},
            )
        except (AiohueException, ClientError, TimeoutError) as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="command_failed",
                translation_placeholders={"entity_id": area_id},
            ) from err
        async_dispatcher_send(hass, SIGNAL_BRIDGES_UPDATED)
        return
    raise ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key="unknown_motion_area",
        translation_placeholders={"area": area_id},
    )
