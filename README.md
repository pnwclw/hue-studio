# Hue Studio

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/docs/faq/custom_repositories)
[![Validate](https://github.com/pnwclw/hue-studio/actions/workflows/validate.yml/badge.svg)](https://github.com/pnwclw/hue-studio/actions/workflows/validate.yml)
[![Tests](https://github.com/pnwclw/hue-studio/actions/workflows/tests.yml/badge.svg)](https://github.com/pnwclw/hue-studio/actions/workflows/tests.yml)

A Home Assistant custom integration that brings the look and feel of the Philips Hue app
to Home Assistant — a color wheel with draggable light dots, a scene gallery, palettes,
multi-color gradients — and adds what the Hue app cannot do: Home Assistant logic such as
time-of-day phases, weather, seasons, presence and automations.

Hue Studio **extends** the built-in [Philips Hue](https://www.home-assistant.io/integrations/hue/)
integration instead of replacing it. Lights, scenes and sensors stay with the native
integration; Hue Studio reuses its bridge connection, so no second pairing is needed.

> **Status:** early development. So far: config flow, bridge connection, services and a
> `/hue` sidebar panel — rooms (your HA areas) and zones, room view with Hue scenes and
> lights, a gamut-aware color wheel with one pin per gradient point, light effects
> (candle, fireplace, sparkle, … with color, brightness and speed), a scene editor (save,
> dynamic speed, auto-play, reset, dynamic playback), the scene gallery with
> "set once", and the Hue Play HDMI Sync Box (a Sync tab, its own entities and
> service). See the roadmap below.

## Services

| Service | What it does |
|---|---|
| `hue_studio.apply_palette` | Apply a gallery scene (`gallery_scene`), up to 5 colors (`points`, CIE xy), a white (`mirek`) or a `palette` reference (`gallery:<id>`, `b64:<base64 JSON>`) to Hue lights, rooms or areas (an area uses its Hue lights only). Gradient lights get the whole palette (laid out by `mode` when they support it), others one color each; optional `brightness` and `transition` (s). |
| `hue_studio.set_gradient` | Set 2-5 color points (and the mode) of Hue gradient lights. |
| `hue_studio.set_effect` | Play an effect (`candle`, `fire`, `sparkle`, `glisten`, `opal`, `prism`, `underwater`, `cosmos`, `sunbeam`, `enchant`; `no_effect` stops it) with an optional color (`xy_color` or `mirek`), `speed` and `brightness`. |
| `hue_studio.create_scene` | Create a scene in a Hue room or zone (target its light group), visible in the Hue app: from a `gallery_scene`, `points` or `mirek` (spread over the lights and stored as the scene palette), otherwise from what the lights show now. Returns the new `scene_id`. |
| `hue_studio.delete_scene` | Delete Hue scenes from the bridge. |
| `hue_studio.save_scene` | Store what a Hue scene's lights show now in the scene; optionally rename it and set its dynamic `speed` and `auto_dynamic` (auto-play). |
| `hue_studio.reset_scene` | Rebuild a Hue scene's light settings from its palette (optionally `shuffle`d) and activate it. |
| `hue_studio.recall_scene` | Play a Hue scene dynamically or statically (`dynamic`), regardless of its auto-play setting. |
| `hue_studio.auto_light_pool` | Set the gallery scenes of one auto light pool of an area (`phase`, `season`, `step`: clear/gloomy, or 0-3 for the day). |
| `hue_studio.auto_light_exclude` | Never (or again, `excluded: false`) pick a gallery scene in an area's auto light. |
| `hue_studio.auto_light_offset` | Shift an area's brightness in one phase by `delta` percent (0 resets); returns the offset. |
| `hue_studio.import_legacy` | Import the auto light of rooms from a legacy `lights.json` into Hue Studio. |
| `hue_studio.set_sync` | Change a Sync Box in one command: `power`, `sync`, `mode` (video/music/game), `intensity`, `input` (id or name), `entertainment_area` (id or name), `brightness`. |

Palette, gradient and effect services leave lights alone while an entertainment area
streams to them (Sync Box, PC or TV sync): the stream would overwrite them anyway.

## Hue Play HDMI Sync Box

There are two ways to use a Sync Box with Hue Studio. You choose when you add it, and
one box is only ever set up one way.

### Pair directly (recommended)

Hue Studio talks to the box itself (local API via
[aiohuesyncbox](https://github.com/mvdwetering/aiohuesyncbox)) and pairs with its
button. This mode has every feature, and new Sync Box features in Hue Studio are built
for it. It brings its own entities: power and light sync switches; sync mode,
intensity, HDMI input, entertainment area and LED selects; brightness; HDMI port,
content, bridge connection and Wi-Fi sensors. Entity ids and option values match the
HACS Sync Box integration (`switch.sync_box_light_sync`, `select.sync_box_hdmi_input`
with your input names, …), so automations keep working when you switch over: remove the
box from that integration first, then add it to Hue Studio.

### Compatibility mode: through the Sync Box integration

Already using the HACS [Hue Sync Box integration](https://github.com/mvdwetering/huesyncbox)
and want to keep it? Hue Studio can work through it instead: nothing to pair and no
entities of Hue Studio's own. It reads that integration's entities and controls the box
with its `huesyncbox.set_sync_state` service. The panel, the Sync tab and
`hue_studio.set_sync` work the same; when you discover or try to pair a box that the
integration already has, Hue Studio offers this mode.

Limits, because Hue Studio only sees what that integration exposes:

- entertainment areas are matched with the bridge by name (a renamed area needs the
  integration to pick up the new name);
- input types (the icons of HDMI inputs) and whether the current content can be synced
  are not available;
- new Sync Box features of Hue Studio need direct pairing.

To switch to direct pairing later, remove the box from the Sync Box integration and
add it to Hue Studio again.

### In both modes

- **Panel**: a Sync tab like in the Hue app, a Sync card in rooms whose lights the box
  syncs, and no scenes on those lights while it syncs.
- **`hue_studio.set_sync`**: one service for both modes (target any entity of the box).
- **Bridge link**: the box's entertainment areas are matched with the bridge, so Hue
  Studio knows which lights are synced, and when streaming starts or stops the bridge
  pushes it at once.

Both Hue Studio and the Sync Box integration require aiohuesyncbox; Hue Studio accepts
any 0.1.x release from 0.1.6 on, so the two share one copy.

Add it under **Settings → Devices & services → Add integration → Hue Studio → Hue
Play HDMI Sync Box** (or accept the discovered device), then pick **Pair directly
(recommended)** — hold the button on the box for about 3 seconds — or, when the Sync
Box integration is installed, **Use the Sync Box integration (compatibility mode)**.

## Requirements

- Home Assistant 2026.10.0 or newer
- The Philips Hue integration set up with a bridge on API v2 (Hue Bridge v2 / Pro)

## Installation

### HACS (custom repository)

1. HACS → ⋮ → **Custom repositories** → add `https://github.com/pnwclw/hue-studio`,
   category **Integration**.
2. Install **Hue Studio** and restart Home Assistant.
3. **Settings → Devices & services → Add integration → Hue Studio → Hue bridge**, then
   pick your Hue bridge.

### Manual

Copy `custom_components/hue_studio` into `<config>/custom_components/` and restart Home
Assistant.

## Roadmap

1. **Backend** — CLIP v2 client with event stream, services (`apply_palette`,
   `set_gradient`, scenes created on the bridge, effects) and a WebSocket API.
2. **`/hue` panel** — rooms, gamut-aware color wheel, scene gallery, palettes.
3. **More-info override** for Hue lights, with a safe fallback to the stock dialog.
4. **Auto light** — scene and brightness picked by time-of-day phase, season, weather and
   holidays.
5. Dashboard cards.

## Development

```bash
npm ci && npm run build    # frontend: src/ (TypeScript + Lit) -> custom_components/hue_studio/frontend/
uv sync
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

The frontend is written in TypeScript with [Lit](https://lit.dev) and bundled by esbuild;
the built JavaScript is not committed. `npm run typecheck` and `npm test` (node:test on the
pure modules) check it; `npm run watch` rebuilds on change.

Preview the panel without Home Assistant (fake demo data): run `npm run watch` and
`python3 -m http.server 8765` in the repository root, then open
<http://localhost:8765/dev/panel.html?lang=en>.

Releases: publishing a GitHub release `vX.Y.Z-alpha.N` (matching `version` in
`manifest.json`, marked as a pre-release) builds the frontend and attaches `hue_studio.zip`,
which HACS installs. Everything is alpha for now: enable "Show beta versions" in HACS.

Rebuild the bundled scene gallery: `uv run python scripts/build_gallery.py`; the icon
and logo (`custom_components/hue_studio/brand/`, shown by Home Assistant 2026.3+):
`uv run python scripts/build_icon.py`.

## License

[MIT](LICENSE). The bundled scene gallery is derived from
[Hypfer/hass-scene_presets](https://github.com/Hypfer/hass-scene_presets) (Apache-2.0), see
[NOTICE](NOTICE).
