// Design tokens (docs/design-system.md): the only colors, type sizes, radii, shadows and
// motion the stylesheets use. Pure (runs in Node): styles.ts turns them into CSS variables on
// the panel's (dialog's, card's) shadow root, tests check the stylesheets use nothing else,
// and a dashboard theme can be generated from the same values later (roadmap I).

/** Colors: the Hue app's dark look, whatever HA's theme is (cards map a few to the theme). Measured on
 *  the Hue app 6.3 (docs/design-system.md, "Inventory"). */
export const COLORS = {
  bg: "#181b1f",
  // Cards and tiles (rooms, scenes, lights, automations, controls).
  surface: "#34353a",
  // Tiles on a surface, header pills.
  "surface-2": "#36383c",
  // List rows, sheets and action sheets, a sub screen's header bar.
  "surface-row": "#24262a",
  // Round buttons on a bar, tiles on a sheet's rows.
  "surface-raised": "#47484c",
  text: "#fff",
  "text-2": "#babbbc",
  "text-3": "#818385",
  "text-dark": "#1c1c1e",
  // Grey fills: buttons and chips; fields, segments and the wheels' band; a switch's track.
  fill: "rgba(120, 120, 128, 0.28)",
  "fill-soft": "rgba(120, 120, 128, 0.24)",
  "fill-strong": "rgba(120, 120, 128, 0.36)",
  // A round button on a tinted or colored surface.
  "fill-light": "rgba(255, 255, 255, 0.12)",
  // The chosen button of a segmented control.
  "segment-on": "#636366",
  separator: "rgba(255, 255, 255, 0.1)",
  // A switch's track when off.
  "switch-off": "#5e5e61",
  // The tab bar and its tabs that are not chosen.
  "bar-bottom": "#0d1013",
  "tab-off": "#404345",
  hairline: "rgba(255, 255, 255, 0.06)",
  // Under every overlay (sheets, popovers, the brightness slider), with a blur.
  scrim: "rgba(0, 0, 0, 0.55)",
  outline: "rgba(120, 120, 128, 0.45)",
  selected: "#fff",
  accent: "#006aff",
  // Links, info icons and the info banner (its border, mark and title are the accent).
  info: "#6c9dff",
  "info-head": "#006aff",
  "info-mark": "#006aff",
  "info-line": "#006aff",
  "info-bg": "#171f2a",
  "info-tint": "rgba(10, 98, 255, 0.14)",
  warn: "#ffb340",
  "warn-line": "rgba(255, 179, 64, 0.45)",
  "warn-bg": "#2a2721",
  "warn-tint": "rgba(255, 179, 64, 0.14)",
  danger: "#e63535",
  "danger-fill": "#c0392b",
  "danger-tint": "rgba(230, 53, 53, 0.14)",
  ok: "#30d158",
  // "Now" and active badges in a room's header.
  sun: "rgba(255, 214, 102, 0.9)",
  // Lights a Sync Box drives.
  "sync-tint": "rgba(106, 91, 255, 0.18)",
} as const;

/** Type scale (px), the Hue app's (Söhne there, cap height 0.718 em; Roboto's 0.711 here, so the
 *  sizes carry over). Weights are 400, 500 and 700 only: HA's Roboto has no others. */
export const FONT_SIZES = {
  label: 10, // section titles and small capitals (spaced), banner titles
  tab: 11, // the tab bar's labels, numbers over a slider
  caption: 12, // row subtitles, a tile's lines under its name, meta, hints in sheets
  footnote: 13, // values on the right of a row, pills, chips, banner text, tiles' names in the gallery
  callout: 14, // light and scene tile names, leads in sheets
  body: 16, // row titles, room and zone names, bar and sheet titles, leads; fields (iOS zooms below 16)
  headline: 17, // action sheets, the chosen value on a wheel, fields
  "title-3": 20, // big numbers, picture cards
  "title-2": 22, // names being edited
  "title-1": 24, // a tab's title in the desktop bar
  title: 28, // a sheet's question or title ("What kind of automation…", "Hue scene gallery")
  large: 34, // a tab's large title, the name on a thing's own screen (wide letters in the Hue app)
} as const;

/** Radii (px); "full" makes a pill or a circle of anything. */
export const RADII = {
  xs: 8,
  s: 10, // fields, segments, menu rows
  m: 12, // every card and tile: rooms, scenes, lights, automations, gallery, banners, groups of rows
  "2xl": 18, // sheets and dialogs
  "3xl": 22, // a room's header, big heroes
  full: 999,
} as const;

/** Shadows: flat (rows, small cards), raised (tiles and cards), overlay (menus, sheets), dot (round pictures). */
export const SHADOWS = {
  flat: "0 3px 10px rgba(0, 0, 0, 0.18)",
  raised: "0 6px 18px rgba(0, 0, 0, 0.22)",
  overlay: "0 16px 44px rgba(0, 0, 0, 0.5)",
  dot: "0 3px 10px rgba(0, 0, 0, 0.35)",
} as const;

/** Sizes of parts (px), the Hue app's (measured in dp on the Android app, 1dp = 1px here). */
export const SIZES = {
  gutter: 12, // a page's side margin: cards and tiles
  "text-inset": 4, // section titles and leads start 4px further in (16 from the edge)
  "section-gap": 32, // a section title under the cards before it
  "title-gap": 8, // a section title over its cards
  control: 32, // everything in a header: round buttons, switches, header pills, search
  "round-s": 28,
  "round-l": 40,
  pill: 36,
  "switch-w": 52,
  knob: 24,
  "row-h": 72, // a list row (settings, devices, sensors, editors, choice sheets)
  "row-h-compact": 52, // a row of controls inside a sheet
  "row-text": 72, // where a list row's text starts
  "row-icon": 24, // at 20px from the edge (device lists: 32, lights are tall)
  "card-gap": 12,
  "tile-gap": 12,
  "light-tile": 102, // a light or scene tile's width in rows that scroll sideways
} as const;

/** Motion. */
export const MOTION = {
  ease: "cubic-bezier(0.25, 0.8, 0.25, 1)",
  spring: "cubic-bezier(0.3, 1.3, 0.5, 1)",
  "t-press": "0.15s",
  // How far a pressed part sinks: round buttons, tiles and buttons, cards, wide rows and banners.
  "press-round": "0.92",
  "press-tile": "0.96",
  "press-card": "0.98",
  "press-row": "0.99",
} as const;

/** Every token as a CSS variable declaration (`--fs-body: 15px;` …). */
export function tokensCss(): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(COLORS)) out.push(`--${k}: ${v};`);
  for (const [k, v] of Object.entries(FONT_SIZES)) out.push(`--fs-${k}: ${v}px;`);
  for (const [k, v] of Object.entries(RADII)) out.push(`--r-${k}: ${v}px;`);
  for (const [k, v] of Object.entries(SHADOWS)) out.push(`--shadow-${k}: ${v};`);
  for (const [k, v] of Object.entries(SIZES)) out.push(`--${k}: ${v}px;`);
  for (const [k, v] of Object.entries(MOTION)) out.push(`--${k}: ${v};`);
  return out.join(" ");
}
