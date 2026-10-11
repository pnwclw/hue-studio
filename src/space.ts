// Where lights stand in a room (hue_studio/positions/subscribe) and the editor's
// coordinate mapping. Pure functions, no DOM.
//
// Room coordinates are the bridge's entertainment ones: x left (-1) to right (1), y back
// (-1) to front (1), z floor (-1) to ceiling (1). The editor shows a top view with the
// front at the top.

import type { PositionsMessage, RoomPoint } from "./types.ts";

/** Positions of every light of every area (entity id -> points). */
export function allPositions(msg: PositionsMessage | null): Record<string, RoomPoint[]> {
  const out: Record<string, RoomPoint[]> = {};
  for (const area of Object.values(msg || {})) {
    for (const [id, light] of Object.entries(area.lights)) if (light.positions.length) out[id] = light.positions;
  }
  return out;
}

/** Whether a palette can be laid out by position over these lights (two placed at least). */
export const canSpread = (msg: PositionsMessage | null, lights: string[]): boolean => {
  const placed = allPositions(msg);
  return lights.filter((id) => placed[id]).length >= 2;
};

const clamp = (v: number): number => Math.min(1, Math.max(-1, v));

/** Room point -> top-view percentages ({left, top}, 0-100). */
export const toView = ([x, y]: RoomPoint): { left: number; top: number } => ({ left: ((x + 1) / 2) * 100, top: ((1 - y) / 2) * 100 });

/** A spot in the top view (fractions 0-1 of its width/height) -> room x and y. */
export const fromView = (fx: number, fy: number): [number, number] => [clamp(fx * 2 - 1), clamp(1 - fy * 2)];

/** Round to the bridge's precision (5 decimals) so saved values compare equal. */
export const roundPoint = (p: RoomPoint): RoomPoint => p.map((v) => Math.round(clamp(v) * 1e5) / 1e5) as RoomPoint;

/** Where a newly placed light goes: the middle, a little off for each one already there. */
export const newPoint = (placed: number): RoomPoint => [clamp(-0.6 + (placed % 4) * 0.4), clamp(0.2 - Math.floor(placed / 4) * 0.4), 0];
