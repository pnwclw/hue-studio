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
armed/disarmed modes, alarms with lights and sirens, recordings in the cloud. Out of scope:
it all runs through the Hue cloud (H, dropped).

**Out of scope for us** (Home Assistant's job or hardware-bound): MotionAware, the AI
assistant, Sports Live, doorbell, bridge backup (except the scenes: `export_scenes` /
`import_scenes` put them where Home Assistant's backups reach). Sync is in scope for the Hue Play HDMI
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

**Superseded by G (2026-10-12).** The Store, the per-area entities, light control and
`apply_auto_light` are gone. The selection (`daylight.py`) lives on as natural light and
the scene of the day, the light of an automation; its settings are an input of that
automation. The history below is kept for reference.

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
- ~~"Add devices" as a flow~~ — done (0.9.1-alpha.3): like the Hue app's: what is added
  (lights, accessories, other brands' Zigbee lights with the default link key), the steps
  to get it ready, serial numbers, the search with its progress and the devices as they
  join, then each one named and put into a room (an existing area or a new one); from a
  room's "+" too. Devices can be deleted from their bridge; unreachable ones are marked.
- ~~Bridges and Sync Boxes as entities of their own~~ — done (0.9.1-alpha.3): Settings →
  Bridges lists every bridge (connected or not) and Sync Box; a bridge's page renames it on
  the bridge and links its devices, entertainment and MotionAware areas; a Sync Box's page
  has its name, status light, following the TV (paired directly), its connection mode and
  facts. "Visit" on their HA device pages opens that page. MotionAware areas show only with
  a Hue Bridge Pro.

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
  settings (the integration's options, only in the panel: there is no options flow since
  0.9.1-alpha.2), Experimental. No Security (H, dropped).
- ~~One Hue Studio for all bridges~~ — done (0.9.1-alpha.2): one config entry that uses every bridge
  of the native `hue` integration and follows its entries (connects when one is loaded,
  closes when it is unloaded, retries while a bridge does not answer); each bridge is a
  service device of it, linked to the native bridge device, with "Visit" opening the
  panel. The old one-entry-per-bridge entries are merged on setup.
- ~~Entertainment areas~~ — `entertainment.py`: list, create, change name/type/lights
  (kept lights keep their places), arrange (the room arrange screen), delete; not while
  streaming.
- ~~Headers~~ — every screen has a fixed header and a body that scrolls (and bounces) on
  its own; tabs have a large title, other screens a compact back + title bar.

### G. Automations like the Hue app, HA-first (2026-10-11)

**Closed (2026-10-22).** The live light automations are moved to our types; the open
questions below are dropped. Its place in the order goes to S (the Sync Box screen).

**Done (2026-10-12):**
- seven blueprints: wake up, go to sleep, coming home, leaving home, mimic presence,
  schedule, plus a motion sensor (the Hue app's accessory behaviour). They are put in
  place on setup, rewritten and reloaded when they change, and validated in tests by
  HA itself;
- `hue_studio.apply_light`: a scene per room, a white, natural light, the scene of the
  day, or off. Natural light and the scene of the day keep up with the day until the
  lights are changed (in memory only);
- the Automations tab with Home – Automations – Sync – Settings. The Explore tab went
  away earlier: the gallery belongs to a room now;
- a Hue-style editor per type, with a second page for natural light and the scene of
  the day (the old auto light editor);
- a room's automations on its screen, and an automations card that replaces the auto
  light card (the old tag still works);
- G2 for automations: ids `hue_studio_<type>_…`, the "Hue Studio" label and category,
  the area of the one room, a description linking back;
- G2's automation sheet (2026-10-12): more-info of an automation made with Hue Studio
  (id prefix, or one of our blueprints as `hue_studio/automations/subscribe` reports) opens
  a Hue-style sheet: the switch, when / rooms and zones / light in Hue words, "Edit" (the
  panel's editor, whose "back" returns to the page) and "Open in Home Assistant". HA's
  dialog stays for everything else, for non-admins (the config API is admin-only), on
  `/config/...`, for "Details" and for events with `detail.view`.

Answers to the open questions below:
- the random intervals of mimic presence use `random` and `wait_template` timeouts
  inside the blueprint;
- a fade that ends at a time uses a template trigger;
- blueprints keep their inputs compatible and are reloaded when they change.

Still open:
- the live switch-over (item 5): the user sets up the automations anew.

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
written through HA's public registries and config APIs; our Store only remembers which
of it is ours.

**Done for scenes (2026-10-21):** every bridge scene (`organize.py`) gets the "Hue Studio"
label (smart scenes too), a scene category named after its Hue room or zone (made by us, with the icon of
the archetype picked in the Hue app, the same icons the panel shows its rooms without
an area icon and its zones with) and the area of its room (the panel's room mapping, set on the scene itself: HA's
scene list shows only an entity's own area). Done on setup and whenever scenes, rooms, areas
or the room mapping change. The user's choice wins: what is ours is remembered
(`.storage/hue_studio.organize`: the scenes organized once, our categories, the areas
we set), so a label or category the user removes stays removed and a category the user
renames is theirs; a Hue room renamed on the bridge moves its scenes to a category of
the new name while theirs is still ours, and our categories nobody uses go away.
"Organize in Home Assistant" (Settings → Integration settings, on by default) turns it
off for scenes and automations. The more-info override opens our scene sheet
(`scene-sheet.ts`) for `scene.*` of `hue` outside `/config/...`: the picture in the
scene's colors and its room, "Activate" (shown at once, Adaptive Lighting told), and
while it is on dynamic play and "Shuffle colors", "Edit scene" (the panel's editor,
which returns to the page it was opened from), "Details" (HA's dialog). Not done: names
in the HA language with Hue-style icons (scenes keep the bridge's names).

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
   - `automation.*` recognized as ours (by the id prefix, or by blueprint path as HA
     reports it) opens our automation sheet: the switch, a summary in Hue words, edit in
     the Hue-style editor, "Open in Home Assistant". Done (2026-10-12).
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
- ~~Whether HA's scene list opens our sheet~~ — no, by rule: `/config/...` stays HA's.
- Whether HA scenes from `scenes.yaml` that touch only Hue lights are shown in a room
  (read-only, opening in HA), or left out.

### I. One style for every dashboard: our cards, and theirs (2026-10-22)

Replaces the earlier plan of a switch between Hue Studio's look and stock HA (with a
generated dashboard of stock cards): the goal is one style everywhere, whatever a
dashboard is built from.

1. **Our own cards** for everything the panel has (rooms and zones, scenes and the
   gallery, lights, automations, sensors, Sync Box), built on the design system (DS), so
   a card on a dashboard looks like the same thing in the panel.
2. **Building them from other cards:** what a dashboard made of Mushroom, Bubble Card or
   stock Lovelace cards needs to look the same — entities, attributes and services
   (no card of ours required), and the design tokens published as CSS variables or a
   theme that those cards can take.
3. **A separate theme** may take the same tokens later, so HA's own screens match too.
4. **Rule:** a feature is done when it can be put on a dashboard in that style, not only
   in the `/hue` panel.


### J. The light of the day: one scene pool for every automation (2026-10-13)

**Done (2026-10-13):** natural light and the scene of the day no longer carry pools per
automation. One global light of the day (the Hue Studio entry's options, Settings →
Light of the day):

- **scene tags** instead of pools: every scene names the phases, seasons, weather and
  moods it fits (none: any). Hue Studio ships hand-made tags for the whole gallery
  (`scene_tags.json`); the user's tags of a scene replace them, empty ones take it out,
  and the ready-made tags can be turned off;
- **mood**, a fourth criterion next to phase, season and weather: scenes such as party or
  festive ones fit no time of day but a mood. `select.hue_studio_mood` ("auto": by the
  day) switches every living scene of the day at once;
- **phase times**, weather, season and light sensor are global; `sensor.hue_studio_phase`
  shows the phase (season and weather as attributes). Missing sources are offered as
  core integrations to add (Met.no, Season);
- an automation keeps only its own: extra and skipped scenes, phase times of its own
  (off by default), brightness, the white of natural light, gradient layout;
- day steps (pools by sun elevation) and holidays are gone: brightness follows the curve
  anyway, holiday scenes became the festive mood. Old pools are moved into the global
  pool by the panel once (ready-made tags off then), and are used as they are until then.

Not done on purpose: a calendar of holidays.

### K. Moving between bridges: dropped (2026-10-22), removed (2026-10-26)

Moving a bridge, a room or lights to another bridge, and lost
devices, were built (`migration.py`, views `bridge-move`, `lost`), hidden from users and
then removed. What `identity.py` needed of it (a device's Zigbee MAC, its services by
type, taking over an old entity's id and settings) lives there now.

### S. The Sync Box screen, reworked (2026-10-22)

**Done (2026-10-23):** the Sync tab is the Hue app's (measured on its iOS screens): the
input's picture, mode / intensity / brightness as three buttons with their popovers, a dock
with what (inputs on a sheet), start/stop and where (entertainment areas on a sheet); "⋯"
holds the box's settings, presets and remote buttons, the mode popover background lighting
and the music palette (direct pairing). The brightness control is shared with the color
screen (`BrightnessControl`).

**Done (2026-10-26), measured on the Android Hue app with the live box:** the tab's measures
(the picture and pills scale with the width, square picture, the dock 20 from the edges, the
start button showing a box that is on, no glow with a box), and a box's settings as the Hue
app's pages behind "⋯" and Settings → Bridges (`sync-settings.ts`): Device (LED, updates at
night, network and device info, restart, remove), Change Hue Bridge, Change Wi-Fi network,
HDMI inputs (name and icon on an icon grid), TV remote control, Automatic control (the box's
CEC / HPD / USB / inactivity power, per-input CEC and HPD switching and auto sync; HDMI CEC
by Hue Studio on top), Advanced (background lighting, ARC bypass), Software updates;
Presets ours. Backend: `hue_studio/sync/behavior`, updates and actions in
`hue_studio/sync/configure`, diagnostics with the box's own state.

The Sync tab and a box's page get the same pass the rooms, scenes and automations got:
the Hue app's Sync screens as the reference (modes, intensity, inputs, the entertainment
area, music and background lighting), laid out on the design system (DS). Direct pairing
and the `huesyncbox` link mode keep one screen.

### DS. One design system (2026-10-22)

So that new features are not built on a vision of their own, everything is put on one
design system first. **Done (2026-10-22, measured on the Hue app 6.3 on 2026-10-23)**:
`docs/design-system.md`, tokens in `src/tokens.ts`, `styles.ts` and the cards, sheets and
dialog on them, kept there by `tests/js/styles.test.ts`. Still to measure: the Sync screens
with a box, a gallery scene's sheet.

1. **Inventory of the Hue app** (done but for the screens above): every screen of the real app (home, rooms, scenes and
   the gallery, the wheel, effects, automations, Sync, settings, devices, sheets and
   pickers), with sizes in dp, measured on the app in the Android emulator.
2. **Inventory of Hue Studio:** every screen and part of the panel, the dialogs and the
   cards, against it: what matches, what differs, what is ours only.
3. **The system:** tokens (colors, type scale, spacing, radii, shadows, motion) and
   components (headers, section titles, rows, tiles and cards, sheets and action sheets,
   pills and round buttons, switches, sliders, wheels, banners, pickers), each with where
   it is used. It lives in the repository, and `CLAUDE.md`'s scale rules point to it.
4. **Bringing the code in line:** `styles.ts` and the views use the tokens and
   components only; one-off sizes go away.
5. **Rule:** a new screen is made of the system's parts; a part that is missing is added
   to the system first.

### H. Hue Secure: dropped (2026-10-25)

Hue Secure (cameras, contact sensors in security mode, armed/disarmed modes, alarms,
recordings) runs entirely through the Hue cloud: there is nothing local for Hue Studio to
build on or change. Not planned. Contact sensors stay whatever the native `hue` makes of
them; HA's own alarm panel and automations cover arming with lights.

## Order

A -> B1–B2 -> R -> Settings tab -> D -> D2 -> C -> rest of B -> E -> F -> G2 (scenes) -> G (with
G2 for automations) -> J. Done so far: A, B, C, D, R, D2, E (except the HACS submission, kept
for later), F, G, J and G2 (scenes 2026-10-21, automations with G). K is dropped.

Next (2026-10-22): **DS** (the design system, first: everything after it is built on it;
done) -> **S** (the Sync Box screen; done) -> **I** (one
style for every dashboard). H (Hue Secure) is dropped: it is cloud-only.

Space (C) comes after auto light: retiring the legacy prototype matters more than spatial
rendering, which only pays off in rooms with several lights.
