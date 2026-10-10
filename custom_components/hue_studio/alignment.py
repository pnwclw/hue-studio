"""Compare HA areas with the Hue rooms of one bridge: the alignment plan.

Pure (no Home Assistant, no aiohue): the caller describes areas, lights, rooms and
scenes as plain data, and gets back what has to change on the bridge so that every area
with Hue lights has a Hue room of its name with exactly those lights.

Rules (see docs/rooms-and-scenes.md):

- A Hue room holds devices, not lights; a light moves with its device. A device whose
  lights lie in different areas is a conflict and stays where it is.
- Lights without an area keep their Hue room.
- Each area gets one existing room or a new one. Areas take rooms greedily by how many
  of their devices a room already has (so most scenes keep their lights), then by equal
  names; a room is used for one area at most.
- A room left without lights and given to no area is offered for deletion only.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Hue limits room and zone names to 32 characters.
NAME_MAX = 32


@dataclass(frozen=True, slots=True)
class Area:
    """An HA area."""

    id: str
    name: str
    icon: str | None = None


@dataclass(frozen=True, slots=True)
class Light:
    """A Hue light: its bridge id, its device and its HA area (None: no area)."""

    id: str
    device: str
    area: str | None


@dataclass(frozen=True, slots=True)
class Room:
    """A Hue room: its devices (with or without lights)."""

    id: str
    name: str
    devices: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Scene:
    """A Hue scene: the room or zone it belongs to and the lights it has actions for."""

    id: str
    group: str
    lights: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RoomTarget:
    """The Hue room of an area after alignment."""

    area: str
    name: str
    # Existing room, or None: a room is created.
    room: str | None
    # Name of the existing room (renamed when it differs from `name`).
    current_name: str | None
    # Devices with lights the room ends up with (sorted).
    devices: tuple[str, ...]
    archetype: str = "other"

    @property
    def create(self) -> bool:
        """Whether the room has to be created."""
        return self.room is None

    @property
    def rename(self) -> bool:
        """Whether the existing room has to be renamed."""
        return self.room is not None and self.current_name != self.name


@dataclass(frozen=True, slots=True)
class Move:
    """A device (with its lights) going to the room of an area."""

    device: str
    lights: tuple[str, ...]
    # Room the device is in now (None: no room).
    source: str | None
    area: str
    # Area whose room the device is in now: set when the light sits in another area's
    # room, e.g. after it was moved in the Hue app.
    source_area: str | None = None


@dataclass(frozen=True, slots=True)
class SceneChange:
    """What a move does to a scene: lights it loses, lights it has no action for."""

    scene: str
    lost: tuple[str, ...] = ()
    missing: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class Plan:
    """Changes that bring a bridge's rooms in line with the HA areas."""

    rooms: tuple[RoomTarget, ...] = ()
    moves: tuple[Move, ...] = ()
    # Rooms left without lights (or without any device) and given to no area: offered
    # for deletion.
    empty: tuple[str, ...] = ()
    scenes: tuple[SceneChange, ...] = ()
    # Devices whose lights lie in different areas (left alone).
    conflicts: tuple[str, ...] = ()
    # The room each device with lights is in now (devices in no room are missing).
    current: dict[str, str] = field(default_factory=dict)

    @property
    def changed(self) -> bool:
        """Whether anything on the bridge would change (deleting rooms aside)."""
        return bool(self.moves) or any(r.create or r.rename for r in self.rooms)


def compute_plan(
    areas: list[Area],
    lights: list[Light],
    rooms: list[Room],
    scenes: list[Scene],
    *,
    only: set[str] | None = None,
) -> Plan:
    """The alignment plan of one bridge.

    `areas` in HA's order (ties go to the earlier area). With `only` (light ids), the
    plan is cut down to moving those lights: rooms are assigned as in the full plan, but
    only rooms needed for those moves are created, nothing is renamed and no room is
    offered for deletion.
    """
    room_of: dict[str, str] = {d: r.id for r in rooms for d in r.devices}
    by_device: dict[str, list[Light]] = {}
    for light in lights:
        by_device.setdefault(light.device, []).append(light)

    # Where each device with lights belongs.
    wanted: dict[str, str] = {}
    conflicts: list[str] = []
    for device, members in by_device.items():
        targets = {light.area for light in members if light.area is not None}
        if len(targets) > 1:
            conflicts.append(device)
        elif targets:
            wanted[device] = targets.pop()

    area_index = {area.id: i for i, area in enumerate(areas)}
    used_areas = [a for a in areas if a.id in set(wanted.values())]
    assigned = _assign_rooms(used_areas, rooms, wanted, room_of, area_index)
    room_area = {room: area for area, room in assigned.items()}
    rooms_by_id = {r.id: r for r in rooms}

    moves = [
        Move(
            device=device,
            lights=tuple(sorted(light.id for light in by_device[device])),
            source=room_of.get(device),
            area=area,
            source_area=room_area.get(room_of.get(device, "")),
        )
        for device, area in sorted(wanted.items())
        if room_of.get(device) is None or room_of[device] != assigned.get(area)
    ]
    if only is not None:
        moves = [m for m in moves if set(m.lights) & only]

    targets: list[RoomTarget] = []
    for area in used_areas:
        room = rooms_by_id.get(assigned.get(area.id, ""))
        if only is not None and not any(m.area == area.id for m in moves):
            continue
        name = area.name.strip()[:NAME_MAX] or area.id[:NAME_MAX]
        if only is not None and room is not None:
            name = room.name
        devices = {d for d, a in wanted.items() if a == area.id}
        if only is not None:
            # Only the moved devices join; the rest of the room stays as it is.
            moved = {m.device for m in moves if m.area == area.id}
            current = {d for d in room.devices if d in by_device} if room else set()
            devices = current | moved
        targets.append(
            RoomTarget(
                area=area.id,
                name=name,
                room=room.id if room else None,
                current_name=room.name if room else None,
                devices=tuple(sorted(devices)),
                archetype=archetype_for(area),
            )
        )

    leaving = {m.device for m in moves}
    empty: list[str] = []
    if only is None:
        for room in rooms:
            if room.id in room_area:
                continue
            had = [d for d in room.devices if d in by_device]
            # Rooms of sensors or switches only are none of our business.
            if (had or not room.devices) and all(d in leaving for d in had):
                empty.append(room.id)

    return Plan(
        rooms=tuple(targets),
        moves=tuple(moves),
        empty=tuple(empty),
        scenes=_scene_changes(moves, assigned, scenes),
        conflicts=tuple(sorted(conflicts)),
        current={d: room_of[d] for d in by_device if d in room_of},
    )


