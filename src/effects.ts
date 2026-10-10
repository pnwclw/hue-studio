// Light effects (CLIP v2 effects_v2) as the Hue app offers them: categories of effects,
// a few color presets each, a 1-12 speed scale. Pure data and functions, no DOM.

import { mirekToRgb, rgbCss, xyToRgb } from "./color.ts";
import type { LightInfo, RunningEffect, XY } from "./types.ts";

export type EffectId = "candle" | "fire" | "sparkle" | "glisten" | "opal" | "prism" | "underwater" | "cosmos" | "sunbeam" | "enchant";
export type CategoryId = "flames" | "sparkly" | "nature" | "magic";
export type VariantId = "default" | "orange" | "warm_white" | "purple" | "green" | "gold" | "pink" | "blue" | "red" | "teal" | "warm";

/** A ready-made effect: no color means the effect's own default colors. */
export interface EffectPreset {
  effect: EffectId;
  variant: VariantId;
  xy?: XY;
  mirek?: number;
}

/** Look of an effect in the list (its own default colors, roughly). */
const DEFAULT_XY: Record<EffectId, XY> = {
  candle: [0.57, 0.4],
  fire: [0.61, 0.37],
  sparkle: [0.45, 0.41],
  glisten: [0.5, 0.42],
  opal: [0.33, 0.3],
  prism: [0.3, 0.15],
  underwater: [0.16, 0.24],
  cosmos: [0.25, 0.1],
  sunbeam: [0.48, 0.43],
  enchant: [0.38, 0.18],
};

const STYLE: Record<CategoryId, "flame" | "sparkle" | "wave" | "nebula"> = {
  flames: "flame",
  sparkly: "sparkle",
  nature: "wave",
  magic: "nebula",
};

export const CATEGORIES: { id: CategoryId; effects: EffectId[] }[] = [
  { id: "flames", effects: ["candle", "fire"] },
  { id: "sparkly", effects: ["glisten", "sparkle", "opal"] },
  { id: "nature", effects: ["underwater", "sunbeam"] },
  { id: "magic", effects: ["cosmos", "prism", "enchant"] },
];

const PURPLE: XY = [0.25, 0.1];
const PINK: XY = [0.45, 0.25];
const GREEN: XY = [0.2, 0.6];
const BLUE: XY = [0.16, 0.12];

export const PRESETS: Record<EffectId, EffectPreset[]> = {
  candle: [{ effect: "candle", variant: "default" }, { effect: "candle", variant: "orange", xy: [0.6, 0.39] }, { effect: "candle", variant: "warm_white", mirek: 454 }],
  fire: [{ effect: "fire", variant: "default" }, { effect: "fire", variant: "purple", xy: PURPLE }, { effect: "fire", variant: "green", xy: GREEN }],
  glisten: [{ effect: "glisten", variant: "gold", xy: [0.5, 0.44] }, { effect: "glisten", variant: "purple", xy: PURPLE }, { effect: "glisten", variant: "pink", xy: PINK }],
  sparkle: [{ effect: "sparkle", variant: "default" }, { effect: "sparkle", variant: "blue", xy: BLUE }, { effect: "sparkle", variant: "red", xy: [0.66, 0.31] }],
  opal: [{ effect: "opal", variant: "default" }, { effect: "opal", variant: "pink", xy: PINK }, { effect: "opal", variant: "blue", xy: BLUE }],
  underwater: [{ effect: "underwater", variant: "default" }, { effect: "underwater", variant: "teal", xy: [0.17, 0.35] }],
  sunbeam: [{ effect: "sunbeam", variant: "default" }, { effect: "sunbeam", variant: "warm", mirek: 400 }],
  cosmos: [{ effect: "cosmos", variant: "default" }, { effect: "cosmos", variant: "blue", xy: BLUE }],
  prism: [{ effect: "prism", variant: "default" }],
  enchant: [{ effect: "enchant", variant: "default" }, { effect: "enchant", variant: "pink", xy: PINK }],
};

/** The color an effect shows without a color of its own. */
export const effectColor = (effect: EffectId): XY => DEFAULT_XY[effect];

const categoryOf = (effect: EffectId): CategoryId => CATEGORIES.find((c) => c.effects.includes(effect))!.id;

// ---------- speed: the Hue app's 1-12 scale over the bridge's 0-1 ----------

