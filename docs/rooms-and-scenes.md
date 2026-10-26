# Rooms, zones and scenes: HA-first with the bridge

How Hue Studio keeps Home Assistant and the Hue bridge (and so the Hue app) consistent.
Status: implemented (`alignment.py`, `rooms.py`, the panel's "Rooms and zones" screen);
see `roadmap.md`, section "Rooms and zones", for what is left.

## Two models

| | Home Assistant | Hue bridge |
|---|---|---|
| Room | **Area**: a light belongs to exactly one | **Room**: a light belongs to exactly one |
| Overlapping groups | no nested areas; **labels** (any number per entity) and **floors** (group areas, not lights) | **Zone**: any lights from any rooms, zones may overlap |
| Scenes | HA scenes (`scene` integration): snapshots of any entities, never on the bridge | Hue scenes: belong to one room or zone, stored on the bridge |

An area and a Hue room are the same concept (one place per light). A Hue zone has no
direct HA counterpart.

## What the native `hue` integration already syncs

Checked against the integration source (`homeassistant/components/hue/v2/`):

| Change on the bridge (e.g. in the Hue app) | Reaches HA? |
|---|---|
| Scene added / deleted | yes, at once: the `scene.*` entity appears / is removed |
| Scene renamed, its palette, its active state | yes, at once (and our `hue_studio/scenes/subscribe`) |
| Room or zone added / deleted | yes, at once: its grouped light `light.*` appears / is removed |
| Lights of a room or zone | yes, the `entity_id` attribute of the grouped light |
| **A light moved to another Hue room** | **no: its HA area does not change** |
| **A new Hue room** | partly: only the room's service device gets `suggested_area`, once, when created; lights never get an area from it |

Scenes and groups follow the bridge by themselves; areas do not. A setup where Hue rooms
and HA areas drifted apart (one Hue room spanning several areas) stays that way.

Hue Studio works only with Hue scenes (`scene.*` of platform `hue`). HA's own scenes are
left alone.

## Sources of truth

- **Areas: Home Assistant.** Which light is in which room is decided in HA (or in our
  panel, which writes HA areas). The bridge is aligned to it.
- **Scenes and zones: the bridge.** Hue Studio and the Hue app both write there; HA and
  the panel read them through the native integration. There is no copy, so no drift.

## Several bridges

Each bridge is its own Hue system, as in the Hue app: rooms, zones, scenes, entertainment
areas and accessories never span two bridges. Hue Studio keeps them apart the same way.

- **An area belongs to one bridge.** Its Hue room is on that bridge; the room is synced
  from HA to it, and the sync shows up as the room's entity in the Philips Hue
  integration. An area with lights on two bridges is a mismatch the panel lists (Rooms
  and zones, the room's page), not a supported state. Alignment still works per bridge.
- **Where things are is shown only with several bridges:** a bridge's page lists its
  rooms and links to its devices (Settings → Devices filters by bridge); a room shows its
  bridge next to "Lights"; zones and entertainment areas say whose they are, and a new one
  picks its bridge first (its lights come from that bridge only). Adding devices from a
  room searches on the room's bridge.
- The rooms payload (`hue_studio/rooms/subscribe`) carries `bridges`, `bridge_of` (light,
  room, zone and scene entities) and `split_areas`.
- **Moving between bridges** was built and removed (roadmap K). What was learned on the
  live bridges: a light deleted from one bridge looks for a bridge open to it only as it
  is switched on (a Zigbee device steers into an open network as it starts); a Bridge Pro
  lets in exactly the device whose QR code install code it was given; a serial number
  lets the new bridge reset a light close to it over touchlink; lights without Bluetooth
  were easier (the Hue app seems to add Bluetooth bulbs through the phone).
- **Identity** (`identity.py`, `hue_studio.identity`): Hue Studio remembers every device by its Zigbee MAC (its entities' ids, names, icons, areas,
    labels, enabled/hidden state; the HA device's area, name and labels; its name,
    archetype and light settings on the bridge) and every room, zone and scene by name.
    A device that comes back as new bridge resources in any way (added again with "Add
    devices", migrated by the Hue app, paired anew) takes its entity ids and settings
    back as soon as the old entities are gone; a room or zone of a remembered name and
    its scenes likewise (without it, lights added again by hand keep the native
    integration's new ids, as do the rooms).

## HA -> bridge (Hue Studio)

### Room alignment

For every area with Hue lights the bridge has a Hue room with the area's name and exactly
those lights. Lights without an area keep their Hue room.

- `hue_studio.align_rooms` computes a plan: rooms to create or rename, lights to move,
  rooms left empty, scenes affected. `dry_run: true` only returns the plan.
- The panel shows the plan as a preview ("Align with Home Assistant") and applies it on
  confirmation. Later, optionally, alignment runs automatically when areas change.
- A Hue room left without lights is offered for deletion, never deleted silently: it may
  hold scenes.
- Bridge limits apply: room changes are `room` PUTs, sent sequentially.

How the plan is made (`alignment.py`, pure and unit-tested):

- A Hue room holds **devices**, not lights (CLIP v2): a light moves with its device. A
  device whose lights lie in different areas is a conflict, listed and left alone. Rooms
  keep their other devices (sensors, switches).
- Each area takes one existing room, greedily by how many of its devices the room holds
  already (so most scenes keep their lights), then by equal name; otherwise a room is
  created (archetype guessed from the area icon). An area's room is renamed to the
  area's name.
- Applying: devices leave their rooms first (a device can be in one room only), then new
  rooms are created with their devices and existing ones get theirs.
- With a target (e.g. "Move back in Hue" for one light), only those lights move: no
  renames, no deletions.

### Zones

Created and edited in the panel (pick lights, name), written to the bridge at once
(`hue_studio.create_zone`, `update_zone`, `delete_zone`). Shown in the panel by their
lights:

- all lights in one area: inside that room, with its own scenes (e.g. a TV zone inside
  the living room);
- lights in several areas: on the home screen under "Zones" (e.g. an open-plan living
  room plus kitchen).

With "Zones as labels" on (`zones.py`), each zone is also an HA label `Hue zone: <name>`
on its lights, kept alike both ways: the zone stays on the bridge (the Hue app's truth),
the label follows it, and a change to the label (its name, the Hue lights carrying it, a
new label of that form) is written to the bridge. The side that changed since the last
pass wins, the bridge when both did; a change we sent waits for the bridge to report it
back before the bridge's side counts again. No automatic deletes: a deleted label leaves
its zone unlinked for the panel to delete or label again, a label on no light keeps its
zone. Light groups of HA were the other candidate and were left out: a zone would show up
twice in HA, and a group whose lights are all off at the wall cannot tell its members.

### Scenes

Create, save, delete, shuffle, save from the gallery: done (`create_scene`,
`save_scene`, `delete_scene`, `reset_scene`).

## Bridge -> HA (what the native integration does not do)

- **A light moved in the Hue app** is a mismatch, not silently accepted (that would break
  HA-first). The panel shows it in the room: "In Hue, <light> is in <room>; in Home
  Assistant in <area>", with "Accept in Home Assistant" (change the area) and "Restore in
  Hue" (move it back on the bridge).
- **A light added in the Hue app** has no area. The panel lists it under "No room" with an
  area picker; alignment then puts it into the matching Hue room. (Later: a device setup
  wizard in Hue Studio, see the roadmap.)

## Scenes when lights move

A Hue scene belongs to a room or zone, and its actions name lights. When alignment moves
lights:

- **a light leaves a room**: the bridge drops it from that room's scenes; the preview says
  "scene X loses light Y";
- **a light joins a room**: existing scenes have no action for it; offer "complete
  scenes": scenes with a palette are rebuilt from it (as "Reset scene"), others copy the
  state of a neighbouring light;
- **a room is split** (one Hue room whose lights end up in several rooms): its scenes
  can be kept in a new zone over the same lights, so nothing is lost (below).

### Keeping the scenes of a split room

CLIP v2 scenes cannot change their room or zone, so "moving" them means copies.
With `keep_split_scenes` (`align_rooms`; on the rooms screen "Keep scenes of split
rooms", off by default), before any room changes:

1. A zone is created with all lights the room has before alignment (the room's
   archetype, so the Hue app shows the same icon).
2. Every scene of the room that would lose lights is copied into it: same actions,
   palette, name, picture, speed and auto-play. Scenes that keep all their lights are
   not copied. The originals stay in the room (and lose the lights that leave), so the
   Hue app shows both; delete either side by hand if you don't need it.
3. Then the rooms are aligned as usual. If the zone or a copy cannot be created, the
   call stops before any room is touched; a retry creates another zone.

Which rooms count as split (`Plan.splits`): an existing room whose lights end up in more
than one room after alignment — an area's room, or the room itself for lights that stay
(no area, conflicts). Only full plans have splits; a targeted alignment ("Restore in
Hue") never creates zones. A room that moves whole into another room is not split.

Zone name: the room's own name, unless a room or zone after alignment has it (usually
the area that took the room has the same name). Then the names of the areas its lights
go to (plus the room's own name for lights staying in a room no area takes), in HA's
area order, joined with " + " ("Living room + Kitchen"); longer than Hue's 32
characters, the first area and how many more ("Living room +2"); still taken, a number
is added ("Living room + Kitchen 2"). The name is made only of the user's own names, so
it needs no translation.

## The options mapping (A3) after this

Once rooms are aligned, area and Hue room match by construction. The Hue room/zone ->
area mapping in the options stays for the cases alignment does not cover: a zone a user
wants to treat as an area's command target, or a setup where alignment is off.

## Work

1. ~~Pure comparison module~~ — `alignment.py`, `tests/test_alignment.py`.
2. ~~Services~~ — `align_rooms` (with `dry_run`, a target, `complete_scenes`,
   `delete_empty_rooms`, `keep_split_scenes`), `create_zone`, `update_zone`, `delete_zone`; WebSocket
   `hue_studio/rooms/subscribe` (the plan, pushed on every change) and
   `hue_studio/lights/set_area`.
3. ~~Panel~~ — "Rooms and zones" screen, mismatch notes in rooms, "No room" on the home
   screen and the rooms screen.
4. ~~Option~~ — "Rooms follow areas" (`auto_align`) in the options: HA area changes only;
   empty rooms are never deleted automatically.
5. ~~On a real bridge~~ — done (2026-10-11): dry run, review, apply. The bridge accepted
   the room PUTs in this order (devices leave, rooms are created with them) in one go;
   a second dry run showed nothing left to change.
6. ~~Split rooms~~ — `align_rooms` `keep_split_scenes`: scenes of a split room are copied
   into a new zone over its original lights first (above). Verified on a real bridge
   with the same apply: scene POSTs into the zone created a moment earlier went through.
