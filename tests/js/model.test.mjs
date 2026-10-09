import assert from "node:assert/strict";
import { test } from "node:test";

import { buildHome, groupState } from "../../custom_components/hue_studio/frontend/model.js";

const light = (state, attrs = {}) => ({ state, attributes: { friendly_name: "x", ...attrs } });

// Office: area with an exact Hue room. Living room: area whose Hue room also spans the
// kitchen, plus a Hue zone inside it. Kitchen: area without its own Hue group.
const hass = {
  areas: {
    office: { name: "Office", icon: "mdi:chair-rolling" },
    living_room: { name: "Living room" },
    kitchen: { name: "Kitchen" },
    empty: { name: "Empty" },
  },
  devices: { d_desk: { area_id: "office" }, d_tv: { area_id: "living_room" }, d_candle: { area_id: "living_room" }, d_bulb: { area_id: "kitchen" } },
  entities: {
    "light.desk": { platform: "hue", device_id: "d_desk" },
    "light.tv_strip": { platform: "hue", device_id: "d_tv" },
    "light.candle": { platform: "hue", device_id: "d_candle" },
    "light.kitchen_bulb": { platform: "hue", device_id: "d_bulb" },
    "light.other": { platform: "demo", area_id: "office" },
    "light.office": { platform: "hue" },
    "light.downstairs": { platform: "hue" },
    "light.tv_zone": { platform: "hue" },
    "scene.office_read": { platform: "hue" },
    "scene.tv_movie": { platform: "hue" },
  },
  states: {
    "light.desk": light("on", { brightness: 128, rgb_color: [255, 100, 0] }),
    "light.tv_strip": light("off"),
    "light.candle": light("off"),
    "light.kitchen_bulb": light("on", { brightness: 255 }),
    "light.other": light("on"),
    "light.office": light("on", { friendly_name: "Office", is_hue_group: true, hue_type: "room", entity_id: ["light.desk"] }),
    "light.downstairs": light("on", {
      friendly_name: "Downstairs",
      is_hue_group: true,
      hue_type: "room",
      entity_id: ["light.tv_strip", "light.candle", "light.kitchen_bulb"],
    }),
    "light.tv_zone": light("off", { friendly_name: "TV", is_hue_group: true, hue_type: "zone", entity_id: ["light.tv_strip"] }),
    "scene.office_read": { state: "unknown", attributes: { group_name: "Office", name: "Read" } },
    "scene.tv_movie": { state: "unknown", attributes: { group_name: "TV", name: "Movie" } },
  },
};

test("rooms come from HA areas, zones from unmatched Hue groups", () => {
  const { rooms, zones } = buildHome(hass);
  assert.deepEqual(rooms.map((r) => r.key), ["area.office", "area.living_room", "area.kitchen"]);

  const [office, living, kitchen] = rooms;
  assert.deepEqual(office.lights, ["light.desk"]);
  assert.equal(office.group, "light.office");
  assert.deepEqual(office.target, ["light.office"]);
  assert.equal(office.icon, "mdi:chair-rolling");
  assert.deepEqual(office.scenes.map((s) => s.entity_id), ["scene.office_read"]);

  // No exact group: commands go to the lights; scenes of the zone inside are offered.
  assert.equal(living.group, null);
  assert.deepEqual(living.target, ["light.tv_strip", "light.candle"]);
  assert.deepEqual(living.scenes.map((s) => s.entity_id), ["scene.tv_movie"]);
  assert.deepEqual(kitchen.target, ["light.kitchen_bulb"]);

  assert.deepEqual(zones.map((z) => z.key), ["hue.light.downstairs", "hue.light.tv_zone"]);
  assert.equal(zones[0].icon, "mdi:home-outline");
  assert.equal(zones[1].icon, "mdi:texture-box");
});

test("group state averages lit lights", () => {
  const { zones } = buildHome(hass);
  const state = groupState(hass, zones[0]);
  assert.equal(state.on, true);
  assert.equal(state.brightness, 100);
  assert.equal(state.colors.length, 1);
});
