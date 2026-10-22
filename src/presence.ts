// Whether Home Assistant knows who is home, before an automation relies on it (coming
// home, leaving home): the home zone, people with a phone running the companion app, and
// that phone's location access ("Always", which arriving and leaving need in the
// background). HA-first: everything is read from what HA has, nothing of our own.
// Pure functions, no DOM.

import type { HassData } from "./types.ts";

export type PhoneIssue = "permission" | "no_location" | null;

export interface PhoneCheck {
  /** The companion app's device tracker. */
  tracker: string;
  name: string;
  /** What the app reports for its location access (iOS: "Authorized Always", …); null: not reported. */
  permission: string | null;
  issue: PhoneIssue;
}

export interface PersonCheck {
  person: string;
  name: string;
  /** HA's user of the person (the one signed in here, for "this phone"). */
  user: string | null;
  phones: PhoneCheck[];
  ok: boolean;
}

export interface PresenceCheck {
  /** HA's home zone with its location. */
  home: boolean;
  people: PersonCheck[];
  /** The person signed in here, when there is one. */
  me: PersonCheck | null;
  /** Arriving and leaving can be known: a home, and someone whose phone reports it. */
  ready: boolean;
}

const name = (hass: HassData, id: string): string => (hass.states[id]?.attributes.friendly_name as string | undefined) || id;

/** A phone's location access is enough to know arriving and leaving with the app closed. */
export const permissionOk = (state: string): boolean => /always/i.test(state);

/** One phone: its tracker reports a location, and its location access (when the app reports it) is "Always". */
function phoneCheck(hass: HassData, tracker: string): PhoneCheck {
  const device = hass.entities?.[tracker]?.device_id;
  const sensor = device
    ? Object.keys(hass.entities || {}).find(
        (id) => id.startsWith("sensor.") && id.endsWith("_location_permission") && hass.entities?.[id]?.device_id === device,
      )
    : undefined;
  const reported = sensor ? hass.states[sensor]?.state : undefined;
  const permission = reported && reported !== "unknown" && reported !== "unavailable" ? reported : null;
  const state = hass.states[tracker]?.state;
  const issue: PhoneIssue = permission && !permissionOk(permission) ? "permission" : !state || state === "unknown" || state === "unavailable" ? "no_location" : null;
  return { tracker, name: name(hass, tracker), permission, issue };
}

/**
 * What HA has for knowing who is home. Phones are the people's trackers from the
 * companion app (`mobile_app`); other trackers (a router, Bluetooth) don't count.
 */
export function presenceCheck(hass: HassData, userId?: string | null): PresenceCheck {
  const zone = hass.states["zone.home"];
  const home = !!zone && zone.attributes.latitude != null && zone.attributes.longitude != null;
  const people = Object.keys(hass.states)
    .filter((id) => id.startsWith("person."))
    .map((person): PersonCheck => {
      const attrs = hass.states[person].attributes;
      const trackers = ((attrs.device_trackers as string[] | undefined) || []).filter((id) => hass.entities?.[id]?.platform === "mobile_app");
      const phones = trackers.map((id) => phoneCheck(hass, id));
      return { person, name: name(hass, person), user: (attrs.user_id as string | undefined) || null, phones, ok: phones.some((p) => !p.issue) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const me = (userId && people.find((p) => p.user === userId)) || null;
  // Only people with a phone are listed (a login for a service has none).
  return { home, people: people.filter((p) => p.phones.length), me, ready: home && people.some((p) => p.ok) };
}

/**
 * Ready to set up arriving and leaving: HA's check, and in the companion app also this
 * person's own devices (their settings are the ones they can fix right here): one reports
 * a location, and none has its location access cut to "while in use".
 */
export function presenceReady(check: PresenceCheck, inApp: boolean): boolean {
  const me = check.me;
  return check.ready && (!inApp || !me || (me.ok && me.phones.every((p) => p.issue !== "permission")));
}
