// Seasonal gallery: which categories of the scene gallery show today. Pure functions, no DOM.
//
// "All" shows every category. "Seasonal" shows the everyday ones always, a holiday category
// (Halloween, winter holidays) only within its date window (editable in the settings), and a
// season category (spring flowers, summer fruit, autumn harvest, winter frost) only in its
// season — from HA's Season integration when there is one, else by month (like auto light).

import type { Hass, StudioConfig } from "./types.ts";

export const SEASONS = ["winter", "spring", "summer", "autumn"] as const;
export type Season = (typeof SEASONS)[number];

/** A date window, "MM-DD" to "MM-DD" inclusive; it may wrap over the new year. */
export type Window = [string, string];

/** Holiday categories and their default windows. */
export const HOLIDAY_WINDOWS: Record<string, Window> = {
  halloween: ["10-01", "11-02"],
  winter_holidays: ["12-01", "01-06"],
};

/** Categories that belong to a season. */
export const SEASON_CATEGORIES: Record<string, Season> = {
  refreshing: "spring",
  vibrant: "summer",
  rustic: "autumn",
  winter_whisper: "winter",
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
  /** Only the everyday categories plus those in season (default: all). */
  seasonal?: boolean;
  /** Holiday windows that differ from the defaults. */
  windows?: Record<string, Window>;
}

/** The seasonal options of the integration's options. */
export const gallerySeasons = (config: Pick<StudioConfig, "gallery_seasonal" | "gallery_windows">): SeasonalOptions => ({
  seasonal: !!config.gallery_seasonal,
  windows: config.gallery_windows,
});

/** A holiday category's window: the user's, else the default. */
export const windowOf = (category: string, windows: Record<string, Window> = {}): Window =>
  windows[category] ?? HOLIDAY_WINDOWS[category];

/** Whether a gallery category shows on `date` in `season`. */
export function categoryShown(category: string, options: SeasonalOptions, season: Season, date: Date): boolean {
  if (!options.seasonal) return true;
  if (category in HOLIDAY_WINDOWS) return inWindow(monthDay(date), windowOf(category, options.windows));
  if (category in SEASON_CATEGORIES) return SEASON_CATEGORIES[category] === season;
  return true;
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