def _assign_rooms(
    areas: list[Area],
    rooms: list[Room],
    wanted: dict[str, str],
    room_of: dict[str, str],
    area_index: dict[str, int],
) -> dict[str, str]:
    """Area id -> existing room id it takes over (areas left out get a new room)."""
    overlap: dict[tuple[str, str], int] = {}
    for device, area in wanted.items():
        if (room := room_of.get(device)) is not None:
            overlap[area, room] = overlap.get((area, room), 0) + 1
    candidates: list[tuple[int, int, int, str, str, str]] = []
    for area in areas:
        for room in rooms:
            count = overlap.get((area.id, room.id), 0)
            same_name = room.name.strip().casefold() == area.name.strip().casefold()
            if count or same_name:
                candidates.append(
                    (
                        -count,
                        -int(same_name),
                        area_index[area.id],
                        room.name.casefold(),
                        area.id,
                        room.id,
                    )
                )
    assigned: dict[str, str] = {}
    taken: set[str] = set()
    for *_, area_id, room_id in sorted(candidates):
        if area_id in assigned or room_id in taken:
            continue
        assigned[area_id] = room_id
        taken.add(room_id)
    return assigned


def _scene_changes(
    moves: list[Move], assigned: dict[str, str], scenes: list[Scene]
) -> tuple[SceneChange, ...]:
    """Scenes that lose lights (their room gives them away) or miss new lights."""
    lost: dict[str, set[str]] = {}
    missing: dict[str, set[str]] = {}
    for move in moves:
        target = assigned.get(move.area)
        for scene in scenes:
            if scene.group == move.source:
                gone = set(move.lights) & set(scene.lights)
                if gone:
                    lost.setdefault(scene.id, set()).update(gone)
            elif target is not None and scene.group == target:
                new = set(move.lights) - set(scene.lights)
                if new:
                    missing.setdefault(scene.id, set()).update(new)
    return tuple(
        SceneChange(
            scene=scene.id,
            lost=tuple(sorted(lost.get(scene.id, ()))),
            missing=tuple(sorted(missing.get(scene.id, ()))),
        )
        for scene in scenes
        if scene.id in lost or scene.id in missing
    )


# Area icons and names -> Hue room archetypes (the icon the Hue app shows).
_ARCHETYPES: tuple[tuple[tuple[str, ...], str], ...] = (
    (("sofa", "living", "lounge"), "living_room"),
    (("stove", "kitchen", "fridge", "silverware"), "kitchen"),
    (("table-furniture", "dining"), "dining"),
    (("bed", "bedroom", "sleep"), "bedroom"),
    (("baby", "nursery"), "nursery"),
    (("shower", "bath"), "bathroom"),
    (("toilet",), "toilet"),
    (("desk", "office", "chair-rolling", "study"), "office"),
    (("dumbbell", "gym"), "gym"),
    (("door", "hall", "corridor"), "hallway"),
    (("garage",), "garage"),
    (("balcony",), "balcony"),
    (("terrace", "patio"), "terrace"),
    (("flower", "tree", "garden", "yard"), "garden"),
    (("stairs", "staircase"), "staircase"),
    (("television", "tv"), "tv"),
    (("wardrobe", "closet", "hanger"), "closet"),
    (("washing", "laundry"), "laundry_room"),
    (("pool",), "pool"),
)


def archetype_for(area: Area) -> str:
    """Hue room archetype for an area, guessed from its icon, then its id."""
    for text in (area.icon or "", area.id):
        lowered = text.lower()
        for words, archetype in _ARCHETYPES:
            if any(word in lowered for word in words):
                return archetype
    return "other"
