# Hue Studio

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/docs/faq/custom_repositories)
[![Validate](https://github.com/pnwclw/hue-studio/actions/workflows/validate.yml/badge.svg)](https://github.com/pnwclw/hue-studio/actions/workflows/validate.yml)
[![Tests](https://github.com/pnwclw/hue-studio/actions/workflows/tests.yml/badge.svg)](https://github.com/pnwclw/hue-studio/actions/workflows/tests.yml)
[![Docs](https://img.shields.io/badge/docs-pnwclw.github.io-blue.svg)](https://pnwclw.github.io/hue-studio/)

A Home Assistant custom integration that brings the look and feel of the Philips Hue app
to Home Assistant — a color wheel with draggable light dots, a scene gallery, palettes,
multi-color gradients — and adds what the Hue app cannot do: Home Assistant logic such as
time-of-day phases, weather, seasons, presence and automations.

Hue Studio **extends** the built-in [Philips Hue](https://www.home-assistant.io/integrations/hue/)
integration instead of replacing it. Lights, scenes and sensors stay with the native
integration; Hue Studio reuses its bridge connections, so no second pairing is needed. It
is added once and uses every bridge of the Philips Hue integration — a bridge added there
later is picked up by itself. Each bridge shows up as a service of Hue Studio (linked to
its device in the Philips Hue integration), with a link into the panel.

![The Hue Studio panel](https://raw.githubusercontent.com/pnwclw/hue-studio/dev/docs/assets/screenshots/home-desktop.webp)

**Documentation: <https://pnwclw.github.io/hue-studio/>**

> **Status:** early development; every release is an alpha (enable "Show beta versions"
> in HACS).

## What it does

- **A `/hue` panel** like the Hue app: your Home Assistant areas as rooms, Hue zones, a
  gamut-aware color wheel with a pin per gradient point, white, gradient styles and
  effects.
- **Scenes on the bridge**, so the Hue app sees them: a gallery of 142 scenes, scenes of
  your own, dynamic playback, spatial scenes, backups.
- **Rooms that follow your areas**: Hue rooms aligned with Home Assistant areas, Hue zones
  as labels.
- **The Hue app's automations as Home Assistant automations**, from blueprints, with
  natural light and the scene of the day (phase of the day, season, weather, mood).
- **The Hue Play HDMI Sync Box**, paired directly or through the HACS Sync Box
  integration.
- **Dashboard cards**, a Hue-style dialog for Hue lights, and
  [services](https://pnwclw.github.io/hue-studio/reference/services/) for your own
  automations.

## Requirements

- Home Assistant 2026.10.0 or newer
- The Philips Hue integration set up with a bridge on API v2 (Hue Bridge v2 / Pro)

## Installation

1. HACS → ⋮ → **Custom repositories** → add `https://github.com/pnwclw/hue-studio`,
   category **Integration**.
2. Install **Hue Studio** and restart Home Assistant.
3. **Settings → Devices & services → Add integration → Hue Studio → Hue Studio for your
   Hue bridges**.

Details, the Sync Box and manual installation:
[Installation](https://pnwclw.github.io/hue-studio/getting-started/installation/).

## Development

```bash
npm ci && npm run build    # frontend: src/ (TypeScript + Lit) -> custom_components/hue_studio/frontend/
uv sync
uv run pytest
uv run ruff check . && uv run ruff format --check .
uv run --group docs mkdocs serve   # the documentation site
```

More in [Development](https://pnwclw.github.io/hue-studio/development/).

## License

[MIT](LICENSE). The bundled scene gallery is derived from
[Hypfer/hass-scene_presets](https://github.com/Hypfer/hass-scene_presets) (Apache-2.0); the
light icons (the Hue app's, as the `hue-studio:` icon set) come from
[elax46/custom-brand-icons](https://github.com/elax46/custom-brand-icons) (MIT). See
[NOTICE](NOTICE).
