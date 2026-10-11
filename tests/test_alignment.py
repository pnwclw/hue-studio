"""Tests for the alignment plan (pure: areas <-> Hue rooms)."""

from custom_components.hue_studio.alignment import (
    Area,
    Light,
    Move,
    Room,
    Scene,
    SceneChange,
    Split,
    archetype_for,
    compute_plan,
)

AREAS = [
    Area("living_room", "Living room", "mdi:sofa"),
    Area("kitchen", "Kitchen", "mdi:stove"),
    Area("bedroom", "Bedroom", None),
]


def _light(name: str, area: str | None) -> Light:
    """Light `l-<name>` on device `d-<name>`."""
    return Light(f"l-{name}", f"d-{name}", area)


def test_one_room_over_three_areas() -> None:
    """The area with most of the room's lights keeps it; the others get new rooms."""
    lights = [
        _light("strip", "living_room"),
        _light("play", "living_room"),
        _light("bulb", "kitchen"),
        _light("garland", "bedroom"),
    ]
    rooms = [
        Room("r-down", "Living room", ("d-strip", "d-play", "d-bulb", "d-garland"))
    ]
    scenes = [Scene("s-relax", "r-down", ("l-strip", "l-bulb", "l-garland"))]
    plan = compute_plan(AREAS, lights, rooms, scenes)

    by_area = {r.area: r for r in plan.rooms}
    assert by_area["living_room"].room == "r-down"
    assert not by_area["living_room"].rename
    assert by_area["living_room"].devices == ("d-play", "d-strip")
    assert by_area["kitchen"].create
    assert by_area["kitchen"].archetype == "kitchen"
    assert by_area["bedroom"].create
    assert by_area["bedroom"].archetype == "bedroom"
    assert plan.moves == (
        Move("d-bulb", ("l-bulb",), "r-down", "kitchen", "living_room"),
        Move("d-garland", ("l-garland",), "r-down", "bedroom", "living_room"),
    )
    assert plan.scenes == (SceneChange("s-relax", lost=("l-bulb", "l-garland")),)
    assert plan.empty == ()
    assert plan.changed
    # "Living room" stays with the room: the zone is named after the areas.
    assert plan.splits == (
        Split(
            "r-down",
            "Living room + Kitchen + Bedroom",
            ("l-bulb", "l-garland", "l-play", "l-strip"),
            ("s-relax",),
        ),
    )


def test_aligned_setup_changes_nothing() -> None:
    """Rooms with the area names and exactly their lights: an empty plan."""
    lights = [_light("strip", "living_room"), _light("bulb", "kitchen")]
    rooms = [
        Room("r-living", "Living room", ("d-strip", "d-sensor")),
        Room("r-kitchen", "Kitchen", ("d-bulb",)),
    ]
    plan = compute_plan(AREAS, lights, rooms, [])
    assert not plan.changed
    assert plan.moves == ()

    # Names compare case-insensitively for matching, but the area's spelling wins.
    rooms[1] = Room("r-kitchen", "kitchen ", ("d-bulb",))
    kitchen = next(
        r for r in compute_plan(AREAS, lights, rooms, []).rooms if r.area == "kitchen"
    )
    assert (kitchen.room, kitchen.name, kitchen.rename) == (
        "r-kitchen",
        "Kitchen",
        True,
    )


def test_rename_room_with_the_area_lights() -> None:
    """A room holding exactly an area's lights under another name is renamed."""
    plan = compute_plan(
        AREAS, [_light("bulb", "kitchen")], [Room("r-1", "Cooking", ("d-bulb",))], []
    )
    (target,) = plan.rooms
    assert (target.room, target.current_name, target.name) == (
        "r-1",
        "Cooking",
        "Kitchen",
    )
    assert target.rename
    assert plan.moves == ()
    assert plan.changed


def test_empty_room_with_the_area_name_is_reused() -> None:
    """Without overlap, a room of the same name is taken instead of creating one."""
    lights = [_light("strip", "living_room"), _light("bulb", "kitchen")]
    rooms = [
        Room("r-living", "Living room", ("d-strip", "d-bulb")),
        Room("r-kitchen", "Kitchen", ()),
    ]
    scenes = [Scene("s-cook", "r-kitchen", ())]
    plan = compute_plan(AREAS, lights, rooms, scenes)
    kitchen = next(r for r in plan.rooms if r.area == "kitchen")
    assert kitchen.room == "r-kitchen"
    assert not kitchen.create
    assert plan.moves == (
        Move("d-bulb", ("l-bulb",), "r-living", "kitchen", "living_room"),
    )
    # The kitchen's scene has no action for the bulb yet.
    assert plan.scenes == (SceneChange("s-cook", missing=("l-bulb",)),)


def test_overlap_beats_names() -> None:
    """A room keeps most of its lights even if another area has its name."""
    lights = [
        _light("a", "living_room"),
        _light("b", "living_room"),
        _light("c", "kitchen"),
    ]
    rooms = [Room("r-1", "Kitchen", ("d-a", "d-b", "d-c"))]
    plan = compute_plan(AREAS, lights, rooms, [])
    by_area = {r.area: r for r in plan.rooms}
    assert by_area["living_room"].room == "r-1"
    assert by_area["living_room"].rename
    assert by_area["kitchen"].create


def test_lights_without_area_and_conflicts_stay() -> None:
    """Lights without area keep their room; a device spanning two areas stays."""
    lights = [
        _light("strip", "living_room"),
        _light("loose", None),
        Light("l-left", "d-pair", "living_room"),
        Light("l-right", "d-pair", "kitchen"),
    ]
    rooms = [Room("r-other", "Other", ("d-loose", "d-pair"))]
    plan = compute_plan(AREAS, lights, rooms, [])
    assert plan.conflicts == ("d-pair",)
    assert [m.device for m in plan.moves] == ["d-strip"]
    assert plan.moves[0].source is None
    # The kitchen's only light is in conflict: no room for it.
    assert [r.area for r in plan.rooms] == ["living_room"]
    assert plan.empty == ()


