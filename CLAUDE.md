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
   - its own CLIP v2 connection to the bridge (aiohue). **Host and app key are read from
     the `hue` config entry** — no second pairing with the bridge button. We never reach
     into the native integration's bridge object via `hass.data`: that is internal API and
     breaks on upgrades;
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
     hold (light positions outside entertainment areas) goes to `helpers.storage.Store`;
   - **automations are HA automations**: Hue Studio ships blueprints, one per Hue app type
     (`blueprints/automation/hue_studio/`, copied into HA's blueprint folder on setup); the
     panel writes automations that use them through HA's automation config API, HA stores
     and runs them. No automation engine of our own. Settings of natural light and the scene
     of the day (pools, phases, holidays, brightness) are an input of the automation;
     `hue_studio.apply_light` shows them and keeps them up with the day while nobody
     changes the lights (memory only). Our automations have ids `hue_studio_<type>_…` and
     get the "Hue Studio" label and category and the area of their one room;
   - **GUI first, no YAML.** Every setting has a GUI path (panel or options flow) and is
     read/written through the WS API and services, never by editing files. No YAML
     configuration layer.
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
     - **Zones = Hue rooms/zones** (light entities with `is_hue_group`) that match no area.
     - Everyday control goes through stock HA services (`light.turn_on`, `scene.turn_on`);
       only what HA can't do goes through ours (`hue_studio.set_gradient`,
       `hue_studio.apply_palette`) and `hue_studio/lights/subscribe` (gamut, gradients);
   - **more-info override**: listen to `hass-more-info` before HA does; if the entity is a
     Hue light (`hass.entities[id].platform === "hue"`), open our own sheet, otherwise let
     the event through untouched;
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
5. **Experimental** (Settings → Experimental): a global "Liquid Glass" footer on phones
   instead of the side menu, with dashboards and the `/hue` panel as its tabs. It reserves
   its room through HA's `--safe-area-inset-bottom` and never shows on `/config/...`.

## Rules that must not be broken

- **Fallback.** If our JS fails to load or crashes, HA must show the stock more-info dialog.
  Losing access to a light because of our code is unacceptable. The override stops the
  `hass-more-info` event only after our dialog was built; its "Details" button and any
  event with `detail.view` go to HA's own dialog.
- **Instant UI.** Every command shows its expected result immediately (`optimistic.ts`)
  and falls back to the real state on error or after 5 s without confirmation.
- **Adaptive Lighting.** Our services (and scene activation from the panel) mark the
  affected lights as manually controlled, so Adaptive Lighting doesn't overwrite them.
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
  `ConfigEntry.runtime_data`, translated exceptions, `config_flow` (a menu: pick an
  existing `hue` entry, or add a Sync Box: pair it or use HACS `huesyncbox`). Ruff with HA-like settings (`pyproject.toml`).
- **Every screen works on phone and desktop.** Verified with screenshots at widths 430 and
  1440 (how: see `CLAUDE.local.md`). A UI change is not done without screenshots.
- **The on-screen keyboard.** Text fields are at least 16px (smaller ones make iOS zoom in).
  While one has focus and the visible viewport shrinks, `fitToViewport` sizes the panel to
  what stays visible (`keyboard` attribute: tab bar hidden, dialogs at the top); the
  footer hides while a field has focus. New fields need nothing else.
- **Haptics.** Picks, drops, snaps, steps and toggles call `haptic()` (`ha-internals.ts`): HA's
  companion apps turn it into the phone's haptics, browsers get `navigator.vibrate`.
- **Sheets and overlays never live inside a scrolling element**: iOS clips them to it. A view
  that opens one renders it outside its scrolling body (the color view's `layers`).
- **Touch drags stay inside.** The panel, the dialog and the footer use `keepTouchInside`: a
  drag that nothing under the finger can scroll is not handed to HA's page (no rubber-band,
  no pull to refresh in the app). Scroll containers need `overflow: auto` plus
  `overscroll-behavior: contain`; gestures use pointer events.
