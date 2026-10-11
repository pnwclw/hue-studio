// A fake `hass` for dev/panel.html: neutral demo data and a tiny simulation of the services
// the panel calls, so every screen can be clicked through without Home Assistant.

import { mirekToRgb, xyToRgb } from "../src/color.ts";
import { predictSync } from "../src/sync.ts";
import type {
  Gallery,
  Hass,
  HassState,
  LightInfo,
  LightsMessage,
  Palette,
  AutoLightConfig,
  AutoLightSettings,
  AutoLightState,
  Holiday,
  Phase,
  PositionsMessage,
  RoomPoint,
  RoomsPlan,
  StudioConfig,
  SceneInfo,
  ServiceData,
  SyncBoxInfo,
  SyncChange,
  XY,
} from "../src/types.ts";

/** Simulated light state. */
interface Sim {
  on?: boolean;
  xy?: XY | null;
  mirek?: number | null;
  bri?: number;
}

const COLOR = { supported_color_modes: ["color_temp", "xy"] };

const LIGHTS: Record<string, [string, string, Sim]> = {
  // id: [name, area, initial state]
  desk_lamp: ["Desk lamp", "office", { on: true, xy: [0.5784, 0.3827], bri: 115 }],
  tv_strip: ["TV strip", "living_room", {}],
  play_left: ["Play left", "living_room", {}],
  play_right: ["Play right", "living_room", {}],
  candle: ["Candle", "living_room", {}],
  kitchen_bulb: ["Kitchen bulb", "kitchen", { on: true, mirek: 370, bri: 200 }],
  string_lights: ["String lights", "bedroom", {}],
  globe_lights: ["Globe lights", "balcony", { on: true, xy: [0.2, 0.25], bri: 160 }],
};

// ?drift=1: rooms that drifted apart. A lamp that is in the office in HA but was moved to
// the balcony room in the Hue app (a mismatch), and one added in the Hue app without an area.
const DRIFT: Record<string, [string, string, Sim]> = {
  reading_lamp: ["Reading lamp", "office", {}],
  hall_spot: ["Hall spot", "", {}],
};

const GROUPS: Record<string, [string, string, string[]]> = {
  // id: [name, hue_type, members]
  office: ["Office", "room", ["desk_lamp"]],
  balcony: ["Balcony", "room", ["globe_lights"]],
  downstairs: ["Downstairs", "room", ["tv_strip", "play_left", "play_right", "candle", "kitchen_bulb", "string_lights"]],
  tv_area: ["TV area", "zone", ["tv_strip", "play_left", "play_right"]],
  tree: ["Tree", "zone", ["string_lights"]],
};

const SCENES: Record<string, string[]> = {
  office: ["Read", "Bright", "Dimmed", "Nature's colors", "Ocean dawn"],
  tv_area: ["Movie", "Read"],
  balcony: ["Galaxy", "Fairy lights"],
  downstairs: ["Relax", "Ocean dawn"],
};

// Scene palettes as the bridge reports them: colors (dynamic-capable) or one white.
const SCENE_PALETTES: Record<string, { palette?: XY[]; mirek?: number }> = {
  Read: { mirek: 346 },
  Bright: { mirek: 233 },
  Dimmed: { mirek: 370 },
  Relax: { mirek: 447 },
  "Nature's colors": { palette: [[0.3, 0.5], [0.45, 0.45], [0.55, 0.38], [0.22, 0.3]] },
  "Ocean dawn": { palette: [[0.17, 0.2], [0.3, 0.3], [0.5, 0.38]] },
  Movie: { palette: [[0.2, 0.1], [0.5, 0.25]] },
  Galaxy: { palette: [[0.16, 0.08], [0.25, 0.1], [0.45, 0.2], [0.2, 0.25]] },
  "Fairy lights": { palette: [[0.55, 0.4], [0.5, 0.42]] },
};

const ARCHETYPES: Record<string, string> = {
  desk_lamp: "hue_signe",
  tv_strip: "hue_lightstrip_tv",
  play_left: "hue_play",
  play_right: "hue_play",
  candle: "candle_bulb",
  kitchen_bulb: "classic_bulb",
  string_lights: "string_light",
  globe_lights: "string_globe",
  reading_lamp: "table_shade",
  hall_spot: "single_spot",
};

const EFFECTS = ["candle", "fire", "prism", "sparkle", "opal", "glisten", "underwater", "cosmos", "sunbeam", "enchant"];

const AREAS: NonNullable<Hass["areas"]> = {
  office: { name: "Office", icon: "mdi:chair-rolling", temperature_entity_id: "sensor.office_thermostat" },
  living_room: { name: "Living room", icon: "mdi:sofa" },
  kitchen: { name: "Kitchen", icon: "mdi:stove" },
  bedroom: { name: "Bedroom", icon: "mdi:bed" },
  balcony: { name: "Balcony", icon: "mdi:balcony" },
  hallway: { name: "Hallway", icon: "mdi:door" },
};

