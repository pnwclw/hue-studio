# Roadmap

What Hue Studio still needs, measured against the current Philips Hue app (5.6x–5.7x,
2026) and the phases in `CLAUDE.md`. We copy the Hue app's **light-control screens**;
automations, schedules and assistants stay with Home Assistant, which is where Hue Studio
adds value.

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

**Out of scope for us** (Home Assistant's job or hardware-bound): MotionAware, automations /
lighting schedules, the AI assistant, Sports Live, doorbell, bridge backup. Sync is in
scope for the Hue Play HDMI Sync Box (done); TV and PC sync apps stay outside.

## Already in Hue Studio

- Panel: home, room, color wheel, gallery, effects (categories and 1–12 speed as in the Hue
  app), scene editor.
- Services: `apply_palette`, `set_gradient`, `set_effect`, `save_scene`, `reset_scene`,
  `recall_scene`.
- WebSocket: `hue_studio/config/subscribe`, `hue_studio/lights/subscribe`,
  `hue_studio/scenes/subscribe`.
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

1. Palette storage (decide: JSON/YAML file vs `helpers.storage.Store`; must stay
   human-readable and diffable) and services `capture`, `palette_save`, `palette_delete`.
2. Import of scenes from the bridge; `gallery:<id>` and `b64:<json>` palette references in
   `apply_palette`.
3. ~~Honour `sync`~~ — done without configuration: lights streaming from an
   entertainment area are known from the bridge. The legacy `sync` room key can go.
4. Switch the legacy cards and automations over to Hue Studio services and remove the
   legacy scripts (phase 1 done criterion).

### B. Catch up with the Hue app in the panel

1. Palettes screen: list, create from current state, delete.
2. Shuffle colors for scenes and palettes.
3. White mode on the wheel for single lights and groups (verify both).
4. Gradient mode picker (`interpolated_palette`, `random_pixelated`, …).
5. Natural Light — built as a subset of auto light (day phases -> color temperature).
6. Room sensors on the room screen (motion, temperature, illuminance) from the options.

### C. Space: our SpatialAware, without a Bridge Pro

1. Read channel positions from `entertainment_configuration`
   (`hue_studio/positions/subscribe`).
2. Position editor: top view plus height, draggable lights. Write back to the bridge for
   lights in an entertainment area, store locally (same storage as palettes) for the rest.
   Lock the editor while the entertainment area is streaming.
3. Spatial palettes: distribute palette points along the room by light position;
   classic/spatial toggle as in the Hue app.
4. Verify on a real bridge: actual coordinate values, whether CLIP v2 accepts position
   writes, and whether any SpatialAware resources appear in the API.

### D. Phase 4 — auto light (the main difference from the Hue app)

- Phases, seasons, weather, holidays and offsets in Python, replacing template sensors and
  automations; settings UI in the panel.
- Manual mode, quiet hours, Adaptive Lighting interplay.

### E. Later

- Sync Box, direct pairing only: presets, IR codes, music palettes, background
  lighting (aiohuesyncbox already has them).
- Dashboard cards replacing the legacy gallery and auto-light cards.
- "Liquid Glass" footer with `/hue` as a tab.
- Submission to the HACS default repository list.

## Order

A -> B1–B2 -> D -> C -> rest of B -> E.

Space (C) comes after auto light: retiring the legacy prototype matters more than spatial
rendering, which only pays off in rooms with several lights.
