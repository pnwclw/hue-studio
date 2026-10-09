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
   "auto light" — and a good UI for it.
2. **Backend** — `custom_components/hue_studio/`:
   - its own CLIP v2 connection to the bridge (aiohue). **Host and app key are read from
     the `hue` config entry** — no second pairing with the bridge button. We never reach
     into the native integration's bridge object via `hass.data`: that is internal API and
     breaks on upgrades;
   - the bridge event stream (SSE) pushes state, no polling;
   - **services with schemas** (`hue_studio.apply_palette`, `set_gradient`, `capture`,
     `palette_save`, `palette_delete`, `set_effect`, …) — visible in the automation editor;
   - **WebSocket API** (`hue_studio/palettes`, `hue_studio/rooms`, `hue_studio/subscribe`,
     …) for the frontend;
   - storage: a JSON/YAML file in the config directory or `helpers.storage.Store` — to be
     decided during the port. Requirement: the data stays human-readable and diffable, so
     it can be versioned in git together with the HA config.
3. **Frontend** — registered by the integration itself via `frontend.add_extra_js_url`
   (no manual Lovelace resources):
   - **panel** (`panel_custom`, `/hue`): a full-screen "Hue app" — rooms, color wheel with
     draggable light dots, gallery, palettes, auto-light settings. It copies the Hue app's
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
4. Later (not in the first iteration): a global "Liquid Glass" footer instead of the
   sidebar, with the `/hue` panel as one of its tabs.

## Rules that must not be broken

- **Fallback.** If our JS fails to load or crashes, HA must show the stock more-info dialog.
  Losing access to a light because of our code is unacceptable.
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
  `hue` dependency to install it.

## Conventions

- **Code style follows Home Assistant core:** `async`, full type hints,
  `ConfigEntry.runtime_data`, translated exceptions, `config_flow` (one step: pick an
  existing `hue` entry). Ruff with HA-like settings (`pyproject.toml`).
- **Every screen works on phone and desktop.** Verified with screenshots at widths 430 and
  1440 (how: see `CLAUDE.local.md`). A UI change is not done without screenshots.
- Frontend without a bundler if possible (ES modules). If Lit is needed, use the one that
  already ships with the HA frontend instead of bundling our own.
- HACS compatibility is a hard requirement: `hacs.json` at the root, a single integration
  under `custom_components/hue_studio/`, `version` in `manifest.json` bumped with every
  release, GitHub releases tagged `vX.Y.Z`. CI runs HACS validation and hassfest.

## Data model

Palettes, rooms and auto-light pools (format inherited from the legacy prototype; may be
refined during the port):

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

- `sync` — an entertainment-sync switch (e.g. Hue Sync Box); while it is on, scenes are not
  applied to those lights.
- Gradient modes: `interpolated_palette`, `random_pixelated`, and others from CLIP v2.
- A palette reference in `apply` is a palette id, `gallery:<scene id>` or `b64:<json>`.
- The scene gallery is built from [Hypfer/hass-scene_presets](https://github.com/Hypfer/hass-scene_presets)
  (Apache-2.0; 142 scenes, 480x270 thumbnails bundled, attribution in `NOTICE`).

## Plan

1. **Backend port.** Config flow, CLIP v2 client + SSE, services and WS API covering
   everything the legacy prototype does (palettes, apply, capture, auto-light pools, import
   of scenes from the bridge). Existing UI is not touched yet. Done when the prototype can
   be fully switched over to Hue Studio services (details in `CLAUDE.local.md`).
2. **`/hue` panel** with the color wheel (gamut, throttle, light dots), gallery, palettes.
3. **More-info override** for Hue lights + fallback.
4. **Auto light** — phases, seasons, weather, holidays and offsets in Python, with UI in the
   panel.
5. Publish in the HACS default repository list.

## Layout

```
custom_components/hue_studio/   the integration (manifest, config flow, translations, …)
  lights.py                     HA light entity <-> bridge resource (aiohue), gamut/gradient info
  services.py, services.yaml    apply_palette, set_gradient
  websocket.py                  hue_studio/lights/subscribe
  panel.py                      registers the `/hue` panel and serves frontend/ at /hue_studio_static
  gallery.py                    backend access to the bundled gallery
  frontend/                     ES modules, no build step
    hue-studio-panel.js         panel shell: routing, tab bar, WS subscription, view context
    views/                      home, room, color (wheel), gallery — one class per screen
    model.js                    pure: rooms/zones/scenes/state from `hass`
    color.js                    pure color math (xy/RGB, wheel mapping, gamut clipping, mirek)
    ui.js, styles.js            DOM helpers (toggle, slider, throttle) and the panel CSS
    i18n.js                     UI strings (en is the source; same keys in every locale)
    ha-internals.js             the only place that touches HA frontend internals
    gallery/                    generated by scripts/build_gallery.py — do not edit by hand
scripts/build_gallery.py — do not edit by hand
scripts/build_gallery.py        rebuilds the bundled gallery from Hypfer/hass-scene_presets
dev/panel.html, dev/fixture.js harness: the panel with a fake `hass` (neutral demo data,
                                simulated services), no HA needed
tests/                          pytest + pytest-homeassistant-custom-component
tests/js/                       node:test for the pure frontend modules
hacs.json                       HACS metadata
NOTICE                          third-party attribution (gallery, Apache-2.0)
.github/workflows/              HACS validation, hassfest, ruff, pytest
```

## Tests

- `uv sync`, then `uv run pytest`; lint with `uv run ruff check . && uv run ruff format --check .`.
- `pytest-homeassistant-custom-component` is pinned to the minimum supported HA release
  (`hacs.json` → `homeassistant`); bump both together. The bridge is always mocked — CI has
  no real bridge.
- Color math (xy ↔ RGB, gamut clipping, mirek) — pure functions with unit tests.
- Frontend logic: `node --test tests/js/*.test.mjs` (model, color math, locale parity).
- UI, fast loop: `dev/panel.html` (Claude: `preview_start` with `panel-harness` from
  `.claude/launch.json`, then `/dev/panel.html?lang=en|pl&path=/room/area.office`) at 430
  and 1440. At 1440 the browser pane crops; use headless Chrome
  (`--headless=new --window-size=1440,900 --virtual-time-budget=8000 --screenshot=…`,
  a fresh `--user-data-dir` per run).
- UI, final check: screenshots (phone + desktop) on a live HA instance.
