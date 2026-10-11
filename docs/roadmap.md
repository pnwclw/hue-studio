# Roadmap

What Hue Studio still needs, measured against the current Philips Hue app (5.6x–5.7x,
2026) and the phases in `CLAUDE.md`. We copy the Hue app's **light-control screens** and
its **automation screens**, but every automation is a Home Assistant automation (G):
Home Assistant runs, stores and edits it, Hue Studio only gives it the Hue app's look.

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

**Automations** (tab): Wake up with light, Go to sleep, Coming home, Leaving home, Mimic
presence, Schedule — each a form with time, days, rooms and a light (scene, brightness,
fade). In scope as HA automations (G).

**Security** (Hue Secure): cameras (wired, battery, floodlight, desktop), contact sensors,
armed/disarmed modes, alarms with lights and sirens, recordings in the cloud. Later (H).

**Out of scope for us** (Home Assistant's job or hardware-bound): MotionAware, the AI
assistant, Sports Live, doorbell, bridge backup. Sync is in scope for the Hue Play HDMI
Sync Box (done); TV and PC sync apps stay outside.

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
presence or time-window logic in the integration). Since G, the panel can set up that
*when* too, as HA automations from our blueprints. What matters are
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

- ~~HA-first device setup~~ — done: Settings → Add devices (`devices.py`): the bridge's
  `zigbee_device_discovery` search (optionally by serial numbers), new devices and those
  without an HA area, each named on the bridge, put into an area and (lights) into the
  area's Hue room; identify. Checked on a live HA (read-only: no search started).

- ~~Sync Box, direct pairing only~~ — done: music palette, background lighting, presets
  (start, save the current state, delete; starting and deleting built on aiohuesyncbox's
  `Presets` controller, which lacks them in 0.1.6) and remote buttons (learn, assign an
  action, forget) in the Sync tab and as services; a linked box answers with an error
  that explains why.
- ~~Dashboard cards~~ — done: room, auto light and gallery cards (`cards.ts`, one shared
  context, theme colors, card picker + visual editor), verified on a live HA.
- ~~"Liquid Glass" footer~~ — done as an experimental setting: phones only, chosen
  panels as tabs plus More (the side menu), room reserved through
  `--safe-area-inset-bottom`, hidden on `/config`; the `/hue` panel moves its own tabs
  to the top while it is on.
- Submission to the HACS default repository list.

### F. Settings like the Hue app (2026-10-11)

