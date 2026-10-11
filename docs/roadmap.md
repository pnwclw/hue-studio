# Roadmap

What Hue Studio still needs, measured against the current Philips Hue app (5.6x–5.7x,
2026) and the phases in `CLAUDE.md`. We copy the Hue app's **light-control screens**;
automations, schedules and assistants stay with Home Assistant, which is where Hue Studio
adds value.

## The Hue app today (reference)

**Light control**

- Home: rooms and zones as cards tinted by the active scene, toggle and brightness on the
  card; a "Bridge" group (5.69).
- Room view: scenes, lights and, recently, switches, sensors, cameras, MotionAware areas and
  an "Automations" section for that room.
- Color wheel with light dots; white mode (color temperature scale).
- Scene Gallery by category; **Shuffle colors** for saved scenes (5.64); **edit a scene
  while previewing it** from the gallery (5.67).
- Effects (candle, fire, sparkle, glisten, opal, prism, underwater, cosmos, sunbeam,
  enchant) with color presets and speed.
- Gradients and gradient modes.
- **Natural Light**: a scene that follows five periods of the day plus night behaviour.

**Space**

- **SpatialAware** (5.66, Bridge Pro only): the room is scanned with the phone camera and
  scene colors are distributed by light position (e.g. a sunset brighter on one side).
  About half of the gallery supports it; classic/spatial toggle. No public CLIP v2 API for
  it is documented as of 2026-10.
- Entertainment areas with manually placed lights (x, y, z in -1..1, up to 10 lights).

