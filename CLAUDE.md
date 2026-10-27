# CLAUDE.md — hue_studio

A Home Assistant custom integration **on top of the native `hue` integration**: Philips Hue
light control with the visual layer of the Hue app (color wheel with light dots, scene
gallery, palettes, gradients) plus what the Hue app lacks — Home Assistant logic
(time-of-day phases, weather, seasons, presence, entertainment sync, automations).

`hue_studio` is the working name (integration domain, panel URL `/hue`). If we rename it,
rename it everywhere at once.

Private, machine-specific context (live instance, addresses, entity names, the legacy
prototype, deployment) lives in `CLAUDE.local.md`, which is git-ignored. Read it before
touching anything outside this repository.

## Language and privacy

- **Everything in the repository is in English**: code, comments, docstrings, docs, commit
  messages, issue/PR text. No other languages anywhere, except translation files (below).
- **UI strings never live in code.** Backend: `custom_components/hue_studio/translations/`
  (`en.json` is the source of truth; other locales are plain translations of it). Frontend:
  a locale dictionary module, same rule. Every new key goes into every existing locale.
- **Nothing personal goes into the repository**: no real room or light names, entity ids,
  addresses, hostnames, bridge ids, dashboard names or details of anyone's setup. Examples,
  tests and fixtures use neutral placeholders (`light.example_lamp`, `living_room`,
  documentation IP ranges such as `192.0.2.0/24`). Private details go to `CLAUDE.local.md`.
- Secrets (bridge app key, HA tokens) are never logged, committed or printed in chat.

## Concept

1. **Extend the native `hue`, don't replace it.** `light.*`, `scene.*` and sensors stay
   with it. We add what it can't do — palettes, multi-color gradients, a scene gallery,
   automations like the Hue app's — and a good UI for it.
