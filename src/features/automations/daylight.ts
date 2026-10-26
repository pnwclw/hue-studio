// Natural light and the scene of the day. The global light of the day (Settings → Light of
// the day: the scene pool as tags of scenes, phase times, sources, mood) and an automation's
// own settings on top of it (`scene_of_the_day`, a blueprint input: extra and skipped scenes,
// own phase times, brightness). Pure functions, no DOM; every change returns a new object.

import type { DayConfig, DayPreview, DaySettings, Holiday, Mood, Phase, PhaseTimes, SceneTags, Season, Weather } from "../../core/types.ts";

export const PHASES: Phase[] = ["morning", "day", "golden", "evening", "night"];
export const SEASONS: Season[] = ["winter", "spring", "summer", "autumn"];
export const WEATHER: Weather[] = ["clear", "gloomy"];
export const MOODS: Mood[] = ["relax", "cozy", "focus", "romantic", "party", "festive"];
export const TAG_KEYS = ["phases", "seasons", "weather", "moods"] as const;
export type TagKey = (typeof TAG_KEYS)[number];
export const TAG_VALUES: { [K in TagKey]: string[] } = { phases: PHASES, seasons: SEASONS, weather: WEATHER, moods: MOODS };
export const SHIFTS = ["morning", "day", "golden", "evening"] as const;
export const DEFAULT_SHIFTS = { morning: 0, day: 50, golden: 50, evening: 0 };
export const DEFAULT_NIGHT_FROM = "23:00";
/** Natural light: color temperature per phase (K), as the backend's defaults. */
export const NATURAL_KELVIN: Record<Phase, number> = { morning: 5000, day: 4300, golden: 2900, evening: 2200, night: 2000 };
export const KELVIN_RANGE = [2000, 6500] as const;
export const GRADIENT_MODES = ["interpolated_palette", "interpolated_palette_mirrored", "random_pixelated", "segmented_palette"];
export const MAX_OFFSET = 60;
export const MOOD_ICONS: Record<Mood, string> = {
  relax: "mdi:sofa-outline",
  cozy: "mdi:fireplace",
  focus: "mdi:book-open-variant",
  romantic: "mdi:heart-outline",
  party: "mdi:party-popper",
  festive: "mdi:pine-tree",
};

/** An automation's settings with every list and map present (what the backend fills in too). */
export function dayConfig(config: Partial<DayConfig> | null | undefined): DayConfig {
  return {
    ...config,
    include: config?.include || [],
    exclude: config?.exclude || [],
    offsets: config?.offsets || {},
    settings: config?.settings || {},
  };
}

// ---- an automation's own settings ----

/** Settings with a scene added to this automation's pool (or not). */
export function withIncluded(config: DayConfig, scene: string, on: boolean): DayConfig {
  const rest = config.include.filter((s) => s !== scene);
  return { ...config, include: on ? [...rest, scene] : rest, exclude: on ? config.exclude.filter((s) => s !== scene) : config.exclude };
}

