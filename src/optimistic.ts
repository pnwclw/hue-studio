// Optimistic UI: show the expected result of a command immediately, until Home Assistant
// reports it (or a timeout passes). Pure, no DOM.

import { mirekToRgb, xyToRgb } from "./color.ts";
import type { HassData, HassState, ServiceData, XY } from "./types.ts";

/** Expected state of one entity after a command. */
export interface Patch {
  state?: string;
  attributes?: Record<string, unknown>;
}

export type Patches = Map<string, Patch>;

const TTL_MS = 5000;

/** Light ids a target refers to: Hue groups expand to their members (and stay themselves). */
export function expandTargets(hass: HassData, entityIds: string | string[] | undefined): string[] {
  const ids = [entityIds].flat().filter((id): id is string => !!id);
  const out = new Set<string>();
  for (const id of ids) {
    out.add(id);
    const attrs = hass.states[id]?.attributes;
    if (attrs?.is_hue_group) for (const m of attrs.entity_id || []) out.add(m);
  }
  return [...out];
}

/** Expected state patches of a service call: Map entity_id -> {state?, attributes?}. */
export function predict(hass: HassData, domain: string, service: string, data: ServiceData = {}): Patches {
  const patches: Patches = new Map();
  const ids = expandTargets(hass, data.entity_id);
  if (domain === "light" && service === "turn_off") ids.forEach((id) => patches.set(id, { state: "off" }));
  if (domain === "light" && service === "toggle") {
    const anyOn = [data.entity_id].flat().some((id) => !!id && hass.states[id]?.state === "on");
    ids.forEach((id) => patches.set(id, { state: anyOn ? "off" : "on" }));
  }
  if (domain === "light" && service === "turn_on") {
    const attributes: Record<string, unknown> = {};
    const { brightness_pct, xy_color, color_temp_kelvin } = data as { brightness_pct?: number; xy_color?: XY; color_temp_kelvin?: number };
    if (brightness_pct != null) attributes.brightness = Math.round(brightness_pct * 2.55);
    if (xy_color) Object.assign(attributes, { xy_color, rgb_color: xyToRgb(...xy_color), color_mode: "xy" });
    if (color_temp_kelvin) {
      const mirek = 1e6 / color_temp_kelvin;
      Object.assign(attributes, { color_temp_kelvin, rgb_color: mirekToRgb(mirek), color_mode: "color_temp" });
    }
    ids.forEach((id) => patches.set(id, { state: "on", attributes }));
  }
  if (domain === "hue_studio") ids.forEach((id) => patches.set(id, { state: "on" }));
  return patches;
}

const close = (a: number | null | undefined, b: number | null | undefined, eps: number): boolean => a != null && b != null && Math.abs(a - b) <= eps;

/** Has HA caught up with the patch? */
function confirmed(real: HassState, patch: Patch): boolean {
  if (patch.state && real.state !== patch.state) return false;
  const want = (patch.attributes || {}) as { brightness?: number; xy_color?: XY; color_temp_kelvin?: number };
  const have = real.attributes || {};
  if (want.brightness != null && !close(have.brightness, want.brightness, 3)) return false;
  if (want.xy_color && !(close(have.xy_color?.[0], want.xy_color[0], 0.01) && close(have.xy_color?.[1], want.xy_color[1], 0.01))) {
    return false;
  }
  if (want.color_temp_kelvin && !close(have.color_temp_kelvin, want.color_temp_kelvin, 60)) return false;
  return true;
}

export class Optimistic {
  readonly items = new Map<string, { patch: Patch; until: number }>();

  readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** Remember the predicted patches of a service call. */
  add(patches: Patches): void {
    const until = this.now() + TTL_MS;
    for (const [id, patch] of patches) {
      const prev = this.items.get(id)?.patch;
      // Later commands win, but keep e.g. "on" from a toggle when only brightness follows.
      const merged = prev ? { ...prev, ...patch, attributes: { ...prev.attributes, ...patch.attributes } } : patch;
      this.items.set(id, { patch: merged, until });
    }
  }

  /** `hass` with pending patches applied; confirmed or expired ones are dropped. */
  apply<H extends Pick<HassData, "states">>(hass: H): H {
    if (!this.items.size) return hass;
    const now = this.now();
    let states: HassData["states"] | null = null;
    for (const [id, { patch, until }] of this.items) {
      const real = hass.states[id];
      if (!real || until < now || confirmed(real, patch)) {
        this.items.delete(id);
        continue;
      }
      states ??= { ...hass.states };
      states[id] = { ...real, state: patch.state ?? real.state, attributes: { ...real.attributes, ...patch.attributes } };
    }
    return states ? { ...hass, states } : hass;
  }
}
