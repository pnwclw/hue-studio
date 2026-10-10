// UI strings. `en` is the source of truth; every key must exist in every locale.
// Scene and category names come from the gallery data and are not translated.

import type { HassData } from "./types.ts";

const EN = {
  "home.title": "Home",
  "home.rooms": "Rooms",
  "home.zones": "Zones",
  "home.empty": "No Hue lights found. Set up the Philips Hue integration and assign lights to areas.",
  "home.all_lights": "All lights",
  "room.scenes": "My scenes",
  "room.lights": "Lights",
  "room.not_found": "This room no longer exists.",
  "room.gallery": "Scene gallery",
  "room.colors": "Colors",
  "color.done": "Done",
  "color.mode_color": "Color",
  "color.mode_white": "White",
  "color.no_color": "None of these lights supports color.",
  "color.merge_lights": "One color for all lights",
  "color.points": "Colors",
  "adaptive.on": "Adaptive",
  "adaptive.off": "Adaptive off",
  "adaptive.resume": "Resume adaptive",
  "more.open_studio": "Hue Studio",
  "more.settings": "Details",
  "gallery.title": "Scene gallery",
  "gallery.search": "Search scenes",
  "gallery.search_button": "Search",
  "gallery.empty": "Nothing found",
  "gallery.load_error": "Could not load the scene gallery.",
  "gallery.target": "Apply to",
  "gallery.set_once": "Set once",
  "gallery.applied": "Applied to {name}",
  "nav.home": "Home",
  "nav.gallery": "Explore",
  "panel.menu": "Menu",
  "common.back": "Back",
  "common.close": "Close",
  "common.toggle": "Turn on or off",
  "common.brightness": "Brightness",
  "common.error": "Something went wrong: {error}",
};

export type StringKey = keyof typeof EN;
export type Translate = (key: StringKey, params?: Record<string, string | number>) => string;

const STRINGS: Record<string, Record<StringKey, string>> = {
  en: EN,
  pl: {
    "home.title": "Dom",
    "home.rooms": "Pokoje",
    "home.zones": "Strefy",
    "home.empty": "Nie znaleziono świateł Hue. Skonfiguruj integrację Philips Hue i przypisz światła do obszarów.",
    "home.all_lights": "Wszystkie światła",
    "room.scenes": "Moje sceny",
    "room.lights": "Światła",
    "room.not_found": "Ten pokój już nie istnieje.",
    "room.gallery": "Galeria scen",
    "room.colors": "Kolory",
    "color.done": "Gotowe",
    "color.mode_color": "Kolor",
    "color.mode_white": "Biel",
    "color.no_color": "Żadne z tych świateł nie obsługuje kolorów.",
    "color.merge_lights": "Jeden kolor dla wszystkich świateł",
    "color.points": "Kolory",
    "adaptive.on": "Adaptacyjne",
    "adaptive.off": "Adaptacyjne wył.",
    "adaptive.resume": "Wznów adaptacyjne",
    "more.open_studio": "Hue Studio",
    "more.settings": "Szczegóły",
    "gallery.title": "Galeria scen",
    "gallery.search": "Szukaj scen",
    "gallery.search_button": "Szukaj",
    "gallery.empty": "Nic nie znaleziono",
    "gallery.load_error": "Nie udało się wczytać galerii scen.",
    "gallery.target": "Zastosuj w",
    "gallery.set_once": "Ustaw raz",
    "gallery.applied": "Zastosowano: {name}",
    "nav.home": "Dom",
    "nav.gallery": "Odkrywaj",
    "panel.menu": "Menu",
    "common.back": "Wstecz",
    "common.close": "Zamknij",
    "common.toggle": "Włącz lub wyłącz",
    "common.brightness": "Jasność",
    "common.error": "Coś poszło nie tak: {error}",
  },
};

/** Return a translate function for the user's HA language, falling back to English. */
export function localize(hass: Pick<HassData, "language" | "locale"> | null | undefined): Translate {
  const lang = hass?.locale?.language || hass?.language || "en";
  const table = STRINGS[lang] || STRINGS[lang.split("-")[0]] || EN;
  return (key, params = {}) =>
    (table[key] ?? EN[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ""));
}

export const LOCALES = Object.keys(STRINGS);
export const keysOf = (lang: string): string[] => Object.keys(STRINGS[lang]);
