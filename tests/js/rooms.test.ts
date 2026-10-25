import assert from "node:assert/strict";
import { test } from "node:test";

import { buildHome } from "../../src/model.ts";
import {
  bridgeAreas,
  bridgeRoomAreas,
  bridgeName,
  bridgeOf,
  groupBridge,
  hueZones,
  lightsByArea,
  lightsByBridge,
  lightsWithoutArea,
  mismatchesIn,
  planHasNews,
  severalBridges,
} from "../../src/rooms.ts";
import type { HassData, RoomsPlan } from "../../src/types.ts";

const light = (name: string, attrs = {}) => ({ state: "on", attributes: { friendly_name: name, ...attrs } });

const hass: HassData = {
  areas: { office: { name: "Office" }, bedroom: { name: "Bedroom" } },
  devices: { d_desk: { area_id: "office" }, d_lamp: { area_id: "office" }, d_garland: { area_id: "bedroom" }, d_spot: {} },
  entities: {
    "light.desk": { platform: "hue", device_id: "d_desk" },
    "light.lamp": { platform: "hue", device_id: "d_lamp" },
    "light.garland": { platform: "hue", device_id: "d_garland" },
    "light.spot": { platform: "hue", device_id: "d_spot" },
    "light.tree": { platform: "hue" },
    "light.bedroom": { platform: "hue" },
    "light.duo": { platform: "hue" },
    "scene.tree_glow": { platform: "hue" },
  },
  states: {
    "light.desk": light("Desk"),
    "light.lamp": light("Lamp"),
    "light.garland": light("Garland"),
    "light.spot": light("Spot"),
    // A zone and a room over the same light (after alignment the room wins).
    "light.tree": light("Tree", { is_hue_group: true, hue_type: "zone", entity_id: ["light.garland"] }),
    "light.bedroom": light("Bedroom", { is_hue_group: true, hue_type: "room", entity_id: ["light.garland"] }),
    "light.duo": light("Duo", { is_hue_group: true, hue_type: "zone", entity_id: ["light.desk", "light.garland"] }),
    "scene.tree_glow": { state: "unknown", attributes: { group_name: "Tree", name: "Glow" } },
  },
};

const plan: RoomsPlan = {
  changed: true,
  rooms: [],
  moves: [
    { lights: ["light.lamp"], area: "office", from: "Bedroom", from_group: "light.bedroom", from_area: "bedroom" },
    { lights: ["light.desk"], area: "office", from: null, from_group: null, from_area: null },
  ],
  empty: [],
  scenes: [],
  conflicts: [],
  splits: [],
  hue_rooms: {},
};

test("mismatches: lights here in HA that sit in another area's Hue room", () => {
  const office = { key: "area.office", kind: "area" as const };
  assert.deepEqual(mismatchesIn(plan, office), [{ light: "light.lamp", hueRoom: "Bedroom", hueArea: "bedroom" }]);
  assert.deepEqual(mismatchesIn(plan, { key: "area.bedroom", kind: "area" }), []);
  assert.deepEqual(mismatchesIn(plan, { key: "hue.light.duo", kind: "hue" }), []);
  assert.deepEqual(mismatchesIn(null, office), []);
});

test("lights without an area, zones and lights by area", () => {
  assert.deepEqual(lightsWithoutArea(hass), ["light.spot"]);
  assert.deepEqual(
    hueZones(hass).map((z) => [z.entity_id, z.lights, z.scenes]),
    [
      ["light.duo", ["light.desk", "light.garland"], 0],
      ["light.tree", ["light.garland"], 1],
    ],
  );
  assert.deepEqual(lightsByArea(hass), [
    ["office", ["light.desk", "light.lamp"]],
    ["bedroom", ["light.garland"]],
    [null, ["light.spot"]],
  ]);
});

test("a Hue room is preferred over a zone with the same lights", () => {
  const bedroom = buildHome(hass).rooms.find((r) => r.key === "area.bedroom");
  assert.equal(bedroom?.group, "light.bedroom");
});

test("plan news", () => {
  assert.equal(planHasNews(null), false);
  assert.equal(planHasNews(plan), true);
  assert.equal(planHasNews({ ...plan, changed: false }), false);
  assert.equal(planHasNews({ ...plan, changed: false, empty: [{ name: "Old", group: null, scenes: 0 }] }), true);
});

test("several bridges: which bridge has what", () => {
  const two: RoomsPlan = {
    ...plan,
    rooms: [
      { area: "office", name: "Office", create: false, rename: false, current_name: "Office", group: "light.office", lights: ["light.desk", "light.lamp"], bridge: "a" },
      { area: "office", name: "Office", create: true, rename: false, current_name: null, group: null, lights: ["light.spot"], bridge: "b" },
      { area: "balcony", name: "Balcony", create: false, rename: false, current_name: "Balcony", group: "light.balcony", lights: ["light.globe"], bridge: "b" },
      { area: "hall", name: "Hall", create: false, rename: false, current_name: "Hall", group: "light.hall", lights: [], bridge: "b" },
    ],
    bridges: { a: "Upstairs", b: "Garden" },
    bridge_of: { "light.desk": "a", "light.lamp": "a", "light.spot": "b", "light.globe": "b", "light.office": "a", "light.tv_zone": "b" },
    split_areas: { office: ["a", "b"] },
  };
  assert.equal(severalBridges(two), true);
  assert.equal(severalBridges(plan), false);
  assert.equal(severalBridges(null), false);
  assert.equal(bridgeOf(two, "light.spot"), "b");
  assert.equal(bridgeOf(two, "light.unknown"), null);
  assert.equal(bridgeName(two, "b"), "Garden");
  assert.equal(bridgeName(two, null), null);
  // Most lights first; ties keep the plan's order of bridges.
  assert.deepEqual(lightsByBridge(two, ["light.spot", "light.desk", "light.lamp"]), [["a", ["light.desk", "light.lamp"]], ["b", ["light.spot"]]]);
  assert.deepEqual(lightsByBridge(two, ["light.spot", "light.desk"]).map(([b]) => b), ["a", "b"]);
  assert.equal(groupBridge(two, { lights: ["light.spot", "light.desk", "light.lamp"], group: null }), "a");
  // A zone without lights the plan knows: its Hue group's bridge.
  assert.equal(groupBridge(two, { lights: [], group: "light.tv_zone" }), "b");
  assert.equal(groupBridge(two, { lights: [], group: null }), null);
  // Rooms of a bridge: areas with lights on it, once each.
  assert.deepEqual(bridgeAreas(two, "b"), ["office", "balcony"]);
  assert.deepEqual(bridgeAreas(two, "a"), ["office"]);
  // Where a new device of an area goes: its Hue room, empty ones too (by name when no area has it).
  const areas = { office: { name: "Office" }, balcony: { name: "Balcony" }, hall: { name: "Hall" }, study: { name: "Study" } };
  const emptied = { ...two, empty: [{ name: "Study", group: "light.study", scenes: 2 }], bridge_of: { ...two.bridge_of, "light.study": "a" } };
  assert.deepEqual(bridgeRoomAreas(emptied, "b", areas), ["office", "balcony", "hall"]);
  assert.deepEqual(bridgeRoomAreas(emptied, "a", areas), ["office", "study"]);
});
