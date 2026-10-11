// Auto light in the panel: pools and areas derived from the settings
// (hue_studio/auto_light/subscribe) and `hass`. Pure functions, no DOM.

import { areaOf, isHueLight } from "./model.ts";
import type { AutoLightConfig, AutoLightMessage, HassData, Phase, Season } from "./types.ts";

export const PHASES: Phase[] = ["morning", "day", "golden", "evening", "night"];
export const SEASONS: ("all" | Season)[] = ["all", "winter", "spring", "summer", "autumn"];
export const MOODS = ["clear", "gloomy"] as const;
export const DAY_STEPS = [0, 1, 2, 3];
export const SHIFTS = ["morning", "day", "golden", "evening"] as const;
export const DEFAULT_SHIFTS = { morning: 0, day: 50, golden: 50, evening: 0 };
export const DEFAULT_NIGHT_FROM = "23:00";
/** Natural light: color temperature per phase (K), as the backend's defaults. */
export const NATURAL_KELVIN: Record<Phase, number> = { morning: 5000, day: 4300, golden: 2900, evening: 2200, night: 2000 };
export const KELVIN_RANGE = [2000, 6500] as const;
export const GRADIENT_MODES = ["interpolated_palette", "interpolated_palette_mirrored", "random_pixelated", "segmented_palette"];

/**
 * Which pool the editor shows: a phase, a season (or "all") and, for the day phase, a
 * brightness step (0-3) or otherwise a mood. Mirrors `auto_light_pool`.
 */
export interface PoolKey {
  phase: Phase;
  season: "all" | Season;
  /** "clear" | "gloomy", or "0".."3" for the day phase. */
  step: string;
}

/** The scenes of one pool as stored (an empty list when there is none). */
export function poolOf(config: AutoLightConfig | undefined, key: PoolKey): string[] {
  const moods = config?.pools?.[key.phase]?.[key.season];
  if (!moods) return [];
  if (key.phase === "day") {
    const steps = (moods.clear || moods.gloomy || []) as string[][];
    return steps[Number(key.step)] || [];
  }
  return (moods[key.step] as string[] | undefined) || [];
}

/** The step values of a phase's pools. */
export const stepsOf = (phase: Phase): string[] => (phase === "day" ? DAY_STEPS.map(String) : [...MOODS]);

/** How many scenes each phase has (all seasons and steps), for the editor's chips. */
export function phaseCounts(config: AutoLightConfig | undefined): Record<Phase, number> {
  const counts = Object.fromEntries(PHASES.map((p) => [p, 0])) as Record<Phase, number>;
  for (const phase of PHASES) {
    for (const moods of Object.values(config?.pools?.[phase] || {})) {
      const lists = phase === "day" ? ((moods.clear || []) as string[][]) : Object.values(moods);
      counts[phase] += lists.reduce((n, list) => n + (list as string[]).length, 0);
    }
  }
  return counts;
}

/** Areas with auto light, by name. */
export function autoAreas(hass: HassData, msg: AutoLightMessage | null): string[] {
  const name = (id: string) => hass.areas?.[id]?.name || id;
  return Object.keys(msg?.areas || {}).sort((a, b) => name(a).localeCompare(name(b)));
}

/** Areas with Hue lights that have no auto light yet, by name. */
export function candidateAreas(hass: HassData, msg: AutoLightMessage | null): string[] {
  const used = new Set(Object.keys(hass.states).filter((id) => isHueLight(hass, id)).map((id) => areaOf(hass, id)));
  return Object.entries(hass.areas || {})
    .filter(([id]) => used.has(id) && !msg?.areas?.[id])
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([id]) => id);
}

/** "12-24" -> a short local date ("24 Dec"); bad input is returned as it is. */
export function monthDay(md: string, locale: string): string {
  const [m, d] = md.split("-").map(Number);
  if (!m || !d) return md;
  return new Date(2000, m - 1, d).toLocaleDateString(locale, { day: "numeric", month: "short" });
}

/** Whether a "MM-DD" value is a real day of the year. */
export const isMonthDay = (md: string): boolean => {
  const match = /^(\d\d)-(\d\d)$/.exec(md);
  if (!match) return false;
  const [m, d] = [Number(match[1]), Number(match[2])];
  return m >= 1 && m <= 12 && d >= 1 && d <= new Date(2000, m, 0).getDate();
};