/** Settings with a scene skipped by this automation (or allowed again). */
export function withExcluded(config: DayConfig, scene: string, on: boolean): DayConfig {
  const rest = config.exclude.filter((s) => s !== scene);
  return { ...config, exclude: on ? [...rest, scene] : rest, include: on ? config.include.filter((s) => s !== scene) : config.include };
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

/** Whether an automation has phase times of its own. */
export const hasOwnPhases = (settings: DaySettings): boolean => settings.night_from !== undefined || settings.shifts !== undefined;

/** Phase times in effect: the automation's own, else the global ones, else the defaults. */
export function phaseTimes(own: PhaseTimes, global: PhaseTimes | undefined): { night_from: string; shifts: typeof DEFAULT_SHIFTS } {
  const from = hasOwnPhases(own) ? own : global || {};
  return { night_from: from.night_from || DEFAULT_NIGHT_FROM, shifts: { ...DEFAULT_SHIFTS, ...from.shifts } };
}

/** Own phase times on (starting from the global ones) or off (the global ones again). */
export function withOwnPhases(config: DayConfig, on: boolean, global: PhaseTimes | undefined): DayConfig {
  if (!on) return withSettings(config, { night_from: null, shifts: null });
  const times = phaseTimes({}, global);
  return withSettings(config, { night_from: times.night_from, shifts: times.shifts });
}

// ---- scene tags (the global pool) ----

/** Whether a scene's tags fit a value ("any" when it has none of that kind). */
export const fits = (tags: SceneTags, key: TagKey, value: string): boolean => {
  const list = tags[key] as string[] | undefined;
  return !list?.length || list.includes(value);
};

/** Whether tags name a value explicitly (a phase or mood the scene is meant for). */
export const names = (tags: SceneTags | undefined, key: TagKey, value: string): boolean => !!(tags?.[key] as string[] | undefined)?.includes(value);

/** Tags with a value added or removed (lists in a fixed order; empty ones left out). */
export function withTag(tags: SceneTags, key: TagKey, value: string, on: boolean): SceneTags {
  const current = new Set((tags[key] as string[] | undefined) || []);
  if (on) current.add(value);
  else current.delete(value);
  return cleanTags({ ...tags, [key]: [...current] });
}

/** Known values only, in order, without empty lists. */
export function cleanTags(tags: SceneTags): SceneTags {
  const clean: Record<string, string[]> = {};
  for (const key of TAG_KEYS) {
    const given = new Set((tags[key] as string[] | undefined) || []);
    const picked = TAG_VALUES[key].filter((v) => given.has(v));
    if (picked.length) clean[key] = picked;
  }
  return clean as SceneTags;
}

/** Whether tags put a scene anywhere (by phase or mood). */
export const inPool = (tags: SceneTags | undefined): boolean => !!tags?.phases?.length || !!tags?.moods?.length;

/** What the pool editor shows: a phase (with a season) or a mood, or the scenes out of the pool. */
export type PoolView = { phase: Phase; season: Season | null } | { mood: Mood } | { out: true };

/** The scenes of a view, in gallery order. */
export function scenesOf(view: PoolView, tags: Record<string, SceneTags>, order: string[]): string[] {
  if ("out" in view) return order.filter((id) => !inPool(tags[id]));
  if ("mood" in view) return order.filter((id) => names(tags[id], "moods", view.mood));
  return order.filter((id) => names(tags[id], "phases", view.phase) && (!view.season || fits(tags[id], "seasons", view.season)));
}

/**
 * The scenes of the day now by Hue Studio's ready-made tags alone (none of the user's on
 * top): the phase's scenes fitting the season and the weather; as long as nothing is
 * left, without the weather, then without the season. In gallery order.
 */
export function readyScenesNow(defaults: Record<string, SceneTags>, now: Pick<DayPreview, "phase" | "season" | "weather">, order: string[]): string[] {
  const ofPhase = order.filter((id) => names(defaults[id], "phases", now.phase));
  const inSeason = ofPhase.filter((id) => fits(defaults[id], "seasons", now.season));
  const fitting = inSeason.filter((id) => fits(defaults[id], "weather", now.weather));
  return fitting.length ? fitting : inSeason.length ? inSeason : ofPhase;
}

/** A scene added to a view (it gets the view's phase or mood) or taken out of it. */
export function tagsFor(view: PoolView, tags: SceneTags, on: boolean): SceneTags {
  if ("out" in view) return tags;
  if ("mood" in view) return withTag(tags, "moods", view.mood, on);
  let next = withTag(tags, "phases", view.phase, on);
  // Added while a season is shown: it fits that season (if it was limited to others).
  if (on && view.season && !fits(next, "seasons", view.season)) next = withTag(next, "seasons", view.season, true);
  return next;
}

/** How many scenes each phase and mood has, for the editor's chips. */
export function viewCounts(tags: Record<string, SceneTags>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of Object.values(tags)) for (const v of [...(t.phases || []), ...(t.moods || [])]) counts[v] = (counts[v] || 0) + 1;
  return counts;
}

// ---- before 0.10: pools of an automation's own ----

/** Whether an automation still has pools of its own. */
export const isLegacy = (config: Partial<DayConfig> | null | undefined): boolean =>
  !!config && (Object.keys(config.pools || {}).length > 0 || (config.holidays || []).length > 0);

/** What moves into the global settings, and what the automation keeps. */
export interface LegacySplit {
  local: DayConfig;
  pools: NonNullable<DayConfig["pools"]>;
  holidays: Holiday[];
  sources: { weather?: string; season?: string; light_sensor?: string };
}

/** An automation's old settings split: pools and sources go global, the rest stays. */
export function splitLegacy(config: Partial<DayConfig>): LegacySplit {
  const { pools = {}, holidays = [], excluded = [], ...rest } = config;
  const { weather, season, light_sensor, ...settings } = rest.settings || {};
  const local = dayConfig({ ...rest, settings });
  const sources: LegacySplit["sources"] = {};
  if (weather) sources.weather = weather;
  if (season) sources.season = season;
  if (light_sensor) sources.light_sensor = light_sensor;
  return { local: { ...local, exclude: [...new Set([...local.exclude, ...excluded])] }, pools, holidays, sources };
}