2. **Backend** — `custom_components/hue_studio/`:
   - **one Hue Studio config entry for every bridge of `hue`**, with its own CLIP v2
     connection to each (aiohue). **Host and app key are read from the bridge's `hue`
     config entry** — no second pairing with the bridge button — and the connection
     follows that entry (opens when it is loaded, closes when it is unloaded or removed,
     retries while the bridge does not answer). Each bridge is a service device of our
     entry (`via_device_id` to the native bridge device, "Visit" opens the panel). We never
     reach into the native integration's bridge object via `hass.data`: that is internal
     API and breaks on upgrades;
   - the bridge event stream (SSE) pushes state, no polling;
   - **services with schemas** (`hue_studio.apply_palette`, `set_gradient`, `set_effect`,
     `create_scene`, `delete_scene`, `save_scene`, …) — visible in the automation editor;
   - **WebSocket API** (`hue_studio/palettes`, `hue_studio/rooms`, `hue_studio/subscribe`,
     …) for the frontend;
   - **where data lives — no divergence from the Hue app:** everything the Hue app can
     show lives on the bridge. A palette saved in a room is a bridge scene with a CLIP v2
     `palette` in that room's Hue room/zone (with the gallery's `public_image` id in
     `metadata.image`), so the Hue app sees and edits it; changes from either side reach
     the other through the bridge, there is no copy to sync. Only what the bridge can't
     hold (light positions outside entertainment areas, a scene's own photo) goes to
     `helpers.storage.Store`;
   - **automations are HA automations**: Hue Studio ships blueprints, one per Hue app type
     (`blueprints/automation/hue_studio/`, copied into HA's blueprint folder on setup); the
     panel writes automations that use them through HA's automation config API, HA stores
     and runs them. No automation engine of our own. Natural light and the scene of the
     day start from the global **light of the day** (`pool.py`, the entry's options): one
     scene pool as tags of scenes (phases, seasons, weather, moods; ready-made tags of the
     gallery in `scene_tags.json`, the user's replace them), phase times and sources
     (weather, season; missing core integrations are offered), and the mood
     (`select.hue_studio_mood`; `sensor.hue_studio_phase` shows the phase). An automation's
     input only adds its own (extra/skipped scenes, own phase times, brightness);
     `hue_studio.apply_light` shows them and keeps them up with the day — and with the
     mood and the global settings — while nobody changes the lights (memory only). Our automations have ids `hue_studio_<type>_…` and
     get the "Hue Studio" label and category and the area of their one room. Their places
     are areas (`rooms`), and Hue rooms/zones no area holds or single Hue lights (some of a
     room's, the Hue app's light picker) in `zones` (an entity selector of Hue lights); a
     scene on some of a room's lights shows on those only (each light's action); the
     panel lists them by room/zone from what HA reports they control (public
     `automations_with_area`/`_entity`) and reads their inputs through HA's automation
     config API (`automation/config` gives a blueprint automation expanded);
   - **GUI first, no YAML.** Every setting has a GUI path in the panel (the options of the
     Hue Studio entry; there is no options flow) and is read/written through the WS API and
     services, never by editing files. No YAML configuration layer.
3. **Frontend** — TypeScript + Lit in `src/`, bundled by esbuild into
   `custom_components/hue_studio/frontend/`; registered by the integration itself via
   `frontend.add_extra_js_url` (no manual Lovelace resources):
   - **panel** (`panel_custom`, `/hue`): a full-screen "Hue app" — rooms, color wheel with
     draggable light dots, gallery, palettes, automations. It copies the Hue app's
     look but is **built on HA's model**, read from the frontend `hass` object:
     - **Rooms = HA areas** that contain Hue lights (area name/icon, device or entity area).
       If a Hue room/zone light group covers exactly the same lights, it is the room's
       command target (one bridge command instead of one per light) and its scenes are the
       room's scenes; otherwise commands go to the lights and scenes of Hue groups lying
       inside the area are offered.
     - **Zones = Hue rooms/zones** (light entities with `is_hue_group`) that are no room's own
       command target: every Hue zone is on Home, also one put in a room's area (that is done
       for other reasons); a room lists the zones lying in it after its lights.
     - Everyday control goes through stock HA services (`light.turn_on`, `scene.turn_on`);
       only what HA can't do goes through ours (`hue_studio.set_gradient`,
       `hue_studio.apply_palette`) and `hue_studio/lights/subscribe` (gamut, gradients);
   - **more-info override**: listen to `hass-more-info` before HA does; if the entity is a
     Hue light or scene (`hass.entities[id].platform === "hue"`) or one of our automations,
     open our own sheet, otherwise let the event through untouched;
   - **cards** for regular dashboards.
4. **Hue Play HDMI Sync Box**, two kinds of config entries, keyed by the box id so one box
   is only ever set up one way:
   - `kind: sync_box` — **the recommended mode**, paired with the box's button (our own registration — never reuse
     another integration's token: it revokes it when removed). Driven by `aiohuesyncbox`
     (extend on its models/controllers, not raw JSON), polled; own entities whose ids and
     option values stay compatible with the HACS `huesyncbox` integration.
   - `kind: sync_box_link` — **compatibility mode**, always mentioned in the UI and docs
     as an option, with its limits. The box stays with HACS `huesyncbox`; we use only its public
     side (its entities by unique id `<key>_<box id>`, its `set_sync_state` service),
     never its internals — the same rule as for `hue`. Areas are matched with the bridge
     by name. A box that `huesyncbox` has is offered as a link instead of being paired.
   Both feed the same `hue_studio/sync/subscribe` payload and `hue_studio.set_sync`, so
   the panel does not know the difference; entertainment areas are matched with the
   bridge to know which lights sync. New Sync Box features (presets, IR codes, music
   palettes, input types, …) are built for direct pairing only; the link mode keeps
   working with what `huesyncbox` exposes and degrades to "unavailable" if it changes.
5. **Experimental** (Settings → Experimental): features that are still taking shape. Empty
   for now; the screen stays as the place for the next one.

## Rules that must not be broken

- **Fallback.** If our JS fails to load or crashes, HA must show the stock more-info dialog.
  Losing access to a light because of our code is unacceptable. The override stops the
  `hass-more-info` event only after our dialog was built; its "Details" button and any
  event with `detail.view` go to HA's own dialog.
- **Instant UI.** Every command shows its expected result immediately (`optimistic.ts`)
  and falls back to the real state on error or after 5 s without confirmation.
- **Only intercept what is ours** (Hue lights). Never touch `/config/...` pages.
- **Bridge rate limits:** ~10 commands/s for `light`, ~1/s for `grouped_light`. Dragging on
  the wheel is throttled; several lights at once go through group commands or a single
  scene, never a per-light loop.
- **Gamut:** lights have different gamuts (A/B/C, from `light.color.gamut` in CLIP v2). A
  point on the wheel is clipped to the gamut of that specific light, otherwise the color on
  screen differs from the light.
- **HA frontend internals** (element names, shadow DOM) change between releases. Everything
  that depends on them lives in one module and is re-checked after every HA update.
- **Keep the native integration healthy.** No `requirements` of our own that could pin
  aiohue to a version different from the one the native `hue` ships with; we rely on the
  `hue` dependency to install it. The only requirement is `aiohuesyncbox`, as a range in
  `manifest.json` (`>=0.1.6,<0.2`) so it can share one copy with HACS `huesyncbox`,
  which pins its own version; the dev group of `pyproject.toml` pins the version we test.

## Conventions

- **Code style follows Home Assistant core:** `async`, full type hints,
  `ConfigEntry.runtime_data`, translated exceptions, `config_flow` (a menu: add Hue Studio
  once — it uses every `hue` bridge — or a Sync Box: pair it or use HACS `huesyncbox`). Ruff with HA-like settings (`pyproject.toml`).
- **One package per feature**, on both sides (`custom_components/hue_studio/<feature>/`,
  `src/features/<feature>/`). A package holds only what belongs to it: its own
  `services.py` and `websocket.py` with its own services and commands (the root files
  only call them); in the frontend its pure modules at its root, its screens in `views/`. Repeating a file name in
  several packages is fine; a shared grab-bag is not. What several features use lives in
  `core/` (and `lights/targets.py`, `lights/palettes.py` for service targets and palettes).
- **Every screen works on phone and desktop.** Verified with screenshots at the widths of
  iPhone 17 Pro (402×874) and 17 Pro Max (440×956), and 1440 (how: see `CLAUDE.local.md`).
  A UI change is not done without screenshots.
- **Design system** (`docs/design-system.md`): every screen, sheet and card is made of its
  parts — tokens in `src/ds/tokens.ts` (colors, type scale, radii, shadows, sizes, motion) and
  the components in `src/ds/styles/` and their helpers. A missing part is added to the system
  (and the doc) first; no one-off sizes, colors or fonts (`tests/js/styles.test.ts`).
- **Scale.** The Hue app is the reference, measured on the app itself (6.3 in the Android
  emulator, dp = px here; how and every number: `docs/design-system.md`). Cards sit 12px
  from the edge, titles at 16; large titles and a thing's name on its own screen 34px;
  room and zone names, row titles, bar and sheet titles 16px medium; row subtitles 12,
  values on the right 13, tile names 14. Automation cards ≥72px, a 32px icon, the text
  from 72px, 16px titles over 13px. List rows (settings, devices, sensors, editors, choice
  sheets) 72px tall, 24px icons at 20px (32px in device lists), text from 72px. Every card
  and tile has a 12px radius. One switch everywhere: 52×32 with a 24px knob well inside
  the track, as tall as the 32px round header buttons. Action buttons are the 36px `.pill`
  in sentence case (capitals only for header pills such as "SAVE"), an editor's "Save"
  sits in its header (a plain grey pill, never the accent), "Delete" is the pill with a
  red border at the bottom. The automation editor's rows have no icons (its type's icon
  sits by its name).