// A Sync Box behind the TV; ?sync=1 starts the page with it syncing.
const SYNC_BOX: SyncBoxInfo = {
  available: true,
  entity_id: "switch.sync_box_light_sync",
  name: "Sync Box",
  model: "Hue Play HDMI Sync Box 8K",
  power: true,
  syncing: false,
  mode: "video",
  intensity: "high",
  brightness: 80,
  input: "input1",
  inputs: [
    { id: "input1", name: "Media player", type: "appletv", status: "linked" },
    { id: "input2", name: "HDMI 2", type: "generic", status: "unplugged" },
    { id: "input3", name: "Game console", type: "playstation", status: "plugged" },
    { id: "input4", name: "PC", type: "desktop", status: "plugged" },
  ],
  area: "ent-tv",
  areas: [
    { id: "ent-desk", name: "Desk", active: false, lights: ["light.desk_lamp"] },
    { id: "ent-tv", name: "TV area", active: false, lights: ["light.tv_strip", "light.play_left", "light.play_right"] },
  ],
  content: "3840 x 2160 @ 60000 - HDR10",
  video_supported: true,
  audio_supported: true,
  connection: "connected",
  features: ["palette", "background_lighting", "presets", "ir"],
  palette: "neutral",
  background_lighting: { video: false, game: true },
  presets: [
    { id: "p1", name: "Movie night", last_used: null },
    { id: "p2", name: "Gaming", last_used: null },
  ],
  preset: null,
  ir: {
    scanning: false,
    scanned: ["20df10ef"],
    codes: [
      { code: "20df4eb1", name: "Red button", action: "toggle_sync" },
      { code: "20df8e71", name: "Green button", action: "preset:p1" },
    ],
  },
};
// Colors the synced lights show per mode (what the picture would do).
const SYNC_COLORS: Record<string, XY[]> = {
  video: [[0.17, 0.12], [0.3, 0.14], [0.45, 0.2]],
  music: [[0.55, 0.3], [0.5, 0.42], [0.45, 0.22]],
  game: [[0.17, 0.5], [0.16, 0.25], [0.2, 0.12]],
};

const GAMUT_C: XY[] = [[0.6915, 0.3083], [0.17, 0.7], [0.1532, 0.0475]];

