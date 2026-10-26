// Scenes shared the Hue app's way: a link to its scene sharing page, whose query is the scene
// as JSON, zlib-compressed, in URL-safe base64 (padded: the page reads only whole groups of
// four) — read off the page's own code:
//   {"i": picture id (a gallery scene's public_image), "p": [palette entry], "s": speed 0-1}
//   entry: {"c": [r, g, b] or [mirek], "e": effect 1-10, "b": brightness %, "s": speed}
// The Hue app opens such a link to add the scene; the page shows its colors to anyone else.
// The page checks what the app does: 1-10 entries, at least one white (153-500 mirek), RGB
// 0-255, a brightness of 0-100 on each entry without an effect, speeds 0-1 (an entry's only
// with an effect).
// Pure (no DOM): compression goes through the platform's CompressionStream.

import { mirekToRgb, rgbToXy, xyToRgb } from "../../core/color.ts";
import type { XY } from "../../core/types.ts";

export const SHARE_PAGE = "https://scenesharing.meethue.com/data/?";

/** The effects a palette entry may carry, by their code (1-10). */
export const SHARE_EFFECTS = ["candle", "fire", "sparkle", "glisten", "prism", "opal", "underwater", "cosmos", "sunbeam", "enchant"] as const;

/** One color of a shared scene: a color (xy) or a white (mirek), its brightness and effect. */
export interface SharedColor {
  xy?: XY;
  mirek?: number;
  /** 0-100. */
  brightness?: number;
  effect?: (typeof SHARE_EFFECTS)[number];
  speed?: number;
}

export interface SharedScene {
  /** The gallery picture it has in the Hue app (`public_image`), if any. */
  image: string | null;
  colors: SharedColor[];
  /** Dynamic speed, 0-1. */
  speed: number;
}

/** What our services take for a shared scene: up to five colors, or a white; its brightness. */
export interface SharedPalette {
  points: XY[];
  mirek: number | null;
  brightness: number | null;
}

type Entry = { c?: number[]; e?: number; b?: number; s?: number };

const MAX_ENTRIES = 10;
const MIREK_MIN = 153;
const MIREK_MAX = 500;

const round = (v: number, digits = 3): number => Math.round(v * 10 ** digits) / 10 ** digits;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The white nearest a color: the closest of the whites from 153 to 500 mirek (the share
 *  page finds a color's white the same way, by the nearest of a row of samples). */
export function whiteOf(xy: XY): number {
  let best = MIREK_MAX;
  let distance = Infinity;
  for (let mirek = MIREK_MIN; mirek <= MIREK_MAX; mirek += 1) {
    const [x, y] = rgbToXy(...mirekToRgb(mirek));
    const d = (x - xy[0]) ** 2 + (y - xy[1]) ** 2;
    if (d < distance) [best, distance] = [mirek, d];
  }
  return best;
}

/** The JSON the Hue app writes (its key order; empty fields left out), within the page's rules:
 *  a palette of colors only gets the white nearest their average, as the Hue app's always has one. */
export function toJson(scene: SharedScene): Record<string, unknown> {
  let colors = scene.colors.filter((c) => c.xy || c.mirek || c.effect);
  if (!colors.some((c) => c.mirek)) {
    const xys = colors.flatMap((c) => (c.xy ? [c.xy] : []));
    const mid: XY = xys.length ? [xys.reduce((a, c) => a + c[0], 0) / xys.length, xys.reduce((a, c) => a + c[1], 0) / xys.length] : [0.4578, 0.41];
    const white: SharedColor = { mirek: whiteOf(mid), brightness: colors[0]?.brightness ?? 100 };
    colors = [...colors.slice(0, MAX_ENTRIES - 1), white];
  }
  const p = colors.slice(0, MAX_ENTRIES).map((c): Entry => {
    const entry: Entry = {};
    if (c.xy) entry.c = xyToRgb(c.xy[0], c.xy[1]);
    else if (c.mirek) entry.c = [Math.round(clamp(c.mirek, MIREK_MIN, MIREK_MAX))];
    const effect = c.effect ? SHARE_EFFECTS.indexOf(c.effect) + 1 : 0;
    if (effect) entry.e = effect;
    entry.b = Math.round(clamp(c.brightness ?? 100, 0, 100));
    if (effect && c.speed !== undefined) entry.s = round(clamp(c.speed, 0, 1));
    return entry;
  });
  return { ...(scene.image ? { i: scene.image } : {}), p, s: round(clamp(scene.speed, 0, 1)) };
}

/** A shared scene from its JSON; null when it is not one. */
export function fromJson(data: unknown): SharedScene | null {
  if (!data || typeof data !== "object") return null;
  const { i, p, s } = data as { i?: unknown; p?: unknown; s?: unknown };
  if (!Array.isArray(p) || !p.length) return null;
  const colors: SharedColor[] = [];
  for (const raw of p) {
    if (!raw || typeof raw !== "object") return null;
    const { c, e, b, s: speed } = raw as Entry;
    const color: SharedColor = {};
    if (Array.isArray(c) && c.length === 3 && c.every((v) => typeof v === "number")) color.xy = rgbToXy(c[0], c[1], c[2]);
    else if (Array.isArray(c) && c.length === 1 && typeof c[0] === "number" && c[0] > 0) color.mirek = c[0];
    if (typeof e === "number" && SHARE_EFFECTS[e - 1]) color.effect = SHARE_EFFECTS[e - 1];
    if (typeof b === "number") color.brightness = Math.max(0, Math.min(100, b));
    if (typeof speed === "number") color.speed = speed;
    colors.push(color);
  }
  return { image: typeof i === "string" && i ? i : null, colors, speed: typeof s === "number" ? s : 0.5 };
}

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
};

