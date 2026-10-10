# Rooms, zones and scenes: HA-first with the bridge

How Hue Studio keeps Home Assistant and the Hue bridge (and so the Hue app) consistent.
Status: design, not implemented yet (see `roadmap.md`, section "Rooms and zones").

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

### Zones

Created and edited in the panel (pick lights, name), written to the bridge at once
(`hue_studio.create_zone`, `update_zone`, `delete_zone`). Shown in the panel by their
lights:

- all lights in one area: inside that room, with its own scenes (e.g. a TV zone inside
  the living room);
- lights in several areas: on the home screen under "Zones" (e.g. an open-plan living
  room plus kitchen).

HA labels are not used for zones for now; "zone = HA label" may come later as an option
for automations by zone.

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
- **a room is split** (one Hue room covering several areas): its scenes can be moved to a
  new zone over the same lights, so nothing is lost.

## The options mapping (A3) after this

Once rooms are aligned, area and Hue room match by construction. The Hue room/zone ->
area mapping in the options stays for the cases alignment does not cover: a zone a user
wants to treat as an area's command target, or a setup where alignment is off.

## Work

1. Pure comparison module: areas <-> Hue rooms -> plan (rooms to create/rename, moves,
   empty rooms, affected scenes). Unit tests.
2. Services: `align_rooms` (with `dry_run`), `create_zone` (done), `update_zone`,
   `delete_zone`; scene completion after moves.
3. Panel: "Rooms and zones" screen (alignment preview and apply, zone editor), mismatch
   notes in rooms, "No room" section.
4. Option: align automatically when areas change.
5. On a real bridge: dry run first, apply only after review.
