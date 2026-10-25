import assert from "node:assert/strict";
import { test } from "node:test";

import { buildHome, glowColor, groupState, hueSensor, sensitivityLevels, splitSensors } from "../../src/model.ts";
import type { HassData, XY } from "../../src/types.ts";

const light = (state: string, attrs = {}) => ({ state, attributes: { friendly_name: "x", ...attrs } });

// Office: area with an exact Hue room. Living room: area whose Hue room also spans the
// kitchen, plus a Hue zone inside it. Kitchen: area without its own Hue group.
const hass: HassData = {
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

import { adaptiveFor } from "../../src/model.ts";
import { resample, smoothPath } from "../../src/color.ts";

test("options map a Hue group onto an area and mark another as a zone", () => {
  const { rooms, zones } = buildHome(hass, { groups: { "light.downstairs": "kitchen", "light.office": "zone" } });
  const kitchen = rooms.find((r) => r.key === "area.kitchen")!;
  assert.equal(kitchen.group, "light.downstairs");
  assert.deepEqual(kitchen.scenes, []);
  // The area keeps its own light and gains the group's; mixed sets go to the lights.
  assert.ok(kitchen.lights.includes("light.kitchen_bulb") && kitchen.lights.includes("light.candle"));
  assert.deepEqual(kitchen.target, ["light.downstairs"]);
  assert.equal(rooms.find((r) => r.key === "area.office")?.group, null);
  assert.ok(zones.some((z) => z.key === "hue.light.office"));
});

test("a zone given to an area that has its room: a zone in that room", () => {
  const h = structuredClone(hass) as Required<HassData>;
  h.states["light.tv_zone"].attributes.entity_id = ["light.desk"];
  h.states["scene.tv_movie"] = { state: "unknown", attributes: { group_name: "TV", name: "Movie" } };
  const { rooms, zones } = buildHome(h, { groups: { "light.tv_zone": "office" } });
  const office = rooms.find((r) => r.key === "area.office")!;
  // The room keeps the group with exactly its lights; the zone's scenes join it.
  assert.equal(office.group, "light.office");
  assert.deepEqual(office.target, ["light.office"]);
  assert.deepEqual(office.scenes.map((s) => s.entity_id), ["scene.office_read", "scene.tv_movie"]);
  assert.ok(!zones.some((z) => z.key === "hue.light.tv_zone"));
});

test("room sensors: defaults from the area, overridable by options", () => {
  const h = structuredClone(hass) as Required<HassData>;
  h.entities["binary_sensor.office_motion"] = { platform: "hue", device_id: "d_desk" };
  h.states["binary_sensor.office_motion"] = { state: "on", attributes: { device_class: "motion" } };
  h.areas.office.temperature_entity_id = "sensor.t1";
  h.states["sensor.t1"] = { state: "21.0", attributes: {} };
  h.states["sensor.t2"] = { state: "23.0", attributes: {} };

  h.entities["sensor.office_lux"] = { platform: "hue", device_id: "d_desk" };
  h.states["sensor.office_lux"] = { state: "40", attributes: { device_class: "illuminance" } };

  let office = buildHome(h).rooms[0];
  assert.deepEqual(office.sensors, { motion: ["binary_sensor.office_motion"], temperature: ["sensor.t1"], illuminance: ["sensor.office_lux"] });
  assert.equal(groupState(h, office).illuminance, 40);
  assert.equal(groupState(h, office).lastMotion, null);
  assert.equal(groupState(h, office).motion, true);
  assert.equal(groupState(h, office).temperature, 21);

  office = buildHome(h, { rooms: { "area.office": { motion: [], temperature: ["sensor.t1", "sensor.t2"] } } }).rooms[0];
  assert.equal(groupState(h, office).temperature, 22);
  assert.equal(groupState(h, office).motion, false);

  // The latest change of a quiet motion sensor is when motion was last seen.
  h.states["binary_sensor.hall_motion"] = { state: "off", last_changed: "2026-01-01T10:00:00Z", attributes: {} };
  h.states["binary_sensor.office_motion"] = { state: "off", last_changed: "2026-01-01T11:00:00Z", attributes: {} };
  office = buildHome(h, { rooms: { "area.office": { motion: ["binary_sensor.hall_motion", "binary_sensor.office_motion"] } } }).rooms[0];
  assert.equal(groupState(h, office).lastMotion, "2026-01-01T11:00:00Z");
});

test("room sensors split into Hue sensor devices (with all their readings and switch) and the rest", () => {
  const h = structuredClone(hass) as Required<HassData>;
  h.devices.d_sensor = { area_id: "office", name: "Hue motion sensor", name_by_user: "Office sensor", model: "Hue outdoor motion sensor" };
  const add = (id: string, entry: object, state: string, attributes = {}) => {
    h.entities[id] = { platform: "hue", device_id: "d_sensor", ...entry };
    h.states[id] = { state, attributes };
  };
  add("binary_sensor.sensor_motion", {}, "off", { device_class: "motion" });
  add("sensor.sensor_temperature", {}, "20.5", { device_class: "temperature" });
  add("sensor.sensor_lux", {}, "12", { device_class: "illuminance" });
  add("sensor.sensor_battery", {}, "80", { device_class: "battery" });
  add("switch.sensor_light_enabled", { translation_key: "light_sensor_enabled" }, "on");
  add("switch.sensor_motion_enabled", { translation_key: "motion_sensor_enabled" }, "on");
  h.entities["sensor.thermostat"] = { platform: "demo", device_id: "d_desk" };
  h.states["sensor.thermostat"] = { state: "22", attributes: { device_class: "temperature" } };

  // The room's temperature comes from the thermostat; the Hue sensor's card still has its own.
  const { devices, rest } = splitSensors(h, { motion: ["binary_sensor.sensor_motion"], temperature: ["sensor.thermostat"], illuminance: ["sensor.sensor_lux"] });
  assert.deepEqual(devices, [
    {
      device: "d_sensor",
      name: "Office sensor",
      icon: "hue-studio:outdoor-motion",
      sensors: { motion: ["binary_sensor.sensor_motion"], temperature: ["sensor.sensor_temperature"], illuminance: ["sensor.sensor_lux"] },
      enabled: "switch.sensor_motion_enabled",
      battery: "sensor.sensor_battery",
    },
  ]);
  // The settings screen finds the same sensor by its device; a light is no sensor.
  assert.deepEqual(hueSensor(h, "d_sensor"), devices[0]);
  assert.equal(hueSensor(h, "d_desk"), null);
  assert.deepEqual(rest, { motion: [], temperature: ["sensor.thermostat"], illuminance: [] });

  // The Hue room's own grouped motion (a service device of HA's `hue`): not picked, no card.
  h.devices.d_room = { area_id: "office", name: "Office", model: "Room", entry_type: "service" };
  h.entities["binary_sensor.office_grouped"] = { platform: "hue", device_id: "d_room" };
  h.states["binary_sensor.office_grouped"] = { state: "off", attributes: { device_class: "motion" } };
  assert.ok(!buildHome(h).rooms[0].sensors.motion.includes("binary_sensor.office_grouped"));
  assert.deepEqual(splitSensors(h, { motion: ["binary_sensor.office_grouped"], temperature: [], illuminance: [] }).devices, []);

  // No Hue sensor among the room's sensors: no cards.
  assert.deepEqual(splitSensors(h, { motion: [], temperature: ["sensor.thermostat"], illuminance: [] }).devices, []);
});

test("motion sensitivity levels are named like the Hue app's", () => {
  assert.deepEqual(sensitivityLevels(2), ["low", "medium", "high"]);
  assert.equal(sensitivityLevels(4)?.length, 5);
  assert.equal(sensitivityLevels(7), null);
});

test("adaptive lighting switches covering a room", () => {
  const h = structuredClone(hass) as Required<HassData>;
  h.entities["switch.al"] = { platform: "adaptive_lighting" };
  h.states["switch.al"] = {
    state: "on",
    attributes: { configuration: { lights: ["light.office", "light.other"] }, manual_control: ["light.office"] },
  };
  const office = buildHome(h).rooms[0];
  assert.deepEqual(adaptiveFor(h, office), [{ switch: "switch.al", on: true, manual: ["light.office"], lights: ["light.office"] }]);
});

test("gradient points fit the fixed point count of a light", () => {
  const pts: XY[] = [[0.6, 0.35], [0.2, 0.3], [0.4, 0.4]];
  assert.deepEqual(resample(pts, 1), [[0.6, 0.35]]);
  assert.equal(resample(pts, 5).length, 5);
  assert.deepEqual(resample(pts, 5)[0], [0.6, 0.35]);
  assert.deepEqual(resample(pts, 5)[4], [0.4, 0.4]);
  assert.equal(resample(pts, 3), pts);
  // A single color is a uniform light: every pin sits on it until dragged apart.
  assert.deepEqual(resample([[0.5, 0.4]], 3), [[0.5, 0.4], [0.5, 0.4], [0.5, 0.4]]);
});

test("gradient line: a smooth curve through every pin, stacked pins skipped", () => {
  const pins: XY[] = [[-0.5, 0], [0, 0.5], [0, 0.5], [0.5, 0]];
  const d = smoothPath(pins);
  assert.ok(d.startsWith("M-0.5000 0.0000"));
  assert.equal(d.match(/C/g)?.length, 2);
  assert.ok(d.endsWith("0.5000 0.0000"));
  assert.equal(smoothPath([[0.1, 0.1], [0.1, 0.1]]), "");
});
test("the page glows in the mean of the lit lights' colors, not at all with none lit", () => {
  assert.equal(glowColor([]), null);
  assert.equal(glowColor(["rgb(255,214,160)"]), "rgb(255, 214, 160)");
  assert.equal(glowColor(["rgb(255, 0, 0)", "rgb(0, 0, 255)"]), "rgb(128, 0, 128)");
});
