// UI strings. `en` is the source of truth; every key must exist in every locale. One file per
// locale (en.ts, pl.ts, ...), each typed by the English keys; a new locale is added to STRINGS.
// Scene and category names come from the gallery data and are not translated.

import type { HassData } from "../core/types.ts";
import { EN, type StringKey } from "./en.ts";
import { PL } from "./pl.ts";

export type { StringKey };
export type Translate = (key: StringKey, params?: Record<string, string | number>) => string;

const STRINGS: Record<string, Record<StringKey, string>> = { en: EN, pl: PL };

/** Return a translate function for the user's HA language, falling back to English. */
export function localize(hass: Pick<HassData, "language" | "locale"> | null | undefined): Translate {
  const lang = hass?.locale?.language || hass?.language || "en";
  const table = STRINGS[lang] || STRINGS[lang.split("-")[0]] || EN;
  return (key, params = {}) =>
    (table[key] ?? EN[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ""));
}

export const LOCALES = Object.keys(STRINGS);
export const keysOf = (lang: string): string[] => Object.keys(STRINGS[lang]);