export function createHass({ language = "en", onChange }: { language?: string; onChange: (hass: Hass) => void }): Hass {
  if (new URLSearchParams(location.search).get("drift") === "1" && !LIGHTS.hall_spot) {
    Object.assign(LIGHTS, DRIFT);
    GROUPS.balcony[2].push(...Object.keys(DRIFT));
  }
  const states: Record<string, HassState & { _s?: Sim }> = {};
  const entities: NonNullable<Hass["entities"]> = {};
  const devices: NonNullable<Hass["devices"]> = {};
  const lightInfo: Record<string, LightInfo> = {};
  const listeners = new Set<(msg: LightsMessage) => void>();

  const setLight = (id: string, s: Sim) => {
    const [name] = LIGHTS[id];
    const attrs: Record<string, unknown> = { ...COLOR, friendly_name: name };
    if (s.on) {
      attrs.brightness = s.bri ?? 200;
      if (s.mirek) {
        attrs.color_mode = "color_temp";
        attrs.color_temp_kelvin = Math.round(1e6 / s.mirek);
        attrs.rgb_color = mirekToRgb(s.mirek);
      } else {
        const xy = s.xy || [0.45, 0.41];
        attrs.color_mode = "xy";
        attrs.xy_color = xy;
        attrs.rgb_color = xyToRgb(...xy);
      }
    }
    states[`light.${id}`] = { entity_id: `light.${id}`, state: s.on ? "on" : "off", attributes: attrs, _s: s };
  };

  for (const [id, [, area, s]] of Object.entries(LIGHTS)) {
    devices[`dev_${id}`] = { area_id: area || null };
    entities[`light.${id}`] = { platform: "hue", device_id: `dev_${id}` };
    setLight(id, s);
  }
  // Sensors: a Hue motion sensor (with its thermometer) and a thermostat in the office.
  devices.dev_motion = { area_id: "office" };
  devices.dev_thermostat = { area_id: "office" };
  const sensor = (id: string, platform: string, device: string, state: string, attributes: Record<string, unknown>) => {
    entities[id] = { platform, device_id: device };
    states[id] = { entity_id: id, state, attributes };
  };
  sensor("binary_sensor.office_motion", "hue", "dev_motion", "on", { device_class: "motion", friendly_name: "Office motion" });
  sensor("sensor.office_motion_temperature", "hue", "dev_motion", "21.9", { device_class: "temperature", friendly_name: "Office motion temperature" });
  sensor("sensor.office_thermostat", "demo", "dev_thermostat", "22.5", { device_class: "temperature", friendly_name: "Office thermostat" });
  sensor("sensor.office_motion_illuminance", "hue", "dev_motion", "35", { device_class: "illuminance", friendly_name: "Office motion illuminance" });
  sensor("weather.home", "met", "", "cloudy", { friendly_name: "Home", cloud_coverage: 85 });
  sensor("sensor.season", "season", "", "autumn", { device_class: "enum", friendly_name: "Season" });
  // Adaptive Lighting for the office lamp.
  entities["switch.adaptive_lighting_office"] = { platform: "adaptive_lighting" };
  states["switch.adaptive_lighting_office"] = {
    entity_id: "switch.adaptive_lighting_office",
    state: "on",
    attributes: { friendly_name: "Adaptive Lighting: Office", configuration: { lights: ["light.desk_lamp"] }, manual_control: [] },
  };

  const gradients: Record<string, XY[]> = {
    desk_lamp: [[0.5784, 0.3827], [0.62, 0.35], [0.38, 0.17], [0.5, 0.41], [0.45, 0.41]],
    tv_strip: [],
    globe_lights: [[0.2, 0.25], [0.17, 0.2], [0.25, 0.1], [0.3, 0.3], [0.2, 0.25]],
  };
  for (const id of Object.keys(LIGHTS)) {
    const points = gradients[id];
    lightInfo[`light.${id}`] = {
      gamut: GAMUT_C,
      gamut_type: "C",
      mirek: [153, 454],
      gradient: points ? { points_capable: 5, points, mode: "interpolated_palette", modes: ["interpolated_palette", "interpolated_palette_mirrored", "random_pixelated", "segmented_palette"] } : null,
      effects: EFFECTS,
      effect: null,
      archetype: ARCHETYPES[id],
    };
  }

  const refreshGroups = () => {
    for (const id of Object.keys(states)) {
      if (states[id].attributes.is_hue_group && !GROUPS[id.replace("light.", "")]) {
        delete states[id];
        delete entities[id];
      }
    }
    for (const [id, [name, type, members]] of Object.entries(GROUPS)) {
      const ids = members.map((m) => `light.${m}`);
      const lit = ids.filter((m) => states[m].state === "on");
      states[`light.${id}`] = {
        entity_id: `light.${id}`,
        state: lit.length ? "on" : "off",
        attributes: { ...COLOR, friendly_name: name, is_hue_group: true, hue_type: type, entity_id: ids },
      };
      entities[`light.${id}`] = { platform: "hue" };
    }
  };
  refreshGroups();

  const sceneInfo: Record<string, SceneInfo> = {};
  const sceneListeners = new Set<(msg: unknown) => void>();
  /** A bridge scene of a Hue group, as the native integration and our WS API show it. */
  const sceneId = (group: string, name: string) => `scene.${group}_${name.toLowerCase().replace(/[^a-z]+/g, "_")}`;
  const addScene = (group: string, name: string, { palette = [], mirek }: { palette?: XY[]; mirek?: number } = {}): string => {
    const id = sceneId(group, name);
    states[id] = { entity_id: id, state: "unknown", attributes: { group_name: GROUPS[group][0], name, friendly_name: `${GROUPS[group][0]} ${name}` } };
    entities[id] = { platform: "hue" };
    sceneInfo[id] = {
      active: id === "scene.office_ocean_dawn" ? "static" : "inactive",
      dynamic: palette.length > 1,
      resettable: palette.length > 0 || !!mirek,
      speed: 0.6,
      auto_dynamic: false,
      palette,
      mirek: mirek ? [mirek] : [],
      lights: GROUPS[group][2].map((m) => `light.${m}`),
      image: null,
    };
    return id;
  };
  for (const [group, names] of Object.entries(SCENES)) for (const name of names) addScene(group, name, SCENE_PALETTES[name]);
  const pushScenes = (ids: string[]) => sceneListeners.forEach((cb) => cb({ scenes: Object.fromEntries(ids.map((id) => [id, sceneInfo[id]])) }));
  /** Mark a scene active (and the other scenes of its group inactive). */
  const activate = (scene: string, active: string) => {
    const group = states[scene].attributes.group_name;
    const ids = Object.keys(sceneInfo).filter((id) => states[id].attributes.group_name === group);
    ids.forEach((id) => (sceneInfo[id] = { ...sceneInfo[id], active: id === scene ? active : "inactive" }));
    pushScenes(ids);
  };
  /** What the bridge does for a scene: its palette over its lights. */
  const showScene = (scene: string, shuffle = false) => {
    const info = sceneInfo[scene];
    const points = shuffle ? [...info.palette].sort(() => Math.random() - 0.5) : info.palette;
    const palette: Palette = info.palette.length ? { kind: "gradient", points, brightness: 80 } : { kind: "white", mirek: info.mirek[0] ?? 300, brightness: 90 };
    applyPalette(info.lights, palette);
  };

  const expand = (ids: string | string[] | undefined): string[] => [ids].flat().flatMap((id) => (!id ? [] : states[id]?.attributes.is_hue_group ? states[id].attributes.entity_id : [id]));
  const update = (id: string, patch: Sim) => setLight(id.replace("light.", ""), { ...states[id]._s, ...patch });

  let gallery: Gallery | undefined;
  // The page is dev/panel.html (this module is bundled into dev/build/).
  fetch(new URL("../custom_components/hue_studio/frontend/gallery/gallery.json", location.href))
    .then((r) => r.json())
    .then((g: Gallery) => (gallery = g));

  const applyPalette = (ids: string[], palette: Palette) => {
    ids.forEach((id, i) => {
      if (palette.kind === "white") return update(id, { on: true, mirek: palette.mirek, xy: null, bri: (palette.brightness ?? 100) * 2.55 });
      const points = palette.points ?? [];
      if (lightInfo[id].gradient && points.length > 1) lightInfo[id] = { ...lightInfo[id], gradient: { ...lightInfo[id].gradient, points: points.slice(0, 5) } };
      update(id, { on: true, mirek: null, xy: points[i % points.length], bri: (palette.brightness ?? 80) * 2.55 });
    });
    push(Object.fromEntries(ids.map((id) => [id, lightInfo[id]])));
  };

  const push = (lights: Record<string, LightInfo>) => listeners.forEach((cb) => cb({ lights }));

  let box: SyncBoxInfo = { ...SYNC_BOX, syncing: new URLSearchParams(location.search).get("sync") === "1" };
  const syncListeners = new Set<(msg: unknown) => void>();
  /** What the box does to its area's lights. */
  const showSync = () => {
    const area = box.areas?.find((a) => a.id === box.area);
    if (!box.syncing || !area) return;
    const colors = SYNC_COLORS[box.mode || "video"];
    area.lights.forEach((id, i) => update(id, { on: true, xy: colors[i % colors.length], mirek: null, bri: 2 * (box.brightness ?? 80) }));
  };
  showSync();

  // Auto light: the office follows the sun; settings and state as the backend sends them.
  const autoListeners = new Set<(msg: unknown) => void>();
  const autoAreas: Record<string, AutoLightConfig> = {
    office: {
      pools: {
        day: { all: { clear: [["sunday_morning"], ["cool_bright"], ["sunday_morning", "fairfax"], ["arctic_aurora"]] } },
        golden: { all: { clear: ["golden_star", "honolulu"] } },
        evening: { all: { clear: ["dreamy_dusk", "rolling_hills", "unwind"], gloomy: ["amber_bloom"] }, winter: { clear: ["silent_night"] } },
        night: { all: { clear: ["nightlight"] } },
      },
      holidays: [{ from: "12-20", to: "01-06", phases: ["evening"], pool: ["silent_night", "snow_capped"] }],
      names: {},
      excluded: ["unwind"],
      offsets: { evening: 10 },
      settings: { weather: "weather.home", light_sensor: "sensor.office_motion_illuminance" },
      control: "auto",
    },
  };
  let manualAreas = new Set<string>();
  const skips: Record<string, number> = {};
  /** A rough copy of auto_select.select: enough to click through the screen. */
  const autoState = (area: string): AutoLightState => {
    const config = autoAreas[area];
    const hour = new Date().getHours();
    const phase: Phase = hour >= 23 || hour < 6 ? "night" : hour < 8 ? "morning" : hour < 17 ? "day" : hour < 18 ? "golden" : "evening";
    const order: Phase[] = ["morning", "day", "golden", "evening", "night"];
    let pool: string[] = [];
    let poolPhase = phase;
    for (let back = 0; back < order.length && !pool.length; back++) {
      poolPhase = order[(order.indexOf(phase) - back + order.length) % order.length];
      const moods = config.pools[poolPhase]?.all || {};
      const raw = (moods.gloomy || moods.clear || []) as string[] | string[][];
      pool = poolPhase === "day" ? ((raw as string[][])[2] || []) : (raw as string[]);
    }
    pool = pool.filter((s) => !config.excluded.includes(s));
    const scene = pool.length ? pool[(new Date().getDate() + (skips[area] || 0)) % pool.length] : null;
    const control = config.control === "off" ? "off" : manualAreas.has(area) ? "manual" : "auto";
    if (config.settings.style === "natural") {
      const kelvin = { morning: 5000, day: 4300, golden: 2900, evening: 2200, night: 2000, ...config.settings.kelvin }[phase];
      const level = config.settings.brightness?.[phase] ?? 70;
      return { control, phase, pool_phase: phase, season: "autumn", mood: "gloomy", holiday: false, scene: null, scene_name: null, brightness: level, step: null, pool: [], kelvin };
    }
    const fixed = config.settings.brightness?.[poolPhase];
    return {
      control, phase, pool_phase: poolPhase, season: "autumn", mood: "gloomy", holiday: false, scene,
      scene_name: scene ? gallery?.scenes.find((s) => s.id === scene)?.name || scene : null,
      brightness: Math.min(100, Math.max(1, (fixed ?? 70) + (config.offsets[poolPhase] || 0))), step: poolPhase === "day" ? 2 : null, pool,
    };
  };
  const autoMessage = () => ({
    areas: autoAreas,
    state: Object.fromEntries(Object.keys(autoAreas).map((a) => [a, autoState(a)])),
    entities: Object.fromEntries(Object.keys(autoAreas).map((a) => [a, { light_control: `select.${a}_light_control`, next_light_scene: `button.${a}_next_light_scene` }])),
  });
  const pushAuto = () => setTimeout(() => autoListeners.forEach((cb) => cb(structuredClone(autoMessage()))), 60);
  // Positions: the TV area (an entertainment area) places the living room's TV lights;
  // the office lamp is placed by Hue Studio; the candle is not placed yet.
  const positionListeners = new Set<(msg: unknown) => void>();
  const positions: Record<string, { points: RoomPoint[]; source: "bridge" | "store" }> = {
    tv_strip: { points: [[-0.5, 0.95, 0.1], [0.5, 0.95, 0.1]], source: "bridge" },
    play_left: { points: [[-0.75, 0.85, -0.2]], source: "bridge" },
    play_right: { points: [[0.75, 0.85, -0.2]], source: "bridge" },
    desk_lamp: { points: [[0.4, -0.3, 0.2]], source: "store" },
  };
  const positionsMessage = (): PositionsMessage => {
    const out: PositionsMessage = {};
    for (const [id] of Object.entries(LIGHTS)) {
      const area = devices[`dev_${id}`].area_id;
      if (!area) continue;
      out[area] ??= { lights: {}, configuration: area === "living_room" ? { id: "ent-tv", name: "TV area", streaming: box.syncing ?? false } : null };
      const p = positions[id];
      out[area].lights[`light.${id}`] = { positions: p?.points || [], source: p ? (area === "living_room" ? "bridge" : "store") : null };
    }
    return out;
  };
  const roomListeners = new Set<(msg: unknown) => void>();
  const configListeners = new Set<(msg: unknown) => void>();
  let config: StudioConfig = { groups: {}, rooms: {}, auto_align: false };
  /** A small copy of the backend's alignment plan (alignment.py), one light per device. */
  const planRooms = (): RoomsPlan => {
    const ids = Object.keys(LIGHTS);
    const areaOf = (l: string) => devices[`dev_${l}`].area_id || null;
    const hueRooms = Object.entries(GROUPS).filter(([, g]) => g[1] === "room");
    const roomOf = (l: string) => hueRooms.find(([, g]) => g[2].includes(l))?.[0] ?? null;
    const areas = Object.keys(AREAS).filter((a) => ids.some((l) => areaOf(l) === a));
    const candidates = areas.flatMap((a, ai) =>
      hueRooms.map(([r, g]) => ({ a, r, ai, n: ids.filter((l) => areaOf(l) === a && roomOf(l) === r).length, same: g[0] === AREAS[a].name })),
    ).filter((c) => c.n || c.same).sort((x, y) => y.n - x.n || Number(y.same) - Number(x.same) || x.ai - y.ai);
    const assigned: Record<string, string> = {};
    for (const c of candidates) if (!assigned[c.a] && !Object.values(assigned).includes(c.r)) assigned[c.a] = c.r;
    const areaOfRoom = (r: string | null) => Object.keys(assigned).find((a) => assigned[a] === r) ?? null;
    const moves = ids
      .filter((l) => areaOf(l) && roomOf(l) !== (assigned[areaOf(l)!] ?? "new"))
      .map((l) => ({ lights: [`light.${l}`], area: areaOf(l)!, from: roomOf(l) ? GROUPS[roomOf(l)!][0] : null, from_group: roomOf(l) ? `light.${roomOf(l)}` : null, from_area: areaOfRoom(roomOf(l)) }));
    const rooms = areas.map((a) => ({
      area: a,
      name: AREAS[a].name,
      create: !assigned[a],
      rename: !!assigned[a] && GROUPS[assigned[a]][0] !== AREAS[a].name,
      current_name: assigned[a] ? GROUPS[assigned[a]][0] : null,
      group: assigned[a] ? `light.${assigned[a]}` : null,
      lights: ids.filter((l) => areaOf(l) === a).map((l) => `light.${l}`),
    }));
    const leaving = new Set(moves.flatMap((m) => m.lights.map((x) => x.replace("light.", ""))));
    const empty = hueRooms
      .filter(([r, g]) => !areaOfRoom(r) && g[2].every((l) => leaving.has(l) || !areaOf(l)) && g[2].some((l) => leaving.has(l)))
      .map(([r, g]) => ({ name: g[0], group: `light.${r}`, scenes: (SCENES[r] || []).length }));
    const scenes = Object.entries(SCENES).flatMap(([group, list]) =>
      list.map((name) => ({ name, group, lost: moves.filter((m) => m.from_group === `light.${group}`).flatMap((m) => m.lights) }))
        .filter((x) => x.lost.length)
        .map((x) => ({ entity_id: null, name: x.name, group_name: GROUPS[x.group][0], lost: x.lost, missing: [] })),
    );
    // Rooms whose lights end up in several rooms; the zone is named as in alignment.py.
    const taken = new Set([
      ...rooms.map((r) => r.name),
      ...hueRooms.filter(([r]) => !areaOfRoom(r)).map(([, g]) => g[0]),
      ...Object.values(GROUPS).filter((g) => g[1] === "zone").map((g) => g[0]),
    ].map((n) => n.toLowerCase()));
    const splits = hueRooms.flatMap(([r, g]) => {
      const ends = new Set(g[2].map((l) => moves.find((m) => m.lights[0] === `light.${l}`)?.area ?? areaOfRoom(r)));
      if (ends.size < 2) return [];
      const spread = Object.keys(AREAS).filter((a) => ends.has(a)).map((a) => AREAS[a].name);
      if (ends.has(null)) spread.push(g[0]);
      const name = taken.has(g[0].toLowerCase()) ? spread.join(" + ") : g[0];
      taken.add(name.toLowerCase());
      const lost = scenes.filter((x) => x.group_name === g[0]).map((x) => sceneId(r, x.name));
      return [{ name, from: g[0], group: `light.${r}`, lights: g[2].map((l) => `light.${l}`).sort(), scenes: lost }];
    });
    return {
      changed: moves.length > 0 || rooms.some((r) => r.create || r.rename),
      rooms,
      moves,
      empty,
      scenes,
      conflicts: [],
      splits,
      hue_rooms: Object.fromEntries(ids.filter(roomOf).map((l) => [`light.${l}`, GROUPS[roomOf(l)!][0]])),
    };
  };
  const pushRooms = () => setTimeout(() => roomListeners.forEach((cb) => cb(planRooms())), 120);
  /** What align_rooms does: move lights into their areas' rooms (made or renamed as needed). */
  const alignRooms = (only: string[] | null, deleteEmpty: boolean, keepSplit: boolean) => {
    const plan = planRooms();
    // Copies of the split rooms' scenes go into zones over their lights, before anything moves.
    if (!only && keepSplit) {
      for (const split of plan.splits.filter((x) => x.scenes.length)) {
        let id = split.name.toLowerCase().replace(/[^a-z]+/g, "_");
        while (GROUPS[id]) id += "_zone";
        GROUPS[id] = [split.name, "zone", split.lights.map((l) => l.replace("light.", ""))];
        const room = split.group!.replace("light.", "");
        for (const name of SCENES[room] || []) if (split.scenes.includes(sceneId(room, name))) {
          (SCENES[id] ??= []).push(name);
          addScene(id, name, SCENE_PALETTES[name]);
        }
      }
    }
    for (const move of plan.moves) {
      const light = move.lights[0].replace("light.", "");
      if (only && !only.includes(move.lights[0])) continue;
      for (const g of Object.values(GROUPS)) if (g[1] === "room") g[2] = g[2].filter((l) => l !== light);
      const target = plan.rooms.find((r) => r.area === move.area)!;
      const key = target.group?.replace("light.", "") ?? move.area;
      GROUPS[key] ??= [target.name, "room", []];
      GROUPS[key][2].push(light);
    }
    if (!only) {
      for (const r of plan.rooms.filter((x) => x.rename && x.group)) {
        const key = r.group!.replace("light.", "");
        GROUPS[key][0] = r.name;
        // The native integration renames the group of the room's scenes too.
        for (const name of SCENES[key] || []) {
          const scene = states[sceneId(key, name)];
          if (scene) scene.attributes = { ...scene.attributes, group_name: r.name, friendly_name: `${r.name} ${name}` };
        }
      }
      if (deleteEmpty) for (const e of plan.empty) delete GROUPS[e.group!.replace("light.", "")];
    }
  };

  const hass: Hass = {
    language,
    locale: { language },
    config: { location_name: "Home" },
    areas: AREAS,
    // Sidebar panels (the experimental footer's tabs).
    panels: {
      lovelace: { url_path: "lovelace", title: null, icon: null },
      hue: { url_path: "hue", title: "Hue", icon: "mdi:lightbulb-group" },
      "dashboard-living": { url_path: "dashboard-living", title: "Living room", icon: "mdi:sofa" },
      energy: { url_path: "energy", title: "energy", icon: "mdi:lightning-bolt" },
      map: { url_path: "map", title: "map", icon: "mdi:map" },
      config: { url_path: "config", title: "config", icon: "mdi:cog" },
    },
    localize: (key: string) => ({ "panel.states": "Overview", "panel.energy": "Energy", "panel.map": "Map" })[key] || "",
    devices,
    entities,
    states,
    async callService(domain: string, service: string, data: ServiceData = {}) {
      const d = data as ServiceData & {
        brightness_pct?: number;
        xy_color?: XY;
        color_temp_kelvin?: number;
        gallery_scene?: string;
        manual_control?: boolean;
        points: XY[];
        dynamic?: boolean;
        shuffle?: boolean;
        name?: string;
        speed?: number;
        auto_dynamic?: boolean;
        effect?: string;
        mirek?: number;
        brightness?: number;
        lights?: string[];
      };
      const one = String(data.entity_id);
      console.info("callService", domain, service, JSON.stringify(data));
      await new Promise((r) => setTimeout(r, 60));
      const ids = expand(data.entity_id);
      if (domain === "light" && service === "turn_off") ids.forEach((id) => update(id, { on: false }));
      if (domain === "light" && service === "toggle") ids.forEach((id) => update(id, { on: states[id].state !== "on" }));
      if (domain === "light" && service === "turn_on") {
        for (const id of ids) {
          const patch: Sim = { on: true };
          if (d.brightness_pct) patch.bri = d.brightness_pct * 2.55;
          if (d.xy_color) Object.assign(patch, { xy: d.xy_color, mirek: null });
          if (d.color_temp_kelvin) Object.assign(patch, { mirek: 1e6 / d.color_temp_kelvin, xy: null });
          update(id, patch);
        }
      }
      if (domain === "scene") {
        showScene(one);
        activate(one, sceneInfo[one].auto_dynamic ? "dynamic_palette" : "static");
      }
      if (domain === "hue_studio" && service === "recall_scene") {
        showScene(one);
        activate(one, d.dynamic ? "dynamic_palette" : "static");
      }
      if (domain === "hue_studio" && service === "reset_scene") {
        showScene(one, d.shuffle);
        activate(one, "static");
      }
      if (domain === "hue_studio" && service === "create_scene") {
        const group = one.replace("light.", "");
        const groupName = GROUPS[group][0];
        if (Object.values(states).some((s) => s.attributes.group_name === groupName && s.attributes.name?.toLowerCase() === d.name!.toLowerCase())) {
          throw new Error(`There already is a scene named ${d.name} in this room or zone`);
        }
        const scene = gallery?.scenes.find((s) => s.id === d.gallery_scene);
        const now = GROUPS[group][2].map((m) => states[`light.${m}`]._s as Sim).filter((l) => l?.on && l.xy).map((l) => l.xy!);
        const created = addScene(group, d.name!, scene ? (scene.kind === "white" ? { mirek: scene.mirek } : { palette: scene.points }) : { palette: now });
        pushScenes([created]);
      }
      if (domain === "hue_studio" && service === "delete_scene") {
        delete states[one];
        delete entities[one];
        delete sceneInfo[one];
      }
      if (domain === "hue_studio" && service === "create_zone") {
        const id = d.name!.toLowerCase().replace(/[^a-z]+/g, "_");
        GROUPS[id] = [d.name!, "zone", ids.map((l) => l.replace("light.", ""))];
      }
      if (domain === "hue_studio" && service === "update_zone") {
        const zone = GROUPS[one.replace("light.", "")];
        if (d.name) zone[0] = d.name;
        if (d.lights) zone[2] = d.lights.map((l) => l.replace("light.", ""));
      }
      if (domain === "hue_studio" && service === "delete_zone") delete GROUPS[one.replace("light.", "")];
      const auto = data as ServiceData & { area?: string; phase?: Phase; season?: string; step?: string; scenes?: string[]; scene?: string; excluded?: boolean; delta?: number; option?: string };
      if (domain === "hue_studio" && service === "auto_light_pool") {
        const config = autoAreas[auto.area!];
        const moods = ((config.pools[auto.phase!] ??= {})[auto.season!] ??= {});
        if (auto.phase === "day") {
          for (const mood of ["clear", "gloomy"]) {
            const steps = ((moods[mood] as string[][]) ??= [[], [], [], []]);
            steps[Number(auto.step)] = auto.scenes!;
          }
        } else moods[auto.step!] = auto.scenes!;
        pushAuto();
      }
      if (domain === "hue_studio" && service === "auto_light_exclude") {
        const config = autoAreas[auto.area!];
        config.excluded = config.excluded.filter((s) => s !== auto.scene);
        if (auto.excluded) config.excluded.push(auto.scene!);
        pushAuto();
      }
      if (domain === "hue_studio" && service === "auto_light_offset") {
        const offsets = autoAreas[auto.area!].offsets;
        offsets[auto.phase!] = auto.delta === 0 ? 0 : (offsets[auto.phase!] || 0) + auto.delta!;
        pushAuto();
      }
      if (domain === "hue_studio" && service === "apply_auto_light") {
        if ((auto as { resume?: boolean }).resume) manualAreas.delete(auto.area!);
        const s = autoState(auto.area!);
        if (s.control === "auto" && s.kelvin) {
          applyPalette(["light.desk_lamp"], { kind: "white", mirek: Math.round(1e6 / s.kelvin), brightness: s.brightness });
        } else if (s.control === "auto" && s.scene) {
          const scene = gallery?.scenes.find((g) => g.id === s.scene);
          if (scene) applyPalette(["light.desk_lamp"], { ...scene, brightness: s.brightness });
        }
        pushAuto();
      }
      if (domain === "select" && one.endsWith("_light_control")) {
        const area = one.replace("select.", "").replace("_light_control", "");
        autoAreas[area].control = auto.option === "off" ? "off" : "auto";
        manualAreas = new Set([...manualAreas].filter((a) => a !== area || auto.option === "manual"));
        if (auto.option === "manual") manualAreas.add(area);
        pushAuto();
      }
      if (domain === "button" && one.endsWith("_next_light_scene")) {
        const area = one.replace("button.", "").replace("_next_light_scene", "");
        skips[area] = (skips[area] || 0) + 1;
        pushAuto();
      }
      if (domain === "hue_studio" && service === "align_rooms") {
        const opts = data as { delete_empty_rooms?: boolean; keep_split_scenes?: boolean };
        alignRooms(data.entity_id ? [data.entity_id].flat() : null, !!opts.delete_empty_rooms, !!opts.keep_split_scenes);
        pushRooms();
      }
      if (domain === "hue_studio" && service === "save_scene") {
        const info = sceneInfo[one];
        if (d.name) states[one] = { ...states[one], attributes: { ...states[one].attributes, name: d.name } };
        sceneInfo[one] = { ...info, speed: d.speed !== undefined ? d.speed / 100 : info.speed, auto_dynamic: d.auto_dynamic ?? info.auto_dynamic };
        pushScenes([one]);
      }
      if (domain === "hue_studio" && service === "save_sync_preset") {
        box = { ...box, presets: [...(box.presets || []), { id: `p${Date.now()}`, name: String(d.name), last_used: null }] };
        setTimeout(() => syncListeners.forEach((cb) => cb({ boxes: { box_tv: box } })), 150);
      }
      if (domain === "hue_studio" && service === "delete_sync_preset") {
        box = { ...box, presets: (box.presets || []).filter((p) => p.id !== d.preset) };
        setTimeout(() => syncListeners.forEach((cb) => cb({ boxes: { box_tv: box } })), 150);
      }
      if (domain === "hue_studio" && service === "learn_sync_ir_code" && box.ir) {
        box = { ...box, ir: { ...box.ir, scanning: true } };
        setTimeout(() => {
          box = { ...box, ir: { ...box.ir!, scanning: false, scanned: [...box.ir!.scanned, "20df40bf"] } };
          syncListeners.forEach((cb) => cb({ boxes: { box_tv: box } }));
        }, 2500);
        setTimeout(() => syncListeners.forEach((cb) => cb({ boxes: { box_tv: box } })), 150);
      }
      if (domain === "hue_studio" && (service === "set_sync_ir_code" || service === "delete_sync_ir_code") && box.ir) {
        const code = String(d.code);
        const codes = box.ir.codes.filter((c) => c.code !== code);
        if (service === "set_sync_ir_code") codes.push({ code, name: String(d.name), action: String(d.action) });
        box = { ...box, ir: { ...box.ir, codes, scanned: box.ir.scanned.filter((c) => c !== code) } };
        setTimeout(() => syncListeners.forEach((cb) => cb({ boxes: { box_tv: box } })), 150);
      }
      if (domain === "hue_studio" && service === "set_sync") {
        const { entity_id: _, ...change } = data as ServiceData & SyncChange;
        box = { ...predictSync(box, change), areas: box.areas?.map((a) => ({ ...a, active: a.id === box.area && !!box.syncing })) };
        setTimeout(() => syncListeners.forEach((cb) => cb({ boxes: { box_tv: box } })), 250);
        showSync();
      }
      if (domain === "hue_studio" && service === "apply_palette" && d.points) applyPalette(ids, { kind: "gradient", points: d.points });
      if (domain === "hue_studio" && service === "set_effect") {
        for (const id of ids) {
          const running = d.effect === "no_effect" ? null : { effect: d.effect!, xy: d.xy_color, mirek: d.mirek, speed: d.speed !== undefined ? d.speed / 100 : 0.5 };
          lightInfo[id] = { ...lightInfo[id], effect: running };
          update(id, { on: true, ...(d.brightness ? { bri: d.brightness * 2.55 } : {}), ...(d.xy_color ? { xy: d.xy_color, mirek: null } : {}) });
        }
        push(Object.fromEntries(ids.map((id) => [id, lightInfo[id]])));
      }
      if (domain === "hue_studio" && service === "apply_palette") {
        const scene = gallery?.scenes.find((s) => s.id === d.gallery_scene);
        if (scene) applyPalette(ids, scene);
      }
      if (domain === "adaptive_lighting" && service === "set_manual_control") {
        const al = states[one];
        const manual = new Set<string>(al.attributes.manual_control);
        (d.lights ?? []).forEach((l) => (d.manual_control ? manual.add(l) : manual.delete(l)));
        states[one] = { ...al, attributes: { ...al.attributes, manual_control: [...manual] } };
      }
      if (domain === "switch") {
        const sw = states[one];
        states[one] = { ...sw, state: service === "turn_on" ? "on" : "off" };
      }
      if (domain === "light" && ids.includes("light.desk_lamp") && (d.xy_color || d.color_temp_kelvin)) {
        // What Adaptive Lighting's take-over detection does for light.turn_on.
        const al = states["switch.adaptive_lighting_office"];
        states["switch.adaptive_lighting_office"] = { ...al, attributes: { ...al.attributes, manual_control: ["light.desk_lamp"] } };
      }
      if (domain === "hue_studio" && service === "set_gradient") {
        for (const id of ids) {
          const gradient = lightInfo[id].gradient;
          if (gradient) lightInfo[id] = { ...lightInfo[id], gradient: { ...gradient, points: d.points, ...(d.mode ? { mode: String(d.mode) } : {}) } };
          update(id, { on: true, xy: d.points[0], mirek: null });
        }
        push(Object.fromEntries(ids.map((id) => [id, lightInfo[id]])));
      }
      refreshGroups();
      onChange({ ...hass, states: { ...states } });
    },
    async callWS<T>(msg: { type: string } & Record<string, unknown>): Promise<T> {
      console.info("callWS", JSON.stringify(msg));
      const area = String(msg.area_id);
      if (msg.type === "hue_studio/auto_light/settings") {
        autoAreas[area] ??= { pools: {}, holidays: [], names: {}, excluded: [], offsets: {}, settings: {}, control: "auto" };
        const merged = { ...autoAreas[area].settings, ...(msg.settings as AutoLightSettings) } as Record<string, unknown>;
        autoAreas[area].settings = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== null));
        pushAuto();
        return null as T;
      }
      if (msg.type === "hue_studio/auto_light/update") {
        if (msg.holidays) autoAreas[area].holidays = msg.holidays as Holiday[];
        if (msg.excluded) autoAreas[area].excluded = msg.excluded as string[];
        pushAuto();
        return null as T;
      }
      if (msg.type === "hue_studio/auto_light/remove") {
        delete autoAreas[area];
        pushAuto();
        return null as T;
      }
      if (msg.type === "hue_studio/positions/set") {
        for (const [entity, points] of Object.entries(msg.positions as Record<string, RoomPoint[]>)) {
          positions[entity.replace("light.", "")] = { points, source: "store" };
        }
        setTimeout(() => positionListeners.forEach((cb) => cb(positionsMessage())), 80);
        return null as T;
      }
      if (msg.type === "hue_studio/config/set") {
        const { type: _type, ...change } = msg;
        config = { ...config, ...(change as Partial<StudioConfig>) };
        setTimeout(() => configListeners.forEach((cb) => cb(config)), 80);
        return null as T;
      }
      if (msg.type !== "hue_studio/lights/set_area") throw new Error("unknown command");
      devices[`dev_${String(msg.entity_id).replace("light.", "")}`].area_id = (msg.area_id as string | null) ?? null;
      pushRooms();
      onChange({ ...hass, states: { ...states }, devices: { ...devices } });
      return null as T;
    },
    connection: {
      async subscribeMessage<T>(cb: (msg: T) => void, msg: { type: string }) {
        const send = cb as unknown as (m: unknown) => void;
        if (msg.type === "hue_studio/positions/subscribe") {
          positionListeners.add(send);
          setTimeout(() => send(positionsMessage()), 50);
          return () => {
            positionListeners.delete(send);
          };
        }
        if (msg.type === "hue_studio/auto_light/subscribe") {
          autoListeners.add(send);
          setTimeout(() => send(structuredClone(autoMessage())), 55);
          return () => {
            autoListeners.delete(send);
          };
        }
        if (msg.type === "hue_studio/rooms/subscribe") {
          roomListeners.add(send);
          setTimeout(() => send(planRooms()), 35);
          return () => {
            roomListeners.delete(send);
          };
        }
        if (msg.type === "hue_studio/config/subscribe") {
          configListeners.add(send);
          setTimeout(() => send(config), 30);
          return () => {
            configListeners.delete(send);
          };
        }
        if (msg.type === "hue_studio/scenes/subscribe") {
          sceneListeners.add(send);
          setTimeout(() => send({ scenes: { ...sceneInfo } }), 40);
          return () => {
            sceneListeners.delete(send);
          };
        }
        if (msg.type === "hue_studio/sync/subscribe") {
          syncListeners.add(send);
          setTimeout(() => send({ boxes: { box_tv: box } }), 45);
          return () => {
            syncListeners.delete(send);
          };
        }
        if (msg.type !== "hue_studio/lights/subscribe") throw new Error("unknown command");
        listeners.add(send);
        setTimeout(() => send({ lights: { ...lightInfo } }), 50);
        return () => {
          listeners.delete(send);
        };
      },
    },
  };
  return hass;
}
