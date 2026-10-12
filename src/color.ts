// Color math shared by the panel and cards. Pure functions, no DOM.

import type { Palette, RGB, XY } from "./types.ts";

const gamma = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const linear = (v: number): number => (v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** CIE xy → sRGB [0-255] at full brightness (Wide RGB D65, as in the Hue developer docs). */
export function xyToRgb(x: number, y: number): RGB {
  if (!y) return [255, 255, 255];
  const X = x / y;
  const Z = (1 - x - y) / y;
  let r = X * 1.656492 - 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - 0.121364 + Z * 1.01153;
  [r, g, b] = [r, g, b].map((v) => Math.max(0, v));
  const m = Math.max(r, g, b) || 1;
  return [r, g, b].map((v) => Math.round(clamp(gamma(v / m), 0, 1) * 255)) as RGB;
}

/** sRGB [0-255] → CIE xy (inverse of xyToRgb, brightness dropped). */
export function rgbToXy(r: number, g: number, b: number): XY {
  const [R, G, B] = [r, g, b].map((v) => linear(v / 255));
  const X = R * 0.664511 + G * 0.154324 + B * 0.162028;
  const Y = R * 0.283881 + G * 0.668433 + B * 0.047685;
  const Z = R * 0.000088 + G * 0.07231 + B * 0.986039;
  const sum = X + Y + Z;
  if (!sum) return [0.3227, 0.329];
  return [round4(X / sum), round4(Y / sum)];
}

const round4 = (v: number): number => Math.round(v * 10000) / 10000;

/** Color temperature in mirek → sRGB [0-255] (Tanner Helland's approximation). */
export function mirekToRgb(mirek: number): RGB {
  const t = 1e6 / mirek / 100;
  const r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  return [r, g, b].map((v) => Math.round(clamp(v, 0, 255))) as RGB;
}

export const rgbCss = (rgb: readonly number[]): string => `rgb(${rgb.join(",")})`;

const soften = (rgb: RGB, k: number): string => `rgb(${rgb.map((v) => Math.round(v * (1 - k) + 255 * k)).join(",")})`;

/** Dot colors of a palette, slightly pastel like the Hue app (it never shows raw primaries). */
export function paletteColors(palette: Palette): string[] {
  if (palette.kind === "white") return [soften(mirekToRgb(palette.mirek ?? 300), 0.35)];
  return (palette.points ?? []).map(([x, y]) => soften(xyToRgb(x, y), 0.18));
}

const SPOTS: XY[] = [[18, 28], [78, 22], [55, 78], [12, 85], [90, 75], [45, 40]];

/** CSS background for a palette without a picture: soft blobs of its colors. */
export function paletteArt(palette: Palette): string {
  const colors = paletteColors(palette);
  const layers = colors.map((c, i) => {
    const [x, y] = SPOTS[i % SPOTS.length];
    return `radial-gradient(circle at ${x}% ${y}%, ${c} 0, transparent 62%)`;
  });
  return `${layers.join(", ")}, linear-gradient(135deg, ${colors[0]}, ${colors[colors.length - 1]})`;
}

// ---------- gamut ----------

const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

function closestOnSegment(p: XY, a: XY, b: XY): XY {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = dx * dx + dy * dy;
  const t = len ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len, 0, 1) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}

