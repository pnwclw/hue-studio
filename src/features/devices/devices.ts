// Pure: adding Hue devices (the "Add devices" flow) and what the settings show of bridges.
// Serial numbers typed by the user, when a search is over, which devices it found.

import { ARCHETYPE_ICONS, PRODUCT_ICONS, sensorIcon } from "../../core/model.ts";
import type { BridgeDevices, BridgesMessage, DevicesMessage, HassData, HueDeviceInfo, LightFunction, PowerOn } from "../../core/types.ts";

/** The bridge takes up to 10 serial numbers per search. */
export const MAX_SERIALS = 10;
/** How long a search takes, about (the bridge says when it is over). */
export const SEARCH_MS = 60_000;
/** Searches in a row while nothing joined (a light may be switched off and on meanwhile). */
export const SEARCH_ROUNDS = 3;
/** A search the bridge never reported as running is over after this. */
const SEARCH_SILENT_MS = 10_000;
/** A search the bridge keeps reporting as running is shown as over after this. */
const SEARCH_MAX_MS = 3 * 60_000;

/** What can be added: Hue lights, accessories (switches, sensors), other brands' Zigbee lights. */
export type AddKind = "light" | "accessory" | "other";

/** A device's Zigbee MAC (`AA:BB:…`, 8 bytes) and install code (36 hex digits), from its QR code. */
export interface InstallCode {
  mac: string;
  code: string;
}

const HUE_QR = /HUE:Z:([0-9A-F]{36})\s+M:([0-9A-F]{16})(?:\s+[A-Z]:[^\s,;]*)*/gi;
const ZIGBEE_QR = /Z:([0-9A-F]{16})\$I:([0-9A-F]{36})[^\s,;]*/gi;

const macOf = (hex: string): string => hex.toUpperCase().match(/../g)!.join(":");

/**
 * The install codes in a text: QR codes of Hue devices (`HUE:Z:<install code> M:<MAC> …`)
 * or of other Zigbee devices (`Z:<MAC>$I:<install code>…`); the rest of the text stays.
 */
export function takeQrCodes(text: string): { codes: InstallCode[]; rest: string } {
  const codes: InstallCode[] = [];
  const rest = text
    .replace(HUE_QR, (_m, code: string, mac: string) => (codes.push({ mac: macOf(mac), code: code.toUpperCase() }), " "))
    .replace(ZIGBEE_QR, (_m, mac: string, code: string) => (codes.push({ mac: macOf(mac), code: code.toUpperCase() }), " "));
  return { codes, rest };
}

/** The install code in one QR code, or null if it is not a device's Zigbee QR code. */
export function parseQr(raw: string): InstallCode | null {
  const { codes, rest } = takeQrCodes(raw.trim());
  return codes.length === 1 && !rest.trim() ? codes[0] : null;
}

/** Install codes so far plus new ones, one per device (the newest wins). */
export function withCodes(known: InstallCode[], added: InstallCode[]): InstallCode[] {
  const byMac = new Map(known.map((c) => [c.mac, c]));
  for (const c of added) byMac.set(c.mac, c);
  return [...byMac.values()];
}

/**
 * Serial numbers in what the user typed: 6 hex characters each, upper case, no repeats;
 * a pasted QR code's text gives its install code (`qr`).
 */
export function parseSerials(text: string): { codes: string[]; qr: InstallCode[]; invalid: string[]; tooMany: boolean } {
  const { codes: qr, rest } = takeQrCodes(text);
  const tokens = rest
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const codes = [...new Set(tokens.filter((s) => /^[0-9A-F]{6}$/.test(s)))];
  const invalid = tokens.filter((s) => !/^[0-9A-F]{6}$/.test(s));
  return { codes: codes.slice(0, MAX_SERIALS), qr: withCodes([], qr), invalid, tooMany: codes.length > MAX_SERIALS };
}

/**
 * Whether a search that started at `started` (ms) is over: the bridge reported it running
 * (`seenActive`) and no longer does, or never did within a few seconds, or it ran too long.
 */
export function searchOver(bridge: BridgeDevices | undefined, started: number, now: number, seenActive: boolean): boolean {
  if (!bridge) return true;
  const elapsed = now - started;
  if (elapsed >= SEARCH_MAX_MS) return true;
  if (bridge.searching) return false;
  return seenActive || elapsed >= SEARCH_SILENT_MS;
}

/** 0..1 of the usual length of a search (stays just short of 1 while the bridge searches). */
export const searchProgress = (started: number, now: number): number => Math.min(0.97, Math.max(0, (now - started) / SEARCH_MS));

/** A device with the bridge it is on. */
export interface FoundDevice extends HueDeviceInfo {
  bridge: string;
}

/** Devices added while Home Assistant runs and not set up yet, newest first; `since` (ms): found after it. */
export function newDevices(msg: DevicesMessage | null, since = 0): FoundDevice[] {
  return Object.entries(msg || {})
    .flatMap(([bridge, b]) => b.devices.filter((d) => d.new && (d.found ?? 0) * 1000 >= since).map((d) => ({ ...d, bridge })))
    .sort((a, b) => (b.found ?? 0) - (a.found ?? 0) || a.name.localeCompare(b.name));
}

/** The HA area of a room's group key ("area.<id>"), or null for a Hue zone. */
export const areaOfRoom = (key: string | null | undefined): string | null => (key?.startsWith("area.") ? key.slice(5) : null);

