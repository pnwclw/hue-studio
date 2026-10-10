// Rooms and zones, HA-first: what the panel derives from the alignment plan
// (hue_studio/rooms/subscribe) and from `hass`. Pure functions, no DOM.

import { areaOf, friendlyName, type Group, isHueGroup, isHueLight, scenesOf } from "./model.ts";
import type { HassData, RoomsPlan } from "./types.ts";

/** A light whose Hue room belongs to another area than its own (e.g. moved in the Hue app). */
export interface Mismatch {
  light: string;
  /** Its Hue room's name. */
  hueRoom: string;
  /** The area that Hue room belongs to. */
  hueArea: string;
}

/** Mismatched lights of a room (an HA area): they are here in HA, elsewhere in Hue. */
export function mismatchesIn(plan: RoomsPlan | null, group: Pick<Group, "key" | "kind">): Mismatch[] {
  if (!plan || group.kind !== "area") return [];
  const area = group.key.slice("area.".length);
  return plan.moves
    .filter((m) => m.area === area && m.from_area && m.from)
    .flatMap((m) => m.lights.map((light) => ({ light, hueRoom: m.from!, hueArea: m.from_area! })));
}

/** Hue lights without an HA area, by name. */
export function lightsWithoutArea(hass: HassData): string[] {
  return Object.keys(hass.states)
    .filter((id) => isHueLight(hass, id) && !areaOf(hass, id))
    .sort((a, b) => friendlyName(hass, a).localeCompare(friendlyName(hass, b)));
}

export interface Zone {
  entity_id: string;
  name: string;
  lights: string[];
  scenes: number;
}

/** Hue zones (not rooms) as the native integration exposes them, by name. */
export function hueZones(hass: HassData): Zone[] {
  return Object.keys(hass.states)
    .filter((id) => isHueGroup(hass, id) && hass.states[id].attributes.hue_type === "zone")
    .map((id) => ({
      entity_id: id,
      name: friendlyName(hass, id),
      lights: (hass.states[id].attributes.entity_id || []).filter((l: string) => isHueLight(hass, l)),
      scenes: scenesOf(hass, id).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** All Hue lights grouped by area (area registry order), lights without an area last (key null). */
export function lightsByArea(hass: HassData): [string | null, string[]][] {
  const lights = Object.keys(hass.states)
    .filter((id) => isHueLight(hass, id))
    .sort((a, b) => friendlyName(hass, a).localeCompare(friendlyName(hass, b)));
  const groups: [string | null, string[]][] = Object.keys(hass.areas || {})
    .map((area): [string, string[]] => [area, lights.filter((id) => areaOf(hass, id) === area)])
    .filter(([, ids]) => ids.length > 0);
  const loose = lights.filter((id) => !areaOf(hass, id));
  return loose.length ? [...groups, [null, loose]] : groups;
}

/** Whether the plan asks for anything at all (changes, rooms to delete or conflicts to look at). */
export const planHasNews = (plan: RoomsPlan | null): boolean => !!plan && (plan.changed || plan.empty.length > 0);