/** True if xy lies inside the gamut triangle [[rx, ry], [gx, gy], [bx, by]]. */
export function inGamut(xy: XY, gamut: XY[]): boolean {
  const [a, b, c] = gamut;
  const d1 = cross(b[0] - a[0], b[1] - a[1], xy[0] - a[0], xy[1] - a[1]);
  const d2 = cross(c[0] - b[0], c[1] - b[1], xy[0] - b[0], xy[1] - b[1]);
  const d3 = cross(a[0] - c[0], a[1] - c[1], xy[0] - c[0], xy[1] - c[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Clip xy to the light's gamut (closest point on the triangle), as the bridge does. */
export function clipToGamut(xy: XY, gamut: XY[] | null | undefined): XY {
  if (!gamut || inGamut(xy, gamut)) return xy;
  const [a, b, c] = gamut;
  const candidates = [closestOnSegment(xy, a, b), closestOnSegment(xy, b, c), closestOnSegment(xy, c, a)];
  const dist = (p: XY): number => (p[0] - xy[0]) ** 2 + (p[1] - xy[1]) ** 2;
  const best = candidates.reduce((m, p) => (dist(p) < dist(m) ? p : m));
  return [round4(best[0]), round4(best[1])];
}

// ---------- color wheel ----------
// The wheel is an HSV disc (hue = angle, saturation = radius, value = 1), oriented like
// the Hue app: red at about eleven o'clock, hues running clockwise.

/** Angle (degrees, clockwise from 12 o'clock) where hue 0 (red) sits. */
export const WHEEL_RED_ANGLE = -20;

/** CSS background drawing the wheel; matches wheelToRgb/rgbToWheel. */
export const WHEEL_CSS =
  "radial-gradient(closest-side, #fff, rgba(255,255,255,0.85) 18%, rgba(255,255,255,0) 100%), " +
  `conic-gradient(from ${WHEEL_RED_ANGLE}deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)`;

function hsvToRgb(h: number, s: number, v: number): RGB {
  const f = (n: number): number => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)].map((c) => Math.round(c * 255)) as RGB;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  [r, g, b] = [r / 255, g / 255, b / 255];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}

/**
 * Point on the wheel ([-1, 1] each, +y down, radius ≤ 1) → sRGB.
 * The white-ish center follows the CSS overlay, so the radius maps to saturation.
 */
export function wheelToRgb(px: number, py: number): RGB {
  const r = Math.min(1, Math.hypot(px, py));
  const angle = (Math.atan2(px, -py) * 180) / Math.PI; // clockwise from 12 o'clock
  const hue = (((angle - WHEEL_RED_ANGLE) % 360) + 360) % 360;
  return hsvToRgb(hue, r, 1);
}

/** sRGB → point on the wheel ([-1, 1] each, +y down). */
export function rgbToWheel(rgb: RGB): XY {
  const [h, s] = rgbToHsv(...rgb);
  const angle = ((h + WHEEL_RED_ANGLE) * Math.PI) / 180;
  return [Math.sin(angle) * s, -Math.cos(angle) * s];
}

export const wheelToXy = (px: number, py: number): XY => rgbToXy(...wheelToRgb(px, py));
export const xyToWheel = (x: number, y: number): XY => rgbToWheel(xyToRgb(x, y));

// ---------- white disc ----------
// White mode shows a vertical scale: coolest at the top, warmest at the bottom.

export const MIREK_MIN = 153;
export const MIREK_MAX = 500;

export const WHITE_CSS = `linear-gradient(${[MIREK_MIN, 250, 333, 400, MIREK_MAX]
  .map((m) => rgbCss(mirekToRgb(m)))
  .join(", ")})`;

/** Vertical wheel position (-1 top … 1 bottom) → mirek. */
export const wheelYToMirek = (py: number): number => Math.round(MIREK_MIN + ((clamp(py, -1, 1) + 1) / 2) * (MIREK_MAX - MIREK_MIN));
/** Mirek → vertical wheel position (-1 top … 1 bottom). */
export const mirekToWheelY = (mirek: number): number => ((clamp(mirek, MIREK_MIN, MIREK_MAX) - MIREK_MIN) / (MIREK_MAX - MIREK_MIN)) * 2 - 1;

// ---------- gradients ----------

/**
 * Fit a light's colors to the n points it shows: a single color is stacked n times (the
 * light is uniform; pins separate when dragged apart), a gradient is resampled along its
 * colors.
 */
export function resample(points: XY[], n: number): XY[] {
  if (points.length === n) return points;
  if (points.length === 1 || n === 1) return Array.from({ length: n }, () => points[0]);
  return Array.from({ length: n }, (_, i) => {
    const t = (i * (points.length - 1)) / (n - 1);
    const a = points[Math.floor(t)];
    const b = points[Math.min(points.length - 1, Math.floor(t) + 1)];
    const f = t - Math.floor(t);
    return [round4(a[0] + (b[0] - a[0]) * f), round4(a[1] + (b[1] - a[1]) * f)];
  });
}

/**
 * A smooth path (SVG, viewBox -1 -1 2 2) through the pins of a gradient light, in order:
 * a Catmull-Rom curve through the points as they sit on the wheel, like the Hue app's
 * line. Pins on top of each other are skipped (no loops on stacked points).
 */
export function smoothPath(pins: XY[]): string {
  const pts = pins.filter((p, i) => i === 0 || Math.hypot(p[0] - pins[i - 1]![0], p[1] - pins[i - 1]![1]) > 1e-3);
  if (pts.length < 2) return "";
  const f = (v: number) => v.toFixed(4);
  let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    const c1: XY = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: XY = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}