/** Whether any bridge is a Hue Bridge Pro (MotionAware areas). */
export const hasPro = (bridges: BridgesMessage | null): boolean => Object.values(bridges || {}).some((b) => b.pro || b.motion_areas !== null);

/** Wi-Fi strength (0-4) as a word of the Sync Box app. */
export const wifiKey = (strength: number | null | undefined): "none" | "weak" | "fair" | "good" | "excellent" | null =>
  strength == null ? null : (["none", "weak", "fair", "good", "excellent"] as const)[Math.max(0, Math.min(4, Math.round(strength)))];

// Settings → Devices, like the Hue app's: devices by kind ("Lights & smart plugs", …), a
// list per kind by room with a search and filters, a device's settings.

/** The lists of Settings → Devices (a route segment each). */
export type DeviceGroup = "lights" | "switches" | "sensors" | "other";
export const DEVICE_GROUPS: DeviceGroup[] = ["lights", "switches", "sensors", "other"];

export const groupOf = (kind: HueDeviceInfo["kind"]): DeviceGroup =>
  kind === "light" ? "lights" : kind === "switch" ? "switches" : kind === "sensor" ? "sensors" : "other";

export const isDeviceGroup = (s: string | null | undefined): s is DeviceGroup => DEVICE_GROUPS.includes(s as DeviceGroup);

export const KIND_ICONS: Record<HueDeviceInfo["kind"], string> = {
  light: "mdi:lightbulb-on-outline",
  switch: "mdi:light-switch",
  sensor: "mdi:motion-sensor",
  other: "mdi:devices",
};

/** Icons of the lists (the Hue app's bulb for lights). */
export const GROUP_ICONS: Record<DeviceGroup, string> = {
  lights: "hue-studio:bulb-sultan-v2",
  switches: "mdi:light-switch",
  sensors: "hue-studio:motion-sensor",
  other: "mdi:devices",
};

/**
 * A device's picture: an icon set on one of its lights in HA wins, then the Hue app's for
 * its product and shape (lights) or model (sensors), else one per kind.
 */
export function deviceIcon(hass: HassData, d: HueDeviceInfo): string {
  const own = d.lights.map((id) => hass.entities?.[id]?.icon).find(Boolean);
  if (own) return own;
  if (d.kind === "light") return PRODUCT_ICONS.find(([re]) => re.test(d.product))?.[1] || ARCHETYPE_ICONS[d.archetype] || KIND_ICONS.light;
  if (d.kind === "sensor") return sensorIcon(d.product || d.model, d.sensitivity !== null || /motion/i.test(d.product));
  return KIND_ICONS[d.kind];
}

/** Lower case without diacritics: "Taśma" is found by "tasma". */
const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLocaleLowerCase();

/** The location filter's value for devices in no area. */
export const NO_AREA = "";

export interface DeviceFilter {
  /** What was typed in the search field. */
  query: string;
  /** An area id, NO_AREA, or null: every location. */
  area: string | null;
  /** A product name, or null: every type. */
  type: string | null;
  /** A bridge (native hue entry id), or null/absent: every bridge. */
  bridge?: string | null;
}

/** Devices that match the search (name or product) and the filters. */
export function filterDevices<T extends HueDeviceInfo & { bridge?: string }>(list: T[], f: DeviceFilter): T[] {
  const q = fold(f.query.trim());
  return list.filter(
    (d) =>
      (!q || fold(d.name).includes(q) || fold(d.product).includes(q)) &&
      (f.area === null || (d.area ?? NO_AREA) === f.area) &&
      (f.type === null || d.product === f.type) &&
      (f.bridge == null || d.bridge === f.bridge),
  );
}

/** Types to filter by: the products of the devices, by name. */
export const deviceTypes = (list: HueDeviceInfo[]): string[] =>
  [...new Set(list.map((d) => d.product).filter(Boolean))].sort((a, b) => a.localeCompare(b));

export interface DeviceSection {
  /** The area id, or null: no area. */
  area: string | null;
  name: string;
  devices: HueDeviceInfo[];
}

/** Devices by area (areas by name, devices in no area last), devices by name. */
export function byLocation(list: HueDeviceInfo[], areaName: (id: string) => string | undefined, noArea: string): DeviceSection[] {
  const sections = new Map<string | null, HueDeviceInfo[]>();
  for (const d of list) {
    const area = d.area && areaName(d.area) !== undefined ? d.area : null;
    sections.set(area, [...(sections.get(area) ?? []), d]);
  }
  return [...sections]
    .map(([area, devices]) => ({
      area,
      name: area === null ? noArea : areaName(area)!,
      devices: devices.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => (a.area === null ? 1 : 0) - (b.area === null ? 1 : 0) || a.name.localeCompare(b.name));
}

/** Every device of every bridge, with its bridge. */
export const allDevices = (msg: DevicesMessage | null): FoundDevice[] =>
  Object.entries(msg || {}).flatMap(([bridge, b]) => b.devices.map((d) => ({ ...d, bridge })));

/** The function and power-on choices of a light's settings, in the Hue app's order. */
export const LIGHT_FUNCTIONS: LightFunction[] = ["functional", "decorative", "mixed"];
export const POWER_ON: Exclude<PowerOn, "custom">[] = ["safety", "last_on_state", "powerfail"];
