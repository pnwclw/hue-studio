// Pure: MotionAware areas (Hue Bridge Pro) as the panel shows them — where an area can
// be made, which lights can sense, how a calibration goes, what an area's lights do.

import type { BridgeInfo, BridgesMessage, MotionArea, MotionGroup, MotionLight } from "./types.ts";

/** The Hue app's limits: three lights at least, four at most. */
export const MIN_LIGHTS = 3;
export const MAX_LIGHTS = 4;
/** How long the bridge calibrates an area (about 30 s). */
export const CALIBRATION_MS = 30_000;

/** An area found among the bridges: [hue entry id, bridge, area]. */
export function findArea(bridges: BridgesMessage | null, id: string): [string, BridgeInfo, MotionArea] | null {
  for (const [entry, b] of Object.entries(bridges || {})) {
    const area = b.motion_areas?.find((a) => a.id === id);
    if (area) return [entry, b, area];
  }
  return null;
}

/** Bridges with MotionAware (Bridge Pro). */
export const motionBridges = (bridges: BridgesMessage | null): [string, BridgeInfo][] =>
  Object.entries(bridges || {}).filter(([, b]) => b.motion_areas !== null && b.motion_areas !== undefined);

export type AreaState = "off" | "calibrating" | "working" | "problem";

/** How an area does: off, calibrating, working, or a problem (a light is not healthy). */
export function areaState(area: MotionArea): AreaState {
  if (!area.enabled || area.health === "not_running") return "off";
  if (area.calibrating) return "calibrating";
  if (area.health !== "healthy" || area.lights.some((l) => l.health !== null && l.health !== "healthy")) return "problem";
  return "working";
}

/** How far a calibration got (0..1) by the time it started; lights done count fully. */
export function calibrationProgress(area: MotionArea, now: number): number {
  const done = area.lights.length ? area.lights.filter((l) => l.health === "healthy").length / area.lights.length : 0;
  if (done >= 1) return 1;
  const started = area.calibration_started;
  const timed = started ? Math.min(0.95, Math.max(0, (now - started * 1000) / CALIBRATION_MS)) : 0;
  return Math.max(done, timed);
}

/** A room or zone an area can be made in: its sensing lights, and why it cannot. */
export interface GroupChoice {
  group: MotionGroup;
  lights: MotionLight[];
  /** "few": fewer than three lights can sense. */
  reason: "few" | null;
}

/** The bridge's rooms then zones, with the lights of theirs that can sense. */
export function groupChoices(bridge: BridgeInfo): GroupChoice[] {
  const lights = new Map((bridge.motion_lights || []).map((l) => [l.id, l]));
  return [...(bridge.motion_groups || [])]
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "room" ? -1 : 1))
    .map((group) => {
      const own = group.lights.map((id) => lights.get(id)).filter((l): l is MotionLight => !!l && !!l.entity_id);
      return { group, lights: own, reason: own.length < MIN_LIGHTS ? ("few" as const) : null };
    });
}

/** Which other area a light senses for already (light entity id -> area name). */
export function lightsInAreas(bridge: BridgeInfo, except: string | null = null): Map<string, string> {
  const used = new Map<string, string>();
  for (const area of bridge.motion_areas || []) {
    if (area.id === except) continue;
    for (const light of area.lights) if (light.entity_id) used.set(light.entity_id, area.name);
  }
  return used;
}

/** Pick or drop a light: at most four; the first ones stay when a fifth comes. */
export function flipLight(picked: string[], id: string): string[] {
  if (picked.includes(id)) return picked.filter((l) => l !== id);
  return picked.length >= MAX_LIGHTS ? picked : [...picked, id];
}

export const enoughLights = (picked: string[]): boolean => picked.length >= MIN_LIGHTS && picked.length <= MAX_LIGHTS;

/** A name for a new area: its room's, then "<room> 2", … where that is taken. */
export function defaultName(bridge: BridgeInfo, group: MotionGroup): string {
  const taken = new Set((bridge.motion_areas || []).map((a) => a.name));
  if (!taken.has(group.name)) return group.name.slice(0, 32);
  for (let n = 2; ; n++) {
    const name = `${group.name.slice(0, 29)} ${n}`;
    if (!taken.has(name)) return name;
  }
}

/** The Hue app's responses that still switch lights (enabled). */
export const activeResponses = (area: MotionArea): MotionArea["responses"] => area.responses.filter((r) => r.enabled);
