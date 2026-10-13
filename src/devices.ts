// Pure: adding Hue devices (the "Add devices" flow) and what the settings show of bridges.
// Serial numbers typed by the user, when a search is over, which devices it found.

import type { BridgeDevices, BridgesMessage, DevicesMessage, HueDeviceInfo } from "./types.ts";

/** The bridge takes up to 10 serial numbers per search. */
export const MAX_SERIALS = 10;
/** How long a search takes, about (the bridge says when it is over). */
export const SEARCH_MS = 60_000;
/** A search the bridge never reported as running is over after this. */
const SEARCH_SILENT_MS = 10_000;
/** A search the bridge keeps reporting as running is shown as over after this. */
const SEARCH_MAX_MS = 3 * 60_000;

/** What can be added: Hue lights, accessories (switches, sensors), other brands' Zigbee lights. */
export type AddKind = "light" | "accessory" | "other";

/** Serial numbers in what the user typed: 6 hex characters each, upper case, no repeats. */
export function parseSerials(text: string): { codes: string[]; invalid: string[]; tooMany: boolean } {
  const tokens = text
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const codes = [...new Set(tokens.filter((s) => /^[0-9A-F]{6}$/.test(s)))];
  const invalid = tokens.filter((s) => !/^[0-9A-F]{6}$/.test(s));
  return { codes: codes.slice(0, MAX_SERIALS), invalid, tooMany: codes.length > MAX_SERIALS };
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