- **Times are chosen on wheels**, never the system's time picker: a time screen
  (`momentChoice`/`timeChoice` in `ds/choice.ts`, wheels in `wheel.ts`) like the Hue
  app's "Start at" — each kind (a time, sunrise, sunset, none) a row with a tick, the
  chosen one's wheels under it, "Done" in the header. An automation's own time of day
  (wake up, go to sleep) sits on its wheels in place (`timeWheels`) under a "Time" switch
  (waking up: off is with sunrise, an offset on one wheel; going to sleep: off is only by
  its Hue buttons, "Controlled by"), its fade on a sheet with a slider and the time it
  leads to. A motion sensor's "Turn off after" is a slider too, its minutes may differ by
  part of the light of the day (`off_after_phases`), and its light level comes from the
  sensor's own light sensor (no choice of one), and so does its daytime brightness when it is on (never a global setting). Coming and leaving home are HA-first: a new one shows only a checklist (home
  zone, people whose phone shares its location "Always"; in the companion app this
  person's own phone, with a button to the app's settings) until HA can know who is home.
- **Banners** are `banner()` (controls.ts), the Hue app's: a 1.5px blue border (amber for a
  warning), a round "i" and a spaced capital 10px title, the text in 13px grey under it, own
  buttons, a round chevron on the right when it leads somewhere. A Sync Box's banner is its
  own (`syncBanner`).
- **Section titles** (10px, spaced capitals) sit 8px over their cards and 32px under the ones before, everywhere:
  rows that scroll sideways keep the room for their cards' shadows inside (padding) and
  give it back outside (negative margin).
- **Headers: everything is 32px tall** — round buttons, switches, pills, the search field.
- **Icons fill their room:** a bigger icon takes its space from the gap next to it, so the
  text never moves (rows, room cards, automation cards); in fixed frames (tiles, round
  buttons, the tab bar) only the icon grows.
- **Font weights: 400, 500 and 700 only.** HA loads Roboto as separate files (100, 300,
  400, 500, 700, 900), so 600 renders as 700 and 800 as 900 there. Keep the font as it is
  (`--ha-font-family-body`, falling back to the system font in the harness).
