// Design tokens (docs/design-system.md): the only colors, type sizes, radii, shadows and
// motion the stylesheets use. Pure (runs in Node): styles.ts turns them into CSS variables on
// the panel's (dialog's, card's) shadow root, tests check the stylesheets use nothing else,
// and a dashboard theme can be generated from the same values later (roadmap I).

/** Colors: the Hue app's dark look, whatever HA's theme is (cards map a few to the theme). */
export const COLORS = {
  bg: "#1c1c1e",
  surface: "#2c2c2e",
  "surface-2": "#3a3a3c",
  // Rows and bars inside a sheet, and tiles that sit on them.
  "surface-sheet": "#333336",
  "surface-raised": "#4a4a4e",
  text: "#fff",
  "text-2": "rgba(235, 235, 245, 0.6)",
  "text-3": "rgba(235, 235, 245, 0.3)",
  "text-dark": "#1c1c1e",
  // Grey fills: buttons and chips; fields, segments and the wheels' band; a switch's track.
  fill: "rgba(120, 120, 128, 0.28)",
  "fill-soft": "rgba(120, 120, 128, 0.24)",
  "fill-strong": "rgba(120, 120, 128, 0.36)",
  // A round button on a tinted or colored surface.
  "fill-light": "rgba(255, 255, 255, 0.12)",
  // The chosen button of a segmented control.
  "segment-on": "#636366",
  separator: "rgba(255, 255, 255, 0.08)",
  hairline: "rgba(255, 255, 255, 0.06)",
  outline: "rgba(120, 120, 128, 0.45)",
  selected: "#fff",
  accent: "#0a62ff",
  // Links, info icons and the info banner.
  info: "#6c9dff",
  "info-head": "#4f84ff",
  "info-mark": "#3478f6",
  "info-line": "rgba(64, 104, 224, 0.5)",
  "info-bg": "#24252d",
  "info-tint": "rgba(10, 98, 255, 0.14)",
  warn: "#ffb340",
  "warn-line": "rgba(255, 179, 64, 0.45)",
  "warn-bg": "#2a2721",
  "warn-tint": "rgba(255, 179, 64, 0.14)",
  danger: "#ff453a",
  "danger-fill": "#c0392b",
  "danger-tint": "rgba(255, 69, 58, 0.14)",
  ok: "#30d158",
  // "Now" and active badges in a room's header.
  sun: "rgba(255, 214, 102, 0.9)",
  // Lights a Sync Box drives.
  "sync-tint": "rgba(106, 91, 255, 0.18)",
} as const;

/** Type scale (px). Weights are 400, 500 and 700 only: HA's Roboto has no others. */
export const FONT_SIZES = {
  tab: 10, // the tab bar's labels
  micro: 11, // numbers over a slider, edge labels
  caption: 12, // section titles, a tile's lines under its name, meta
  footnote: 13, // row subtitles, pills, hints, banner titles
  callout: 14, // tile and scene names, leads
  body: 15, // row titles, banner text
  name: 16, // home's room and zone names; fields (iOS zooms below 16)
  headline: 17, // bar titles, automation card titles, action sheets
  "title-3": 20, // big numbers, picture cards
  "title-2": 22, // sheet titles, names being edited
  "title-1": 24, // a tab's title in the desktop bar
  title: 28, // the name on a thing's own screen (scene, sensor, device, automation)
  large: 30, // a tab's large title on phones
  display: 34, // large titles on wide screens, an effect's screen
} as const;

/** Radii (px); "full" makes a pill or a circle of anything. */
export const RADII = {
  xs: 8,
  s: 10, // fields, segments, menu rows
  m: 12, // gallery tiles, rows inside a sheet, place tiles
  l: 14, // groups of rows, flat cards and tiles
  xl: 16, // cards that float: room cards, tile cards, banners, automation cards
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

/** Sizes of parts (px), the Hue app's (1pt ≈ 2.09px on its screenshots). */
export const SIZES = {
  gutter: 16, // a page's side margin
  "section-gap": 22, // a section title under the cards before it
  "title-gap": 8, // a section title over its cards
  control: 32, // everything in a header: round buttons, switches, header pills, search
  "round-s": 28,
  "round-l": 40,
  pill: 34,
  "switch-w": 52,
  knob: 24,
  "row-h": 68, // a list row (settings, devices, sensors, editors, choice sheets)
  "row-h-compact": 52, // a row of controls inside a sheet
  "row-text": 72, // where a list row's text starts
  "row-icon": 28,
  "card-gap": 12,
  "tile-gap": 10,
  "light-tile": 104, // a light or scene tile's width in rows that scroll sideways
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
