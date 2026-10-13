"""A Sync Box used through the HACS `huesyncbox` integration.

The alternative to pairing the box with Hue Studio: the box stays with `huesyncbox`
(by the author of aiohuesyncbox) and Hue Studio only uses its public side — the
entities it creates and its `set_sync_state` service — never its internals, the same
rule as for the native `hue` integration. The panel sees the same payload as for a box
paired directly; entertainment areas are matched with the bridge by name, because that
is what the integration exposes.
"""

from __future__ import annotations

from typing import Any

from aiohue.v2.models.entertainment_configuration import EntertainmentStatus
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    ATTR_DEVICE_ID,
    CONF_HOST,
    STATE_ON,
    STATE_UNAVAILABLE,
    STATE_UNKNOWN,
)
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.event import async_track_state_change_event

from .const import DOMAIN, SYNC_BOX_INTEGRATION
from .sync import (
    INPUTS,
    INTENSITIES,
    SYNC_MODES,
    async_config_lights,
    async_entertainment_area,
)

SERVICE_SET_SYNC_STATE = "set_sync_state"

# Keys of the integration's entities: their unique ids are "<key>_<box id>".
KEY_POWER = "power"
KEY_SYNC = "light_sync"
KEY_MODE = "sync_mode"
KEY_INTENSITY = "intensity"
KEY_INPUT = "hdmi_input"
KEY_AREA = "entertainment_area"
KEY_BRIGHTNESS = "brightness"
KEY_CONTENT = "content_info"
KEY_CONNECTION = "bridge_connection_state"

_NO_VALUE = (None, STATE_UNKNOWN, STATE_UNAVAILABLE)