- ~~Settings tab~~ — In this home: Devices (all, by area, plus adding), Bridges, MotionAware
  areas, Entertainment areas; Hue Studio: Rooms and zones, Auto light, Integration
  settings (the options flow's settings in the panel), Experimental. Security comes later.
- ~~Entertainment areas~~ — `entertainment.py`: list, create, change name/type/lights
  (kept lights keep their places), arrange (the room arrange screen), delete; not while
  streaming.
- ~~Headers~~ — every screen has a fixed header and a body that scrolls (and bounces) on
  its own; tabs have a large title, other screens a compact back + title bar.

### G. Automations like the Hue app, HA-first (2026-10-11)

The Hue app's Automations tab in the panel, with every automation a **real HA automation**:
stored by HA (`automations.yaml`, through HA's own automation config API, the one its editor
uses), run by HA, listed in Settings → Automations, readable and editable there. No
automation engine and no second copy in Hue Studio.

1. **Blueprints** shipped with the integration (`blueprints/automation/hue_studio/`, put in
   place on setup like core integrations do), one per Hue type. A Hue Studio automation is
   `use_blueprint` with that blueprint and its inputs, so HA shows it with a form and the
   panel reads it back by the blueprint path. Taken over in HA ("take control", edited
   away from the blueprint): the panel lists it as custom and links to HA's editor.
2. **Types**, copied from the Hue app (names, steps, defaults):
   1. **Wake up with light** — time, days, rooms; fade in over N minutes before the time
      to a white or scene; optional off after.
   2. **Go to sleep** — time, days, rooms; fade out over N minutes.
   3. **Coming home** — when the first person arrives (HA `person`/zone), optionally
      only after sunset; rooms and scene.
   4. **Leaving home** — when everyone has left: rooms off (all by default).
   5. **Mimic presence** — while nobody is home, in a time window (or sunset to a
      time): rooms on and off at random intervals.
   6. **Schedule** — time or sunrise/sunset with offsets, days, rooms and a light. Our
      current auto light editor (pools by phase, season and weather, brightness,
      holidays) moves here from Settings → Auto light: a schedule whose light is
      "auto light" shows the scene of the day (`apply_auto_light`); its settings stay in
      the Store, the timing is the automation.
   7. **Custom (Home Assistant)** — a card that opens HA's automation editor for a new
      automation; below it, the other HA automations that touch Hue lights, each opening
      in HA.
3. **Panel:** an Automations tab: the list (icon, name, time, days, rooms; the switch is
   the `automation.*` entity: on/off), "+" → the seven types, a Hue-style editor per type
   (time wheel, day chips, room picker, scene from the room or the gallery, fade). Saving
   writes the automation; deleting removes it from HA. A room's screen shows its
   automations, like the Hue app.
4. **Tab bar** exactly like the Hue app: **Home – Automations – Sync – Explore –
   Settings** (now Home – Explore – Sync – Settings). Settings → Auto light goes away
   (moved to Schedule).
5. **Live switch-over:** the existing hand-written light automations become Schedule (and
   Coming home / Leaving home) automations where they fit; whatever does not fit stays a
   custom HA automation.
6. **Adaptive Lighting:** the blueprints' light actions mark lights as manually controlled,
   like our services do.

Open questions: how a Hue type that the blueprint form cannot express well (random
mimic intervals, a fade ending at a time) is done in the blueprint itself (HA scripts,
`delay` with templates) versus a small Hue Studio service it calls; how blueprints are
updated with the integration without breaking automations that use them.

### G2. Our scenes and automations in HA: markers, grouping, opening in Hue Studio (2026-10-11)

What Hue Studio creates ends up in HA: scenes as `scene.*` of the native `hue` (bridge
scenes), automations as HA automations (G). Each gets markers so that Hue Studio
recognizes it, and grouping so that HA's own lists stay tidy. Everything is
written through HA's public registries and config APIs, never into our Store.

1. **Markers. Hue Studio recognizes its scenes and automations by them, not by name.**
   - Scenes: platform `hue` plus the bridge scene id (as today). The bridge stays the
     source of truth, so a scene made in the Hue app is recognized the same way.
   - Automations: `use_blueprint.path` under `hue_studio/` gives the type.
   - The automation `id` gets the prefix `hue_studio_<type>_`. The id survives a takeover
     in HA, so the panel can still show a taken-over automation as "custom, made in Hue
     Studio" and link to it.
   - Labels and categories (item 2) are for people. Recognition never depends on them
     alone, because the user may change or remove them.
2. **Grouping in HA.** We assign it on create, and on setup for what already exists.
   - **Label** "Hue Studio": HA labels are global, so one filter in the entity, scene and
     automation lists shows everything of ours.
   - **Scene category** = its Hue room or zone, so HA's scene list is grouped by room,
     like the Hue app.
   - **Automation category** "Hue Studio" (HA categories are per list).
   - **Area:** a scene gets its room's area. An automation gets the area of its one room;
     with several rooms it gets no area.
   - **Names:** names follow the HA language (translations), with Hue-style icons.
   - **The user's choice wins.** We fill only what is empty or still ours. We never
     overwrite a category, area or label the user set. A rename or move on the bridge
     updates a category only while it is still one of ours.
   - **Off switch:** an option, "Organize in Home Assistant" (on by default). Turning it
     off leaves everything as it is.
3. **Opening in Hue Studio, like lights.** The more-info override grows beyond lights,
   under the same rules: only what is ours, the fallback to HA's dialog, "Details" and
   `detail.view` go to HA.
   - `scene.*` of `hue` opens our scene sheet: picture and colors, activate, edit in the
     panel's scene editor.
   - `automation.*` recognized as ours (by blueprint path, read through HA's automation
     config API) opens our automation sheet: the switch, a summary in Hue words, edit in
     the Hue-style editor, "Open in Home Assistant".
   - Everything else passes through untouched.
4. **HA's editors stay HA's.** On `/config/...` the automation and scene lists open HA's
   editors, and we don't intercept that: the rule "never touch `/config/...`" holds, and
   HA-first means HA's editor is always reachable. The way back is a link instead:
   - every automation we write gets a `description` with a link to it in the panel
     (`/hue/automations/<id>`), and HA's editor shows that description;
   - the blueprints' descriptions link to the panel's Automations tab.
   - Deep links: `/hue/automations/<id>`, plus the existing scene and room routes.
5. **Upstream, not patched.** Changing HA itself (a frontend hook that lets an
   integration offer its own editor for automations from its blueprints, or a custom
   more-info for scenes) would be a proposal to HA core and frontend. We never monkeypatch
   HA. Until such a hook exists, items 3 and 4 are the whole mechanism.

Scenes come first: markers, grouping and the scene sheet work today, without waiting
for G. The automation parts land together with G.

Open questions:
- Whether HA's scene list opens more-info for non-editable (bridge) scenes, so our sheet
  can appear there too. Check on the live HA.
- Whether HA scenes from `scenes.yaml` that touch only Hue lights are shown in a room
  (read-only, opening in HA), or left out.

### H. Later: Hue Secure

Plans, after research:

1. **What the bridge and the cloud expose** (2026): CLIP v2 resources for contact sensors,
   tamper, camera motion and security areas; whether cameras talk to the bridge at all or
   only to the Hue cloud; any documented local or cloud API for live view, events and
   recordings. HA has no Hue camera support today.
2. **Contact sensors and camera motion** as HA entities when the native `hue` does not
   provide them (respecting the rule: extend `hue`, never duplicate it).
3. **Security in Settings** (the "Security comes later" row of F): armed/disarmed modes
   built on HA's `alarm_control_panel`, not a mode store of our own; alarms as HA
   automations (G) that flash lights and sound sirens.
4. **Cameras** only with a usable API (live view as a `camera` entity, events, recordings);
   otherwise a link to the Hue app.

## Order

A -> B1–B2 -> R -> Settings tab -> D -> D2 -> C -> rest of B -> E -> F -> G2 (scenes) -> G (with
G2 for automations) -> H. Done so far: A, B, C, D, R, D2, E (except the HACS submission, kept
for later) and F. Next: G2 for scenes, then G.

Space (C) comes after auto light: retiring the legacy prototype matters more than spatial
rendering, which only pays off in rooms with several lights.
