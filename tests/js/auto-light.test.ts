import assert from "node:assert/strict";
import { test } from "node:test";

import { autoAreas, candidateAreas, isMonthDay, phaseCounts, poolOf, stepsOf } from "../../src/auto-light.ts";
import type { AutoLightConfig, AutoLightMessage, HassData } from "../../src/types.ts";

const config: AutoLightConfig = {
  pools: {
    day: { all: { clear: [["a"], ["b"], ["c", "d"], ["e"]], gloomy: [["a"], ["b"], ["c", "d"], ["e"]] } },
    evening: { all: { clear: ["x", "y"], gloomy: ["z"] }, winter: { clear: ["w"] } },
  },
  holidays: [],
  names: {},
  excluded: [],
  offsets: {},
  settings: {},
  control: "auto",
};

test("pools by phase, season and step", () => {
  assert.deepEqual(poolOf(config, { phase: "day", season: "all", step: "2" }), ["c", "d"]);
  assert.deepEqual(poolOf(config, { phase: "evening", season: "all", step: "gloomy" }), ["z"]);
  assert.deepEqual(poolOf(config, { phase: "evening", season: "summer", step: "clear" }), []);
  assert.deepEqual(poolOf(undefined, { phase: "night", season: "all", step: "clear" }), []);
  assert.deepEqual(stepsOf("day"), ["0", "1", "2", "3"]);
  assert.deepEqual(stepsOf("night"), ["clear", "gloomy"]);
  // The day's steps count once (both moods share them).
  assert.deepEqual(phaseCounts(config), { morning: 0, day: 5, golden: 0, evening: 4, night: 0 });
});

test("areas with and without auto light", () => {
  const hass: HassData = {
    areas: { office: { name: "Office" }, kitchen: { name: "Kitchen" }, hall: { name: "Hall" } },
    entities: { "light.a": { platform: "hue", area_id: "office" }, "light.b": { platform: "hue", area_id: "kitchen" } },
    states: { "light.a": { state: "on", attributes: {} }, "light.b": { state: "on", attributes: {} } },
  };
  const msg = { areas: { office: config }, state: {}, entities: {} } as AutoLightMessage;
  assert.deepEqual(autoAreas(hass, msg), ["office"]);
  assert.deepEqual(candidateAreas(hass, msg), ["kitchen"]);
});

test("month-day values", () => {
  assert.equal(isMonthDay("12-24"), true);
  assert.equal(isMonthDay("02-30"), false);
  assert.equal(isMonthDay("1-1"), false);
});