def test_rooms_left_without_lights() -> None:
    """Rooms losing all their lights (or holding nothing) are offered for deletion.

    A room of sensors only is left alone.
    """
    lights = [_light("strip", "living_room")]
    rooms = [
        Room("r-old", "Old", ("d-strip", "d-sensor")),
        Room("r-kitchen", "Kitchen", ("d-lamp",)),
        Room("r-blank", "Blank", ()),
        Room("r-sensors", "Hallway", ("d-motion",)),
    ]
    lights.append(_light("lamp", "living_room"))
    plan = compute_plan(AREAS, lights, rooms, [])
    # Both rooms hold one of its lights: the tie goes by room name, "Old" empties.
    living = next(r for r in plan.rooms if r.area == "living_room")
    assert living.room == "r-kitchen"
    assert plan.empty == ("r-old", "r-blank")


def test_only_some_lights() -> None:
    """Restricted to one light: its move only, nothing renamed or deleted."""
    lights = [
        _light("strip", "living_room"),
        _light("bulb", "kitchen"),
        _light("garland", "bedroom"),
    ]
    rooms = [
        Room("r-living", "Lounge", ("d-strip", "d-garland")),
        Room("r-kitchen", "Kitchen", ()),
    ]
    plan = compute_plan(AREAS, lights, rooms, [], only={"l-garland"})
    assert [m.device for m in plan.moves] == ["d-garland"]
    (target,) = plan.rooms
    assert target.area == "bedroom"
    assert target.create
    assert plan.empty == ()

    plan = compute_plan(AREAS, lights, rooms, [], only={"l-bulb"})
    (target,) = plan.rooms
    assert (target.room, target.devices) == ("r-kitchen", ("d-bulb",))
    assert not target.rename


def test_split_room_keeps_its_name_in_a_zone() -> None:
    """A split room renamed after its area leaves its name to the zone.

    Only scenes that lose lights are copied; a room moving whole is not split.
    """
    lights = [
        _light("strip", "living_room"),
        _light("play", "living_room"),
        _light("bulb", "kitchen"),
        _light("lamp", "bedroom"),
    ]
    rooms = [
        Room("r-down", "Downstairs", ("d-strip", "d-play", "d-bulb", "d-sensor")),
        Room("r-up", "Upstairs", ("d-lamp",)),
    ]
    scenes = [
        Scene("s-tv", "r-down", ("l-strip", "l-play")),
        Scene("s-all", "r-down", ("l-strip", "l-bulb")),
        Scene("s-up", "r-up", ("l-lamp",)),
    ]
    plan = compute_plan(AREAS, lights, rooms, scenes)
    assert plan.splits == (
        Split("r-down", "Downstairs", ("l-bulb", "l-play", "l-strip"), ("s-all",)),
    )

    # A zone has that name already: the areas' names, numbered when taken too.
    plan = compute_plan(
        AREAS,
        lights,
        rooms,
        scenes,
        zone_names=["downstairs", "Living room + Kitchen"],
    )
    assert plan.splits[0].name == "Living room + Kitchen 2"


def test_split_zone_names() -> None:
    """Too long for Hue: the first area and how many more; a room no area takes."""
    areas = [
        Area("a", "A rather long first area name"),
        Area("b", "Second"),
        Area("c", "Third"),
    ]
    lights = [_light("x", "a"), _light("y", "b"), _light("z", "c")]
    rooms = [Room("r", "A rather long first area name", ("d-x", "d-y", "d-z"))]
    (split,) = compute_plan(areas, lights, rooms, []).splits
    assert split.name == "A rather long first area name +2"
    assert len(split.name) <= 32
    assert split.scenes == ()

    # Lights without area stay in a room no area takes (it keeps its name).
    lights = [
        _light("loose", None),
        _light("bulb", "kitchen"),
        _light("lamp", "kitchen"),
        _light("pan", "kitchen"),
    ]
    rooms = [
        Room("r-kitchen", "Kitchen", ("d-lamp", "d-pan")),
        Room("r-old", "Old", ("d-loose", "d-bulb")),
    ]
    (split,) = compute_plan(AREAS, lights, rooms, []).splits
    assert (split.room, split.name) == ("r-old", "Kitchen + Old")


def test_no_splits_for_targeted_moves() -> None:
    """With `only` (e.g. "Restore in Hue"), no room is reported as split."""
    lights = [_light("strip", "living_room"), _light("bulb", "kitchen")]
    rooms = [Room("r-living", "Living room", ("d-strip", "d-bulb"))]
    assert compute_plan(AREAS, lights, rooms, []).splits
    assert compute_plan(AREAS, lights, rooms, [], only={"l-bulb"}).splits == ()


def test_current_rooms_and_long_names() -> None:
    """The plan knows each device's room; names are cut to Hue's 32 characters."""
    area = Area("big", "A very long area name that Hue cannot store")
    plan = compute_plan([area], [_light("x", "big")], [Room("r", "R", ("d-x",))], [])
    assert plan.current == {"d-x": "r"}
    assert len(plan.rooms[0].name) == 32


def test_archetypes() -> None:
    """Archetypes come from the icon, then the area id."""
    assert archetype_for(Area("a", "A", "mdi:bed-king")) == "bedroom"
    assert archetype_for(Area("office", "Study")) == "office"
    assert archetype_for(Area("x", "X", "mdi:star")) == "other"
