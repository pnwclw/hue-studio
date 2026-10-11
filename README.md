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
> `/hue` sidebar panel — rooms (your HA areas) and zones, room view with Hue scenes,
> lights and the room's sensors (motion, temperature, light level), a gamut-aware color
> wheel with one pin per gradient point, white mode and gradient styles, light effects
> (candle, fireplace, sparkle, … with color, brightness and speed), a scene editor (save,
> dynamic speed, auto-play, reset, dynamic playback), the scene gallery with
> "set once", Hue rooms that follow your HA areas (a "Rooms and zones" screen with
> a zone editor), and the Hue Play HDMI Sync Box (a Sync tab, its own entities and
> service). See the roadmap below.

## Services

| Service | What it does |
|---|---|
| `hue_studio.apply_palette` | Apply a gallery scene (`gallery_scene`), up to 5 colors (`points`, CIE xy), a white (`mirek`) or a `palette` reference (`gallery:<id>`, `b64:<base64 JSON>`) to Hue lights, rooms or areas (an area uses its Hue lights only). Gradient lights get the whole palette (laid out by `mode` when they support it), others one color each; with `layout: spatial`, colors follow where the lights stand (see "Space"). Optional `brightness` and `transition` (s). |
| `hue_studio.set_gradient` | Set 2-5 color points (and the mode) of Hue gradient lights. |
| `hue_studio.set_effect` | Play an effect (`candle`, `fire`, `sparkle`, `glisten`, `opal`, `prism`, `underwater`, `cosmos`, `sunbeam`, `enchant`; `no_effect` stops it) with an optional color (`xy_color` or `mirek`), `speed` and `brightness`. |
| `hue_studio.create_scene` | Create a scene in a Hue room or zone (target its light group), visible in the Hue app: from a `gallery_scene`, `points` or `mirek` (spread over the lights and stored as the scene palette), otherwise from what the lights show now. Returns the new `scene_id`. |
| `hue_studio.delete_scene` | Delete Hue scenes from the bridge. |
| `hue_studio.create_zone` | Create a Hue zone of the targeted lights (e.g. an area's Hue lights), so the area gets scenes of its own. Returns the new `zone_id`. |
| `hue_studio.update_zone` | Rename a Hue zone (`name`) or give it other `lights`. |
| `hue_studio.delete_zone` | Delete Hue zones (with their scenes) from the bridge. |
| `hue_studio.align_rooms` | Bring the Hue rooms on the bridge in line with your HA areas: each area with Hue lights gets a Hue room of its name with exactly those lights (created, renamed or refilled as needed). `dry_run` only returns the plan; `complete_scenes` (default on) gives a room's scenes settings for lights that joined it; `delete_empty_rooms` removes rooms left without lights; `keep_split_scenes` first copies the scenes of a room split over several areas into a new zone over all of the room's lights, so they keep every light. With a target, only the targeted lights are moved. Returns the plan. |
| `hue_studio.save_scene` | Store what a Hue scene's lights show now in the scene; optionally rename it and set its dynamic `speed` and `auto_dynamic` (auto-play). |
| `hue_studio.reset_scene` | Rebuild a Hue scene's light settings from its palette (optionally `shuffle`d) and activate it. |
| `hue_studio.recall_scene` | Play a Hue scene dynamically or statically (`dynamic`), regardless of its auto-play setting. |
| `hue_studio.apply_auto_light` | Show an area's auto light (scene of the day at its brightness) on its Hue lights, with an optional `transition`. Does nothing while the area is under manual control or auto light is off, unless `force`; `resume` hands manual control back first (e.g. when someone enters). |
| `hue_studio.auto_light_pool` | Set the gallery scenes of one auto light pool of an area (`phase`, `season`, `step`: clear/gloomy, or 0-3 for the day). |
| `hue_studio.auto_light_exclude` | Never (or again, `excluded: false`) pick a gallery scene in an area's auto light. |
| `hue_studio.auto_light_offset` | Shift an area's brightness in one phase by `delta` percent (0 resets); returns the offset. |
| `hue_studio.import_legacy` | Import the auto light of rooms from a legacy `lights.json` into Hue Studio. |
| `hue_studio.set_sync` | Change a Sync Box in one command: `power`, `sync`, `mode` (video/music/game), `intensity`, `input` (id or name), `entertainment_area` (id or name), `brightness`; paired directly also `palette` (music), `background_lighting`, `preset` (name or id). |
| `hue_studio.save_sync_preset`, `delete_sync_preset` | Save what a directly paired box does now as a preset of the box (`name`), or delete one. |
| `hue_studio.learn_sync_ir_code`, `set_sync_ir_code`, `delete_sync_ir_code` | Remote buttons of a directly paired box: listen for one, make one do something (`code`, `name`, `action`: `toggle_sync`, `mode_game`, `input:input2`, `preset:Movie night`, …), forget one. |

Palette, gradient and effect services leave lights alone while an entertainment area
streams to them (Sync Box, PC or TV sync): the stream would overwrite them anyway.

## Auto light

Hue Studio works out what each area with auto light settings should show — the phase
of the day (from the sun), a scene of the day from pools by phase, season, weather and
holidays, and a brightness — and gives every such area a device with entities for
dashboards and automations. An area can use **natural light** instead of scenes, like
the Hue app's Natural light: a white per phase (cool in the morning and during the day,
warm in the evening and at night) with the same brightness rules; its scene sensor then
shows the color temperature (`2900 K`, attribute `kelvin`).