**Out of scope for us** (Home Assistant's job or hardware-bound): MotionAware, automations /
lighting schedules, the AI assistant, Sports Live, doorbell, bridge backup. Sync is in
scope for the Hue Play HDMI Sync Box (done); TV and PC sync apps stay outside.

## Already in Hue Studio

- Panel: home, room, color wheel, gallery, effects (categories and 1–12 speed as in the Hue
  app), scene editor.
- Services: `apply_palette`, `set_gradient`, `set_effect`, `create_scene`,
  `delete_scene`, `create_zone`, `update_zone`, `delete_zone`, `align_rooms`,
  `save_scene`, `reset_scene`, `recall_scene`.
- WebSocket: `hue_studio/config/subscribe`, `hue_studio/lights/subscribe`,
  `hue_studio/scenes/subscribe`, `hue_studio/rooms/subscribe`,
  `hue_studio/lights/set_area`.
- Rooms follow HA areas: alignment plan, "Rooms and zones" screen, zone editor,
  mismatch notes, "No room", optional automatic alignment.
- More-info override with fallback, Adaptive Lighting marking, room/zone mapping options.
- Hue Play HDMI Sync Box: own pairing and entities (compatible with the HACS Sync Box
  integration), `set_sync`, `hue_studio/sync/subscribe`, a Sync tab, a Sync card in
  rooms, scenes locked while syncing; services skip lights that are streaming.
- Sync Box modes: direct pairing (recommended, all features) or compatibility mode
  through the HACS `huesyncbox` integration (`kind: sync_box_link`: its entities and
  `set_sync_state` service, same panel and `set_sync`); boxes it already has are
  offered as a link, never paired twice.

## To do

### A. Finish phase 1 (backend port) — highest priority

1. ~~Storage~~ — decided, scenes done: room palettes are bridge scenes (CLIP v2 `palette` +
   `metadata.image`), visible and editable in the Hue app; the rest (auto light, later
   positions) in `helpers.storage.Store`, read/written via WS API and services only; no
   YAML. Done: `create_scene` (from a gallery scene, points, a white or the lights'
   current state; `public_image` from the gallery when it has one) and `delete_scene`.
   The Store comes with its first data (A4, D). Still to do, in the panel (B1): saving
   in an area without a Hue room/zone offers to assign one or create a zone on the
   bridge.
2. ~~Gallery picture ids~~ — done: `public_image` UUIDs (Hue app picture ids, read off a
   bridge, `scripts/hue_public_images.json`) in the gallery data; the panel matches
   bridge scenes to pictures by it, falling back to the name; scenes created from the
   gallery get it as `metadata.image`. 27 of 142 known so far; add more as bridges show
   them. Still to verify on the live bridge: that it accepts `metadata.image` on create.
3. ~~Options: room mapping on one screen~~ — done, like HA's own vacuum segment -> area
   mapping: one row per Hue room/zone with an area picker, prefilled with the automatic
   match (same lights); an empty row is a zone; only deviations from the automatic
   match are stored. Creating a zone on the bridge for an area without a Hue group
   belongs to the panel (A1/B1). Still to do: screenshots on a live HA.
4. ~~Auto light settings in the Store~~ — done: `auto_light.py` (`.storage/
   hue_studio.auto_light`, per area id), services `auto_light_pool`, `auto_light_exclude`,
   `auto_light_offset`, `import_legacy`, WS `hue_studio/auto_light/subscribe`.
5. ~~Palette references~~ — done: `apply_palette` takes `palette` (`gallery:<id>`,
   `b64:<json>`, a gallery id), `transition` and gradient `mode`, and area targets use
   their Hue lights only. Importing bridge scenes as palettes is obsolete: palettes are
   bridge scenes now.
6. ~~Honour `sync`~~ — done without configuration: lights streaming from an
   entertainment area are known from the bridge. The legacy `sync` room key can go.
7. ~~Switch the legacy setup over to Hue Studio~~ — done on the live system: its apply
   and config scripts call Hue Studio services, auto light data is in the Store, the
   legacy shell command and script are gone. One temporary shim stays outside the
   repository (the legacy template sensors read pools through a command-line sensor fed
   from the Store) until auto light runs in Hue Studio (D).

### B. Catch up with the Hue app in the panel

1. ~~Palettes~~ — done as room scenes on the bridge: "New scene" in a room (what the
   lights show now), "Save as scene" in the gallery sheet (with the picture), "Delete
   scene" in the scene editor; a room without a Hue room/zone is offered a new zone
   (`create_zone`) or the settings.
2. ~~Shuffle colors~~ — done: on the active scene tile (palette spread anew and kept,
   like the Hue app) and live in the scene editor.
3. ~~White mode on the wheel~~ — verified for single lights and groups (merged pin);
   white pins keep where they were dropped sideways (only their height matters).
4. ~~Gradient mode picker~~ — done: smooth / mirrored / scattered / segments on the
   wheel for the selected gradient light (or all of them), only modes every target
   supports.
5. ~~Natural Light~~ — done as an auto light style (`settings.style: natural`): a color
   temperature per phase (defaults like the Hue app's Energize … Nightlight, editable),
   the same brightness, entities and `apply_auto_light`; the room screen shows an
   "Auto light" / "Natural light" tile.
6. ~~Room sensors~~ — done: motion (with when it was last seen), temperature and light
   level under the room header, from the room's Hue sensors or the options (light
   sensors added to the room sensors step); a tap opens the sensor in HA.

### C. Space: our SpatialAware, without a Bridge Pro

1. ~~Positions~~ — done (`positions.py`): per area, from the entertainment
   configuration holding most of its lights (`service_locations`: one point per light,
   two for a strip's ends), else from the Store; `hue_studio/positions/subscribe`.
2. ~~Position editor~~ — done: room → Arrange, top view with draggable lights (strips
   as two ends) and height; lights of the entertainment area are written back to the
   bridge (`hue_studio/positions/set`), the rest go to the Store; locked while syncing.
3. ~~Spatial palettes~~ — done: `apply_palette` `layout: spatial` lays the palette
   along the room's longest side, strips get the stretch between their ends; the
   gallery sheet has the classic/spatial toggle.
4. ~~Verify on a real bridge~~ — done (2026-10-11): coordinates are -1..1 (lights on
   walls sit at ±1); a light has one point, an upright lamp (Signe) two points one above
   the other, which the editor keeps as one spot; a PUT of `locations` is accepted and
   read back unchanged; no SpatialAware resources in the API of a regular bridge.

### R. Rooms and zones, HA-first (design: `rooms-and-scenes.md`)

1. ~~Comparison of areas and Hue rooms -> alignment plan~~ — done: `alignment.py` (pure,
   tested); rooms hold devices, areas take rooms by overlap, then name.
2. ~~`align_rooms`, `update_zone`, `delete_zone`, completing scenes~~ — done, plus
   `hue_studio/rooms/subscribe` and `hue_studio/lights/set_area`.
3. ~~Panel~~ — done: "Rooms and zones" screen (alignment preview and apply, zone
   editor), mismatch notes in rooms, "No room" section. Still to do: screenshots on a
   live HA.
4. ~~Optional automatic alignment~~ — done: "Rooms follow areas" option.
5. ~~On the live bridge~~ — done (2026-10-11): dry run, review, applied with
   `keep_split_scenes`: two rooms created, two lights moved, the split room's seven scenes
   copied into a zone over its old lights; a second dry run shows nothing left to do.
6. ~~Keeping a split room's scenes~~ — done: `align_rooms` `keep_split_scenes` (and a
   toggle on the rooms screen) copies the scenes that would lose lights into a new zone
   over the room's original lights before the room is split.

### D. Phase 4 — auto light as building blocks (the main difference from the Hue app)

Hue Studio decides *what* to show; *when* stays with Home Assistant automations (no
presence or time-window logic in the integration, no blueprints). What matters are
entities that dashboards (Lovelace, Mushroom, Bubble Card) and automations can use
directly. Per HA area with auto light settings:

1. ~~Selection engine~~ — done: `auto_select.py` (pure, tested). Matches the legacy
   templates on a snapshot of the live inputs. Differences on purpose: a phase without
   a pool behaves like the phase before it; the light day starts in the morning (no
   scene change at midnight); the season entity must report winter/spring/summer/autumn
   (else the month decides).
2. ~~Entities~~ — done (`auto_entity.py`), with translations, icons, device classes and
   an `entity_picture` where it helps cards:
   - **light control** (`select`: auto / manual / off): who controls the lights right
     now. Hue Studio sets `manual` when the lights change by anything but auto light
     (outside a 15 s quiet window after its own command); back to `auto` through the
     select or `apply_auto_light` with `resume` — automations decide when (e.g. on
     leaving the room), and also hand control back after they turn the lights off
     themselves, which Hue Studio sees as a manual change; `off` disables auto light
     for the area;
   - phase (`sensor`, enum), scene of the day (`sensor`, the gallery picture as
     `entity_picture`), brightness (`sensor`, %), brightness offset of the current
     phase (`number`), next scene (`button`).
3. ~~Service `apply_auto_light`~~ — done (area, transition, `force`, `resume`; through
   `apply_palette`, so Adaptive Lighting marking and streaming lights are handled).
   Settings over WebSocket: `hue_studio/auto_light/settings`.
4. ~~Settings in the panel~~ — done: Settings → Auto light (areas, add an area) and a
   screen per area: who controls the lights, today's scene (another one, show now,
   never this one), pools by phase/season/weather or day step with a gallery picker,
   phase boundaries, brightness (curve or fixed, offsets), weather / light sensor /
   season / gradient layout, holidays, excluded scenes, turning auto light off for the
   area. Still to do: screenshots on a live HA.
