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
> lights, a gamut-aware color wheel with gradient points, and the scene gallery with
> "set once". See the roadmap below.

## Services

| Service | What it does |
|---|---|
| `hue_studio.apply_palette` | Apply a gallery scene (`gallery_scene`), up to 5 colors (`points`, CIE xy) or a white (`mirek`) to Hue lights, rooms or areas. Gradient lights get the whole palette, others one color each. |
| `hue_studio.set_gradient` | Set 2-5 color points (and the mode) of Hue gradient lights. |

## Requirements

- Home Assistant 2026.10.0 or newer
- The Philips Hue integration set up with a bridge on API v2 (Hue Bridge v2 / Pro)

## Installation

### HACS (custom repository)

1. HACS → ⋮ → **Custom repositories** → add `https://github.com/pnwclw/hue-studio`,
   category **Integration**.
2. Install **Hue Studio** and restart Home Assistant.
3. **Settings → Devices & services → Add integration → Hue Studio**, then pick your Hue
   bridge.

### Manual

Copy `custom_components/hue_studio` into `<config>/custom_components/` and restart Home
Assistant.

## Roadmap

1. **Backend** — CLIP v2 client with event stream, services (`apply_palette`,
   `set_gradient`, `capture`, palette management, effects) and a WebSocket API.
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

Rebuild the bundled scene gallery: `uv run python scripts/build_gallery.py`.

## License

[MIT](LICENSE). The bundled scene gallery is derived from
[Hypfer/hass-scene_presets](https://github.com/Hypfer/hass-scene_presets) (Apache-2.0), see
[NOTICE](NOTICE).