export const SPEED_STEPS = 12;
export const speedToStep = (speed: number): number => Math.round(Math.min(1, Math.max(0, speed)) * (SPEED_STEPS - 1)) + 1;
export const stepToSpeed = (step: number): number => (Math.min(SPEED_STEPS, Math.max(1, step)) - 1) / (SPEED_STEPS - 1);
/** Word for a speed step, as the Hue app labels it ("7 - Medium", "8 - Fast"). */
export const speedWord = (step: number): "slow" | "medium" | "fast" => (step <= 3 ? "slow" : step <= 7 ? "medium" : "fast");

// ---------- which lights, what runs ----------

/** Lights that can play the effect. */
export const effectLights = (lights: string[], info: Record<string, LightInfo>, effect: EffectId): string[] =>
  lights.filter((id) => info[id]?.effects?.includes(effect));

/** Effects any of the lights can play, in catalog order. */
export function availableEffects(lights: string[], info: Record<string, LightInfo>): EffectId[] {
  const all = CATEGORIES.flatMap((c) => c.effects);
  return all.filter((e) => lights.some((id) => info[id]?.effects?.includes(e)));
}

const near = (a: XY | undefined, b: XY | undefined): boolean => !!a && !!b && Math.abs(a[0] - b[0]) < 0.02 && Math.abs(a[1] - b[1]) < 0.02;

/** Does a running effect look like this preset (same effect and color)? */
export function matchesPreset(running: RunningEffect | null | undefined, preset: EffectPreset): boolean {
  if (!running || running.effect !== preset.effect) return false;
  if (preset.xy) return near(running.xy, preset.xy);
  if (preset.mirek) return !!running.mirek && Math.abs(running.mirek - preset.mirek) < 15;
  return !running.xy && !running.mirek;
}

/** Service data for hue_studio.set_effect. */
export function effectData(effect: EffectId, opts: { xy?: XY; mirek?: number; speed?: number; brightness?: number } = {}): Record<string, unknown> {
  const data: Record<string, unknown> = { effect };
  if (opts.xy) data.xy_color = opts.xy;
  else if (opts.mirek) data.mirek = Math.round(opts.mirek);
  if (opts.speed !== undefined) data.speed = Math.round(opts.speed * 100);
  if (opts.brightness !== undefined) data.brightness = opts.brightness;
  return data;
}

// ---------- look ----------

const shade = (rgb: number[], k: number): string => rgbCss(rgb.map((v) => Math.round(v * k)));
const tint = (rgb: number[], k: number): string => rgbCss(rgb.map((v) => Math.round(v + (255 - v) * k)));

/** CSS background of an effect's round picture, in the given (or its default) color. */
export function effectArt(effect: EffectId, color: { xy?: XY; mirek?: number } = {}): string {
  const rgb = color.mirek ? mirekToRgb(color.mirek) : xyToRgb(...(color.xy ?? DEFAULT_XY[effect]));
  const c = rgbCss(rgb);
  switch (STYLE[categoryOf(effect)]) {
    case "flame":
      return (
        `radial-gradient(ellipse 18% 30% at 50% 46%, ${tint(rgb, 0.85)} 0, ${tint(rgb, 0.3)} 45%, transparent 100%), ` +
        `radial-gradient(ellipse 55% 40% at 50% 62%, ${c} 0, ${shade(rgb, 0.45)} 55%, transparent 100%), ` +
        `linear-gradient(#141210, #241c16)`
      );
    case "sparkle":
      return (
        `radial-gradient(circle at 30% 34%, #fff 0, ${tint(rgb, 0.5)} 4%, transparent 9%), ` +
        `radial-gradient(circle at 66% 58%, #fff 0, ${tint(rgb, 0.4)} 3%, transparent 8%), ` +
        `radial-gradient(circle at 46% 74%, ${tint(rgb, 0.6)} 0, transparent 7%), ` +
        `linear-gradient(160deg, ${tint(rgb, 0.35)}, ${c} 45%, ${shade(rgb, 0.4)})`
      );
    case "wave":
      return (
        `repeating-linear-gradient(170deg, transparent 0 9%, ${tint(rgb, 0.35)} 11%, transparent 14%), ` +
        `linear-gradient(${tint(rgb, 0.25)}, ${c} 50%, ${shade(rgb, 0.45)})`
      );
    default:
      return (
        `radial-gradient(ellipse 70% 25% at 50% 50%, ${tint(rgb, 0.55)} 0, transparent 70%), ` +
        `radial-gradient(circle at 30% 30%, ${c} 0, transparent 60%), ` +
        `linear-gradient(135deg, ${shade(rgb, 0.35)}, ${c}, ${shade(rgb, 0.5)})`
      );
  }
}
