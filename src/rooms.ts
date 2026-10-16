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

// Several bridges: each is its own Hue system (rooms, zones, scenes, entertainment areas
// stay on one bridge), and an area belongs to one bridge. The panel names bridges only
// when there is more than one.

/** Whether Hue Studio has more than one bridge (then the panel says which one has what). */
export const severalBridges = (plan: RoomsPlan | null): boolean => Object.keys(plan?.bridges || {}).length > 1;

/** The bridge (native hue entry id) of a light, Hue room/zone or scene entity, if known. */
export const bridgeOf = (plan: RoomsPlan | null, entityId: string): string | null => plan?.bridge_of?.[entityId] ?? null;

/** A bridge's name, if known. */
export const bridgeName = (plan: RoomsPlan | null, id: string | null | undefined): string | null => (id && plan?.bridges?.[id]) || null;

/** Lights by the bridge they are on, the bridge with most of them first (ties: the plan's order). */
export function lightsByBridge(plan: RoomsPlan | null, lights: string[]): [string, string[]][] {
  const order = Object.keys(plan?.bridges || {});
  const by = new Map<string, string[]>();
  for (const light of lights) {
    const bridge = bridgeOf(plan, light);
    if (bridge) by.set(bridge, [...(by.get(bridge) || []), light]);
  }
  return [...by].sort(([a, x], [b, y]) => y.length - x.length || order.indexOf(a) - order.indexOf(b));
}

/** The bridge a room or zone is on: the one most of its lights are on, else its Hue group's. */
export function groupBridge(plan: RoomsPlan | null, group: Pick<Group, "lights" | "group">): string | null {
  return lightsByBridge(plan, group.lights)[0]?.[0] ?? (group.group ? bridgeOf(plan, group.group) : null);
}

/** The areas of a bridge's rooms after alignment, in the plan's order. */
export const bridgeAreas = (plan: RoomsPlan | null, bridge: string): string[] => [
  ...new Set((plan?.rooms || []).filter((r) => r.bridge === bridge && r.lights.length).map((r) => r.area)),
];
