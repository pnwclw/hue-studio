// Natural light and the scene of the day: their settings (`scene_of_the_day`, an input of
// an automation's blueprint) edited in the panel. Pure functions, no DOM; every change
// returns a new settings object, written when the automation is saved.

import type { DayConfig, DaySettings, Phase, Season } from "./types.ts";

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
export const MAX_OFFSET = 60;

/** Settings with every list and map present (what the backend fills in too). */
export function dayConfig(config: Partial<DayConfig> | null | undefined): DayConfig {
  return {
    pools: config?.pools || {},
    holidays: config?.holidays || [],
    excluded: config?.excluded || [],
    offsets: config?.offsets || {},
    settings: config?.settings || {},
  };
}

/**
 * Which pool the editor shows: a phase, a season (or "all") and, for the day phase, a
 * brightness step (0-3) or otherwise a mood.
 */
export interface PoolKey {
  phase: Phase;
  season: "all" | Season;
  /** "clear" | "gloomy", or "0".."3" for the day phase. */
  step: string;
}

/** The scenes of one pool as stored (an empty list when there is none). */
export function poolOf(config: DayConfig | undefined, key: PoolKey): string[] {
  const moods = config?.pools?.[key.phase]?.[key.season];
  if (!moods) return [];
  if (key.phase === "day") {
    const steps = (moods.clear || moods.gloomy || []) as string[][];
    return steps[Number(key.step)] || [];
  }
  return (moods[key.step] as string[] | undefined) || [];
}

/** Settings with one pool replaced; the day's steps are shared by both moods. */
export function withPool(config: DayConfig, key: PoolKey, scenes: string[]): DayConfig {
  const pools = structuredClone(config.pools);
  const moods = ((pools[key.phase] ??= {})[key.season] ??= {});
  const unique = [...new Set(scenes)];
  if (key.phase === "day") {
    for (const mood of MOODS) {
      const steps = ((moods[mood] as string[][] | undefined) || []).slice();
      while (steps.length < DAY_STEPS.length) steps.push([]);
      steps[Number(key.step)] = unique;
      moods[mood] = steps;
    }
  } else moods[key.step] = unique;
  return { ...config, pools };
}

/** Settings with a scene excluded (or allowed again). */
export function withExcluded(config: DayConfig, scene: string, excluded: boolean): DayConfig {
  const rest = config.excluded.filter((s) => s !== scene);
  return { ...config, excluded: excluded ? [...rest, scene] : rest };
}

/** Settings with a phase's brightness offset (0 removes it). */
export function withOffset(config: DayConfig, phase: Phase, value: number): DayConfig {
  const offsets = { ...config.offsets };
  const clamped = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, value));
  if (clamped) offsets[phase] = clamped;
  else delete offsets[phase];
  return { ...config, offsets };
}

/** Settings merged with a patch; a key set to null goes back to its default. */
export function withSettings(config: DayConfig, patch: Partial<Record<keyof DaySettings, unknown>>): DayConfig {
  const merged: Record<string, unknown> = { ...config.settings, ...patch };
  for (const key of Object.keys(merged)) if (merged[key] === null || merged[key] === undefined) delete merged[key];
  return { ...config, settings: merged as DaySettings };
}

/** The step values of a phase's pools. */
export const stepsOf = (phase: Phase): string[] => (phase === "day" ? DAY_STEPS.map(String) : [...MOODS]);

/** How many scenes each phase has (all seasons and steps), for the editor's chips. */
export function phaseCounts(config: DayConfig | undefined): Record<Phase, number> {
  const counts = Object.fromEntries(PHASES.map((p) => [p, 0])) as Record<Phase, number>;
  for (const phase of PHASES) {
    for (const moods of Object.values(config?.pools?.[phase] || {})) {
      const lists = phase === "day" ? ((moods.clear || []) as string[][]) : Object.values(moods);
      counts[phase] += lists.reduce((n, list) => n + (list as string[]).length, 0);
    }
  }
  return counts;
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
