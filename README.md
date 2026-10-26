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
integration; Hue Studio reuses its bridge connections, so no second pairing is needed. It
is added once and uses every bridge of the Philips Hue integration — a bridge added there
later is picked up by itself. Each bridge shows up as a service of Hue Studio (linked to
its device in the Philips Hue integration), with a link into the panel.

> **Status:** early development. So far: config flow, bridge connection, services and a
> `/hue` sidebar panel — rooms (your HA areas) and zones, room view with Hue scenes,
> lights and the room's sensors (temperature, light level; a card per Hue sensor with its on/off and its settings: name, room, lights, motion sensitivity tried out live while it calibrates), a gamut-aware color
> wheel with one pin per gradient point, white mode and gradient styles, light effects
> (candle, fireplace, sparkle, … with color, brightness and speed), a scene editor (save,
> dynamic speed, auto-play, reset, dynamic playback), the scene gallery with
> "set once", Hue rooms that follow your HA areas (a "Rooms and zones" screen with
> a zone editor), Hue scenes kept tidy in Home Assistant's lists (a "Hue Studio" label,
> a "Hue custom scene" label on scenes of your own, a category per Hue room or zone, the
> room's area) with a Hue-style sheet when you open
> one, and the Hue Play HDMI Sync Box (a Sync tab, its own entities and service). See
> the roadmap below.

## Services

