// UI strings. `en` is the source of truth; every key must exist in every locale.
// Scene and category names come from the gallery data and are not translated.

const STRINGS = {
  en: {
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
  },
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
export function localize(hass) {
  const lang = hass?.locale?.language || hass?.language || "en";
  const table = STRINGS[lang] || STRINGS[lang.split("-")[0]] || STRINGS.en;
  return (key, params = {}) =>
    (table[key] ?? STRINGS.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => params[k] ?? "");
}

export const LOCALES = Object.keys(STRINGS);
export const keysOf = (lang) => Object.keys(STRINGS[lang]);
