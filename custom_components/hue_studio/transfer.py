"""Moving a whole bridge to a Bridge Pro: the Hue app's migration, HA kept as it was.

The Hue app moves everything of a bridge to a Bridge Pro (Settings → Bridges → the
bridge → Migrate): lights, plugs, switches, sensors with their names and settings,
rooms and zones. Home Assistant's `hue` integration then shows them as new devices and
entities of the Bridge Pro. Hue Studio keeps HA as it was:

1. Before: everything of the old bridge is remembered (a Store): each device by its
   Zigbee MAC, with its entities (by service type and index) and its HA device's area,
   name and labels; rooms and zones by name; scenes by their room or zone and name.
2. While the Hue app migrates, the panel shows what has arrived on the Bridge Pro.
3. Finish: the old bridge is removed from HA (its entities go, freeing their ids), and
   what arrived takes over: a device's entities (found by MAC), rooms and zones (by
   name), scenes (by room or zone and name); light positions follow.

Moving single rooms and lights between bridges is migration.py.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable
from dataclasses import dataclass
import logging
from typing import Any

from aiohue import HueBridgeV2
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.dispatcher import (
    async_dispatcher_connect,
    async_dispatcher_send,
)
from homeassistant.helpers.storage import Store

from .bridges import PRO_MODELS, bridge_name
from .const import DOMAIN, HUE_DOMAIN, SIGNAL_BRIDGES_UPDATED
from .devices import is_bridge_device
from .lights import LIGHT_DOMAIN, async_bridges
from .migration import async_take_over, device_mac, remember_entity, service_keys
from .positions import position_store
from .scenes import SCENE_DOMAIN

_LOGGER = logging.getLogger(__name__)

SIGNAL_TRANSFER_UPDATED = f"{DOMAIN}_transfer_updated"
STORAGE_KEY = f"{DOMAIN}.transfer"
STORAGE_VERSION = 1


def _is_pro(bridge: HueBridgeV2) -> bool:
    data = getattr(bridge.config.bridge_device, "product_data", None)
    return getattr(data, "model_id", None) in PRO_MODELS


def _groups(bridge: HueBridgeV2) -> list[tuple[str, Any]]:
    """(kind, group) of every room and zone."""
    return [("room", r) for r in bridge.groups.room] + [
        ("zone", z) for z in bridge.groups.zone
    ]


@callback
def async_remember_bridge(hass: HomeAssistant, source: str) -> dict[str, Any]:
    """Everything of a bridge HA knows, to be found again on another bridge."""
    bridge = async_bridges(hass)[source]
    entities = er.async_get(hass)
    devices_reg = dr.async_get(hass)
    by_unique_id: dict[str, list[er.RegistryEntry]] = {}
    for entry in er.async_entries_for_config_entry(entities, source):
        by_unique_id.setdefault(entry.unique_id, []).append(entry)
    store = position_store(hass)
    devices = []
    for device in bridge.devices:
        if is_bridge_device(bridge, device) or not (
            mac := device_mac(bridge, device.id)
        ):
            continue
        ha_device = devices_reg.async_get_device_by_identifier(
            (HUE_DOMAIN, device.id), source
        )
        keys = service_keys(device, lights=True)
        devices.append(
            {
                "mac": mac,
                "name": device.metadata.name,
                "entities": [
                    {
                        "key": key,
                        "domain": entry.domain,
                        "entity": remember_entity(hass, entry.entity_id),
                    }
                    for key, rid in keys
                    for entry in by_unique_id.get(rid, [])
                ],
                # Light positions (by service key), and the ids they are stored under.
                "positions": {
                    key: store.lights[rid] for key, rid in keys if rid in store.lights
                },
                "position_ids": [rid for _key, rid in keys if rid in store.lights],
                "ha_device": {
                    "area_id": ha_device.area_id,
                    "name_by_user": ha_device.name_by_user,
                    "labels": sorted(ha_device.labels),
                }
                if ha_device is not None
                else None,
            }
        )
    groups = []
    names: dict[str, tuple[str, str]] = {}
    for kind, group in _groups(bridge):
        names[group.id] = (kind, group.metadata.name)
        grouped = group.grouped_light
        groups.append(
            {
                "kind": kind,
                "name": group.metadata.name,
                "entity": remember_entity(
                    hass,
                    entities.async_get_entity_id(LIGHT_DOMAIN, HUE_DOMAIN, grouped)
                    if grouped
                    else None,
                ),
            }
        )
    scenes = [
        {
            "kind": names[scene.group.rid][0],
            "group": names[scene.group.rid][1],
            "name": scene.metadata.name,
            "entity": remember_entity(
                hass, entities.async_get_entity_id(SCENE_DOMAIN, HUE_DOMAIN, scene.id)
            ),
        }
        for scene in bridge.scenes.scene
        if scene.group.rid in names
    ]
    return {"devices": devices, "groups": groups, "scenes": scenes}


@dataclass(slots=True)
class Transfer:
    """The transfer being prepared or finished, its stored memo and its task."""

    hass: HomeAssistant
    store: Store[dict[str, Any]]
    memo: dict[str, Any] | None = None
    task: asyncio.Task[None] | None = None

    async def async_save(self) -> None:
        if self.memo is None:
            await self.store.async_remove()
        else:
            await self.store.async_save(self.memo)
        async_dispatcher_send(self.hass, SIGNAL_TRANSFER_UPDATED)

    @property
    def busy(self) -> bool:
        return self.task is not None and not self.task.done()


async def async_setup_transfer(hass: HomeAssistant) -> None:
    """Load a transfer being prepared (kept over restarts: the Hue app takes a
    while)."""
    transfer = Transfer(hass, Store(hass, STORAGE_VERSION, STORAGE_KEY, private=True))
    hass.data[STORAGE_KEY] = transfer
    transfer.memo = await transfer.store.async_load() or None
    if transfer.memo is not None and transfer.memo["step"] == "finishing":
        transfer.memo["step"] = "waiting"


def _transfer(hass: HomeAssistant) -> Transfer:
    transfer: Transfer | None = hass.data.get(STORAGE_KEY)
    if transfer is None:
        raise HomeAssistantError(
            translation_domain=DOMAIN, translation_key="not_set_up"
        )
    return transfer


def _arrived(target: HueBridgeV2 | None, memo: dict[str, Any]) -> dict[str, Any]:
    """What of the old bridge the target has: devices by MAC, groups by kind and name,
    scenes by group and name."""
    if target is None:
        return {"devices": {}, "groups": {}, "scenes": {}}
    devices = {
        mac: device
        for device in target.devices
        if not is_bridge_device(target, device)
        and (mac := device_mac(target, device.id))
    }
    groups = {(kind, g.metadata.name): g for kind, g in _groups(target)}
    names = {g.id: key for key, g in groups.items()}
    scenes = {
        (*names[s.group.rid], s.metadata.name): s
        for s in target.scenes.scene
        if s.group.rid in names
    }

    def pick(found: dict[Any, Any], keys: Iterable[Any]) -> dict[Any, Any]:
        return {key: found[key] for key in keys if key in found}

    return {
        "devices": pick(devices, (d["mac"] for d in memo["devices"])),
        "groups": pick(groups, ((g["kind"], g["name"]) for g in memo["groups"])),
        "scenes": pick(
            scenes, ((s["kind"], s["group"], s["name"]) for s in memo["scenes"])
        ),
    }


@callback
def async_transfer_payload(hass: HomeAssistant) -> dict[str, Any] | None:
    """The transfer the panel shows, or None:

    {"step": "waiting" | "finishing" | "done" | "failed", "error", "source", "target",
     "source_name", "target_name", "source_connected",
     "devices": {"total", "arrived"}, "groups": {...}, "scenes": {...},
     "missing": [names of devices not on the target yet]}
    """
    transfer: Transfer | None = hass.data.get(STORAGE_KEY)
    if transfer is None or transfer.memo is None:
        return None
    memo = transfer.memo
    bridges = async_bridges(hass)
    arrived = _arrived(bridges.get(memo["target"]), memo)
    return {
        "step": memo["step"],
        "error": memo.get("error"),
        "source": memo["source"],
        "target": memo["target"],
        "source_name": memo["source_name"],
        "target_name": memo["target_name"],
        "source_connected": memo["source"] in bridges,
        "devices": {"total": len(memo["devices"]), "arrived": len(arrived["devices"])},
        "groups": {"total": len(memo["groups"]), "arrived": len(arrived["groups"])},
        "scenes": {"total": len(memo["scenes"]), "arrived": len(arrived["scenes"])},
        "missing": sorted(
            d["name"] for d in memo["devices"] if d["mac"] not in arrived["devices"]
        ),
    }


@callback
def async_track_transfer(
    hass: HomeAssistant, on_change: Callable[[], None]
) -> Callable[[], None]:
    """Call `on_change` when the transfer or what the target bridge holds changes."""
    watched: list[Callable[[], None]] = []

    @callback
    def changed(*_: Any) -> None:
        on_change()

    @callback
    def watch() -> None:
        while watched:
            watched.pop()()
        transfer: Transfer | None = hass.data.get(STORAGE_KEY)
        memo = transfer.memo if transfer else None
        target = async_bridges(hass).get(memo["target"]) if memo else None
        if target is not None:
            watched.append(target.devices.subscribe(changed))
            watched.append(target.groups.room.subscribe(changed))
            watched.append(target.groups.zone.subscribe(changed))
            watched.append(target.scenes.scene.subscribe(changed))

    @callback
    def bridges_changed() -> None:
        watch()
        on_change()

    watch()
    unsubs = [
        async_dispatcher_connect(hass, SIGNAL_TRANSFER_UPDATED, bridges_changed),
        async_dispatcher_connect(hass, SIGNAL_BRIDGES_UPDATED, bridges_changed),
    ]

    @callback
    def unsubscribe() -> None:
        for unsub in unsubs:
            unsub()
        while watched:
            watched.pop()()

    return unsubscribe


async def async_start_transfer(hass: HomeAssistant, source: str, target: str) -> None:
    """Remember everything of `source` before the Hue app moves it to `target`."""
    transfer = _transfer(hass)
    if transfer.busy or (transfer.memo is not None and transfer.memo["step"] != "done"):
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="move_busy"
        )
    bridges = async_bridges(hass)
    if source not in bridges or target not in bridges:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="hue_entry_missing"
        )
    if source == target:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="move_same_bridge"
        )
    if not _is_pro(bridges[target]):
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="transfer_needs_pro"
        )
    transfer.memo = {
        **async_remember_bridge(hass, source),
        "source": source,
        "target": target,
        "source_name": bridge_name(hass, source, bridges[source]),
        "target_name": bridge_name(hass, target, bridges[target]),
        "step": "waiting",
        "error": None,
    }
    await transfer.async_save()


async def async_cancel_transfer(hass: HomeAssistant) -> None:
    """Forget a transfer (nothing in HA has changed until it is finished)."""
    transfer = _transfer(hass)
    if transfer.busy:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="move_busy"
        )
    transfer.memo = None
    await transfer.async_save()


async def async_finish_transfer(hass: HomeAssistant) -> None:
    """The old bridge leaves HA and what arrived on the Bridge Pro takes over (in the
    background; the panel watches)."""
    transfer = _transfer(hass)
    if transfer.busy or transfer.memo is None or transfer.memo["step"] == "done":
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="move_busy"
        )
    if transfer.memo["target"] not in async_bridges(hass):
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="hue_entry_missing"
        )
    transfer.memo.update(step="finishing", error=None)
    await transfer.async_save()
    transfer.task = hass.async_create_background_task(
        _async_finish(transfer), f"{DOMAIN} bridge transfer"
    )


async def _async_finish(transfer: Transfer) -> None:
    hass = transfer.hass
    memo = transfer.memo
    assert memo is not None
    try:
        await _async_take_over_all(hass, memo)
    except (HomeAssistantError, ValueError) as err:
        _LOGGER.warning("Finishing the bridge transfer stopped: %s", err)
        memo.update(step="failed", error="ha")
    else:
        memo.update(step="done")
    await transfer.async_save()


async def _async_take_over_all(hass: HomeAssistant, memo: dict[str, Any]) -> None:
    target = async_bridges(hass)[memo["target"]]
    arrived = _arrived(target, memo)
    # The old bridge's entities go with its entry: their ids are free for the new ones.
    if hass.config_entries.async_get_entry(memo["source"]) is not None:
        await hass.config_entries.async_remove(memo["source"])
        await hass.async_block_till_done()
    devices_reg = dr.async_get(hass)
    store = position_store(hass)
    positions: dict[str, Any] = {}
    for device in memo["devices"]:
        positions.update(dict.fromkeys(device.get("position_ids", [])))
        new = arrived["devices"].get(device["mac"])
        if new is None:
            continue
        keys = dict(service_keys(new, lights=True))
        for entity in device["entities"]:
            if (rid := keys.get(entity["key"])) is not None:
                await async_take_over(hass, entity["domain"], rid, entity["entity"])
        for key, points in device.get("positions", {}).items():
            if (rid := keys.get(key)) is not None:
                positions[rid] = points
        old = device["ha_device"]
        ha_device = devices_reg.async_get_device_by_identifier(
            (HUE_DOMAIN, new.id), memo["target"]
        )
        if old and ha_device is not None:
            devices_reg.async_update_device(
                ha_device.id,
                area_id=old["area_id"] or ha_device.area_id,
                name_by_user=old["name_by_user"],
                labels=set(old["labels"]),
            )
    for group in memo["groups"]:
        new = arrived["groups"].get((group["kind"], group["name"]))
        if new is not None and new.grouped_light:
            await async_take_over(
                hass, LIGHT_DOMAIN, new.grouped_light, group["entity"]
            )
    for scene in memo["scenes"]:
        new = arrived["scenes"].get((scene["kind"], scene["group"], scene["name"]))
        if new is not None:
            await async_take_over(hass, SCENE_DOMAIN, new.id, scene["entity"])
    if positions:
        await store.async_update(positions)
