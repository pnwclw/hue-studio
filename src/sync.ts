// Sync Box: which room a box syncs, what a command will change, its inputs' icons. Pure
// functions, no DOM.

import type { Group } from "./model.ts";
import type { SyncArea, SyncBoxInfo, SyncChange, SyncInput } from "./types.ts";

export const SYNC_MODES = ["video", "music", "game"] as const;
export const INTENSITIES = ["subtle", "moderate", "high", "intense"] as const;
export const PALETTES = ["happy_energetic", "happy_calm", "melancholic_calm", "melancholic_energetic", "neutral"] as const;
/** Remote button actions (sync.py IR_ACTIONS), plus "input:<id>" and "preset:<id>". */
export const IR_ACTIONS = [
  "toggle_sync", "sync_on", "sync_off", "power_off", "passthrough", "mode_video", "mode_music", "mode_game",
  "next_mode", "next_input", "next_intensity", "brighter", "darker", "toggle_background",
] as const;

/** What a picture on an input starts (sync_follow.ACTIONS); absent: nothing. */
export const FOLLOW_ACTIONS = ["passthrough", "video", "game", "music"] as const;
/** Domains of the entities that may tell an input's picture (sync_follow.SIGNAL_DOMAINS), players first. */
export const SIGNAL_DOMAINS = ["media_player", "remote", "binary_sensor", "input_boolean", "switch"] as const;
/** How long the linked screen stays on without a picture, in seconds (0: always). */
export const SCREEN_OFF_AFTER = [60, 120, 300, 600, 1800, 3600, 0] as const;

// Device types the Sync Box app offers for inputs -> MDI icons.
const INPUT_ICONS: [RegExp, string][] = [
  [/appletv/, "mdi:apple"],
  [/xbox|playstation|nintendo|game/, "mdi:controller"],
  [/desktop|laptop|monitor|pc/, "mdi:mouse"],
  [/phone/, "mdi:cellphone"],
  [/diskplayer/, "mdi:disc-player"],
  [/roku|shield|chromecast|firetv|settopbox|satellite|video/, "mdi:television-box"],
  [/music|speaker|soundbar|avreceiver/, "mdi:speaker"],
];
export const inputIcon = (input: SyncInput | null | undefined): string => (input && INPUT_ICONS.find(([re]) => re.test(input.type || ""))?.[1]) || "mdi:hdmi-port";

/** Whether a directly paired box offers a feature (a linked one offers none of these). */
export const hasFeature = (box: SyncBoxInfo, feature: NonNullable<SyncBoxInfo["features"]>[number]): boolean => !!box.features?.includes(feature);

/** The entertainment area the box syncs (or would sync), or null. */
export const currentArea = (box: SyncBoxInfo): SyncArea | null => box.areas?.find((a) => a.id === box.area) || null;

/** The selected HDMI input, or null. */
export const currentInput = (box: SyncBoxInfo) => box.inputs?.find((i) => i.id === box.input) || null;

/** Lights the box is driving right now (empty unless syncing). */
export const syncedLights = (box: SyncBoxInfo): string[] => (box.available && box.syncing ? currentArea(box)?.lights || [] : []);

/**
 * Boxes relevant to a room: those whose current entertainment area shares a light with it.
 * Sorted so that a box syncing this room comes first.
 */
export function boxesForGroup(boxes: Record<string, SyncBoxInfo>, group: Pick<Group, "lights">): [string, SyncBoxInfo][] {
  return Object.entries(boxes)
    .filter(([, box]) => box.available && (currentArea(box)?.lights || []).some((id) => group.lights.includes(id)))
    .sort(([, a], [, b]) => Number(!!b.syncing) - Number(!!a.syncing));
}

/** Lights of the group that some box syncs now (scenes would be overwritten there). */
export function syncingIn(boxes: Record<string, SyncBoxInfo>, group: Pick<Group, "lights">): string[] {
  const synced = new Set(Object.values(boxes).flatMap(syncedLights));
  return group.lights.filter((id) => synced.has(id));
}

/**
 * What HA's more-info needs before our WebSocket answers: each box's sync switch and the
 * lights of its current entertainment area (kept by the page between visits).
 */
export type SyncMemo = Record<string, { entity: string; lights: string[] }>;

export function syncMemo(boxes: Record<string, SyncBoxInfo>): SyncMemo {
  const memo: SyncMemo = {};
  for (const [id, box] of Object.entries(boxes)) {
    const lights = currentArea(box)?.lights;
    if (box.entity_id && lights?.length) memo[id] = { entity: box.entity_id, lights };
  }
  return memo;
}

/** The box whose sync switch is on and whose area holds `light`, by the memo and HA's states. */
export function memoBoxFor(memo: SyncMemo, states: Record<string, { state: string } | undefined>, light: string): string | null {
  return Object.entries(memo).find(([, m]) => states[m.entity]?.state === "on" && m.lights.includes(light))?.[0] ?? null;
}

/** What the box will report after `hue_studio.set_sync` with `change` (mirrors the backend). */
export function predictSync(box: SyncBoxInfo, change: SyncChange): SyncBoxInfo {
  const next: SyncBoxInfo = { ...box };
  if (change.power === false) return { ...next, power: false, syncing: false };
  if (change.mode && change.sync !== false) Object.assign(next, { mode: change.mode, syncing: true, power: true });
  else if (change.sync !== undefined) Object.assign(next, { syncing: change.sync, power: change.sync || next.power });
  else if (change.power) next.power = true;
  if (change.intensity) next.intensity = change.intensity;
  if (change.input) next.input = box.inputs?.find((i) => i.id === change.input || i.name === change.input)?.id ?? next.input;
  if (change.entertainment_area) {
    next.area = box.areas?.find((a) => a.id === change.entertainment_area || a.name === change.entertainment_area)?.id ?? next.area;
  }
  if (change.brightness !== undefined) next.brightness = change.brightness;
  if (change.palette) next.palette = change.palette;
  if (change.background_lighting !== undefined && next.background_lighting && (next.mode === "video" || next.mode === "game")) {
    next.background_lighting = { ...next.background_lighting, [next.mode]: change.background_lighting };
  }
  return next;
}

/** Whether the box reports everything a prediction expects. */
export function confirmed(predicted: SyncBoxInfo, actual: SyncBoxInfo): boolean {
  const keys: (keyof SyncBoxInfo)[] = ["power", "syncing", "mode", "intensity", "input", "area", "brightness"];
  return keys.every((k) => predicted[k] === actual[k]);
}

/** Status line of a box, as keys for the translator. */
export function statusKey(box: SyncBoxInfo): "sync.unavailable" | "sync.off" | "sync.syncing" | "sync.ready" {
  if (!box.available) return "sync.unavailable";
  if (!box.power) return "sync.off";
  return box.syncing ? "sync.syncing" : "sync.ready";
}
