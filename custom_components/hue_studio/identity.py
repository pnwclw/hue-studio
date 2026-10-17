"""Hue devices, rooms, zones and scenes keep their Home Assistant identity.

A device that leaves a bridge and joins one again (moved by Hue Studio, added again with
"Add devices", migrated by the Hue app, reset and paired anew) comes back as new bridge
resources, so the native `hue` integration makes new entities with new entity ids. Hue
Studio remembers every device by its Zigbee MAC (each light's and each other service's
entity: id, name, icon, area, labels, aliases, enabled and hidden state; the device's
area, name and labels in HA; its name, archetype, and each light's function and power-on
on the bridge) and every room, zone and scene by name, in a Store kept up to date as
things change. When a known MAC turns up as another device and its old entities are
gone, the new ones take their ids and settings back and the bridge gets the device's
name and settings back; a room or zone of a remembered name, and its scenes, likewise.

It never takes an entity id something else still holds (the old device while it is still
on its bridge, e.g. until the old bridge's entry is removed): it tries again on the next
change. While a move runs, the move does this itself.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import logging
from typing import Any

from aiohttp import ClientError
from aiohue import HueBridgeV2
from aiohue.errors import AiohueException
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.event import async_call_later
from homeassistant.helpers.storage import Store

from .const import DOMAIN, HUE_DOMAIN, SIGNAL_BRIDGES_UPDATED
from .devices import (
    SIGNAL_DEVICES_UPDATED,
    is_bridge_device,
    light_settings,
    put_light_settings,
)
from .lights import LIGHT_DOMAIN, async_bridges
from .migration import (
    DEVICE_PATH,
    STORAGE_KEY as MOVE_KEY,
    Mover,
    async_take_over,
    device_lights,
    device_mac,
    remember_entity,
    service_keys,
)
from .positions import position_store
from .scenes import SCENE_DOMAIN

_LOGGER = logging.getLogger(__name__)

STORAGE_KEY = f"{DOMAIN}.identity"
STORAGE_VERSION = 1
# Changes come in bursts (a device's entities one by one): look once they settle.
SETTLE = 5.0
SAVE_DELAY = 10.0


class Identities:
    """What Hue Studio remembers of every device, room, zone and scene."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, STORAGE_KEY, private=True
        )
        # Zigbee MAC (lower case) -> a device as last seen.
        self.devices: dict[str, dict[str, Any]] = {}
        # "room:<name>" / "zone:<name>" -> a room or zone with its scenes.
        self.groups: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()
        self._later: CALLBACK_TYPE | None = None

    async def async_load(self) -> None:
        data = await self.store.async_load() or {}
        self.devices = data.get("devices", {})
        self.groups = data.get("groups", {})

    def _save(self) -> None:
        self.store.async_delay_save(
            lambda: {"devices": self.devices, "groups": self.groups}, SAVE_DELAY
        )

    @callback
    def async_schedule(self, *_: Any) -> None:
        """Look again once changes settle."""
        if self._later is not None:
            self._later()
        self._later = async_call_later(self.hass, SETTLE, self._async_fire)

    @callback
    def async_cancel(self) -> None:
        """Stop looking (Home Assistant stops)."""
        if self._later is not None:
            self._later()
            self._later = None

    @callback
    def _async_fire(self, _now: Any) -> None:
        self._later = None
        self.hass.async_create_background_task(
            self.async_reconcile(), f"{DOMAIN} identities"
        )

    async def async_reconcile(self) -> None:
        """Give devices, rooms, zones and scenes that came back their identity, then
        remember everything as it is now."""
        mover: Mover | None = self.hass.data.get(MOVE_KEY)
        if mover is not None and mover.busy:
            # A move restores what it moves; look once it is done.
            self.async_schedule()
            return
        async with self._lock:
            changed = False
            for entry_id, bridge in async_bridges(self.hass).items():
                try:
                    changed |= await self._async_bridge(entry_id, bridge)
                except AiohueException, ClientError, TimeoutError, HomeAssistantError:
                    _LOGGER.debug("Could not restore identities on %s", entry_id)
            if changed:
                self._save()

    async def _async_bridge(self, entry_id: str, bridge: HueBridgeV2) -> bool:
        entities = er.async_get(self.hass)
        by_unique_id: dict[str, list[er.RegistryEntry]] = {}
        for entry in er.async_entries_for_config_entry(entities, entry_id):
            by_unique_id.setdefault(entry.unique_id, []).append(entry)
        # A MAC on several devices at once (a device still on its old bridge): wait.
        macs: dict[str, list[Any]] = {}
        for bridge_ in async_bridges(self.hass).values():
            for device in bridge_.devices:
                if (mac := device_mac(bridge_, device.id)) is not None:
                    macs.setdefault(mac.lower(), []).append(device)
        changed = False
        for device in bridge.devices:
            if is_bridge_device(bridge, device):
                continue
            mac = (device_mac(bridge, device.id) or "").lower()
            if not mac or len(macs.get(mac, [])) > 1:
                continue
            known = self.devices.get(mac)
            if known is not None and known["device_id"] != device.id:
                if not self._free(known):
                    continue
                await self._async_restore_device(entry_id, bridge, device, known)
                by_unique_id = {}
                for entry in er.async_entries_for_config_entry(entities, entry_id):
                    by_unique_id.setdefault(entry.unique_id, []).append(entry)
            seen = self._device(entry_id, bridge, device, by_unique_id)
            if seen != known:
                self.devices[mac] = seen
                changed = True
        for kind, groups in (
            ("room", bridge.groups.room),
            ("zone", bridge.groups.zone),
        ):
            for group in groups:
                changed |= await self._async_group(entry_id, bridge, kind, group)
        return changed

    def _free(self, known: dict[str, Any]) -> bool:
        """Whether no entity holds the remembered entity ids any more."""
        entities = er.async_get(self.hass)
        ids = [light["entity"].get("entity_id") for light in known["lights"]] + [
            other["entity"].get("entity_id") for other in known["others"]
        ]
        return all(entities.async_get(e) is None for e in ids if e)

    def _device(
        self,
        entry_id: str,
        bridge: HueBridgeV2,
        device: Any,
        by_unique_id: dict[str, list[er.RegistryEntry]],
    ) -> dict[str, Any]:
        """A device as it is now."""
        ha_device = dr.async_get(self.hass).async_get_device_by_identifier(
            (HUE_DOMAIN, device.id), entry_id
        )
        lights = []
        for rid in device_lights(device):
            function, power_on = light_settings(bridge.lights.get(rid))
            entries = [e for e in by_unique_id.get(rid, []) if e.domain == LIGHT_DOMAIN]
            lights.append(
                {
                    "id": rid,
                    "function": function,
                    "power_on": power_on,
                    "entity": remember_entity(
                        self.hass, entries[0].entity_id if entries else None
                    ),
                }
            )
        return {
            "device_id": device.id,
            "bridge": entry_id,
            "name": device.metadata.name,
            "archetype": device.metadata.archetype.value,
            "lights": lights,
            "others": [
                {
                    "key": key,
                    "domain": entry.domain,
                    "entity": remember_entity(self.hass, entry.entity_id),
                }
                for key, rid in service_keys(device)
                for entry in by_unique_id.get(rid, [])
            ],
            "ha_device": {
                "area_id": ha_device.area_id,
                "name_by_user": ha_device.name_by_user,
                "labels": sorted(ha_device.labels),
            }
            if ha_device is not None
            else None,
        }

    async def _async_restore_device(
        self, entry_id: str, bridge: HueBridgeV2, device: Any, known: dict[str, Any]
    ) -> None:
        """A known device came back as a new one: its identity back."""
        _LOGGER.info(
            "Hue device %s came back: its name, settings and entity ids are restored",
            known["name"],
        )
        metadata = {"name": known["name"], "archetype": known["archetype"]}
        if (device.metadata.name, device.metadata.archetype.value) != tuple(
            metadata.values()
        ):
            await bridge.request(
                "put", f"{DEVICE_PATH}/{device.id}", json={"metadata": metadata}
            )
        new_lights = device_lights(device)
        moved: dict[str, Any] = {}
        positions = position_store(self.hass)
        for index, light in enumerate(known["lights"]):
            if index >= len(new_lights):
                break
            rid = new_lights[index]
            await put_light_settings(bridge, rid, light["function"], light["power_on"])
            await async_take_over(self.hass, LIGHT_DOMAIN, rid, light["entity"])
            if (points := positions.lights.get(light["id"])) is not None:
                moved[light["id"]] = None
                moved[rid] = points
        services = dict(service_keys(device))
        for other in known["others"]:
            if (rid := services.get(other["key"])) is not None:
                await async_take_over(self.hass, other["domain"], rid, other["entity"])
        if moved:
            await positions.async_update(moved)
        devices = dr.async_get(self.hass)
        ha_device = devices.async_get_device_by_identifier(
            (HUE_DOMAIN, device.id), entry_id
        )
        if ha_device is not None and known["ha_device"]:
            devices.async_update_device(
                ha_device.id,
                area_id=known["ha_device"]["area_id"],
                name_by_user=known["ha_device"]["name_by_user"],
                labels=set(known["ha_device"]["labels"]),
            )

    async def _async_group(
        self, entry_id: str, bridge: HueBridgeV2, kind: str, group: Any
    ) -> bool:
        """A room or zone (and its scenes) that came back takes its ids back; then
        it is remembered as it is."""
        entities = er.async_get(self.hass)
        key = f"{kind}:{group.metadata.name}"
        known = self.groups.get(key)
        light_entity = (
            entities.async_get_entity_id(LIGHT_DOMAIN, HUE_DOMAIN, group.grouped_light)
            if group.grouped_light
            else None
        )
        scenes = [s for s in bridge.scenes.scene if s.group.rid == group.id]
        if known is not None:
            old = known["entity"].get("entity_id")
            if (
                known["id"] != group.id
                and group.grouped_light
                and light_entity != old
                and old
                and entities.async_get(old) is None
            ):
                await async_take_over(
                    self.hass, LIGHT_DOMAIN, group.grouped_light, known["entity"]
                )
            for scene in scenes:
                was = known["scenes"].get(scene.metadata.name)
                if not was or was.get("id") == scene.id:
                    continue
                old = was["entity"].get("entity_id")
                current = entities.async_get_entity_id(
                    SCENE_DOMAIN, HUE_DOMAIN, scene.id
                )
                if old and current != old and entities.async_get(old) is None:
                    await async_take_over(
                        self.hass, SCENE_DOMAIN, scene.id, was["entity"]
                    )
        seen = {
            "id": group.id,
            "bridge": entry_id,
            "entity": remember_entity(
                self.hass,
                entities.async_get_entity_id(
                    LIGHT_DOMAIN, HUE_DOMAIN, group.grouped_light
                )
                if group.grouped_light
                else None,
            ),
            "scenes": {
                scene.metadata.name: {
                    "id": scene.id,
                    "entity": remember_entity(
                        self.hass,
                        entities.async_get_entity_id(
                            SCENE_DOMAIN, HUE_DOMAIN, scene.id
                        ),
                    ),
                }
                for scene in scenes
            },
        }
        # A scene or the room's light not in HA yet keeps what was remembered of it.
        if known is not None:
            if not seen["entity"].get("entity_id"):
                seen["entity"] = known["entity"]
            for name, was in known["scenes"].items():
                if name not in seen["scenes"] or not seen["scenes"][name]["entity"].get(
                    "entity_id"
                ):
                    seen["scenes"][name] = was
        if seen == known:
            return False
        self.groups[key] = seen
        return True


async def async_setup_identities(hass: HomeAssistant) -> Callable[[], None]:
    """Load what is remembered and keep it up to date (returns: stop)."""
    identities = Identities(hass)
    await identities.async_load()
    hass.data[STORAGE_KEY] = identities
    stops = [
        hass.bus.async_listen(
            er.EVENT_ENTITY_REGISTRY_UPDATED, identities.async_schedule
        ),
        hass.bus.async_listen(
            dr.EVENT_DEVICE_REGISTRY_UPDATED, identities.async_schedule
        ),
        async_dispatcher_connect(
            hass, SIGNAL_BRIDGES_UPDATED, identities.async_schedule
        ),
        async_dispatcher_connect(
            hass, SIGNAL_DEVICES_UPDATED, identities.async_schedule
        ),
    ]
    identities.async_schedule()

    @callback
    def stop(*_: Any) -> None:
        for unsub in stops:
            unsub()
        stops.clear()
        identities.async_cancel()

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, stop)
    return stop
