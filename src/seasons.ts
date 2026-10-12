// Seasonal gallery: which categories of the scene gallery show today. Pure functions, no DOM.
//
// "All" shows every category. "Seasonal" shows each category by its rule, set by the user in
// the settings: always, in some seasons, and/or within a date window (a holiday). Halloween,
// winter holidays and the season categories (spring flowers, summer fruit, autumn harvest,
// winter frost) have default rules. The season comes from HA's Season integration when there
// is one, else from the month (like auto light).

import type { Hass, StudioConfig } from "./types.ts";

export const SEASONS = ["winter", "spring", "summer", "autumn"] as const;
export type Season = (typeof SEASONS)[number];

/** A date window, "MM-DD" to "MM-DD" inclusive; it may wrap over the new year. */
export type Window = [string, string];

/**
 * When a category shows in the seasonal gallery: in any of its seasons, or within its date
 * window (a holiday). Neither: always.
 */
export interface Rule {
  seasons?: Season[];
  window?: Window;
}

/** Rules of the gallery's own seasonal categories, until the user sets their own. */
export const DEFAULT_RULES: Record<string, Rule> = {
  halloween: { window: ["10-01", "11-02"] },
  winter_holidays: { window: ["12-01", "01-06"] },
  refreshing: { seasons: ["spring"] },
  vibrant: { seasons: ["summer"] },
  rustic: { seasons: ["autumn"] },
  winter_whisper: { seasons: ["winter"] },
};

const MONTH_SEASONS: Season[] = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"];

const MD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Whether a value is a "MM-DD" date. */
export const isMonthDay = (value: unknown): value is string => typeof value === "string" && MD.test(value);

/** "MM-DD" of a date (local time). */
export const monthDay = (date: Date): string =>
  `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Whether `md` lies in the window (both ends included; a window may wrap over the new year). */
export function inWindow(md: string, [from, to]: Window): boolean {
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

/** The season entity of HA's Season integration, if there is one that reports a season. */
export function seasonEntity(hass: Pick<Hass, "states" | "entities">): string | null {
  for (const [id, entry] of Object.entries(hass.entities || {})) {
    if (entry.platform === "season" && (SEASONS as readonly string[]).includes(hass.states[id]?.state ?? "")) return id;
  }
  return null;
}

/** The season now: from the Season integration, else by month. */
export function seasonNow(hass: Pick<Hass, "states" | "entities">, date: Date): Season {
  const id = seasonEntity(hass);
  return id ? (hass.states[id].state as Season) : MONTH_SEASONS[date.getMonth()];
}

export interface SeasonalOptions {
  /** Only categories in their time (default: all, all year). */
  seasonal?: boolean;
  /** The user's rules; a category without one keeps its default rule. */
  rules?: Record<string, Rule>;
}

/** The seasonal options of the integration's options. */
export const gallerySeasons = (config: Pick<StudioConfig, "gallery_seasonal" | "gallery_rules">): SeasonalOptions => ({
  seasonal: !!config.gallery_seasonal,
  rules: config.gallery_rules,
});

/** A category's rule: the user's, else the default, else none (always). */
export const ruleOf = (category: string, rules: Record<string, Rule> = {}): Rule => rules[category] ?? DEFAULT_RULES[category] ?? {};

/** Whether a rule limits a category at all. */
export const isSeasonal = (rule: Rule): boolean => !!rule.seasons?.length || !!rule.window;

/** Whether two rules say the same. */
export const sameRule = (a: Rule, b: Rule): boolean =>
  [...(a.seasons || [])].sort().join() === [...(b.seasons || [])].sort().join() && (a.window || []).join() === (b.window || []).join();

/** Whether a rule lets its category show on `date` in `season`. */
export function ruleShows(rule: Rule, season: Season, date: Date): boolean {
  if (!isSeasonal(rule)) return true;
  return !!rule.seasons?.includes(season) || (!!rule.window && inWindow(monthDay(date), rule.window));
}

/** Whether a gallery category shows on `date` in `season`. */
export function categoryShown(category: string, options: SeasonalOptions, season: Season, date: Date): boolean {
  return !options.seasonal || ruleShows(ruleOf(category, options.rules), season, date);
}

/** The categories (ids, in order) that show now. */
export function shownCategories(
  categories: { id: string }[],
  options: SeasonalOptions,
  hass: Pick<Hass, "states" | "entities">,
  date = new Date(),
): string[] {
  const season = seasonNow(hass, date);
  return categories.map((c) => c.id).filter((id) => categoryShown(id, options, season, date));
}