const fromBase64Url = (text: string): Uint8Array => {
  const b64 = text.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
};

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/** The link the Hue app would give for this scene. */
export async function shareLink(scene: SharedScene): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(toJson(scene)));
  return SHARE_PAGE + toBase64Url(await through(json, new CompressionStream("deflate")));
}

/** A shared scene from a link (or only its data, pasted with text around it); null when there is none. */
export async function readShareLink(text: string): Promise<SharedScene | null> {
  const match = /scenesharing\.meethue\.com\/data\/?\?([A-Za-z0-9_-]+=*)/.exec(text) ?? /^\s*([A-Za-z0-9_-]{16,}=*)\s*$/.exec(text);
  if (!match) return null;
  try {
    const json = await through(fromBase64Url(match[1]), new DecompressionStream("deflate"));
    return fromJson(JSON.parse(new TextDecoder().decode(json)));
  } catch {
    return null;
  }
}

/** A shared scene as our palette: its colors (a Hue palette's whites are for white lights:
 *  left out beside colors), else its white; their mean brightness. */
export function sharedPalette(scene: SharedScene): SharedPalette {
  const points = scene.colors.flatMap((c) => (c.xy ? [c.xy] : []));
  const white = scene.colors.find((c) => c.mirek)?.mirek ?? null;
  const levels = scene.colors.map((c) => c.brightness).filter((b): b is number => b !== undefined);
  return {
    points: points.slice(0, 5),
    mirek: points.length ? null : white,
    brightness: levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : null,
  };
}

/** Our palette as a shared scene: each color and white at the scene's brightness. */
export function paletteShare(p: {
  points: XY[];
  /** Its whites (a bridge scene's palette may have colors and whites). */
  whites?: number[];
  mirek?: number | null;
  brightness?: number | null;
  image?: string | null;
  speed?: number | null;
}): SharedScene {
  const brightness = p.brightness ?? 100;
  const whites = p.whites?.length ? p.whites : p.points.length ? [] : [p.mirek ?? 366];
  const colors: SharedColor[] = [...p.points.map((xy) => ({ xy, brightness })), ...whites.map((mirek) => ({ mirek, brightness }))];
  return { image: p.image ?? null, colors, speed: p.speed ?? 0.5 };
}

/**
 * Hand a link on: the system's share sheet where there is one (phones, the companion app),
 * else the clipboard (an older way too: the clipboard API needs HTTPS, HA is often plain HTTP
 * at home). "shared", "copied", or null when neither worked (a share sheet closed is "shared").
 */
export async function sendLink(url: string, title: string): Promise<"shared" | "copied" | null> {
  const nav = globalThis.navigator;
  if (nav?.share && nav.maxTouchPoints > 0) {
    try {
      await nav.share({ title, url });
      return "shared";
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return "shared";
    }
  }
  try {
    await nav.clipboard.writeText(url);
    return "copied";
  } catch {
    const field = document.createElement("textarea");
    field.value = url;
    field.setAttribute("readonly", "");
    field.style.cssText = "position: fixed; opacity: 0";
    document.body.append(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    return ok ? "copied" : null;
  }
}