| Service | What it does |
|---|---|
| `hue_studio.apply_palette` | Apply a gallery scene (`gallery_scene`), up to 5 colors (`points`, CIE xy), a white (`mirek`) or a `palette` reference (`gallery:<id>`, `b64:<base64 JSON>`) to Hue lights, rooms or areas (an area uses its Hue lights only). Gradient lights get the whole palette (laid out by `mode` when they support it), others one color each; with `layout: spatial`, colors follow where the lights stand (see "Space"). Optional `brightness` and `transition` (s). |
| `hue_studio.set_gradient` | Set 2-5 color points (and the mode) of Hue gradient lights. |
| `hue_studio.set_effect` | Play an effect (`candle`, `fire`, `sparkle`, `glisten`, `opal`, `prism`, `underwater`, `cosmos`, `sunbeam`, `enchant`; `no_effect` stops it) with an optional color (`xy_color` or `mirek`), `speed` and `brightness`. |
| `hue_studio.create_scene` | Create a scene in a Hue room or zone (target its light group), visible in the Hue app: from a `gallery_scene`, `points` or `mirek` (spread over the lights and stored as the scene palette), otherwise from what the lights show now. Returns the new `scene_id`. A scene of your own (not a gallery scene as it is) is marked so on the bridge (`metadata.appdata`), whatever picture it carries. |
| `hue_studio.delete_scene` | Delete Hue scenes from the bridge. |
| `hue_studio.create_zone` | Create a Hue zone of the targeted lights (e.g. an area's Hue lights), so the area gets scenes of its own. Returns the new `zone_id` and, once the Philips Hue integration has added it, the zone's light `entity_id`. |
| `hue_studio.update_zone` | Rename a Hue zone (`name`) or give it other `lights`. |
| `hue_studio.delete_zone` | Delete Hue zones (with their scenes) from the bridge. |
| `hue_studio.align_rooms` | Bring the Hue rooms on the bridge in line with your HA areas: each area with Hue lights gets a Hue room of its name with exactly those lights (created, renamed or refilled as needed). `dry_run` only returns the plan; `complete_scenes` (default on) gives a room's scenes settings for lights that joined it; `delete_empty_rooms` removes rooms left without lights; `keep_split_scenes` first copies the scenes of a room split over several areas into a new zone over all of the room's lights, so they keep every light. With a target, only the targeted lights are moved. Returns the plan. |
| `hue_studio.export_scenes` | Write the bridge scenes (or those of the targeted Hue rooms and zones) to a file in `<config>/hue_studio/scenes/`, so Home Assistant's own backups hold them; lights are saved by Zigbee MAC, name and entity id. The newest `keep` copies stay (7), plus an older one that still has a scene no newer copy has, so an export right after a deletion never drops it. Call it nightly from an automation, before HA's backup. Returns the `file`. |
| `hue_studio.import_scenes` | Make the scenes of an exported `file` (the newest by default) again in the Hue room or zone of the same name, lights found by MAC, else by name; a scene of that name there stays unless `replace`. `dry_run` only returns what would be created, replaced or skipped. The panel does this under Settings → Integration settings → Scene backup. |
| `hue_studio.save_scene` | Store what a Hue scene's lights show now in the scene; optionally rename it and set its dynamic `speed` and `auto_dynamic` (auto-play). |
| `hue_studio.reset_scene` | Rebuild a Hue scene's light settings from its palette (optionally `shuffle`d) and activate it. |
| `hue_studio.recall_scene` | Play a Hue scene dynamically or statically (`dynamic`), or as it is set up, with an optional `transition`. |
| `hue_studio.apply_light` | What Hue Studio's automations show in some rooms: `light` = a `scene` (one per room), a `white` (`kelvin`, `brightness`), `natural` light, the scene of the day (`auto`, settings in `scene_of_the_day`) or `off`; `transition`, `from_dark` (fade in from off), `only_if_off`, `toggle`. Natural light and the scene of the day keep up with the day until the lights are changed (`follow`). |
| `hue_studio.set_sync` | Change a Sync Box in one command: `power`, `sync`, `mode` (video/music/game), `intensity`, `input` (id or name), `entertainment_area` (id or name), `brightness`; paired directly also `palette` (music), `background_lighting`, `preset` (name or id). |
| `hue_studio.save_sync_preset`, `delete_sync_preset` | Save what a directly paired box does now as a preset of the box (`name`), or delete one. |
| `hue_studio.learn_sync_ir_code`, `set_sync_ir_code`, `delete_sync_ir_code` | Remote buttons of a directly paired box: listen for one, make one do something (`code`, `name`, `action`: `toggle_sync`, `mode_game`, `input:input2`, `preset:Movie night`, …), forget one. |

Palette, gradient and effect services leave lights alone while an entertainment area
streams to them (Sync Box, PC or TV sync): the stream would overwrite them anyway.

Services that delete or reshape things on the bridge or the box (`delete_scene`,
`create_zone`, `update_zone`, `delete_zone`, `align_rooms`, `delete_sync_preset` and the
remote button services) need a Home Assistant administrator, like the panel's settings.
Automations run them without a user, so they are not affected; a script started by a
user who is not an administrator (a dashboard button, a voice assistant) is refused.
Lighting and scene services stay open to everyone, like `light.turn_on`: creating,
saving and shuffling scenes is everyday use in the Hue app too.

## Zones as labels

With "Zones as labels" on (Settings → Integration settings, off by default), every Hue
zone is also a Home Assistant label `Hue zone: <name>` on its lights, kept alike both
ways. The zone stays on the bridge, so the Hue app always shows it right, and it appears
in Home Assistant only once, as its Hue light group; the label lets automations, scripts
and templates (`label_entities()`) use it.

- A zone made, renamed or given other lights in the Hue app or the panel changes its
  label; the label renamed or put on other Hue lights in Home Assistant changes the zone.
  A new label `Hue zone: <name>` on Hue lights makes that zone. When both sides changed
  at once, the bridge wins.
- Nothing is deleted behind your back: deleting the label leaves the zone (and its
  scenes) on the bridge, and the "Rooms and zones" screen offers to delete it or label it
  again; a label taken off every light keeps its zone. A zone deleted on the bridge takes
  its label with it.
- Lights that cannot join (not Hue lights, or on another bridge) keep the label and are
  listed on the "Rooms and zones" screen. Only labels on entities count, not on devices.

## Automations

The panel's **Automations** tab has the Hue app's automations: wake up, go to sleep,
coming home, leaving home, mimic presence, schedule (at a time, sunrise or sunset, with
an optional end) and a motion sensor (on with motion when it is dark enough, off after a
while). Each one is a **Home Assistant automation** made from a blueprint that Hue
Studio puts in place (`blueprints/automation/hue_studio/`): Home Assistant stores and
runs it, lists it in Settings → Automations and edits it with a form; "Open in Home
Assistant" is one tap away, and the panel lists your other automations that use Hue
lights. An automation works in rooms (Home Assistant areas) and zones (Hue rooms and
zones that no area holds); the tab lists them by room and zone, and each room's or
zone's screen shows its own with their switches. Editing them in the panel needs a Home
Assistant administrator; everyone can switch them on and off.

The light of an automation is a scene per room, a white, **natural light** (a white per
phase of the day, cool in the morning, warm in the evening, like the Hue app's) or the
**scene of the day**: a gallery scene picked by phase of the day, season, weather and
mood, with a brightness that follows the light outside. Once shown, natural light and
the scene of the day keep up with the day until someone changes the lights or turns
them off.

Both start from the **light of the day** (Settings → Light of the day), shared by every
automation:

- **the scene pool**: every gallery scene has tags — the phases of the day, seasons,
  weather (clear or gloomy) and moods it fits. Hue Studio ships ready-made tags for the
  whole gallery, so the scene of the day works out of the box; change any scene's tags,
  take it out of the pool, or turn the ready-made tags off and build your own pool;
- **the mood** (relax, cozy, focus, romantic, party, festive, or "by the day"): a mood
  picks from its own scenes instead, in every automation at once. It is an entity
  (`select.hue_studio_mood`), so dashboards and automations can set it too;
- **the phases of the day**: when morning, day, golden hour and evening start (minutes
  from sunrise and sunset) and when the night starts. `sensor.hue_studio_phase` shows the
  phase, with the season and weather as attributes;
- **weather, season and a light sensor**: picked automatically when Home Assistant has
  them. Without a weather entity the panel offers to add Met.no, without the Season
  integration to add it (until then the month decides).

An automation only adds what is its own (on its second page in the panel): extra or
skipped scenes, its own phase times, brightness per phase and the white of natural
light. Automations from before 0.10 had pools of their own: the panel moves them into
the shared pool once (the ready-made tags are then off, so the pool is what you had put
together) and saves the automations without them.

Automations made in Hue Studio get the "Hue Studio" label and automation category and
the area of their room (your own choices are kept); their description links back to the
panel.

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
With "Rooms follow areas" turned on (Settings tab → Integration settings), every area change is
written to the bridge at once. Details: [docs/rooms-and-scenes.md](docs/rooms-and-scenes.md).

## Settings

The panel's Settings tab is laid out like the Hue app's. **In this home**: Devices (every
Hue device by area, and adding new ones), Bridges (every bridge and Sync Box as a row of its
own, each opening its page: a bridge's name, facts, devices and MotionAware areas; a Sync
Box's name, status light, turning on and off with the TV, how it is connected), MotionAware
areas (health, on/off; shown only with a Hue Bridge Pro) and Entertainment areas (create, rename, change type and lights, arrange
where the lights stand, delete — they are not rooms or zones). **Hue Studio**: Rooms and
zones, Scene gallery, Integration settings (rooms follow areas, which area each Hue room or
zone belongs to, the sensors of each room) and Experimental. Every setting of Hue Studio is
here: the integration has no options dialog in Home Assistant's settings.

## Adding devices

Settings → Devices → **Add devices** in the panel (or a room's "+" → Device), like the Hue
app: pick what you add (Hue lights, accessories, or Zigbee lights of other brands where the
bridge allows it), follow the steps to get it ready, and the bridge searches for about a
minute (optionally by the serial numbers printed on the devices, for devices from another
bridge or far away); devices show up as they join. Each new device then gets a name (on the
bridge, so the Hue app shows it too) and a room — a Home Assistant area, or a new one
created on the spot — and a light also moves into the Hue room of that area. "Identify"
makes a light breathe or a sensor blink. Any Hue device can later be renamed, moved to
another area or deleted from its bridge (Home Assistant removes its device then).

## Dashboard cards

Three cards for regular dashboards (in the card picker, with a visual editor):

| Card | |
|---|---|
| `custom:hue-studio-room-card` | A room (`area`): toggle, brightness, sensors, its Hue scenes |
| `custom:hue-studio-automations-card` | Hue Studio's automations (of an `area`) with their switches; "+" adds one |
| `custom:hue-studio-gallery-card` | Gallery scenes to show once in a room (`area`, or room chips limited by `rooms`; `categories`) |

They follow your theme's colors; a Hue light's more-info opens Hue Studio's dialog from
any card (tile, Mushroom, Bubble Card, …), and an automation made with Hue Studio opens a
sheet with its switch, a summary, "Edit" and "Open in Home Assistant" (for administrators);
everything else opens Home Assistant's.

## Experimental

Settings → Experimental in the panel: features that are still taking shape. There are none
right now.

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
3. **Settings → Devices & services → Add integration → Hue Studio → Hue Studio for your
   Hue bridges**. All bridges of the Philips Hue integration are used; Sync Boxes are
   added the same way later (**Add integration → Hue Studio**).

### Manual

Copy `custom_components/hue_studio` into `<config>/custom_components/` and restart Home
Assistant.

## Roadmap

1. **Backend** — CLIP v2 client with event stream, services (`apply_palette`,
   `set_gradient`, scenes created on the bridge, effects) and a WebSocket API.
2. **`/hue` panel** — rooms, gamut-aware color wheel, scene gallery, palettes.
3. **More-info override** for Hue lights, with a safe fallback to the stock dialog.
4. **Automations** — the Hue app's automation types as Home Assistant automations, with
   natural light and the scene of the day (by time-of-day phase, season, weather and
   mood, from one shared scene pool).
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

Rebuild the bundled light icons: `uv run python scripts/build_hue_icons.py`; the scene
gallery: `uv run python scripts/build_gallery.py`; the icon
and logo (`custom_components/hue_studio/brand/`, shown by Home Assistant 2026.3+):
`uv run python scripts/build_icon.py`.

## License

[MIT](LICENSE). The bundled scene gallery is derived from
[Hypfer/hass-scene_presets](https://github.com/Hypfer/hass-scene_presets) (Apache-2.0); the
light icons (the Hue app's, as the `hue-studio:` icon set) come from
[elax46/custom-brand-icons](https://github.com/elax46/custom-brand-icons) (MIT). See
[NOTICE](NOTICE).
