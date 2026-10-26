"""The bridges as the panel's settings show them, and their MotionAware areas.

Every bridge of the native integration is listed, connected or not; a connected one
with its facts, and it can be renamed (on the bridge, like in the Hue app).

MotionAware areas (Bridge Pro: lights as motion sensors) come with every Bridge Pro;
`motion_areas.py` has them.
"""

from __future__ import annotations

from typing import Any

from aiohttp import ClientError
from aiohue import HueBridgeV2
from aiohue.errors import AiohueException
from aiohue.v2.models.device import DeviceMetaDataPut, DevicePut
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.dispatcher import async_dispatcher_send

from ..const import DOMAIN, HUE_DOMAIN, SIGNAL_BRIDGES_UPDATED
from ..core.connections import async_supported_hue_entries
from ..lights.bridge import async_bridges
from .motion_areas import async_bridge_payload, has_motion_aware
from .setup import MODELS

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
                        "motion_areas", "motion_lights", "motion_groups"}}
    Every bridge of the native integration; one Hue Studio is not connected to (yet)
    has only its name, address and id. The `motion_*` keys (see
    `motion_areas.async_bridge_payload`) are None when the bridge has no MotionAware
    (no Bridge Pro)."""
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
                "motion_lights": None,
                "motion_groups": None,
            }
    for hue_entry_id, bridge in bridges.items():
        entry = hass.config_entries.async_get_entry(hue_entry_id)
        device = bridge.config.bridge_device
        model_id = getattr(getattr(device, "product_data", None), "model_id", None)
        motion: dict[str, Any] = {
            "motion_areas": None,
            "motion_lights": None,
            "motion_groups": None,
        }
        if has_motion_aware(bridge):
            motion = async_bridge_payload(hass, hue_entry_id, bridge)
        pro = bool(motion["motion_areas"]) or model_id in PRO_MODELS
        if not pro:
            motion = dict.fromkeys(motion)
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
            # A Bridge Pro calls itself "Hue Bridge"; its model id tells them apart.
            "model": (MODELS.get(model_id) or device.product_data.product_name)
            if device
            else None,
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
            **motion,
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