- **The on-screen keyboard.** Text fields are at least 16px (smaller ones make iOS zoom in).
  While one has focus and the visible viewport shrinks, `fitToViewport` sizes the panel to
  what stays visible (`keyboard` attribute: tab bar hidden, dialogs at the top). New fields
  need nothing else.
- **Haptics.** Picks, drops, snaps, steps and toggles call `haptic()` (`ha-internals.ts`): HA's
  companion apps turn it into the phone's haptics, browsers get `navigator.vibrate`.
- **Sheets and overlays never live inside a scrolling element**: iOS clips them to it. A view
  that opens one renders it outside its scrolling body (the color view's `layers`).
- **Touch drags stay inside.** The panel and the dialog use `keepTouchInside`: a
  drag that nothing under the finger can scroll is not handed to HA's page (no rubber-band,
  no pull to refresh in the app). Scroll containers need `overflow: auto` plus
  `overscroll-behavior: contain`; gestures use pointer events.
- **Frontend: TypeScript + Lit, bundled with esbuild** (`npm run build`). We bundle our own
  Lit (never reach into HA's copy — that is internal API). Standard decorators on `accessor`
  fields (`@property() accessor x`), `strict` TypeScript, `erasableSyntaxOnly` so the pure
  modules run in Node without a build. Views and controls are light-DOM Lit elements
  (`LightElement`) under one shadow root per panel/dialog, so the single stylesheet in
  `ds/styles/` applies. Views get `ctx` plus a `rev` counter that the owner bumps on every
  change (new `hass`, WebSocket data, optimistic state). The built JS is git-ignored; it
  ships in the release zip.
- HACS compatibility is a hard requirement: `hacs.json` at the root, a single integration
  under `custom_components/hue_studio/`, `version` in `manifest.json` bumped with every
  release, GitHub releases tagged `vX.Y.Z`. **For now every release is an alpha:** version
  `X.Y.Z-alpha.N`, tag `vX.Y.Z-alpha.N`, GitHub release marked as a pre-release (the release
  workflow refuses anything else). HACS installs `hue_studio.zip` from the release
  (`zip_release`), built by `.github/workflows/release.yml` — the tag must match the
  manifest version. Pushing the tag is enough: the workflow creates the pre-release
  (generated notes) with the zip attached; a release published in the UI works too, and so
  does running the workflow by hand on a branch (it tags that commit as v<manifest version>). CI runs HACS validation and hassfest.

## Data model

Legacy prototype format (`lights.json`), imported once into Hue Studio: room light lists
are replaced by HA areas, palettes by bridge scenes, and `auto` is offered as the scene of
the day of a new automation (`hue_studio/automations/legacy_auto_light`; its pools are
merged into the global pool like the pools of automations from before 0.10):

```
palettes: [{"id": "sunset", "name": "Sunset", "kind": "gradient", "points": [[x, y], ...2-5],
            "brightness": 80, "image": "sunset"},
           {"id": "read", "name": "Read", "kind": "white", "mirek": 346, "brightness": 100}]
rooms: {"room_a": {"name": "Room A", "light": "light.example_lamp"},
        "room_b": {"name": "Room B", "light": [...], "sync": "switch.example_sync"},
        "room_c": {"light": "light.example_desk", "auto": {
            "pools": {phase: {season | "all": {"clear": [gallery ids], "gloomy": [...]}}},
            "holidays": [{"from": "MM-DD", "to": "MM-DD", "phases": [...], "pool": [...]}],
            "names": {gallery id: name}, "excluded": [ids], "offsets": {phase: %}}}}
```

- `sync` — legacy: an entertainment-sync switch. Hue Studio no longer needs it: lights
  that an entertainment area streams to are known from the bridge.
- Gradient modes: `interpolated_palette`, `random_pixelated`, and others from CLIP v2.
- A palette reference in `apply` is a palette id, `gallery:<scene id>` or `b64:<json>`.
- Gallery scenes carry the Hue `public_image` UUID of their picture; bridge scenes are
  matched to gallery pictures by that id (`metadata.image`), not by name.
- The scene gallery is built from [Hypfer/hass-scene_presets](https://github.com/Hypfer/hass-scene_presets)
  (Apache-2.0; 142 scenes, 480x270 thumbnails bundled, attribution in `NOTICE`). Its
  pictures are clean-room stand-ins; a scene's `picture` is the address of the Hue app's
  own picture (`scripts/hue_scene_pictures.json`, read off the Hue app's copy of its
  gallery), which HA downloads on first use into its cache and serves at
  `/api/hue_studio/gallery/<id>.jpg` (`pictures.py`), the bundled tile standing in until
  then. The Hue app's pictures never go into the repository. The defaults (Read, Relax, …)
  have none: the Hue app ships those inside the app. A picture in the git-ignored
  `frontend/gallery/local/<id>.jpg` comes first (`build_gallery.py --app-defaults <apk>`
  puts the Hue app's defaults there for one install).
- Light icons are the Hue app's, from [elax46/custom-brand-icons](https://github.com/elax46/custom-brand-icons)
  (MIT, attribution in `NOTICE`): a light's CLIP v2 archetype (the shape picked in the Hue app),
  refined by its product name, picks the icon; an icon set in HA's entity settings wins. The
  Hue app's scene glyphs (Read, Relax, …) come from the same set.

## Plan

1. **Backend port.** Config flow, CLIP v2 client + SSE, services and WS API covering
   everything the legacy prototype does (palettes, apply, capture, auto-light pools, import
   of scenes from the bridge). Existing UI is not touched yet. Done when the prototype can
   be fully switched over to Hue Studio services (details in `CLAUDE.local.md`).
2. **`/hue` panel** with the color wheel (gamut, throttle, light dots), gallery, palettes.
3. **More-info override** for Hue lights + fallback.
4. **Automations** — the Hue app's types as HA automations from our blueprints, natural
   light and the scene of the day (phases, seasons, weather, holidays, offsets) as their
   light, with UI in the panel.
5. Publish in the HACS default repository list.

## Layout

```
custom_components/hue_studio/   the integration: one package per feature, each with its own services.py / websocket.py
                                (only that feature's services and commands); HA's own files stay at the root
  __init__.py, const.py         setup of the entries; constants shared by every package
  config_flow.py                setup (menu: Hue Studio once, for every `hue` bridge; Sync Box: pair or use `huesyncbox`); no options flow
  diagnostics.py                a paired Sync Box's own state (redacted), to match the Hue app's settings with its fields
  switch.py, select.py, number.py, sensor.py   platforms: Sync Box entities; the Hue Studio entry's phase sensor and mood select
  services.py, services.yaml    calls each package's async_setup_services; services.yaml describes them all
  websocket.py                  calls each package's async_setup_websocket
  panel.py                      registers the `/hue` panel and serves frontend/ at /hue_studio_static
  core/
    connections.py              the Hue Studio entry: one connection per `hue` bridge, following its entry; bridges as service devices
    options.py                  the entry's options (room mapping, room sensors, panel settings) as the panel changes them;
                                unique ids -> entity ids for the frontend
    websocket.py                hue_studio/config/subscribe|set|set_group|set_room_sensors
    ws.py                       what the commands share: a subscription sending a payload as it changes, a call -> result/error
    entities.py                 waiting for the entity `hue` adds for a resource we just made (a zone, a scene)
  lights/
    bridge.py                   HA light entity <-> bridge resource (aiohue), gamut/gradient/effect info
    targets.py                  a service call's Hue lights (entities, areas, devices, labels; syncing ones left alone), shared values
    palettes.py                 the palette a call names: gallery scene, colors, white, `gallery:<id>`, `b64:<json>`
    services.py                 apply_palette, set_gradient, set_effect
    websocket.py                hue_studio/lights/subscribe
  rooms/
    alignment.py                pure: HA areas <-> Hue rooms of one bridge -> alignment plan (rooms hold devices)
    areas.py                    feeds/applies the plan (registries + bridge), set a light's area, watch changes, auto-align
    zones.py                    "Zones as labels": each Hue zone mirrored as an HA label "Hue zone: <name>", both ways
                                (the side that changed wins, the bridge on a tie; no automatic deletes); pairs in a Store;
                                create_zone waits for the zone's entity
    services.py                 create_zone, update_zone, delete_zone, align_rooms
    websocket.py                hue_studio/rooms/subscribe, hue_studio/lights/set_area, hue_studio/zones/subscribe|relink
  space/
    positions.py                light positions (entertainment areas + Store), editor saves, spatial palette layout
    entertainment.py            entertainment areas: list, create, change (name, type, lights), positions, delete
    websocket.py                hue_studio/positions/subscribe|set, hue_studio/entertainment/subscribe|create|update|delete|positions
  scenes/
    bridge.py                   HA scene entity <-> bridge scene: info, create/save (capture lights or palette), reset (palette)
    gallery.py                  backend access to the bundled gallery
    pictures.py                 gallery pictures: the Hue app's, downloaded once into HA's cache; the bundled tile otherwise
    covers.py                   a scene of your own's own photo: uploaded to HA (image_upload), kept by scene id in a Store
    backup.py                   scenes to a file in <config>/hue_studio/scenes/ and back: lights by Zigbee MAC, copies kept
                                while they hold a deleted scene
    organize.py                 bridge scenes in HA's lists: "Hue Studio" label, category by Hue room/zone (its archetype's
                                icon, alignment.ARCHETYPE_ICONS, also sent to the panel), area of the room;
                                the user's choice wins (what is ours in a Store); "Organize in Home Assistant" option
    services.py                 create_scene, delete_scene, save_scene, reset_scene, recall_scene, export_scenes, import_scenes
    websocket.py                hue_studio/scenes/subscribe|backups|cover
  automations/
    blueprints.py               blueprints in place, our automations (markers) and the others on Hue lights,
                                label/category/area of ours, setup (living light started)
    light.py                    apply_light (scene/white/natural/scene of the day/off), living light (keeps up with the day
                                until changed)
    daylight.py                 pure: phase, season, weather, mood, scene tags -> pool, scene of the day, natural light, brightness;
                                global + an automation's own settings (resolve), old pools -> tags; change tolerance
    pool.py                     the global light of the day: settings in the entry's options, ready-made tags, mood, sources
    scene_tags.json             ready-made tags of every gallery scene (hand-made: phases, seasons, weather, moods)
    websocket.py                hue_studio/automations/subscribe|organize|preview|legacy_auto_light,
                                hue_studio/daylight/subscribe|set|tags|merge
  blueprints/automation/hue_studio/   one blueprint per Hue app type (wake up, go to sleep, coming/leaving home,
                                mimic presence, schedule, motion sensor), validated in tests by HA itself
  devices/
    manage.py                   adding devices: Zigbee search (serials, other brands, install codes from QR codes where the
                                bridge takes them), all devices, name + area + Hue room,
                                a light's function and power-on preset, delete
    identity.py                 every Hue device remembered by Zigbee MAC (its entities' ids and settings, HA device area,
                                name, labels; bridge name, archetype, light settings), rooms/zones/scenes by name; a device
                                or room that comes back as new resources (any way: "Add devices", the Hue app, pairing
                                again) takes its ids and settings back once the old entities are gone
    websocket.py                hue_studio/devices/subscribe|search|identify|setup|sensitivity|delete
  bridges/
    info.py                     every bridge (connected or not): facts, Bridge Pro, rename
    setup.py                    adding a bridge: find it (mDNS, Hue discovery), link it through the native `hue` config flow
                                (its button); Wi-Fi bridges are put on the network by the Hue app
    motion_areas.py             MotionAware areas: health, on/off, create, change, recalibrate, what motion does, delete
    websocket.py                hue_studio/bridges/subscribe|motion_area|rename|discover|link, MotionAware area commands
  sync_box/
    coordinator.py              Sync Box (aiohuesyncbox): coordinator, state, its settings (name, LED, TV, inputs' names and
                                types, Bluetooth for the Hue Sync app's Wi-Fi change, updates at night, restart; the Hue app's
                                automatic control: CEC/HPD/USB/inactivity power, per-input CEC/HPD switching and auto sync,
                                ARC bypass), link to bridge entertainment areas, moving it to another bridge
                                (that bridge's button: its own entertainment credentials, the area of the same name)
    follow.py                   following the picture (HDMI CEC for sources without it, e.g. a PC behind an EDID manager): the
                                box sees a picture (`linked`) only on the input it is on and none asleep, so each input's picture
                                is an HA entity (its player, a sensor) or the box's link while on it; a picture switches (and
                                wakes) the box in that input's mode, another input with one takes over when it is gone; its
                                one screen (media_player) turns on onto its input, off without a picture, and
                                turned on by hand wakes the box, the box waking turns it on; light sync stopped by hand stays
                                stopped for the session; picking an input wakes its source (a wake entity). Edges only; the
                                box entry's options. All of it is the home-made HDMI CEC of "HDMI CEC: Hue Studio" (the box
                                then does not follow the TV); with "HDMI CEC: the box" nothing here acts
    link.py                     Sync Box used through HACS `huesyncbox`: its entities -> panel payload, set_sync_state
    entity.py                   the Sync Box entities' base
    services.py                 set_sync, save/delete_sync_preset, learn/set/delete_sync_ir_code
    websocket.py                hue_studio/sync/subscribe|configure|behavior|follow|input|link_bridge
  brand/                        icon and logo (scripts/build_icon.py), shown by HA 2026.3+
  frontend/                     build output (git-ignored) + gallery/
    gallery/                    generated by scripts/build_gallery.py — do not edit by hand
src/                            frontend sources (TypeScript + Lit), bundled into frontend/; by feature: a feature's
                                pure modules at its root, its Lit screens and sheets in views/
  entries/                      the esbuild entry points (built as frontend/<name>.js)
    hue-studio-panel.ts         panel shell: routing, tab bar; owns the StudioContext
    hue-studio-more-info.ts     more-info override + Hue-style dialog
    hue-studio-extra.ts         extra JS on every HA page: loads more-info, cards and icons, each on its own
  core/                         what every feature shares
    context.ts                  shared by panel and dialog: optimistic hass, WS subscriptions, calls
    optimistic.ts               pure: predicted state of a service call until HA confirms it
    model.ts                    pure: rooms/zones/scenes/sensors from `hass`, light icons
    color.ts                    pure color math (xy/RGB, wheel, gamut clipping, mirek, gradients)
    types.ts                    the subset of HA's `hass` we use + our WebSocket payloads
    ha-internals.ts             the only place that touches HA frontend internals (incl. panel sizing, icon sets,
                                the companion app's QR scanner)
  i18n/                         UI strings: index.ts (localize, LOCALES), en.ts (the source and its keys), pl.ts —
                                one file per locale, typed by the English keys
  ds/                           the design system (docs/design-system.md)
    tokens.ts                   pure: its tokens, as CSS variables
    styles/                     the panel CSS: one sheet split by area, joined in order by index.ts (the cascade
                                depends on that order)
    controls.ts                 hue-studio-slider, room surface/meta, brightness throttled to bridge limits, tileCard
                                (the one card layout), banner
    ui.ts                       icons, toggle, throttle, LightElement
    lights.ts                   a set's lights (zone, entertainment area): the "Lights" card and "Add lights to …"
    base.ts                     StudioView: fixed header + scrolling body, tab/sub headers, sheets, flows
    choice.ts                   a row with its value opens the list to pick from (a sheet for one value, a screen
                                for several), time screens — no <select>, segments or chips inside a section
    wheel.ts                    the picker wheel (scroll snapping, a drum look) of the time screens
    hue-icons.ts, hue-icons-data.ts   the Hue app's light icons as the `hue-studio:` icon set (data generated,
                                do not edit), matched to lights by archetype and product in core/model.ts
  features/
    rooms/                      rooms.ts (pure: mismatches, lights without area, zones), space.ts (pure: placed lights,
                                top-view mapping); views: home, room, rooms (rooms and zones), zone (a zone's editor), space (arrange a room or
                                an entertainment area), add-sheet (a room's "+": scene, automation or device)
    color/                      effects.ts (pure: effect catalog, 1-12 speed scale); views: color (wheel), effects,
                                effect-sheet (an effect's "adjust")
    scenes/                     gallery-data.ts (the bundled gallery, matching), icons.ts (pure: the Hue app's scene
                                glyphs, default scenes drawn as its discs), seasons.ts (pure: seasonal gallery),
                                share.ts (pure: the Hue app's scene share links, both ways);
                                views: scene (editor), new-scene, scene-pick (a scene's sheet), gallery,
                                gallery-settings, scene-sheet (the override's sheet for Hue scenes)
    automations/                automations.ts (pure: blueprint inputs <-> config, the list, the light picker),
                                daylight.ts (pure: scene tags, pools, own settings), presence.ts (pure: whether HA
                                knows who is home); views: automations (the tab, "+"), automation-edit,
                                automation-parts (shared with a sensor's settings), day-parts, daylight-settings,
                                automation-sheet (the override's sheet), automation-art (pictures of the types)
    devices/                    devices.ts (pure: adding devices, QR codes, Settings → Devices); views: devices, device,
                                device-add, qr-scan, sensor (a Hue sensor's settings)
    bridges/                    motion.ts (pure: MotionAware); views: bridges, bridge-add, motion-area, entertainment
    sync/                       sync.ts (pure: Sync Box <-> rooms, predicted set_sync, the more-info memo);
                                views: sync, sync-settings (a Sync Box's settings, the Hue app's pages)
    settings/                   views: settings (tab), integration (options), experimental (empty for now)
    cards/                      cards.ts: dashboard cards (room, automations, gallery) sharing one StudioContext
scripts/build-frontend.mjs      esbuild: src/ -> frontend/ (shared chunk), dev fixture -> dev/build/
scripts/build_gallery.py        rebuilds the bundled gallery from Hypfer/hass-scene_presets
scripts/build_hue_icons.py      rebuilds hue-icons-data.ts from elax46/custom-brand-icons (pinned release)
scripts/hue_public_images.json  Hue app scene name -> picture id (`public_image`), from real bridges
scripts/hue_scene_pictures.json picture id -> Hue app scene name and its picture's address (build_gallery.py --pictures)
scripts/build_icon.py           renders brand/ (icon, logo, dark variants)
scripts/mkdocs_services.py      MkDocs hook: docs/reference/services.md from services.yaml + translations/en.json
scripts/docs_screenshots.py     the docs' screenshots from the harness (headless Chrome) -> docs/assets/screenshots/
dev/panel.html, dev/fixture.ts  harness: the built panel with a fake `hass` (neutral demo data,
                                simulated services), no HA needed
dev/cards.html                  harness: the dashboard cards with the same fake `hass`
tests/                          pytest + pytest-homeassistant-custom-component
tests/js/                       node:test (TypeScript, run by Node directly) for the pure modules
package.json, tsconfig.json     frontend toolchain (Lit, esbuild, TypeScript)
hacs.json                       HACS metadata
NOTICE                          third-party attribution (gallery, Apache-2.0; light icons, MIT)
mkdocs.yml, docs/               the documentation site (MkDocs Material, GitHub Pages): getting-started/, guide/,
                                reference/, help/, development/; design-system.md, rooms-and-scenes.md and
                                roadmap.md stay at the root of docs/ (nav: Development)
.github/workflows/              HACS validation, hassfest, ruff, pytest, frontend; release zip; docs (strict build, Pages)
```

## Tests

- `npm ci && npm run build` first (the panel test serves the built JS), then `uv sync`,
  `uv run pytest`; lint with `uv run ruff check . && uv run ruff format --check .`.
- `pytest-homeassistant-custom-component` is pinned to the minimum supported HA release
  (`hacs.json` → `homeassistant`); bump both together. The bridge is always mocked — CI has
  no real bridge.
- Color math (xy ↔ RGB, gamut clipping, mirek) — pure functions with unit tests.
- Frontend: `npm run typecheck` and `npm test` (model, color math, optimistic state, locale
  parity, stylesheets on the design system's tokens).
- UI, fast loop: `npm run watch`, then `dev/panel.html` (Claude: `preview_start` with `panel-harness` from
  `.claude/launch.json`, then `/dev/panel.html?lang=en|pl&path=/room/area.office`) at 402,
  440 and 1440; `&moreinfo=light.desk_lamp` opens the dialog. The browser pane freezes CSS
  transitions while hidden and crops at 1440, so take final shots with headless Chrome
  (`--headless=new --window-size=1440,900 --virtual-time-budget=6000 --screenshot=…`,
  a fresh `--user-data-dir` per run; for 402/440 use a 520px window plus `&w=402` or
  `&w=440` (and `&inset=59,34` for the safe areas) and crop; a black shot is a headless
  quirk: retake it with a shorter `--virtual-time-budget`).
- Custom panels get no height from HA: the panel sizes itself to the viewport
  (`fitToViewport`), otherwise the page doesn't scroll and the tab bar ends up below the
  content. The panel is registered with `handle_safe_area`: it pads the status bar and home
  indicator itself (`--safe-area-inset-*`); without it HA pads `ha-panel-custom` and a
  full-height panel overflows the screen in the mobile app. Harness: `&inset=59,34` fakes a
  phone's safe areas, `&pad=59,34` additionally pads the slot like HA would.
- A room's scenes are the Hue app's: two rows that scroll sideways (the scenes in columns
  of two as they come), the gallery over the suggestion at their end; the active one
  shows play/stop (a dynamic one) in place of its picture and gets edit and "⋯" beside it
  (copy to another room, dynamic speed, shuffle colors, delete), the cards after it in
  its row sliding aside and the buttons fading in; then the scene gallery and a suggested scene (a scene of the
  day now by the ready-made tags alone, tinted with its colors, rising from its stack on
  shuffle). A scene's sheet (`scene-pick.ts`: the gallery's, and "Copy to…") is the Hue
  app's: picture, name and pencil, colors and shuffle, room or zone, "Save to my scenes",
  "Set once". A light playing a dynamic scene says
  "Dynamics" and its card's colors drift at the scene's speed (`dynamics` of the light).
- Gradient lights always show `points_capable` pins on the wheel (fixed per device, like the
  Hue app). Pins with the same color are drawn as one pin with a count (a uniform gradient,
  or pins merged by dropping one on another); a tap spreads them around a disc to pull one
  out. There is no point-count control and no "all lights one color" switch.
- UI, final check: screenshots (phone + desktop) on a live HA instance.
- Docs: `uv run --group docs mkdocs build --strict` (Claude: `preview_start` with `docs`).
  The user-facing docs live on the site (`docs/`), the README is only its landing page.
  A new service needs its `<!-- service: name -->` marker in `docs/reference/services.md`
  (the strict build fails without it); a feature that users see gets its guide page
  updated in the same change, and a screen that changed gets its docs screenshot retaken
  (`uv run python scripts/docs_screenshots.py <name>`).
