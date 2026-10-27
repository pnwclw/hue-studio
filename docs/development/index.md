# Development

## Setup

```bash
npm ci && npm run build    # frontend: src/ (TypeScript + Lit) -> custom_components/hue_studio/frontend/
uv sync
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

The frontend is written in TypeScript with [Lit](https://lit.dev) and bundled by esbuild;
the built JavaScript is not committed. `npm run typecheck` and `npm test` (node:test on the
pure modules) check it; `npm run watch` rebuilds on change.

`pytest-homeassistant-custom-component` is pinned to the minimum supported Home Assistant
release (`hacs.json` → `homeassistant`); the two are bumped together. The bridge is always
mocked: CI has no real bridge.

## The harness

Preview the panel without Home Assistant, on fake demo data: run `npm run watch` and
`python3 -m http.server 8765` in the repository root, then open
<http://localhost:8765/dev/panel.html?lang=en>.

| Parameter | |
|---|---|
| `path=/room/area.office` | The panel's route. |
| `moreinfo=light.desk_lamp` | Opens the more-info dialog. |
| `w=402` | Pins the layout width (headless Chrome windows can't be narrower than ~500 px). |
| `inset=59,34` | Fakes a phone's safe areas; `pad=59,34` also pads the slot like HA would. |
| `drift=1` | Adds a light moved in the Hue app and one without an area. |
| `click=<selector>\|…` | Clicks elements in turn (through shadow roots), to open a sheet for a shot. |

`dev/cards.html` shows the dashboard cards on the same data.

## Architecture

- **Backend** (`custom_components/hue_studio/`): one Hue Studio config entry for every
  bridge of the native `hue` integration, each with its own CLIP v2 connection (aiohue)
  and event stream. Host and app key come from the bridge's `hue` config entry; Hue Studio
  never reaches into the native integration's internals. One package per feature
  (`lights/`, `rooms/`, `scenes/`, `space/`, `automations/`, `devices/`, `bridges/`,
  `sync_box/`), each with its own `services.py` and `websocket.py`; what several use lives
  in `core/`.
- **Data on the bridge.** Everything the Hue app can show lives on the bridge (scenes with
  their palettes, rooms, zones); only what the bridge cannot hold goes to
  `helpers.storage.Store`.
- **Automations are Home Assistant automations** from the blueprints in
  `blueprints/automation/hue_studio/`, written by the panel through Home Assistant's
  automation config API.
- **Frontend** (`src/`): TypeScript + Lit, bundled by esbuild into
  `custom_components/hue_studio/frontend/` and registered by the integration itself. The
  panel, the more-info override and the dashboard cards share one context
  (`src/core/context.ts`); every screen is made of the [design system](../design-system.md).
  Everything that depends on Home Assistant's frontend internals lives in
  `src/core/ha-internals.ts`.

## Releases

Publishing a GitHub release `vX.Y.Z-alpha.N` (matching `version` in `manifest.json`,
marked as a pre-release) builds the frontend and attaches `hue_studio.zip`, which HACS
installs. Pushing the tag is enough: the release workflow creates the pre-release with
generated notes. Everything is an alpha for now.

## Rebuilding bundled assets

| What | Command |
|---|---|
| Light icons (`src/ds/hue-icons-data.ts`) | `uv run python scripts/build_hue_icons.py` |
| Scene gallery (`frontend/gallery/`) | `uv run python scripts/build_gallery.py` |
| Icon and logo (`brand/`) | `uv run python scripts/build_icon.py` |
| Documentation screenshots | `uv run python scripts/docs_screenshots.py` ([Documentation](docs.md)) |

## Rules

Everything in the repository is in English, UI strings live in translation files
(`translations/` for the backend, `src/i18n/` for the frontend), and nothing personal —
real room or light names, addresses, entity ids of a real home — goes into code, tests,
fixtures or these docs.