- **Frontend: TypeScript + Lit, bundled with esbuild** (`npm run build`). We bundle our own
  Lit (never reach into HA's copy — that is internal API). Standard decorators on `accessor`
  fields (`@property() accessor x`), `strict` TypeScript, `erasableSyntaxOnly` so the pure
  modules run in Node without a build. Views and controls are light-DOM Lit elements
  (`LightElement`) under one shadow root per panel/dialog, so the single stylesheet in
  `styles.ts` applies. Views get `ctx` plus a `rev` counter that the owner bumps on every
  change (new `hass`, WebSocket data, optimistic state). The built JS is git-ignored; it
  ships in the release zip.
- HACS compatibility is a hard requirement: `hacs.json` at the root, a single integration
  under `custom_components/hue_studio/`, `version` in `manifest.json` bumped with every
  release, GitHub releases tagged `vX.Y.Z`. **For now every release is an alpha:** version
  `X.Y.Z-alpha.N`, tag `vX.Y.Z-alpha.N`, GitHub release marked as a pre-release (the release
  workflow refuses anything else). HACS installs `hue_studio.zip` from the release
  (`zip_release`), built by `.github/workflows/release.yml` — the tag must match the
  manifest version. CI runs HACS validation and hassfest.

## Data model

Legacy prototype format (`lights.json`), imported once into Hue Studio: room light lists
are replaced by HA areas, palettes by bridge scenes, and `auto` is offered as the scene of
the day settings of a new automation (`hue_studio/automations/legacy_auto_light`):

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
  (Apache-2.0; 142 scenes, 480x270 thumbnails bundled, attribution in `NOTICE`).
- Light icons are the Hue app's, from [elax46/custom-brand-icons](https://github.com/elax46/custom-brand-icons)
  (MIT, attribution in `NOTICE`): a light's CLIP v2 archetype (the shape picked in the Hue app),
  refined by its product name, picks the icon; an icon set in HA's entity settings wins.

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
custom_components/hue_studio/   the integration (manifest, config flow, translations, …)
  lights.py                     HA light entity <-> bridge resource (aiohue), gamut/gradient/effect info
  scenes.py                     HA scene entity <-> bridge scene: info, create/save (capture lights or palette), reset (palette)
  services.py, services.yaml    apply_palette, set_gradient, set_effect, create_scene, delete_scene, create_zone, update_zone, delete_zone,
                                align_rooms, save_scene, reset_scene, recall_scene, set_sync
  websocket.py                  hue_studio/lights|scenes|config|sync|rooms|positions|devices/subscribe, hue_studio/lights/set_area,
                                hue_studio/config/set|set_group|set_room_sensors, hue_studio/positions/set,
                                hue_studio/devices/search|identify|setup, hue_studio/entertainment/subscribe|create|update|delete|positions,
                                hue_studio/bridges/subscribe|motion_area
  alignment.py                  pure: HA areas <-> Hue rooms of one bridge -> alignment plan (rooms hold devices)
  rooms.py                      feeds/applies the plan (registries + bridge), set a light's area, watch changes, auto-align
  devices.py                    adding devices: Zigbee search (serials), all devices, name + area + Hue room
  entertainment.py              entertainment areas: list, create, change (name, type, lights), positions, delete
  bridges.py                    bridge facts and MotionAware areas (health, on/off) for the settings
  automations.py                blueprints in place, apply_light (scene/white/natural/scene of the day/off), living light
                                (keeps up with the day until changed), label/category/area of our automations,
                                hue_studio/automations/subscribe|organize|preview|legacy_auto_light
  blueprints/automation/hue_studio/   one blueprint per Hue app type (wake up, go to sleep, coming/leaving home,
                                mimic presence, schedule, motion sensor), validated in tests by HA itself
  daylight.py                   pure: phase, season, weather, pool, scene of the day, natural light, brightness; change tolerance
  positions.py                  light positions (entertainment areas + Store), editor saves, spatial palette layout
  sync.py                       Sync Box (aiohuesyncbox): coordinator, state, link to bridge entertainment areas
  sync_link.py                  Sync Box used through HACS `huesyncbox`: its entities -> panel payload, set_sync_state
  entity.py, switch.py, select.py, number.py, sensor.py   Sync Box entities
  brand/                        icon and logo (scripts/build_icon.py), shown by HA 2026.3+
  config_flow.py                setup (menu: pick a `hue` entry; Sync Box: pair or use `huesyncbox`) + options: Hue room/zone -> HA area,
                                motion/temperature sensors per room, rooms follow areas (Roborock-style menu)
  options.py                    option helpers; unique ids -> entity ids for the frontend
  adaptive.py                   Adaptive Lighting: mark lights manual after our commands
  panel.py                      registers the `/hue` panel and serves frontend/ at /hue_studio_static
  gallery.py                    backend access to the bundled gallery
  frontend/                     build output (git-ignored) + gallery/
    gallery/                    generated by scripts/build_gallery.py — do not edit by hand
src/                            frontend sources (TypeScript + Lit), bundled into frontend/
  hue-studio-panel.ts           panel shell: routing, tab bar; owns the StudioContext
  hue-studio-extra.ts           extra JS on every HA page: loads more-info, cards and footer, each on its own
  hue-studio-more-info.ts       more-info override + Hue-style dialog
  cards.ts                      dashboard cards (room, automations, gallery) sharing one StudioContext
  footer.ts, footer-model.ts    experimental Liquid Glass footer (element; pure: tabs, active tab, visibility)
  context.ts                    shared by panel and dialog: optimistic hass, WS subscriptions, calls
  optimistic.ts                 pure: predicted state of a service call until HA confirms it
  controls.ts                   hue-studio-slider, room surface/meta, brightness throttled to bridge limits
  views/                        home, room, color (wheel), effects, scene (editor), gallery, sync, settings (tab), rooms (rooms and zones),
                                automations (the tab, "+" and a room's list), add-sheet (a room's "+": scene, automation or device), automation-edit (one automation;
                                natural light / scene of the day settings as its second page), new-scene (the "New scene" sheet), effect-sheet (an effect's "adjust"), space (arrange a room or an entertainment area),
                                experimental, devices, bridges (and MotionAware), entertainment, integration (options),
                                gallery-settings (all scenes, or each category by its rule)
                                — one Lit element per screen; base.ts: fixed header + scrolling body, tab/sub headers
  space.ts                      pure: placed lights, top-view coordinate mapping
  automations.ts                pure: blueprint inputs <-> automation config, defaults, what the list shows
  daylight.ts                   pure: editing natural light / scene of the day settings (pools, offsets, …)
  rooms.ts                      pure: mismatches, lights without area, zones — from the alignment plan and `hass`
  sync.ts                       pure: Sync Box <-> rooms, predicted state of set_sync, the memo more-info reads
  seasons.ts                    pure: seasonal gallery (a rule per category: seasons and/or dates; season source)
  effects.ts                    pure: effect catalog (categories, presets), 1-12 speed scale
  model.ts                      pure: rooms/zones/scenes/sensors/Adaptive Lighting from `hass`
  color.ts                      pure color math (xy/RGB, wheel, gamut clipping, mirek, gradients)
  types.ts                      the subset of HA's `hass` we use + our WebSocket payloads
  ui.ts, styles.ts              icons, toggle, throttle, LightElement; the panel CSS
  i18n.ts                       UI strings (en is the source; same keys in every locale)
  ha-internals.ts               the only place that touches HA frontend internals (incl. panel sizing, icon sets)
  hue-icons.ts, hue-icons-data.ts   the Hue app's light icons as the `hue-studio:` icon set (data generated,
                                do not edit), matched to lights by archetype and product in model.ts
scripts/build-frontend.mjs      esbuild: src/ -> frontend/ (shared chunk), dev fixture -> dev/build/
scripts/build_gallery.py        rebuilds the bundled gallery from Hypfer/hass-scene_presets
scripts/build_hue_icons.py      rebuilds hue-icons-data.ts from elax46/custom-brand-icons (pinned release)
scripts/hue_public_images.json  Hue app scene name -> picture id (`public_image`), from real bridges
scripts/build_icon.py           renders brand/ (icon, logo, dark variants)
dev/panel.html, dev/fixture.ts  harness: the built panel with a fake `hass` (neutral demo data,
                                simulated services), no HA needed
dev/cards.html                  harness: the dashboard cards and the footer (&footer=1) with the same fake `hass`
tests/                          pytest + pytest-homeassistant-custom-component
tests/js/                       node:test (TypeScript, run by Node directly) for the pure modules
package.json, tsconfig.json     frontend toolchain (Lit, esbuild, TypeScript)
hacs.json                       HACS metadata
NOTICE                          third-party attribution (gallery, Apache-2.0; light icons, MIT)
.github/workflows/              HACS validation, hassfest, ruff, pytest, frontend; release zip
```

## Tests

- `npm ci && npm run build` first (the panel test serves the built JS), then `uv sync`,
  `uv run pytest`; lint with `uv run ruff check . && uv run ruff format --check .`.
- `pytest-homeassistant-custom-component` is pinned to the minimum supported HA release
  (`hacs.json` → `homeassistant`); bump both together. The bridge is always mocked — CI has
  no real bridge.
- Color math (xy ↔ RGB, gamut clipping, mirek) — pure functions with unit tests.
- Frontend: `npm run typecheck` and `npm test` (model, color math, optimistic state, locale
  parity).
- UI, fast loop: `npm run watch`, then `dev/panel.html` (Claude: `preview_start` with `panel-harness` from
  `.claude/launch.json`, then `/dev/panel.html?lang=en|pl&path=/room/area.office`) at 430
  and 1440; `&moreinfo=light.desk_lamp` opens the dialog. The browser pane freezes CSS
  transitions while hidden and crops at 1440, so take final shots with headless Chrome
  (`--headless=new --window-size=1440,900 --virtual-time-budget=6000 --screenshot=…`,
  a fresh `--user-data-dir` per run; for 430 use a 520px window plus `&w=430` and crop).
- Custom panels get no height from HA: the panel sizes itself to the viewport
  (`fitToViewport`), otherwise the page doesn't scroll and the tab bar ends up below the
  content. The panel is registered with `handle_safe_area`: it pads the status bar and home
  indicator itself (`--safe-area-inset-*`); without it HA pads `ha-panel-custom` and a
  full-height panel overflows the screen in the mobile app. Harness: `&inset=59,34` fakes a
  phone's safe areas, `&pad=59,34` additionally pads the slot like HA would.
- Gradient lights always show `points_capable` pins on the wheel (fixed per device, like the
  Hue app). Pins with the same color are drawn as one pin with a count (a uniform gradient,
  or pins merged by dropping one on another); a tap spreads them around a disc to pull one
  out. There is no point-count control and no "all lights one color" switch.
- UI, final check: screenshots (phone + desktop) on a live HA instance.
