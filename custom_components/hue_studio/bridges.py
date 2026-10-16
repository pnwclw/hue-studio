"""The bridges as the panel's settings show them, and their MotionAware areas.

Every bridge of the native integration is listed, connected or not; a connected one
with its facts, and it can be renamed (on the bridge, like in the Hue app).

MotionAware areas (`motion_area_configuration`, Bridge Pro) use lights as motion
sensors; they are set up in the Hue app. Here they are listed with their health and
can be switched on and off.
"""

from __future__ import annotations

from typing import Any

from aiohttp import ClientError
from aiohue import HueBridgeV2
from aiohue.errors import AiohueException
from aiohue.v2.models.device import DeviceMetaDataPut, DevicePut
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .connections import async_supported_hue_entries
from .const import DOMAIN, HUE_DOMAIN, SIGNAL_BRIDGES_UPDATED
from .lights import LIGHT_DOMAIN, async_bridges

# Model ids of the Hue Bridge Pro (the bridge with MotionAware).
PRO_MODELS = {"BSB003"}
NAME_MAX = 32


@callback
def bridge_name(hass: HomeAssistant, hue_entry_id: str, bridge: HueBridgeV2) -> str:
    """The bridge's name (as set in the Hue app), else its `hue` entry's title."""
    device = bridge.config.bridge_device
    name = getattr(getattr(device, "metadata", None), "name", None)
    if isinstance(name, str) and name:
        return name
    entry = hass.config_entries.async_get_entry(hue_entry_id)
    return entry.title if entry else "Hue Bridge"


@callback
def async_bridges_payload(hass: HomeAssistant) -> dict[str, Any]:
    """{hue entry id: {"name", "connected", "host", "id", "model", "software", "pro",
                        "ha_device", "devices", "lights", "rooms", "zones",
                        "motion_areas": [{"id", "name", "group", "enabled", "health",
                                          "lights": [{"entity_id", "health"}]}] | None}}
    Every bridge of the native integration; one Hue Studio is not connected to (yet)
    has only its name, address and id. `motion_areas` is None when the bridge has no
    MotionAware (no Bridge Pro), a list (maybe empty) on a Bridge Pro."""
    payload: dict[str, Any] = {}
    bridges = async_bridges(hass)
    for entry in async_supported_hue_entries(hass):
        if entry.entry_id not in bridges:
            payload[entry.entry_id] = {
                "name": entry.title,
                "connected": False,
                "host": entry.data.get("host"),
                "id": entry.unique_id,
                "model": None,
                "software": None,
                "pro": False,
                "ha_device": None,
                "devices": None,
                "lights": None,
                "rooms": None,
                "zones": None,
                "motion_areas": None,
            }
    for hue_entry_id, bridge in bridges.items():
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
        model_id = getattr(getattr(device, "product_data", None), "model_id", None)
        pro = bool(items) or model_id in PRO_MODELS
        if pro:
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
        native = (
            dr.async_get(hass).async_get_device_by_identifier(
                (HUE_DOMAIN, str(device.id)), hue_entry_id
            )
            if isinstance(getattr(device, "id", None), str)
            else None
        )
        payload[hue_entry_id] = {
            "name": bridge_name(hass, hue_entry_id, bridge),
            "connected": True,
            "host": entry.data.get("host") if entry else None,
            "id": bridge.config.bridge_id,
            "model": device.product_data.product_name if device else None,
            "software": device.product_data.software_version if device else None,
            "pro": pro,
            "ha_device": native.id if native else None,
            "devices": sum(
                1
                for d in bridge.devices
                if not d.product_data.product_archetype.value.startswith("bridge")
            ),
            "lights": sum(1 for _ in bridge.lights),
            "rooms": sum(1 for _ in bridge.groups.room),
            "zones": sum(1 for _ in bridge.groups.zone),
            "motion_areas": areas,
        }
    return payload


async def async_rename_bridge(
    hass: HomeAssistant, hue_entry_id: str, name: str
) -> None:
    """Name a bridge (its device on the bridge, as the Hue app does)."""
    bridge = async_bridges(hass).get(hue_entry_id)
    if bridge is None or bridge.config.bridge_device is None:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="hue_entry_missing"
        )
    device = bridge.config.bridge_device
    name = name.strip()[:NAME_MAX]
    if not name or name == device.metadata.name:
        return
    try:
        await bridge.devices.update(
            device.id,
            DevicePut(metadata=DeviceMetaDataPut(archetype=None, name=name)),
        )
    except (AiohueException, ClientError, TimeoutError) as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="command_failed",
            translation_placeholders={"entity_id": device.metadata.name},
        ) from err
    async_dispatcher_send(hass, SIGNAL_BRIDGES_UPDATED)


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