5. ~~Live switch-over~~ — done (2026-10-11): the existing automations take scene and
   brightness from the auto light entities, call `apply_auto_light` and leave manual
   detection to the control select; presence, illuminance thresholds and time windows
   stay in the automations. Dashboard helpers (auto/manual switches, "another scene")
   are bridged to the select and the button by the automations themselves, which read
   the current states rather than `trigger.to_state` (queued runs go stale). The legacy
   template sensors, helpers and the light config shim stay until the dashboards move
   to Hue Studio cards (D2/E).

### D2. Cards

- ~~More-info from cards~~ — verified on a live HA (2026-10-11) with tile, button,
  entities and Bubble Card cards: a Hue light opens our dialog both through
  `hass-action` (tile; Mushroom uses the same path) and a direct `hass-more-info`
  (Bubble Card); Hue sensors, scenes and our own entities open HA's dialog.
- ~~Our entities in cards~~ — state names, state icons, the scene picture, the
  brightness offset slider and the control select render in tile, entities and Bubble
  Card. The auto light device is named after its area, so entities read "<area> Scene
  of the day" (HA's dialog shows "<area> ▸ <area>" as the breadcrumb, the price of
  that).
- Fixed on the way: the dialog header shared a class with the settings pages' header.

### E. Later

- HA-first device setup: add Hue devices (lights, sensors, switches) through a wizard
  of Hue Studio itself, assigning HA areas (and the matching Hue rooms) on the way.

- Sync Box, direct pairing only: presets, IR codes, music palettes, background
  lighting (aiohuesyncbox already has them).
- Dashboard cards replacing the legacy gallery and auto-light cards.
- "Liquid Glass" footer with `/hue` as a tab.
- Submission to the HACS default repository list.

## Order

A -> B1–B2 -> R -> Settings tab -> D -> D2 -> C -> rest of B -> E. Done so far: A, B, C, D, R
and D2; only E is left.

Space (C) comes after auto light: retiring the legacy prototype matters more than spatial
rendering, which only pays off in rooms with several lights.
