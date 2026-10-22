import assert from "node:assert/strict";
import { test } from "node:test";

import { presenceCheck, presenceReady } from "../../src/presence.ts";

const hass = (permission: string, trackerState = "home") => ({
  states: {
    "zone.home": { entity_id: "zone.home", state: "2", attributes: { latitude: 52.2, longitude: 21.0, radius: 100 } },
    "person.alex": { entity_id: "person.alex", state: "home", attributes: { friendly_name: "Alex", user_id: "u1", device_trackers: ["device_tracker.alex_phone", "device_tracker.router_alex"] } },
    "person.service": { entity_id: "person.service", state: "unknown", attributes: { friendly_name: "Service", user_id: "u2", device_trackers: [] } },
    "device_tracker.alex_phone": { entity_id: "device_tracker.alex_phone", state: trackerState, attributes: { friendly_name: "Alex phone" } },
    "device_tracker.router_alex": { entity_id: "device_tracker.router_alex", state: "home", attributes: {} },
    "sensor.alex_phone_location_permission": { entity_id: "sensor.alex_phone_location_permission", state: permission, attributes: {} },
  },
  entities: {
    "device_tracker.alex_phone": { platform: "mobile_app", device_id: "d1" },
    "device_tracker.router_alex": { platform: "nmap_tracker" },
    "sensor.alex_phone_location_permission": { platform: "mobile_app", device_id: "d1" },
  },
});

test("arriving and leaving need a home and a phone with location access always", () => {
  const ok = presenceCheck(hass("Authorized Always") as never, "u1");
  assert.equal(ok.home, true);
  assert.deepEqual(ok.people.map((p) => p.person), ["person.alex"]); // no phone, not listed
  assert.deepEqual(ok.people[0].phones.map((p) => p.tracker), ["device_tracker.alex_phone"]); // the router doesn't count
  assert.equal(ok.ready, true);
  assert.equal(presenceReady(ok, true), true);

  // Only while the app is open: HA can't know arriving or leaving.
  const inUse = presenceCheck(hass("Authorized when in use") as never, "u1");
  assert.equal(inUse.people[0].phones[0].issue, "permission");
  assert.equal(inUse.ready, false);
  assert.equal(inUse.me?.person, "person.alex");

  // No location yet (Android reports no permission sensor: the tracker tells).
  const quiet = presenceCheck(hass("unknown", "unknown") as never, "u1");
  assert.equal(quiet.people[0].phones[0].permission, null);
  assert.equal(quiet.people[0].phones[0].issue, "no_location");

  // No home zone.
  const noHome = hass("Authorized Always") as { states: Record<string, unknown> };
  delete noHome.states["zone.home"];
  assert.equal(presenceCheck(noHome as never).ready, false);
});

test("in the companion app, this person's own phone has to be set up too", () => {
  const h = hass("Authorized when in use") as ReturnType<typeof hass>;
  // Someone else's phone works...
  Object.assign(h.states, {
    "person.sam": { entity_id: "person.sam", state: "home", attributes: { friendly_name: "Sam", user_id: "u3", device_trackers: ["device_tracker.sam_phone"] } },
    "device_tracker.sam_phone": { entity_id: "device_tracker.sam_phone", state: "home", attributes: {} },
  });
  Object.assign(h.entities, { "device_tracker.sam_phone": { platform: "mobile_app", device_id: "d3" } });
  const check = presenceCheck(h as never, "u1");
  assert.equal(check.ready, true);
  assert.equal(presenceReady(check, false), true); // a browser: fine
  assert.equal(presenceReady(check, true), false); // Alex's app: Alex's phone first
});
