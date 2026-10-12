// What the panel shows, derived from the HA frontend `hass` object (plus Hue Studio's own
// config). Pure functions, no DOM.
//
// Rooms are HA areas that contain Hue lights; zones are Hue rooms/zones (light groups of
// the native integration). Which Hue group belongs to which area is decided by the
// integration options (config.groups: group -> area_id | "zone"); groups without an option
// are matched automatically: a group with exactly the area's lights becomes that room.

import { rgbCss, xyToRgb } from "./color.ts";
import type { HassData, LightInfo, RoomSensors, StudioConfig } from "./types.ts";

export interface Scene {
  entity_id: string;
  name: string;
  /** The Hue group the scene belongs to. */
  group: string;
}

/** A room (HA area) or zone (Hue group) as the panel shows it. */
export interface Group {
  key: string;
  kind: "area" | "hue";
  name: string;
  icon: string;
  /** Hue light entity ids. */
  lights: string[];
  /** The Hue group entity of this room, or null. */
  group: string | null;
  /** What to send commands to (see buildHome). */
  target: string[];
  scenes: Scene[];
  sensors: RoomSensors;
}

export interface Home {
  rooms: Group[];
  zones: Group[];
}

export interface GroupState {
  on: boolean;
  available: boolean;
  brightness: number;
  colors: string[];
  temperature: number | null;
  /** Mean of the light sensors (lx), or null. */
  illuminance: number | null;
  motion: boolean;
  /** When a motion sensor last changed while none reports motion now (ISO), or null. */
  lastMotion: string | null;
}

export interface AdaptiveSwitch {
  switch: string;
  on: boolean;
  /** Lights of the group under manual control. */
  manual: string[];
  /** Lights of the group the switch controls. */
  lights: string[];
}

export const isHueLight = (hass: HassData, id: string): boolean =>
  hass.entities?.[id]?.platform === "hue" && id.startsWith("light.") && !hass.states[id]?.attributes.is_hue_group;

export const isHueGroup = (hass: HassData, id: string): boolean =>
  hass.entities?.[id]?.platform === "hue" && id.startsWith("light.") && !!hass.states[id]?.attributes.is_hue_group;

/** Area of an entity: its own, else its device's. */
export const areaOf = (hass: HassData, id: string): string | null => {
  const entity = hass.entities?.[id];
  if (!entity) return null;
  return entity.area_id || (entity.device_id && hass.devices?.[entity.device_id]?.area_id) || null;
};

const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));
const unique = (list: string[]): string[] => [...new Set(list)];

export const friendlyName = (hass: HassData, id: string): string => hass.states[id]?.attributes.friendly_name || id;

