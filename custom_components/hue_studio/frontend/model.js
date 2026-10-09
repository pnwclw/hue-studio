// What the panel shows, derived from the HA frontend `hass` object only.
// Rooms are HA areas that contain Hue lights; zones are Hue rooms/zones (light groups of
// the native integration) that do not match an area one-to-one. Pure functions, no DOM.

import { rgbCss, xyToRgb } from "./color.js";

const isHueLight = (hass, id) => {
  const entity = hass.entities?.[id];
  return entity?.platform === "hue" && id.startsWith("light.") && !hass.states[id]?.attributes.is_hue_group;
};

const isHueGroup = (hass, id) =>
  hass.entities?.[id]?.platform === "hue" && id.startsWith("light.") && !!hass.states[id]?.attributes.is_hue_group;

const areaOf = (hass, id) => {
  const entity = hass.entities[id];
  return entity.area_id || hass.devices?.[entity.device_id]?.area_id || null;
};

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

export const friendlyName = (hass, id) => hass.states[id]?.attributes.friendly_name || id;

/** Hue scenes of a Hue group, by the group name the native integration stores on scenes. */
function scenesOf(hass, groupId) {
  const name = friendlyName(hass, groupId);
  return Object.keys(hass.states)
    .filter((id) => id.startsWith("scene.") && hass.entities?.[id]?.platform === "hue")
    .filter((id) => hass.states[id].attributes.group_name === name)
    .map((id) => ({ entity_id: id, name: hass.states[id].attributes.name || friendlyName(hass, id), group: groupId }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build the home screen structure.
 * Group: {key, kind: "area" | "hue", name, icon, lights, group, target, scenes}
 *   lights  – Hue light entity ids
 *   group   – the Hue group entity covering exactly these lights, or null
 *   target  – what to send commands to: [group] when it exists (one bridge command), else lights
 */
export function buildHome(hass) {
  const lights = Object.keys(hass.states).filter((id) => isHueLight(hass, id));
  const groups = Object.keys(hass.states).filter((id) => isHueGroup(hass, id));
  const members = (g) => (hass.states[g].attributes.entity_id || []).filter((id) => lights.includes(id));

  const used = new Set();
  const rooms = [];
  for (const [areaId, area] of Object.entries(hass.areas || {})) {
    const inArea = lights.filter((id) => areaOf(hass, id) === areaId);
    if (!inArea.length) continue;
    const group = groups.find((g) => !used.has(g) && sameSet(members(g), inArea)) || null;
    if (group) used.add(group);
    // Without an exact group, offer scenes of Hue groups that lie inside the area.
    const sceneGroups = group ? [group] : groups.filter((g) => members(g).length && members(g).every((id) => inArea.includes(id)));
    rooms.push({
      key: `area.${areaId}`,
      kind: "area",
      name: area.name,
      icon: area.icon || "mdi:sofa-outline",
      lights: inArea,
      group,
      target: group ? [group] : inArea,
      scenes: sceneGroups.flatMap((g) => scenesOf(hass, g)),
    });
  }

  const zones = groups
    .filter((g) => !used.has(g) && members(g).length)
    .map((g) => ({
      key: `hue.${g}`,
      kind: "hue",
      name: friendlyName(hass, g),
      icon: hass.states[g].attributes.hue_type === "room" ? "mdi:home-outline" : "mdi:texture-box",
      lights: members(g),
      group: g,
      target: [g],
      scenes: scenesOf(hass, g),
    }));

  return { rooms, zones };
}

export const findGroup = (home, key) => [...home.rooms, ...home.zones].find((g) => g.key === key) || null;

/**
 * Current colors of a light as CSS colors: gradient points when the bridge reports them
 * (`info` from hue_studio/lights/subscribe), else HA's rgb_color. Empty when off.
 */
export function lightColors(hass, id, info) {
  const state = hass.states[id];
  if (state?.state !== "on") return [];
  const points = info?.gradient?.points;
  if (points?.length > 1 && state.attributes.color_mode === "xy") return points.map(([x, y]) => rgbCss(xyToRgb(x, y)));
  const rgb = state.attributes.rgb_color;
  return [rgb ? rgbCss(rgb) : "rgb(255,214,160)"];
}

/** Aggregate state of a group of lights: on, brightness 0-100 (mean of lit lights), colors. */
export function groupState(hass, group, lightInfo = {}) {
  const states = group.lights.map((id) => hass.states[id]).filter(Boolean);
  const lit = states.filter((s) => s.state === "on");
  const brightness = lit.length
    ? Math.round(lit.reduce((sum, s) => sum + (s.attributes.brightness ?? 255), 0) / lit.length / 2.55)
    : 0;
  return {
    on: lit.length > 0,
    available: states.some((s) => s.state !== "unavailable"),
    brightness,
    colors: group.lights.flatMap((id) => lightColors(hass, id, lightInfo[id])),
  };
}

/** CSS background for a lit room card: its light colors left to right. */
export function colorsCss(colors, fallback) {
  if (!colors.length) return fallback;
  const list = colors.length === 1 ? [colors[0], colors[0]] : colors;
  return `linear-gradient(90deg, ${list.join(", ")})`;
}

/** True when the mean of CSS rgb() colors is light enough to need dark text on top. */
export function needsDarkText(colors) {
  const rgbs = colors.map((c) => c.match(/\d+/g)?.slice(0, 3).map(Number)).filter((c) => c?.length === 3);
  if (!rgbs.length) return false;
  const lum = rgbs.reduce((s, [r, g, b]) => s + (0.299 * r + 0.587 * g + 0.114 * b) / 255, 0) / rgbs.length;
  return lum > 0.72;
}
