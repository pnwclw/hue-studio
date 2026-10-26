"""Hue zones mirrored as Home Assistant labels, both ways ("Zones as labels").

The zone lives on the bridge, so the Hue app always shows it right; Hue Studio keeps a
label "Hue zone: <name>" on its lights. Whichever side changes is followed: a zone made,
renamed or given other lights in the Hue app (or the panel) changes the label; the label
renamed or put on other Hue lights in HA changes the zone on the bridge; a new label of
that form on Hue lights makes a zone. When both changed since the last pass, the bridge
wins.

Nothing is ever deleted behind the user's back: a zone whose label the user deleted is
left on the bridge, unlinked, for the panel to offer deleting it (its scenes go with it)
or mirroring it again; a label left without Hue lights keeps its zone as it is. Lights
that cannot join a zone (not Hue lights, or on another bridge) keep the label and are
reported. A zone deleted on the bridge takes its label with it (ours).

What the bridge cannot hold (which label belongs to which zone, and what both sides
looked like at the last pass) is in a Store. Only labels on entities count, not on
devices.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
import logging
import time
from typing import Any

from aiohttp import ClientError
from aiohue import HueBridgeV2
from aiohue.errors import AiohueException
from aiohue.v2.models.resource import ResourceTypes
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er, label_registry as lr
from homeassistant.helpers.debounce import Debouncer
from homeassistant.helpers.dispatcher import (
    async_dispatcher_connect,
    async_dispatcher_send,
)
from homeassistant.helpers.storage import Store

from ..bridges.info import bridge_name
from ..const import CONF_ZONE_LABELS, DOMAIN, HUE_DOMAIN, SIGNAL_CONFIG_UPDATED
from ..core.entities import async_wait_entity
from ..core.options import async_options
from ..lights.bridge import LIGHT_DOMAIN, async_bridges
from .areas import ZONE_PATH, async_track_rooms

_LOGGER = logging.getLogger(__name__)

STORAGE_KEY = f"{DOMAIN}.zones"
STORAGE_VERSION = 1
LABEL_PREFIX = "Hue zone: "
LABEL_ICON = "mdi:texture-box"
COOLDOWN = 1.0
# How long a change we sent waits for the bridge to report it back.
PENDING_SECONDS = 15.0
ZONE_ENTITY_TIMEOUT = 10.0
SIGNAL_ZONES_UPDATED = "hue_studio_zones_updated"


@callback
def async_enabled(hass: HomeAssistant) -> bool:
    """Whether "Zones as labels" is on (off by default)."""
    return bool(async_options(hass).get(CONF_ZONE_LABELS, False))


def zone_name(label_name: str) -> str:
    """The zone a label stands for: its name without the prefix."""
    if label_name.casefold().startswith(LABEL_PREFIX.casefold()):
        return label_name[len(LABEL_PREFIX) :].strip()
    return label_name.strip()


@dataclass(frozen=True)
class Side:
    """One side of a zone at a pass: its name (the label's own name for the label)
    and its lights (entity ids)."""

    name: str
    lights: frozenset[str]


@dataclass(frozen=True)
class Synced:
    """Both sides at the last pass: the zone's name, the label's name, the lights."""

    name: str
    label: str
    lights: frozenset[str]


@dataclass
class Decision:
    """What one pass does with a zone and its label."""

    name: str | None = None  # the zone's name both get
    name_to_bridge: bool = False
    lights: frozenset[str] | None = None  # the lights both get
    lights_to_bridge: bool = False


def decide(synced: Synced, bridge: Side, label: Side) -> Decision:
    """Follow the side that changed since the last pass; the bridge wins a tie.

    A label without lights never empties the zone (the label is followed back instead).
    """
    decision = Decision()
    if bridge.name != synced.name:
        decision.name = bridge.name
    elif (
        label.name != synced.label
        and (new := zone_name(label.name))
        and new != bridge.name
    ):
        decision.name, decision.name_to_bridge = new, True
    if bridge.lights != synced.lights:
        decision.lights = bridge.lights
    elif label.lights != synced.lights:
        if label.lights:
            decision.lights, decision.lights_to_bridge = label.lights, True
        else:
            decision.lights = bridge.lights
    return decision


@dataclass
class _Pending:
    """A change we sent to the bridge, until it reports it back (or time runs out)."""

    side: Side
    until: float = field(default_factory=lambda: time.monotonic() + PENDING_SECONDS)


class ZoneMirror:
    """Keeps every zone of the connected bridges and its label alike."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize (call `async_load` before use)."""
        self.hass = hass
        self.store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        # Zone id -> {"bridge", "label" (None: unlinked by the user), "name",
        # "label_name", "lights" (None: the label's win at the next pass)}.
        self.zones: dict[str, dict[str, Any]] = {}
        self.pending: dict[str, _Pending] = {}
        # What the panel shows: zones left unlinked, lights that cannot join.
        self.notes: list[dict[str, Any]] = []
        self._debouncer: Debouncer[Any] = Debouncer(
            hass, _LOGGER, cooldown=COOLDOWN, immediate=False, function=self.async_pass
        )

    async def async_load(self) -> None:
        """Read the pairs."""
        data = await self.store.async_load() or {}
        self.zones = data.get("zones", {})

    def _save(self) -> None:
        self.store.async_delay_save(lambda: {"zones": self.zones}, 5)

    @callback
    def async_schedule(self, *_: Any) -> None:
        """Pass again soon (changes come in bursts)."""
        self._debouncer.async_schedule_call()

    @callback
    def async_cancel(self) -> None:
        """Stop pending work."""
        self._debouncer.async_cancel()

    @callback
    def async_relink(self, zone_id: str) -> None:
        """Mirror an unlinked zone again (it gets a label at the next pass)."""
        if (known := self.zones.get(zone_id)) is not None and known["label"] is None:
            del self.zones[zone_id]
            self._save()
            self.async_schedule()

    async def async_pass(self) -> None:
        """Follow every change since the last pass, one zone at a time."""
        if not async_enabled(self.hass):
            if self.notes:
                self.notes = []
                async_dispatcher_send(self.hass, SIGNAL_ZONES_UPDATED)
            return
        hass = self.hass
        entities = er.async_get(hass)
        labels = lr.async_get(hass)
        notes: list[dict[str, Any]] = []
        bridges = async_bridges(hass)
        connected = {b.config.bridge_id for b in bridges.values()}
        hue_lights = _hue_lights(entities, bridges)
        by_label = _entities_by_label(entities)
        paired = {z["label"] for z in self.zones.values() if z["label"]}

        for entry_id, bridge in bridges.items():
            ours = hue_lights.get(entry_id, {})
            for zone in list(bridge.groups.zone):
                await self._async_zone(
                    entry_id, bridge, zone, ours, labels, entities, by_label, notes
                )
                if (label_id := self.zones.get(zone.id, {}).get("label")) is not None:
                    paired.add(label_id)

        # Zones gone from a connected bridge: their labels go (ours).
        now = time.monotonic()
        for zone_id, known in list(self.zones.items()):
            if (
                pending := self.pending.get(zone_id)
            ) is not None and now <= pending.until:
                continue
            if known["bridge"] not in connected or any(
                bridge.groups.zone.get(zone_id) is not None
                for bridge in bridges.values()
            ):
                continue
            del self.zones[zone_id]
            self.pending.pop(zone_id, None)
            if known["label"] and labels.async_get_label(known["label"]):
                labels.async_delete(known["label"])

        # New labels of the form "Hue zone: <name>" on Hue lights make zones.
        for label in list(labels.async_list_labels()):
            if label.label_id in paired or not label.name.casefold().startswith(
                LABEL_PREFIX.casefold()
            ):
                continue
            await self._async_new_zone(label, bridges, hue_lights, by_label, notes)

        self._save()
        if notes != self.notes:
            self.notes = notes
            async_dispatcher_send(hass, SIGNAL_ZONES_UPDATED)

    async def _async_zone(
        self,
        entry_id: str,
        bridge: HueBridgeV2,
        zone: Any,
        ours: dict[str, str],
        labels: lr.LabelRegistry,
        entities: er.EntityRegistry,
        by_label: dict[str, set[str]],
        notes: list[dict[str, Any]],
    ) -> None:
        """One zone: pair it with a label, then follow whichever side changed."""
        bridge_side = Side(
            zone.metadata.name,
            frozenset(
                eid
                for light in bridge.groups.zone.get_lights(zone.id)
                if (eid := ours.get(light.id))
            ),
        )
        known = self.zones.get(zone.id)
        label = (
            labels.async_get_label(known["label"]) if known and known["label"] else None
        )
        if known is not None and label is None:
            # The user deleted the label: the zone stays on the bridge, unlinked.
            known["label"] = None
            self.pending.pop(zone.id, None)
            notes.append(
                {
                    "kind": "unlinked",
                    "zone": zone.id,
                    "name": bridge_side.name,
                    "entity_id": _zone_entity(entities, zone),
                }
            )
            return
        if known is None or label is None:
            label = self._label_for(labels, bridge_side.name, bridge, entry_id)
            known = self.zones[zone.id] = {
                "bridge": bridge.config.bridge_id,
                "label": label.label_id,
                "name": bridge_side.name,
                "label_name": label.name,
                "lights": [],
            }
            # Never synced: the bridge's lights win over a label adopted by its name.
            synced = Synced(bridge_side.name, label.name, frozenset({"\0"}))
        else:
            # Linked again by a label of its name: that label's lights win.
            lights = (
                bridge_side.lights
                if known["lights"] is None
                else frozenset(known["lights"])
            )
            synced = Synced(known["name"], known["label_name"], lights)

        carrying = by_label.get(label.label_id, set())
        label_side = Side(label.name, frozenset(carrying & set(ours.values())))
        if foreign := sorted(carrying - label_side.lights):
            notes.append(
                {
                    "kind": "foreign",
                    "zone": zone.id,
                    "name": bridge_side.name,
                    "entity_id": _zone_entity(entities, zone),
                    "lights": foreign,
                }
            )

        # A change we sent and the bridge has not reported back yet is not the bridge's.
        if (pending := self.pending.get(zone.id)) is not None:
            if pending.side == bridge_side or time.monotonic() > pending.until:
                del self.pending[zone.id]
            else:
                bridge_side = Side(synced.name, synced.lights)

        decision = decide(synced, bridge_side, label_side)
        name = decision.name or synced.name
        lights = decision.lights if decision.lights is not None else synced.lights
        name_to_label = decision.name is not None and not decision.name_to_bridge
        lights_to_label = decision.lights is not None and not decision.lights_to_bridge
        body: dict[str, Any] = {}
        if decision.name_to_bridge:
            body["metadata"] = {"name": name}
        if decision.lights_to_bridge:
            rids = {eid: rid for rid, eid in ours.items()}
            body["children"] = [
                {"rid": rids[eid], "rtype": "light"} for eid in sorted(lights)
            ]
        if body:
            try:
                await bridge.request("put", f"{ZONE_PATH}/{zone.id}", json=body)
            except (AiohueException, ClientError, TimeoutError) as err:
                # Not taken: the label follows the bridge again.
                _LOGGER.warning("Could not change zone %s: %s", zone.id, err)
                name, lights = bridge_side.name, bridge_side.lights
                name_to_label = lights_to_label = True
            else:
                self.pending[zone.id] = _Pending(Side(name, lights))
        if name_to_label:
            self._rename_label(labels, label, name)
        if lights_to_label:
            _set_label(entities, label.label_id, lights, set(label_side.lights))
        current = labels.async_get_label(label.label_id)
        known.update(
            name=name,
            label_name=current.name if current else label.name,
            lights=sorted(lights),
        )

    def _label_for(
        self, labels: lr.LabelRegistry, name: str, bridge: HueBridgeV2, entry_id: str
    ) -> lr.LabelEntry:
        """A newly paired zone's label: one of its name nobody has, else a new one."""
        paired = {z["label"] for z in self.zones.values() if z["label"]}
        for wanted in (
            f"{LABEL_PREFIX}{name}",
            f"{LABEL_PREFIX}{name} ({bridge_name(self.hass, entry_id, bridge)})",
        ):
            existing = labels.async_get_label_by_name(wanted)
            if existing is None:
                return labels.async_create(wanted, icon=LABEL_ICON)
            if existing.label_id not in paired:
                return existing
        return labels.async_create(
            f"{LABEL_PREFIX}{name} ({bridge.config.bridge_id})", icon=LABEL_ICON
        )

    def _rename_label(
        self, labels: lr.LabelRegistry, label: lr.LabelEntry, name: str
    ) -> None:
        if zone_name(label.name) == name:
            return
        try:
            labels.async_update(label.label_id, name=f"{LABEL_PREFIX}{name}")
        except ValueError:
            _LOGGER.warning("A label named %s%s exists already", LABEL_PREFIX, name)

    async def _async_new_zone(
        self,
        label: lr.LabelEntry,
        bridges: dict[str, HueBridgeV2],
        hue_lights: dict[str, dict[str, str]],
        by_label: dict[str, set[str]],
        notes: list[dict[str, Any]],
    ) -> None:
        """A zone on the bridge holding most of the label's Hue lights."""
        carrying = by_label.get(label.label_id, set())
        name = zone_name(label.name)
        for known in self.zones.values():
            if known["label"] is None and known["name"].casefold() == name.casefold():
                # An unlinked zone of that name: linked again, the label's lights win.
                known.update(label=label.label_id, label_name=label.name, lights=None)
                self.async_schedule()
                return
        counts = {
            entry_id: [rid for rid, eid in lights.items() if eid in carrying]
            for entry_id, lights in hue_lights.items()
        }
        entry_id = max(counts, key=lambda e: len(counts[e]), default=None)
        if entry_id is None or not counts[entry_id] or not name:
            return
        bridge = bridges[entry_id]
        members = {hue_lights[entry_id][rid] for rid in counts[entry_id]}
        body = {
            "type": "zone",
            "metadata": {"name": name, "archetype": "other"},
            "children": [{"rid": rid, "rtype": "light"} for rid in counts[entry_id]],
        }
        try:
            created = await bridge.request("post", ZONE_PATH, json=body)
        except (AiohueException, ClientError, TimeoutError) as err:
            _LOGGER.warning("Could not make zone %s: %s", name, err)
            return
        if not created:
            return
        zone_id = created[0]["rid"]
        side = Side(name, frozenset(members))
        self.zones[zone_id] = {
            "bridge": bridge.config.bridge_id,
            "label": label.label_id,
            "name": name,
            "label_name": label.name,
            "lights": sorted(members),
        }
        self.pending[zone_id] = _Pending(side)
        if foreign := sorted(carrying - members):
            notes.append(
                {
                    "kind": "foreign",
                    "zone": zone_id,
                    "name": name,
                    "entity_id": None,
                    "lights": foreign,
                }
            )


def _hue_lights(
    entities: er.EntityRegistry, bridges: dict[str, HueBridgeV2]
) -> dict[str, dict[str, str]]:
    """Per bridge (its `hue` entry id): light resource id -> entity id."""
    found: dict[str, dict[str, str]] = {entry_id: {} for entry_id in bridges}
    for entry in entities.entities.values():
        if (
            entry.domain == LIGHT_DOMAIN
            and entry.platform == HUE_DOMAIN
            and (bridge := bridges.get(entry.config_entry_id or "")) is not None
            and bridge.lights.get(entry.unique_id) is not None
        ):
            found[entry.config_entry_id or ""][entry.unique_id] = entry.entity_id
    return found


def _entities_by_label(entities: er.EntityRegistry) -> dict[str, set[str]]:
    found: dict[str, set[str]] = {}
    for entry in entities.entities.values():
        for label_id in entry.labels:
            found.setdefault(label_id, set()).add(entry.entity_id)
    return found


def _zone_entity(entities: er.EntityRegistry, zone: Any) -> str | None:
    grouped = next(
        (s.rid for s in zone.services if s.rtype == ResourceTypes.GROUPED_LIGHT), None
    )
    return (
        entities.async_get_entity_id(LIGHT_DOMAIN, HUE_DOMAIN, grouped)
        if grouped
        else None
    )


def _set_label(
    entities: er.EntityRegistry,
    label_id: str,
    lights: frozenset[str],
    carrying: set[str],
) -> None:
    """The label on exactly these Hue lights (of those that carry it now)."""
    for entity_id in lights - carrying:
        if (entry := entities.async_get(entity_id)) is not None:
            entities.async_update_entity(entity_id, labels={*entry.labels, label_id})
    for entity_id in carrying - lights:
        if (entry := entities.async_get(entity_id)) is not None:
            entities.async_update_entity(entity_id, labels=entry.labels - {label_id})


async def async_wait_zone_entity(
    hass: HomeAssistant,
    bridge: HueBridgeV2,
    zone_id: str,
    wait: float | None = None,
) -> str | None:
    """The grouped light entity of a zone just made, once `hue` has added it."""
    entities = er.async_get(hass)

    def find() -> str | None:
        zone = bridge.groups.zone.get(zone_id)
        return _zone_entity(entities, zone) if zone is not None else None

    return await async_wait_entity(hass, find, wait or ZONE_ENTITY_TIMEOUT)


async def async_track_zones(
    hass: HomeAssistant,
) -> tuple[ZoneMirror, Callable[[], None]]:
    """Mirror zones now and whenever zones, labels, labelled lights or the option
    change."""
    mirror = ZoneMirror(hass)
    await mirror.async_load()

    @callback
    def entity_changed(event: Event[er.EventEntityRegistryUpdatedData]) -> None:
        data = event.data
        if data["action"] != "update" or "labels" in data.get("changes", {}):
            mirror.async_schedule()

    stops = [
        async_track_rooms(hass, mirror.async_schedule),
        hass.bus.async_listen(lr.EVENT_LABEL_REGISTRY_UPDATED, mirror.async_schedule),
        hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, entity_changed),
        async_dispatcher_connect(hass, SIGNAL_CONFIG_UPDATED, mirror.async_schedule),
    ]
    mirror.async_schedule()

    @callback
    def stop() -> None:
        for unsub in stops:
            unsub()
        mirror.async_cancel()

    return mirror, stop