/** Hue scenes of a Hue group, by the group name the native integration stores on scenes. */
export function scenesOf(hass: HassData, groupId: string): Scene[] {
  const name = friendlyName(hass, groupId);
  return Object.keys(hass.states)
    .filter((id) => id.startsWith("scene.") && hass.entities?.[id]?.platform === "hue")
    .filter((id) => hass.states[id].attributes.group_name === name)
    .map((id) => ({ entity_id: id, name: hass.states[id].attributes.name || friendlyName(hass, id), group: groupId }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const hasDeviceClass = (hass: HassData, id: string, classes: string[]): boolean => classes.includes(hass.states[id]?.attributes.device_class);
const MOTION_CLASSES = ["motion", "occupancy", "presence"];

/**
 * Default sensors of an area: Hue motion and light sensors in it; the area's temperature
 * sensor or Hue thermometers.
 */
function defaultSensors(hass: HassData, areaId: string | null): RoomSensors {
  if (!areaId) return { motion: [], temperature: [], illuminance: [] };
  const inArea = Object.keys(hass.states).filter((id) => areaOf(hass, id) === areaId && hass.entities?.[id]?.platform === "hue");
  const areaTemp = hass.areas?.[areaId]?.temperature_entity_id;
  return {
    motion: inArea.filter((id) => id.startsWith("binary_sensor.") && hasDeviceClass(hass, id, MOTION_CLASSES)),
    temperature: areaTemp ? [areaTemp] : inArea.filter((id) => id.startsWith("sensor.") && hasDeviceClass(hass, id, ["temperature"])),
    illuminance: inArea.filter((id) => id.startsWith("sensor.") && hasDeviceClass(hass, id, ["illuminance"])),
  };
}

/**
 * Build the home screen structure. A group's `target` is [its Hue group] when that covers
 * exactly its lights (one bridge command), else the lights.
 */
export function buildHome(hass: HassData, config: Partial<StudioConfig> = {}): Home {
  const mapping = config.groups || {};
  const roomSensors = config.rooms || {};
  const lights = Object.keys(hass.states).filter((id) => isHueLight(hass, id));
  // Hue rooms before zones: after alignment a room always matches its area exactly.
  const isRoom = (g: string): number => (hass.states[g].attributes.hue_type === "room" ? 0 : 1);
  const groups = Object.keys(hass.states)
    .filter((id) => isHueGroup(hass, id))
    .sort((a, b) => isRoom(a) - isRoom(b));
  const members = (g: string): string[] => (hass.states[g].attributes.entity_id || []).filter((id: string) => lights.includes(id));
  const sensorsFor = (key: string, areaId: string | null): RoomSensors => ({ ...defaultSensors(hass, areaId), ...roomSensors[key] });

  const used = new Set<string>();
  const rooms: Group[] = [];
  for (const [areaId, area] of Object.entries(hass.areas || {})) {
    const inArea = lights.filter((id) => areaOf(hass, id) === areaId);
    const explicit = groups.find((g) => mapping[g] === areaId) || null;
    if (!inArea.length && !explicit) continue;
    const auto = groups.find((g) => !used.has(g) && !mapping[g] && sameSet(members(g), inArea)) || null;
    const group = explicit || auto;
    if (group) used.add(group);
    const roomLights = unique([...inArea, ...(group ? members(group) : [])]);
    // Without a group of its own, offer scenes of Hue groups that lie inside the area.
    const sceneGroups = group
      ? [group]
      : groups.filter((g) => !mapping[g] && members(g).length && members(g).every((id) => inArea.includes(id)));
    const key = `area.${areaId}`;
    rooms.push({
      key,
      kind: "area",
      name: area.name,
      icon: area.icon || "mdi:sofa-outline",
      lights: roomLights,
      group,
      target: group && sameSet(members(group), roomLights) ? [group] : roomLights,
      scenes: sceneGroups.flatMap((g) => scenesOf(hass, g)),
      sensors: sensorsFor(key, areaId),
    });
  }

  const zones = groups
    .filter((g) => !used.has(g) && members(g).length)
    .map((g): Group => {
      const key = `hue.${g}`;
      return {
        key,
        kind: "hue",
        name: friendlyName(hass, g),
        icon: hass.states[g].attributes.hue_type === "room" ? "mdi:home-outline" : "mdi:texture-box",
        lights: members(g),
        group: g,
        target: [g],
        scenes: scenesOf(hass, g),
        sensors: sensorsFor(key, null),
      };
    });

  return { rooms, zones };
}

export const allGroups = (home: Home): Group[] => [...home.rooms, ...home.zones];
export const findGroup = (home: Home, key: string | null | undefined): Group | null => allGroups(home).find((g) => g.key === key) || null;

/** The room/zone a Hue light or Hue group entity belongs to (rooms first). */
export const groupOfEntity = (home: Home, id: string): Group | null =>
  allGroups(home).find((g) => g.group === id) || allGroups(home).find((g) => g.lights.includes(id)) || null;

/**
 * Current colors of a light as CSS colors: gradient points when the bridge reports them
 * (`info` from hue_studio/lights/subscribe), else HA's rgb_color. Empty when off.
 */
export function lightColors(hass: HassData, id: string, info?: LightInfo | null): string[] {
  const state = hass.states[id];
  if (state?.state !== "on") return [];
  const points = info?.gradient?.points;
  if (points && points.length > 1 && state.attributes.color_mode === "xy") return points.map(([x, y]) => rgbCss(xyToRgb(x, y)));
  const rgb = state.attributes.rgb_color;
  return [rgb ? rgbCss(rgb) : "rgb(255,214,160)"];
}

const numeric = (hass: HassData, id: string): number | null => {
  const v = parseFloat(hass.states[id]?.state);
  return Number.isFinite(v) ? v : null;
};

/**
 * Aggregate state of a group: on, brightness 0-100 (mean of lit lights), colors,
 * temperature and illuminance (means of its sensors, or null) and motion (any sensor on).
 */
export function groupState(hass: HassData, group: Group, lightInfo: Record<string, LightInfo> = {}): GroupState {
  const states = group.lights.map((id) => hass.states[id]).filter(Boolean);
  const lit = states.filter((s) => s.state === "on");
  const brightness = lit.length
    ? Math.round(lit.reduce((sum, s) => sum + (s.attributes.brightness ?? 255), 0) / lit.length / 2.55)
    : 0;
  const mean = (ids: string[] = []): number | null => {
    const values = ids.map((id) => numeric(hass, id)).filter((v) => v !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  const motionStates = (group.sensors?.motion || []).map((id) => hass.states[id]).filter(Boolean);
  const motion = motionStates.some((s) => s.state === "on");
  const changed = motionStates.filter((s) => s.state === "off" && s.last_changed).map((s) => s.last_changed as string);
  return {
    on: lit.length > 0,
    available: states.some((s) => s.state !== "unavailable"),
    brightness,
    colors: group.lights.flatMap((id) => lightColors(hass, id, lightInfo[id])),
    temperature: mean(group.sensors?.temperature),
    illuminance: mean(group.sensors?.illuminance),
    motion,
    lastMotion: !motion && changed.length ? changed.sort().at(-1)! : null,
  };
}

/**
 * Adaptive Lighting switches that control any light of the group (by light or by the Hue
 * group entity). Returns [{switch, on, manual: [light ids under manual control]}].
 */
export function adaptiveFor(hass: HassData, group: Pick<Group, "lights" | "group">): AdaptiveSwitch[] {
  const ids = new Set([...group.lights, ...(group.group ? [group.group] : [])]);
  return Object.keys(hass.states)
    .filter((id) => id.startsWith("switch.") && hass.entities?.[id]?.platform === "adaptive_lighting")
    .map((id) => ({ id, attrs: hass.states[id].attributes, on: hass.states[id].state === "on" }))
    .filter(({ attrs }) => (attrs.configuration?.lights || []).some((l: string) => ids.has(l)))
    .map(({ id, attrs, on }) => ({
      switch: id,
      on,
      manual: (attrs.manual_control || []).filter((l: string) => ids.has(l)),
      lights: (attrs.configuration.lights || []).filter((l: string) => ids.has(l)),
    }));
}

/** CSS background for a lit room card: its light colors left to right. */
export function colorsCss(colors: string[], fallback: string): string {
  if (!colors.length) return fallback;
  const list = colors.length === 1 ? [colors[0], colors[0]] : colors;
  // The angle comes from the surface (cards run top to bottom, wide headers across).
  return `linear-gradient(var(--lit-angle, 160deg), ${list.join(", ")})`;
}

/** True when the mean of CSS rgb() colors is light enough to need dark text on top. */
export function needsDarkText(colors: string[]): boolean {
  const rgbs = colors.map((c) => c.match(/\d+/g)?.slice(0, 3).map(Number)).filter((c): c is number[] => c?.length === 3);
  if (!rgbs.length) return false;
  const lum = rgbs.reduce((s, [r, g, b]) => s + (0.299 * r + 0.587 * g + 0.114 * b) / 255, 0) / rgbs.length;
  return lum > 0.72;
}

// Hue product archetypes -> MDI icons (what the Hue app draws on light tiles and pins).
/**
 * Icons of the Hue app for each light archetype (CLIP v2 `metadata.archetype`: the shape
 * chosen for the light in the Hue app), from elax46/custom-brand-icons (MIT, see NOTICE).
 * Bundled as the `hue-studio:` icon set (`hue-icons.ts`); `scripts/build_hue_icons.py`
 * extracts exactly the icons named here.
 */
export const ARCHETYPE_ICONS: Record<string, string> = {
  classic_bulb: "hue-studio:bulb-sultan-v2",
  sultan_bulb: "hue-studio:bulb-sultan-v2",
  flood_bulb: "hue-studio:bulb-flood",
  spot_bulb: "hue-studio:hue-spot-v2",
  candle_bulb: "hue-studio:bulb-candle",
  luster_bulb: "hue-studio:bulb-golfball-e14",
  vintage_bulb: "hue-studio:bulbs-filament",
  edison_bulb: "hue-studio:bulb-filament-alt",
  vintage_candle_bulb: "hue-studio:bulb-filament-candle",
  ellipse_bulb: "hue-studio:bulb-lightguide-oval",
  triangle_bulb: "hue-studio:bulb-lightguide-flask",
  small_globe_bulb: "hue-studio:bulb-lightguide-round",
  large_globe_bulb: "hue-studio:bulb-lightguide-round",
  pendant_round: "hue-studio:pendant-round",
  pendant_long: "hue-studio:pendant-long",
  pendant_tube: "hue-studio:pendant-long",
  ceiling_round: "hue-studio:ceiling-round",
  ceiling_square: "hue-studio:ceiling-square",
  floor_shade: "hue-studio:floor-shade",
  floor_lantern: "hue-studio:floor-lantern",
  table_shade: "hue-studio:table-shade",
  table_wash: "hue-studio:table-wash",
  recessed_ceiling: "hue-studio:recessed-ceiling",
  recessed_floor: "hue-studio:recessed-floor",
  single_spot: "hue-studio:single-spot",
  double_spot: "hue-studio:double-spot",
  ground_spot: "hue-studio:lily",
  wall_lantern: "hue-studio:wall-lantern",
  wall_shade: "hue-studio:wall-shade",
  wall_spot: "hue-studio:wall-spot",
  wall_washer: "hue-studio:wall-flood",
  flexible_lamp: "hue-studio:desk-lamp",
  bollard: "hue-studio:bollard",
  hue_go: "hue-studio:go",
  hue_go_xxl: "hue-studio:go",
  hue_iris: "hue-studio:iris",
  hue_bloom: "hue-studio:bloom",
  hue_play: "hue-studio:play",
  hue_play_wallwasher: "hue-studio:wall-flood",
  hue_centris: "hue-studio:centris",
  hue_tube: "hue-studio:gradient-tube-short",
  hue_signe: "hue-studio:signe",
  hue_lightstrip: "hue-studio:light-strip",
  hue_lightstrip_tv: "hue-studio:lightstrip-tv",
  hue_lightstrip_pc: "hue-studio:hue-sync-strip",
  hue_omniglow: "hue-studio:light-strip",
  hue_neon: "hue-studio:light-strip",
  christmas_tree: "hue-studio:christmas-tree",
  string_light: "hue-studio:festavia",
  string_globe: "hue-studio:light-string",
  string_permanent: "hue-studio:light-string",
  string_icicle: "hue-studio:christmas-lights",
  string_grid: "hue-studio:christmas-lights",
  string_net: "hue-studio:christmas-lights",
};

/** One archetype, several products: the Hue app draws them apart (matched on the product name). */
export const PRODUCT_ICONS: [RegExp, string][] = [
  [/signe.*table/i, "hue-studio:signe-gradient-table"],
  [/signe.*floor/i, "hue-studio:signe-gradient-floor"],
];

/** Icon of a light: the user's own (entity registry), else the Hue app's for its product and shape, else a bulb. */
export function lightIcon(hass: HassData, id: string, info?: LightInfo | null): string {
  const own = hass.entities?.[id]?.icon;
  if (own) return own;
  const product = info?.product || "";
  return PRODUCT_ICONS.find(([re]) => re.test(product))?.[1] || ARCHETYPE_ICONS[info?.archetype || ""] || "mdi:lightbulb";
}