class SyncBoxLink:
    """One box of the `huesyncbox` integration, seen through its entities."""

    def __init__(self, hass: HomeAssistant, sync_entry: ConfigEntry) -> None:
        """Bind to the integration's config entry (no I/O)."""
        self.hass = hass
        self.sync_entry = sync_entry

    @property
    def entities(self) -> dict[str, str]:
        """The integration's entity ids for this box, by key."""
        return {
            entry.unique_id.rsplit("_", 1)[0]: entry.entity_id
            for entry in er.async_entries_for_config_entry(
                er.async_get(self.hass), self.sync_entry.entry_id
            )
            if entry.platform == SYNC_BOX_INTEGRATION
        }

    @property
    def device(self) -> dr.DeviceEntry | None:
        """The box's device in the device registry."""
        devices = dr.async_entries_for_config_entry(
            dr.async_get(self.hass), self.sync_entry.entry_id
        )
        return devices[0] if devices else None

    def _state(self, key: str) -> str | None:
        entity_id = self.entities.get(key)
        state = self.hass.states.get(entity_id) if entity_id else None
        return None if state is None or state.state in _NO_VALUE else state.state

    def _options(self, key: str) -> list[str]:
        entity_id = self.entities.get(key)
        state = self.hass.states.get(entity_id) if entity_id else None
        return list(state.attributes.get("options") or []) if state else []

    def inputs(self) -> list[dict[str, Any]]:
        """HDMI inputs: the input select's options are their names, in port order."""
        names = self._options(KEY_INPUT)
        entities = self.entities
        ports = [key for key in INPUTS if f"hdmi{key[-1]}_status" in entities]
        if len(ports) != len(names):
            ports = INPUTS[: len(names)]
        return [
            {
                "id": port,
                "name": name,
                "type": None,
                "status": self._state(f"hdmi{port[-1]}_status"),
            }
            for port, name in zip(ports, names, strict=False)
        ]

    def areas(self) -> list[dict[str, Any]]:
        """Entertainment areas (the area select's options), matched with the bridge."""
        areas = []
        for name in self._options(KEY_AREA):
            config = async_entertainment_area(self.hass, name=name)
            areas.append(
                {
                    "id": config.id if config else name,
                    "name": name,
                    "active": bool(
                        config and config.status == EntertainmentStatus.ACTIVE
                    ),
                    "lights": async_config_lights(self.hass, config),
                }
            )
        return sorted(areas, key=lambda a: a["name"].casefold())

    @callback
    def async_add_listener(self, update_callback: CALLBACK_TYPE) -> CALLBACK_TYPE:
        """Call `update_callback` when any entity of the box changes."""

        @callback
        def changed(event: Any) -> None:
            update_callback()

        return async_track_state_change_event(
            self.hass, list(self.entities.values()), changed
        )

    def panel_info(self) -> dict[str, Any]:
        """The same payload as for a box paired directly (hue_studio/sync/subscribe)."""
        entity_id = self.entities.get(KEY_SYNC)
        power = self._state(KEY_POWER)
        if power is None:
            return {"available": False, "entity_id": entity_id, "name": None}
        device = self.device
        mode = self._state(KEY_MODE)
        intensity = self._state(KEY_INTENSITY)
        inputs = self.inputs()
        areas = self.areas()
        input_name = self._state(KEY_INPUT)
        area_name = self._state(KEY_AREA)
        try:
            brightness = round(float(self._state(KEY_BRIGHTNESS) or ""))
        except ValueError:
            brightness = None
        return {
            "available": True,
            "entity_id": entity_id,
            "name": (device and (device.name_by_user or device.name))
            or self.sync_entry.title,
            "model": (device and device.model) or "Sync Box",
            "power": power == STATE_ON,
            "syncing": self._state(KEY_SYNC) == STATE_ON,
            "mode": mode if mode in SYNC_MODES else SYNC_MODES[0],
            "intensity": intensity if intensity in INTENSITIES else None,
            "brightness": brightness,
            "input": next((i["id"] for i in inputs if i["name"] == input_name), None),
            "inputs": inputs,
            "area": next((a["id"] for a in areas if a["name"] == area_name), None),
            "areas": areas,
            "content": self._state(KEY_CONTENT),
            "video_supported": True,
            "audio_supported": True,
            "connection": self._state(KEY_CONNECTION),
            "device": {
                "id": self.sync_entry.unique_id,
                "host": self.sync_entry.data.get(CONF_HOST),
                "firmware": device.sw_version if device else None,
                "update": None,
                "wifi": None,
                "led": None,
                "tv_power": None,
                "ha_device": device.id if device else None,
            },
        }

    async def async_set_sync(self, data: dict[str, Any]) -> None:
        """Apply a `hue_studio.set_sync` call with the integration's service."""
        device = self.device
        if device is None or not self.hass.services.has_service(
            SYNC_BOX_INTEGRATION, SERVICE_SET_SYNC_STATE
        ):
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="sync_box_integration_unavailable",
                translation_placeholders={"name": self.sync_entry.title},
            )
        payload: dict[str, Any] = {ATTR_DEVICE_ID: device.id}
        for key in ("power", "sync", "mode", "intensity", "brightness"):
            if key in data:
                payload[key] = data[key]
        if (source := data.get("input")) is not None:
            payload["input"] = self._input_id(source)
        if (area := data.get("entertainment_area")) is not None:
            payload["entertainment_area"] = self._area_name(area)
        await self.hass.services.async_call(
            SYNC_BOX_INTEGRATION, SERVICE_SET_SYNC_STATE, payload, blocking=True
        )

    def _input_id(self, value: str) -> str:
        for port in self.inputs():
            if value in (port["id"], port["name"]):
                return port["id"]
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="unknown_input",
            translation_placeholders={"input": value},
        )

    def _area_name(self, value: str) -> str:
        for area in self.areas():
            if value in (area["id"], area["name"]):
                return area["name"]
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="unknown_area",
            translation_placeholders={"area": value},
        )


@callback
def async_sync_box_entries(hass: HomeAssistant) -> list[ConfigEntry]:
    """Config entries of the `huesyncbox` integration (enabled, with a box id)."""
    return [
        entry
        for entry in hass.config_entries.async_entries(SYNC_BOX_INTEGRATION)
        if entry.disabled_by is None and entry.unique_id
    ]


@callback
def async_sync_box_entry_for(hass: HomeAssistant, box_id: str) -> ConfigEntry | None:
    """The `huesyncbox` entry of a box, if the integration has it."""
    return next(
        (
            entry
            for entry in async_sync_box_entries(hass)
            if (entry.unique_id or "").upper() == box_id.upper()
        ),
        None,
    )