| Entity | |
|---|---|
| `select.<area>_light_control` | Who controls the lights: `auto`, `manual` (someone changed them by hand: a dashboard, the Hue app, a switch), `off`. Back to `auto` shows the auto scene at once. |
| `sensor.<area>_light_phase` | morning, day, golden, evening, night |
| `sensor.<area>_light_scene` | The scene of the day, with its gallery picture (Mushroom and Bubble Card show it) |
| `sensor.<area>_light_brightness` | The brightness auto light shows now |
| `number.<area>_light_offset` | Your brightness offset for the current phase |
| `button.<area>_next_light_scene` | Another scene for the rest of the day |

Pools (or color temperatures), holidays, phases, brightness and inputs are edited in
the panel (Settings → Auto light); a room with auto light also gets an "Auto light" (or
"Natural light") tile among its scenes that shows it and hands the lights back to it. *When* to show it stays with your automations: call `hue_studio.apply_auto_light` (for
example on presence, with `resume: true`, and again when the scene or brightness
sensor changes).

## Space

Where lights stand drives spatial scenes, like the Hue app's SpatialAware but without a
Bridge Pro. Positions come from your entertainment areas (as the Hue app placed the
lights); a room's **Arrange** screen shows them from above and lets you drag lights and
set their height. Lights of an entertainment area are saved back to the bridge, the
rest in Hue Studio. "Set once" in the gallery then offers Classic or Spatial: spatial
spreads the scene's colors along the room.

## Rooms and zones

Home Assistant areas decide which room a light is in; the Hue bridge (and so the Hue
app) follows. The panel's **Rooms and zones** screen (in the Settings tab) shows how the Hue rooms differ from your areas — rooms to create or rename,
lights to move, scenes that lose or gain lights — and aligns them on confirmation. A
light moved in the Hue app shows up in its room with "move in Home Assistant" or "move
back in Hue"; Hue lights without an area are listed under "No room" with an area
picker. Zones (any lights from any rooms) are created and edited on the same screen.
With "Rooms follow areas" turned on (Settings tab, or the integration options), every area change is
written to the bridge at once. Details: [docs/rooms-and-scenes.md](docs/rooms-and-scenes.md).

## Settings

The panel's Settings tab is laid out like the Hue app's. **In this home**: Devices (every
Hue device by area, and adding new ones), Bridges (and Sync Boxes), MotionAware areas
(health, on/off) and Entertainment areas (create, rename, change type and lights, arrange
where the lights stand, delete — they are not rooms or zones). **Hue Studio**: Rooms and
zones, Auto light, Integration settings (rooms follow areas, which area each Hue room or
zone belongs to, the sensors of each room — the integration's options, without leaving
the panel) and Experimental.

## Adding devices

Settings → **Devices** in the panel: the bridge searches for new Hue lights, switches
and sensors (optionally by the serial numbers printed on them, for devices from another
bridge or far away). Each new device — and any Hue device not in a Home Assistant area
yet — gets a name (on the bridge, so the Hue app shows it too), an area and, for lights,
the Hue room of that area. "Identify" makes a light breathe or a sensor blink.

## Dashboard cards

Three cards for regular dashboards (in the card picker, with a visual editor):

| Card | |
|---|---|
| `custom:hue-studio-room-card` | A room (`area`): toggle, brightness, sensors, its Hue scenes and auto light |
| `custom:hue-studio-auto-light-card` | Auto light of an area: today's scene, auto / manual / off, another scene, show now |
| `custom:hue-studio-gallery-card` | Gallery scenes to show once in a room (`area`, or room chips limited by `rooms`; `categories`) |

They follow your theme's colors; a Hue light's more-info opens Hue Studio's dialog from
any card (tile, Mushroom, Bubble Card, …), everything else opens Home Assistant's.

## Experimental

Settings → Experimental in the panel. **Liquid Glass footer**: a floating tab bar at the
bottom of every page on phones, instead of the side menu — your dashboards and the Hue
panel as tabs, More opens the side menu. It applies to every user of the instance and
stays away from Home Assistant's settings pages.

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
box from that integration first, then add it to Hue Studio. Only in this mode: the music
palette, background lighting, presets of the box and remote buttons (any infrared remote
can be taught to start syncing, switch modes or inputs, or apply a preset) — in the
Sync tab and through the services above.

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
