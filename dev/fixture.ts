// A fake `hass` for dev/panel.html: neutral demo data and a tiny simulation of the services
// the panel calls, so every screen can be clicked through without Home Assistant.

import { mirekToRgb, xyToRgb } from "../src/color.ts";
import { predictSync } from "../src/sync.ts";
import type {
  Gallery,
  BridgesMessage,
  MoveState,
  Hass,
  HassState,
  HueDeviceInfo,
  EntertainmentArea,
  LightInfo,
  LightsMessage,
  Palette,
  AutomationConfig,
  AutomationsMessage,
  DayConfig,
  DaylightMessage,
  DayPreview,
  Mood,
  Phase,
  PositionsMessage,
  RoomPoint,
  SceneTags,
  RoomsPlan,
  StudioConfig,
  SceneInfo,
  ServiceData,
  SyncBoxDevice,
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
/** What the bridge says the lights are (product, model): Settings → Devices shows it. */
const LIGHT_PRODUCTS: Record<string, [string, string]> = {
  desk_lamp: ["Signe gradient table", "915005987001"],
  tv_strip: ["Hue Play gradient lightstrip", "LCX006"],
  play_left: ["Hue Play", "LCT024"],
  play_right: ["Hue Play", "LCT024"],
  candle: ["Hue color candle", "LCT015"],
  kitchen_bulb: ["Hue color lamp", "LCA006"],
  string_lights: ["Festavia string lights", "LCX027"],
  globe_lights: ["Festavia globe string lights", "LCX029"],
};
/** Product names where one archetype covers several products (the icon tells them apart). */
const PRODUCTS: Record<string, string> = { desk_lamp: "Signe gradient table" };

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
  features: ["palette", "background_lighting", "presets", "settings", "ir"],
  device: { id: "c42996000000", host: "192.0.2.30", firmware: "2.5.4", update: null, wifi: 3, led: "normal", tv_power: true, ha_device: "dev_sync_box" },
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
  devices.dev_motion = { area_id: "office", name: "Office sensor", model: "Hue motion sensor" };
  devices.dev_thermostat = { area_id: "office" };
  const sensor = (id: string, platform: string, device: string, state: string, attributes: Record<string, unknown>) => {
    entities[id] = { platform, device_id: device };
    states[id] = { entity_id: id, state, attributes };
  };
  sensor("binary_sensor.office_motion", "hue", "dev_motion", "on", { device_class: "motion", friendly_name: "Office motion" });
  sensor("sensor.office_motion_temperature", "hue", "dev_motion", "21.9", { device_class: "temperature", friendly_name: "Office motion temperature" });
  sensor("sensor.office_thermostat", "demo", "dev_thermostat", "22.5", { device_class: "temperature", friendly_name: "Office thermostat" });
  sensor("sensor.office_motion_illuminance", "hue", "dev_motion", "35", { device_class: "illuminance", friendly_name: "Office motion illuminance" });
  // The Hue motion sensor's on/off switch (HA's `hue` creates it as "Motion sensor enabled").
  sensor("switch.office_sensor_motion_sensor_enabled", "hue", "dev_motion", "on", { friendly_name: "Office sensor Motion sensor enabled" });
  entities["switch.office_sensor_motion_sensor_enabled"].translation_key = "motion_sensor_enabled";
  sensor("sensor.office_sensor_battery", "hue", "dev_motion", "85", { device_class: "battery", unit_of_measurement: "%", friendly_name: "Office sensor Battery" });
  // The office Hue room's grouped motion (on the room's service device): never a sensor card.
  devices.dev_office_room = { area_id: "office", name: "Office", model: "Room", entry_type: "service" };
  sensor("binary_sensor.office_grouped_motion", "hue", "dev_office_room", "off", { device_class: "motion", friendly_name: "Office" });
  sensor("weather.home", "met", "", "cloudy", { friendly_name: "Home", cloud_coverage: 85 });
  sensor("sensor.season", "season", "", "autumn", { device_class: "enum", friendly_name: "Season" });
  // Hue Studio's own: the phase of the day and the mood (the light of the day).
  sensor("sensor.hue_studio_phase", "hue_studio", "", "evening", { device_class: "enum", friendly_name: "Hue Studio Phase of the day" });
  sensor("select.hue_studio_mood", "hue_studio", "", "auto", {
    friendly_name: "Hue Studio Mood",
    options: ["auto", "relax", "cozy", "focus", "romantic", "party", "festive"],
  });
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
      product: PRODUCTS[id] ?? null,
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

  // Automations: HA's automation configs (ours use the blueprints) and their entities.
  const automationListeners = new Set<(msg: unknown) => void>();
  // From before 0.10 (pools of its own): the panel moves them into the global pool.
  const OFFICE_DAY: Partial<DayConfig> = {
    pools: {
      day: { all: { clear: [["sunday_morning"], ["cool_bright"], ["sunday_morning", "fairfax"], ["arctic_aurora"]] } },
      golden: { all: { clear: ["golden_star", "honolulu"] } },
      evening: { all: { clear: ["dreamy_dusk", "rolling_hills", "unwind"], gloomy: ["amber_bloom"] }, winter: { clear: ["silent_night"] } },
      night: { all: { clear: ["nightlight"] } },
    },
    holidays: [{ from: "12-20", to: "01-06", phases: ["evening"], pool: ["silent_night", "snow_capped"] }],
    excluded: ["unwind"],
    offsets: { evening: 10 },
    settings: { weather: "weather.home", light_sensor: "sensor.office_motion_illuminance" },
  };
  const automationConfigs: Record<string, AutomationConfig> = {
    "automation.office_light": {
      id: "hue_studio_motion_demo1",
      alias: "Office light",
      use_blueprint: {
        path: "hue_studio/motion.yaml",
        input: { rooms: ["office"], motion: ["binary_sensor.office_motion"], off_after: 10, light: "auto", scene_of_the_day: OFFICE_DAY },
      },
    },
    "automation.wake_up": {
      id: "hue_studio_wake_up_demo2",
      alias: "Wake up",
      use_blueprint: { path: "hue_studio/wake_up.yaml", input: { rooms: ["bedroom"], time: "06:45:00", days: ["mon", "tue", "wed", "thu", "fri"], fade: 30, light: "white", kelvin: 4000 } },
    },
    "automation.balcony_evening": {
      id: "hue_studio_schedule_demo3",
      alias: "Balcony evening",
      use_blueprint: {
        path: "hue_studio/schedule.yaml",
        input: { rooms: ["balcony"], start_kind: "sunset", start_offset: { hours: 0, minutes: -20, seconds: 0 }, end_kind: "time", end_time: "23:00:00", light: "natural" },
      },
    },
    "automation.film_night": {
      id: "hue_studio_schedule_demo4",
      alias: "Film night",
      use_blueprint: {
        path: "hue_studio/schedule.yaml",
        input: { rooms: [], zones: ["light.tv_area"], start_kind: "time", start_time: "20:30:00", days: ["fri", "sat"], light: "white", kelvin: 2200, brightness: 30 },
      },
    },
    "automation.tv_dim": { id: "1712345678901", alias: "Dim the TV area when a film starts", triggers: [], actions: [] },
  };
  let automationReloads = 0;
  const automationState = (entityId: string, on = true) => {
    const config = automationConfigs[entityId];
    states[entityId] = { entity_id: entityId, state: on ? "on" : "off", attributes: { id: config.id, friendly_name: config.alias, last_triggered: null } };
  };
  for (const id of Object.keys(automationConfigs)) automationState(id, id !== "automation.balcony_evening");
  const automationsMessage = (): AutomationsMessage => {
    const ours: AutomationsMessage["automations"] = {};
    for (const [entityId, config] of Object.entries(automationConfigs)) {
      const type = /^hue_studio\/([a-z_]+)\.yaml$/.exec(config.use_blueprint?.path || "")?.[1] || null;
      // HA reports what an automation controls from its targets (here: straight from the inputs).
      const input = (config.use_blueprint?.input || {}) as { rooms?: string[]; zones?: string[] };
      if (type || config.id?.startsWith("hue_studio_"))
        ours[entityId] = { id: config.id || null, type, custom: !type, areas: [...(input.rooms || [])], groups: [...(input.zones || [])] };
    }
    const related = Object.keys(automationConfigs).filter((id) => !ours[id]);
    return { automations: ours, related, types: ["wake_up", "go_to_sleep", "coming_home", "leaving_home", "mimic_presence", "schedule", "motion"], reloads: automationReloads };
  };
  const pushAutomations = () => {
    automationReloads++;
    setTimeout(() => automationListeners.forEach((cb) => cb(structuredClone(automationsMessage()))), 60);
  };
  // The global light of the day: ready-made tags (scene_tags.json), the user's tags, settings.
  const daylightListeners = new Set<(msg: unknown) => void>();
  let readyTags: Record<string, SceneTags> = {};
  fetch(new URL("../custom_components/hue_studio/scene_tags.json", location.href))
    .then((r) => r.json())
    .then((t: { scenes: Record<string, SceneTags> }) => {
      readyTags = t.scenes;
      pushDaylight();
    });
  const day = { settings: { defaults: true } as DaylightMessage["settings"], user: {} as Record<string, SceneTags>, merged: false };
  const PHASE_ORDER: Phase[] = ["morning", "day", "golden", "evening", "night"];
  const phaseNow = (): Phase => {
    const hour = new Date().getHours();
    return hour >= 23 || hour < 6 ? "night" : hour < 8 ? "morning" : hour < 17 ? "day" : hour < 18 ? "golden" : "evening";
  };
  const poolTags = (): Record<string, SceneTags> => {
    const tags: Record<string, SceneTags> = {};
    for (const id of [...(day.settings.defaults ? Object.keys(readyTags) : []), ...Object.keys(day.user)]) {
      const t = day.user[id] ?? readyTags[id];
      if (t && Object.keys(t).length) tags[id] = t;
      else delete tags[id];
    }
    return tags;
  };
  /** A rough copy of daylight.select (autumn, gloomy): enough to click through the screens. */
  const preview = (config: Partial<DayConfig>, natural: boolean): DayPreview => {
    const phase = phaseNow();
    const mood = (states["select.hue_studio_mood"]?.state || "auto") as Mood | "auto";
    const base = { phase, season: "autumn" as const, weather: "gloomy" as const };
    if (natural) {
      const kelvin = { morning: 5000, day: 4300, golden: 2900, evening: 2200, night: 2000, ...config.settings?.kelvin }[phase];
      return { ...base, mood: null, pool_phase: phase, scene: null, pool: [], brightness: config.settings?.brightness?.[phase] ?? 70, kelvin };
    }
    const tags = poolTags();
    for (const id of config.include || []) tags[id] ??= { ...readyTags[id], phases: readyTags[id]?.phases || PHASE_ORDER };
    for (const id of [...(config.exclude || []), ...(config.excluded || [])]) delete tags[id];
    const fit = (id: string, key: keyof SceneTags, value: string) => !tags[id][key]?.length || (tags[id][key] as string[]).includes(value);
    const narrow = (pool: string[], steps: [keyof SceneTags, string][]) => {
      for (const [key, value] of steps) {
        const next = pool.filter((id) => fit(id, key, value));
        if (next.length) pool = next;
      }
      return pool;
    };
    let pool: string[] = [];
    let poolPhase = phase;
    let from: Mood | null = null;
    const moody = mood === "auto" ? [] : Object.keys(tags).filter((id) => tags[id].moods?.includes(mood));
    if (moody.length) {
      pool = narrow(moody, [["seasons", "autumn"], ["phases", phase], ["weather", "gloomy"]]);
      from = mood as Mood;
    } else {
      for (let back = 0; back < PHASE_ORDER.length && !pool.length; back++) {
        poolPhase = PHASE_ORDER[(PHASE_ORDER.indexOf(phase) - back + PHASE_ORDER.length) % PHASE_ORDER.length];
        pool = Object.keys(tags).filter((id) => tags[id].phases?.includes(poolPhase));
      }
      pool = narrow(pool, [["seasons", "autumn"], ["weather", "gloomy"]]);
    }
    const scene = pool.length ? pool[new Date().getDate() % pool.length] : null;
    const fixed = config.settings?.brightness?.[poolPhase];
    return {
      ...base, mood: from, pool_phase: poolPhase, scene, pool, kelvin: null,
      scene_name: scene ? gallery?.scenes.find((g) => g.id === scene)?.name || scene : null,
      brightness: Math.min(100, Math.max(1, (fixed ?? 70) + (config.offsets?.[poolPhase] || 0))),
    };
  };
  const daylightMessage = (): DaylightMessage => ({
    settings: { ...day.settings },
    user_tags: { ...day.user },
    defaults: readyTags,
    tags: poolTags(),
    sources: { weather: day.settings.weather || "weather.home", season: day.settings.season || "sensor.season", light_sensor: day.settings.light_sensor || null },
    now: preview({}, false),
    moods: ["relax", "cozy", "focus", "romantic", "party", "festive"],
    mood_entity: "select.hue_studio_mood",
    phase_entity: "sensor.hue_studio_phase",
  });
  const pushDaylight = () => setTimeout(() => daylightListeners.forEach((cb) => cb(structuredClone(daylightMessage()))), 60);
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
  // ?bridges=two: a second bridge with the balcony's lights; &split=1 puts the candle there too
  // (its living room then has lights on two bridges).
  const params = new URLSearchParams(location.search);
  const twoBridges = params.get("bridges") === "two";
  const onSecond = new Set(twoBridges ? ["globe_lights", ...(params.get("split") === "1" ? ["candle"] : [])] : []);
  const lightBridge = (entityId: string) => (onSecond.has(entityId.replace("light.", "")) ? "hue-entry-2" : "hue-entry");
  const groupBridge = (group: string) => (GROUPS[group]?.[2].length && GROUPS[group][2].every((l) => onSecond.has(l)) ? "hue-entry-2" : "hue-entry");
  // Add devices: a switch and a sensor without an area; the search finds a lamp.
  const hueDevices: HueDeviceInfo[] = [
    { id: "dev-dial", name: "Hue tap dial switch 1", product: "Hue tap dial switch", model: "RDM002", archetype: "unknown_archetype", kind: "switch", new: false, found: null, area: null, lights: [], ha_device: null, sensitivity: null, software: "2.47.8", reachable: false },
    { id: "dev-motion2", name: "Hue motion sensor 2", product: "Hue motion sensor", model: "SML003", archetype: "unknown_archetype", kind: "sensor", new: false, found: null, area: null, lights: [], ha_device: null, sensitivity: { value: 2, max: 4 } },
    // The office's motion sensor (HA device dev_motion).
    { id: "dev-motion1", name: "Office sensor", product: "Hue motion sensor", model: "SML003", archetype: "unknown_archetype", kind: "sensor", new: false, found: null, area: "office", lights: [], ha_device: "dev_motion", sensitivity: { value: 2, max: 4 } },
    // The lights (one device each); the string lights are switched off at the wall.
    ...Object.entries(LIGHTS).map(([id, [name, area]]): HueDeviceInfo => {
      const [product, model] = LIGHT_PRODUCTS[id] ?? ["Hue color lamp", "LCA006"];
      return {
        id: `dev-${id}`, name, product, model, archetype: ARCHETYPES[id] ?? "classic_bulb", kind: "light", new: false, found: null,
        area: area || null, lights: [`light.${id}`], ha_device: `dev_${id}`, sensitivity: null, software: "1.122.8",
        reachable: id !== "string_lights", function: id === "string_lights" || id === "globe_lights" || id === "candle" ? "decorative" : "functional",
        power_on: id === "kitchen_bulb" ? "powerfail" : "safety",
      };
    }),
  ];
  let searching = false;
  let searchStarted: number | null = null;
  // Entertainment areas: the TV area (the living room's TV lights) and a desk area.
  const entAreas: EntertainmentArea[] = [
    { id: "ent-tv", name: "TV area", type: "screen", streaming: false, lights: {
      "light.tv_strip": [[-0.6, 1, -0.2], [0.6, 1, -0.2]], "light.play_left": [[-0.9, 0.9, 0]], "light.play_right": [[0.9, 0.9, 0]] } },
    { id: "ent-desk", name: "Desk", type: "monitor", streaming: false, lights: { "light.desk_lamp": [[0, 0.6, 0.2]] } },
  ];
  const entListeners = new Set<(m: unknown) => void>();
  const entLights = ["light.candle", "light.desk_lamp", "light.globe_lights", "light.play_left", "light.play_right", "light.tv_strip"];
  const entMessage = () => ({
    "hue-entry": { name: "Hue Bridge", areas: structuredClone(entAreas), lights: entLights.filter((l) => lightBridge(l) === "hue-entry") },
    ...(twoBridges ? { "hue-entry-2": { name: "Garden Bridge", areas: [], lights: entLights.filter((l) => lightBridge(l) === "hue-entry-2") } } : {}),
  });
  const pushEnt = () => setTimeout(() => entListeners.forEach((cb) => cb(entMessage())), 60);
  // ?bridges=basic: no Hue Bridge Pro (no MotionAware).
  const pro = new URLSearchParams(location.search).get("bridges") !== "basic";
  const bridgesMessage: BridgesMessage = {
    "hue-entry": { name: "Hue Bridge", connected: true, host: "192.0.2.10", id: "001788fffe000000", model: pro ? "Hue Bridge Pro" : "Hue Bridge",
      software: "1.70.1970", pro, ha_device: "dev_bridge", devices: 14, lights: 11,
      motion_areas: pro ? [{ id: "ma-1", name: "Living room", group: "Living room", enabled: true, health: "healthy",
        lights: [{ entity_id: "light.play_left", health: "healthy" }, { entity_id: "light.play_right", health: "healthy" }] }] : null },
    "hue-entry-2": twoBridges
      ? { name: "Garden Bridge", connected: true, host: "192.0.2.11", id: "001788fffe000001", model: "Hue Bridge", software: "1.70.1970",
          pro: false, ha_device: null, devices: onSecond.size, lights: onSecond.size, rooms: 1, zones: 0, motion_areas: null }
      : { name: "Garden Bridge", connected: false, host: "192.0.2.11", id: "001788fffe000001", model: null, software: null,
          pro: false, ha_device: null, devices: null, lights: null, motion_areas: null },
  };
  bridgesMessage["hue-entry"].lights = Object.keys(LIGHTS).filter((l) => !onSecond.has(l)).length;
  bridgesMessage["hue-entry"].rooms = Object.entries(GROUPS).filter(([g, v]) => v[1] === "room" && groupBridge(g) === "hue-entry").length;
  bridgesMessage["hue-entry"].zones = Object.values(GROUPS).filter((v) => v[1] === "zone").length;
  const bridgeListeners = new Set<(m: unknown) => void>();
  // Moving to another bridge (?bridges=two): a simulated run (the old bridge lets go, then
  // it waits for "Continue"); ?move=power_cycle|searching|waiting|done starts the page with
  // a move in that state (the living room to the Garden Bridge); &movefail=1: one not found.
  const moveListeners = new Set<(m: unknown) => void>();
  const moveTimers: ReturnType<typeof setTimeout>[] = [];
  const movingLights = (msg: Record<string, unknown>): string[] =>
    msg.bridge
      ? Object.keys(LIGHTS).map((l) => `light.${l}`)
      : Array.isArray(msg.lights)
        ? (msg.lights as string[])
        : Object.keys(LIGHTS).filter((l) => devices[`dev_${l}`].area_id === msg.area).map((l) => `light.${l}`);
  const moveDevices = (lights: string[], found: (i: number) => boolean): MoveState["devices"] =>
    lights.map((l, i) => ({ entity_id: l, name: LIGHTS[l.replace("light.", "")]?.[0] ?? l, light: true, found: found(i) }));
  let move: MoveState | null = null;
  const pushMove = () => setTimeout(() => moveListeners.forEach((cb) => cb(structuredClone(move))), 30);
  /** Steps from `from` on, `missing` devices never found; stops at the pause unless past it. */
  const runMove = (steps: MoveState["step"][], missing: number) => {
    moveTimers.splice(0).forEach(clearTimeout);
    steps.forEach((step, i) =>
      moveTimers.push(setTimeout(() => {
        if (!move) return;
        const searching = step === "searching";
        move = { ...move, step, running: step !== "done" && step !== "power_cycle", error: null, searching_until: searching ? Date.now() / 1000 + 60 : null };
        const total = move.devices.length;
        if (searching) move.devices = move.devices.map((d, j) => ({ ...d, found: j === 0 && total - missing > 0 }));
        if (step === "restoring") {
          move.devices = move.devices.map((d, j) => ({ ...d, found: j < total - missing }));
          if (missing) {
            move = { ...move, step: "waiting", running: false, error: "not_found" };
            moveTimers.splice(0).forEach(clearTimeout);
          }
        }
        pushMove();
      }, 900 + i * 2200)),
    );
  };
  const seedMove = params.get("move");
  if (twoBridges && seedMove) {
    const lights = ["tv_strip", "play_left", "play_right", "candle"].map((l) => `light.${l}`);
    move = {
      step: seedMove as MoveState["step"], error: seedMove === "waiting" ? "not_found" : null, source: "hue-entry", target: "hue-entry-2",
      source_name: "Hue Bridge", target_name: "Garden Bridge", rooms: ["Living room"], whole_bridge: false, area: "living_room",
      searching_until: seedMove === "searching" ? Date.now() / 1000 + 42 : null, running: seedMove === "searching",
      devices: moveDevices(lights, (i) => seedMove === "done" || (seedMove !== "power_cycle" && i < (seedMove === "waiting" ? 3 : 2))),
    };
  }
  const pushBridges = () => setTimeout(() => bridgeListeners.forEach((cb) => cb(structuredClone(bridgesMessage))), 60);
  const deviceListeners = new Set<(m: unknown) => void>();
  const devicesMessage = () => ({
    "hue-entry": { name: "Hue Bridge", searching, search_started: searching ? searchStarted : null, other_brands: true,
      devices: structuredClone(hueDevices.filter((d) => !d.lights.some((l) => lightBridge(l) === "hue-entry-2"))) },
    ...(twoBridges
      ? { "hue-entry-2": { name: "Garden Bridge", searching: false, search_started: null, other_brands: false,
          devices: structuredClone(hueDevices.filter((d) => d.lights.some((l) => lightBridge(l) === "hue-entry-2"))) } }
      : {}),
  });
  const pushDevices = () => setTimeout(() => deviceListeners.forEach((cb) => cb(devicesMessage())), 60);
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
      bridge: assigned[a] ? groupBridge(assigned[a]) : "hue-entry",
    }));
    // Several bridges (?bridges=two): which bridge has what, areas with lights on two.
    const bridgeOf: Record<string, string> = {
      ...Object.fromEntries(ids.map((l) => [`light.${l}`, lightBridge(`light.${l}`)])),
      ...Object.fromEntries(Object.keys(GROUPS).map((g) => [`light.${g}`, groupBridge(g)])),
      ...Object.fromEntries(Object.entries(SCENES).flatMap(([g, list]) => list.map((n) => [sceneId(g, n), groupBridge(g)]))),
    };
    const splitAreas = Object.fromEntries(
      areas
        .map((a): [string, string[]] => [a, [...new Set(ids.filter((l) => areaOf(l) === a).map((l) => lightBridge(`light.${l}`)))]])
        .filter(([, b]) => b.length > 1),
    );
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
      bridges: twoBridges ? { "hue-entry": "Hue Bridge", "hue-entry-2": "Garden Bridge" } : { "hue-entry": "Hue Bridge" },
      bridge_of: bridgeOf,
      split_areas: splitAreas,
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
    user: { is_admin: true },
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
      if (domain === "automation" && (service === "turn_on" || service === "turn_off")) {
        for (const id of [data.entity_id].flat()) if (id && automationConfigs[id]) automationState(id, service === "turn_on");
      }
      if (domain === "select" && service === "select_option" && data.entity_id === "select.hue_studio_mood") {
        states["select.hue_studio_mood"] = { ...states["select.hue_studio_mood"], state: String(d.option) };
        pushDaylight();
      }
      if (domain === "hue_studio" && service === "apply_light") {
        const a = data as ServiceData & { area_id?: string[]; light?: string; scene_of_the_day?: DayConfig };
        const lights = Object.keys(LIGHTS).filter((l) => (a.area_id || []).includes(devices[`dev_${l}`].area_id || "")).map((l) => `light.${l}`);
        const p = preview(a.scene_of_the_day || ({} as DayConfig), a.light === "natural");
        const scene = p.scene ? gallery?.scenes.find((g) => g.id === p.scene) : null;
        if (p.kelvin) applyPalette(lights, { kind: "white", mirek: Math.round(1e6 / p.kelvin), brightness: p.brightness });
        else if (scene) applyPalette(lights, { ...scene, brightness: p.brightness });
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
    // HA's automation config API: write or delete an automation, then HA reloads it.
    async callApi<T>(method: "GET" | "POST" | "DELETE", path: string, data?: Record<string, unknown>): Promise<T> {
      console.info("callApi", method, path, JSON.stringify(data));
      await new Promise((r) => setTimeout(r, 120));
      const id = decodeURIComponent(path.replace("config/automation/config/", ""));
      const entityId = Object.keys(automationConfigs).find((e) => automationConfigs[e].id === id);
      if (method === "GET") {
        if (!entityId) throw new Error("Resource not found");
        return structuredClone(automationConfigs[entityId]) as T;
      }
      if (method === "DELETE" && entityId) {
        delete automationConfigs[entityId];
        delete states[entityId];
      }
      if (method === "POST") {
        const config = data as AutomationConfig;
        const target = entityId || `automation.${String(config.alias || id).toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
        automationConfigs[target] = config;
        automationState(target, states[target]?.state !== "off");
      }
      pushAutomations();
      onChange({ ...hass, states: { ...states } });
      return null as T;
    },
    async callWS<T>(msg: { type: string } & Record<string, unknown>): Promise<T> {
      console.info("callWS", JSON.stringify(msg));
      const area = String(msg.area_id);
      if (msg.type === "automation/config") {
        // Like HA: a blueprint automation comes back expanded, without its inputs.
        const config = automationConfigs[String(msg.entity_id)];
        if (!config) throw new Error("not found");
        return { config: { id: config.id, alias: config.alias, triggers: [], actions: [] } } as T;
      }
      if (msg.type === "hue_studio/automations/organize") return null as T;
      if (msg.type === "hue_studio/daylight/set") {
        const { type: _type, ...change } = msg;
        const settings = day.settings as unknown as Record<string, unknown>;
        for (const [key, value] of Object.entries(change)) {
          if (value === null) delete settings[key];
          else settings[key] = value;
        }
        pushDaylight();
        return null as T;
      }
      if (msg.type === "hue_studio/daylight/tags") {
        if (msg.tags === null) delete day.user[String(msg.scene)];
        else day.user[String(msg.scene)] = msg.tags as SceneTags;
        pushDaylight();
        return null as T;
      }
      if (msg.type === "hue_studio/daylight/merge") {
        // Roughly daylight.tags_from_pools: the phases each scene was in.
        const found: Record<string, Set<Phase>> = {};
        for (const [phase, seasons] of Object.entries((msg.pools || {}) as NonNullable<DayConfig["pools"]>))
          for (const lists of Object.values(seasons)) for (const list of Object.values(lists)) for (const id of list.flat()) (found[id] ??= new Set()).add(phase as Phase);
        for (const [id, phases] of Object.entries(found)) day.user[id] = { phases: PHASE_ORDER.filter((p) => phases.has(p)) };
        if (!day.merged) day.settings.defaults = false;
        day.merged = true;
        pushDaylight();
        return { scenes: Object.keys(found).length } as T;
      }
      if (msg.type === "hue_studio/automations/preview") return preview(msg.scene_of_the_day as DayConfig, !!msg.natural) as T;
      if (msg.type === "hue_studio/automations/legacy_auto_light") {
        return { office: { natural: false, config: OFFICE_DAY } } as T;
      }
      if (msg.type === "hue_studio/positions/set") {
        for (const [entity, points] of Object.entries(msg.positions as Record<string, RoomPoint[]>)) {
          positions[entity.replace("light.", "")] = { points, source: "store" };
        }
        setTimeout(() => positionListeners.forEach((cb) => cb(positionsMessage())), 80);
        return null as T;
      }
      if (msg.type === "hue_studio/entertainment/create") {
        entAreas.push({ id: `ent-${Date.now()}`, name: String(msg.name), type: msg.area_type as EntertainmentArea["type"], streaming: false,
          lights: Object.fromEntries((msg.lights as string[]).map((l, i) => [l, [[i * 0.4 - 0.4, 0.8, 0]]])) });
        pushEnt();
        return null as T;
      }
      if (msg.type === "hue_studio/entertainment/update" || msg.type === "hue_studio/entertainment/positions") {
        const area = entAreas.find((a) => a.id === msg.area_id);
        if (area) {
          if (msg.name) area.name = String(msg.name);
          if (msg.area_type) area.type = msg.area_type as EntertainmentArea["type"];
          if (msg.lights) area.lights = Object.fromEntries((msg.lights as string[]).map((l) => [l, area.lights[l] || [[0, 0.8, 0]]]));
          if (msg.positions) Object.assign(area.lights, msg.positions);
        }
        pushEnt();
        return null as T;
      }
      if (msg.type === "hue_studio/entertainment/delete") {
        entAreas.splice(entAreas.findIndex((a) => a.id === msg.area_id), 1);
        pushEnt();
        return null as T;
      }
      if (msg.type === "hue_studio/bridges/motion_area") {
        const area = bridgesMessage["hue-entry"].motion_areas?.find((a) => a.id === msg.area_id);
        if (area) area.enabled = !!msg.enabled;
        pushBridges();
        return null as T;
      }
      if (msg.type === "hue_studio/config/set_group" || msg.type === "hue_studio/config/set_room_sensors") return null as T;
      if (msg.type === "hue_studio/devices/search") {
        // ?found=0: the search finds nothing. Otherwise a lamp joins, then a dimmer switch.
        const finds = new URLSearchParams(location.search).get("found") !== "0";
        searching = true;
        searchStarted = Date.now() / 1000;
        const n = hueDevices.filter((d) => d.id.startsWith("dev-new")).length;
        if (finds) {
          setTimeout(() => {
            hueDevices.unshift({ id: `dev-new${n}`, name: `Hue color lamp ${3 + n}`, product: "Hue color lamp", model: "LCA006", archetype: "sultan_bulb", kind: "light", new: true, found: Date.now() / 1000, area: null, lights: [], ha_device: null, sensitivity: null, software: "1.122.2", reachable: true });
            pushDevices();
          }, 2500);
          setTimeout(() => {
            hueDevices.unshift({ id: `dev-new${n}-dimmer`, name: "Hue dimmer switch 1", product: "Hue dimmer switch", model: "RWL022", archetype: "unknown_archetype", kind: "switch", new: true, found: Date.now() / 1000, area: null, lights: [], ha_device: null, sensitivity: null, software: "2.45.2", reachable: true });
            pushDevices();
          }, 4500);
        }
        setTimeout(() => {
          searching = false;
          pushDevices();
        }, 8000);
        pushDevices();
        return null as T;
      }
      if (msg.type === "hue_studio/devices/delete") {
        const i = hueDevices.findIndex((d) => d.id === msg.device);
        if (i < 0) throw new Error("unknown device");
        hueDevices.splice(i, 1);
        pushDevices();
        return null as T;
      }
      if (msg.type === "config/area_registry/create") {
        const id = String(msg.name).toLowerCase().replace(/[^a-z0-9]+/g, "_");
        AREAS[id] = { name: String(msg.name), icon: null };
        onChange({ ...hass, areas: { ...AREAS } });
        return { area_id: id, name: String(msg.name) } as T;
      }
      if (msg.type === "hue_studio/bridges/move_plan") {
        const lights = movingLights(msg);
        const rooms = msg.bridge ? Object.values(GROUPS).filter((g) => g[1] === "room").map((g) => g[0]) : msg.area ? [AREAS[String(msg.area)]?.name] : [];
        return {
          source: msg.bridge ? String(msg.bridge) : "hue-entry", target: String(msg.target), source_name: msg.bridge ? bridgesMessage[String(msg.bridge)]?.name : "Hue Bridge",
          target_name: bridgesMessage[String(msg.target)]?.name ?? "", whole_bridge: !!msg.bridge,
          lights, accessories: msg.bridge || msg.area === "office" ? ["Office sensor"] : [], rooms, scenes: rooms.length ? 4 : 0,
          zones: lights.includes("light.tv_strip") ? [{ name: "TV area", whole: rooms.length > 0 }] : [],
          entertainment: lights.includes("light.tv_strip") ? [{ name: "TV area", whole: rooms.length > 0 }] : [], over_limit: false,
        } as T;
      }
      if (msg.type === "hue_studio/bridges/move") {
        const lights = movingLights(msg);
        move = {
          step: "saving", error: null, source: msg.bridge ? String(msg.bridge) : "hue-entry", target: String(msg.target),
          source_name: msg.bridge ? bridgesMessage[String(msg.bridge)]?.name : "Hue Bridge", target_name: bridgesMessage[String(msg.target)]?.name ?? "",
          rooms: msg.area ? [AREAS[String(msg.area)]?.name] : [], whole_bridge: !!msg.bridge, area: msg.area || msg.to_area ? String(msg.area ?? msg.to_area) : null,
          searching_until: null, running: true, devices: moveDevices(lights, () => false),
        };
        pushMove();
        // A whole bridge searches at once; part of one waits for the lights to be switched off and on.
        runMove(msg.bridge ? ["removing", "searching", "restoring", "rooms", "scenes", "done"] : ["removing", "power_cycle"], 0);
        return null as T;
      }
      if (msg.type === "hue_studio/bridges/move/continue" || msg.type === "hue_studio/bridges/move/retry") {
        if (move) move = { ...move, running: true, error: null, ...(msg.target ? { target: String(msg.target), target_name: "Hue Bridge" } : {}) };
        pushMove();
        const fail = msg.type === "hue_studio/bridges/move/continue" && params.get("movefail") === "1" ? 1 : 0;
        runMove(["searching", "restoring", "rooms", "scenes", "done"], fail);
        return null as T;
      }
      if (msg.type === "hue_studio/bridges/move/finish") {
        moveTimers.splice(0).forEach(clearTimeout);
        move = null;
        pushMove();
        return null as T;
      }
      if (msg.type === "hue_studio/bridges/rename") {
        bridgesMessage[String(msg.hue_entry_id)].name = String(msg.name);
        pushBridges();
        return null as T;
      }
      if (msg.type === "hue_studio/sync/configure") {
        const { entry_id: _, type: __, ...change } = msg;
        if (typeof change.name === "string") box = { ...box, name: change.name };
        box = { ...box, device: { ...box.device!, ...(change as Partial<SyncBoxDevice>) } };
        setTimeout(() => syncListeners.forEach((cb) => cb({ boxes: { box_tv: box } })), 150);
        return null as T;
      }
      if (msg.type === "hue_studio/devices/identify") return null as T;
      if (msg.type === "hue_studio/devices/setup") {
        const i = hueDevices.findIndex((d) => d.id === msg.device);
        const d = hueDevices[i];
        if (d?.ha_device) {
          // A device that HA has: the bridge renames it (HA follows), HA moves it.
          if (msg.name) d.name = String(msg.name);
          d.area = (msg.area_id as string | null) ?? null;
          if (typeof msg.sensitivity === "number" && d.sensitivity) d.sensitivity = { ...d.sensitivity, value: msg.sensitivity };
          if (typeof msg.function === "string") d.function = msg.function as HueDeviceInfo["function"];
          if (typeof msg.power_on === "string") d.power_on = msg.power_on as HueDeviceInfo["power_on"];
          devices[d.ha_device] = { ...devices[d.ha_device], name: d.name, area_id: d.area };
          pushDevices();
          onChange({ ...hass, states: { ...states }, devices: { ...devices } });
          return null as T;
        }
        if (i >= 0) hueDevices.splice(i, 1);
        pushDevices();
        return null as T;
      }
      if (msg.type === "hue_studio/devices/sensitivity") {
        // The sensor calibrates to it for a while (the bridge's `changing`), then it is set.
        const d = hueDevices.find((x) => x.id === msg.device);
        if (!d?.sensitivity) throw new Error("no motion sensitivity");
        d.sensitivity = { ...d.sensitivity, value: Number(msg.sensitivity), changing: true };
        pushDevices();
        setTimeout(() => {
          d.sensitivity = { ...d.sensitivity!, changing: false };
          pushDevices();
        }, 4000);
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
        if (msg.type === "hue_studio/daylight/subscribe") {
          daylightListeners.add(send);
          setTimeout(() => send(structuredClone(daylightMessage())), 45);
          return () => {
            daylightListeners.delete(send);
          };
        }
        if (msg.type === "hue_studio/positions/subscribe") {
          positionListeners.add(send);
          setTimeout(() => send(positionsMessage()), 50);
          return () => {
            positionListeners.delete(send);
          };
        }
        if (msg.type === "hue_studio/automations/subscribe") {
          automationListeners.add(send);
          setTimeout(() => send(structuredClone(automationsMessage())), 55);
          return () => {
            automationListeners.delete(send);
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
        if (msg.type === "hue_studio/entertainment/subscribe") {
          entListeners.add(send);
          setTimeout(() => send(entMessage()), 40);
          return () => {
            entListeners.delete(send);
          };
        }
        if (msg.type === "hue_studio/bridges/discover") {
          // Searching, then a new Bridge Pro on the network.
          const pro = { id: "001788000001", host: "192.0.2.20", name: "Hue Bridge Pro", model: "Hue Bridge Pro", supported: true };
          const t1 = setTimeout(() => send({ searching: true, bridges: [] }), 30);
          const t2 = setTimeout(() => send({ searching: false, bridges: [pro] }), 1200);
          return () => {
            clearTimeout(t1);
            clearTimeout(t2);
          };
        }
        if (msg.type === "hue_studio/bridges/link") {
          // Connecting, then the button; an address ending in .99 does not answer.
          const host = String((msg as Record<string, unknown>).host ?? "");
          const timers = [setTimeout(() => send({ step: "connecting" }), 20)];
          if (host.endsWith(".99")) timers.push(setTimeout(() => send({ step: "failed", reason: "cannot_connect" }), 900));
          else {
            timers.push(setTimeout(() => send({ step: "press", timeout: 60 }), 700));
            timers.push(setTimeout(() => send({ step: "done", hue_entry_id: "hue-entry-2", name: "Hue Bridge Pro" }), 9000));
          }
          return () => timers.forEach(clearTimeout);
        }
        if (msg.type === "hue_studio/bridges/move/subscribe") {
          moveListeners.add(send);
          setTimeout(() => send(structuredClone(move)), 30);
          return () => {
            moveListeners.delete(send);
          };
        }
        if (msg.type === "hue_studio/bridges/subscribe") {
          bridgeListeners.add(send);
          setTimeout(() => send(structuredClone(bridgesMessage)), 40);
          return () => {
            bridgeListeners.delete(send);
          };
        }
        if (msg.type === "hue_studio/devices/subscribe") {
          deviceListeners.add(send);
          setTimeout(() => send(devicesMessage()), 40);
          return () => {
            deviceListeners.delete(send);
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
