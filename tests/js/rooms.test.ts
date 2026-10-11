import assert from "node:assert/strict";
import { test } from "node:test";

import { buildHome } from "../../src/model.ts";
import { hueZones, lightsByArea, lightsWithoutArea, mismatchesIn, planHasNews } from "../../src/rooms.ts";
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
