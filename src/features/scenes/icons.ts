// Scene icons as the Hue app draws them: its default scenes (Read, Relax, …) show in a
// room as a disc with a white glyph, not as their gallery picture; a scene of your own
// can take one of these glyphs over its colors. The glyphs are the Hue app's, from
// custom-brand-icons (the `hue-studio:` icon set, scripts/build_hue_icons.py).

import type { StringKey } from "../../i18n/index.ts";

/** The glyphs a scene of your own can show over its colors, with their names. */
export const SCENE_ICONS: [string, StringKey][] = [
  ["hue-studio:scene-bright", "scene.icon_bright"],
  ["hue-studio:scene-concentrate", "scene.icon_concentrate"],
  ["hue-studio:scene-energize", "scene.icon_energize"],
  ["hue-studio:scene-read", "scene.icon_read"],
  ["hue-studio:scene-relax", "scene.icon_relax"],
  ["hue-studio:scene-dimmed", "scene.icon_dimmed"],
  ["hue-studio:scene-nightlight", "scene.icon_nightlight"],
  ["hue-studio:scene-dynamic", "scene.icon_dynamic"],
];

/** A default scene's disc: its glyph and two tones, top left to bottom right. */
export interface DefaultSceneIcon {
  icon: string;
  colors: [string, string];
}

/**
 * The Hue app's default scenes in a room, by gallery id (measured on the Hue app 6.3;
 * Dimmed and Cool bright, not in the reference room, take Bright's and Concentrate's).
 * Rest has no glyph in the icon set: the closest MDI one.
 */
const DEFAULTS: Record<string, DefaultSceneIcon> = {
  bright: { icon: "hue-studio:scene-bright", colors: ["#ffefcf", "#ffd684"] },
  cool_bright: { icon: "hue-studio:scene-bright", colors: ["#c2f1f9", "#96dbe6"] },
  concentrate: { icon: "hue-studio:scene-concentrate", colors: ["#c2f1f9", "#96dbe6"] },
  dimmed: { icon: "hue-studio:scene-dimmed", colors: ["#ffefcf", "#ffd684"] },
  energize: { icon: "hue-studio:scene-energize", colors: ["#7ac0d6", "#93d8e7"] },
  nightlight: { icon: "hue-studio:scene-nightlight", colors: ["#cf460a", "#7e3729"] },
  read: { icon: "hue-studio:scene-read", colors: ["#fff0a5", "#ffd584"] },
  relax: { icon: "hue-studio:scene-relax", colors: ["#fdb43c", "#fed761"] },
  rest: { icon: "mdi:record-circle-outline", colors: ["#db6c08", "#db6c08"] },
};

/** Natural light, a scene the Hue app adds to every room (no gallery scene). */
const NATURAL_LIGHT: DefaultSceneIcon = { icon: "mdi:sun-clock", colors: ["#ff920c", "#ff920c"] };
/** Its name as the Hue app gives it (in the app's language when it was added). */
const NATURAL_LIGHT_NAMES = ["natural light", "światło naturalne"];

/** The disc of a default scene: by its gallery id (`category` "defaults"), or by name. */
export function defaultSceneIcon(match: { id: string; category: string } | null, name: string): DefaultSceneIcon | null {
  if (match?.category === "defaults") return DEFAULTS[match.id] ?? null;
  return NATURAL_LIGHT_NAMES.includes(name.trim().toLowerCase()) ? NATURAL_LIGHT : null;
}

/** A default scene's disc as a CSS background. */
export const defaultSceneArt = (d: DefaultSceneIcon): string => `linear-gradient(135deg, ${d.colors[0]}, ${d.colors[1]})`;
