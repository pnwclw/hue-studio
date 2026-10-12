import assert from "node:assert/strict";
import { test } from "node:test";

import { dayConfig, isMonthDay, phaseCounts, poolOf, stepsOf, withExcluded, withOffset, withPool, withSettings } from "../../src/daylight.ts";
import type { DayConfig } from "../../src/types.ts";

const config: DayConfig = {
  pools: {
    day: { all: { clear: [["a"], ["b"], ["c", "d"], ["e"]], gloomy: [["a"], ["b"], ["c", "d"], ["e"]] } },
    evening: { all: { clear: ["x", "y"], gloomy: ["z"] }, winter: { clear: ["w"] } },
  },
  holidays: [],
  excluded: [],
  offsets: {},
  settings: {},
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

test("editing pools, exclusions, offsets and settings", () => {
  const empty = dayConfig(null);
  const day = withPool(empty, { phase: "day", season: "all", step: "1" }, ["a", "a", "b"]);
  assert.deepEqual(day.pools.day.all, { clear: [[], ["a", "b"], [], []], gloomy: [[], ["a", "b"], [], []] });
  assert.deepEqual(empty.pools, {}, "the original stays as it was");
  const evening = withPool(day, { phase: "evening", season: "winter", step: "gloomy" }, ["w"]);
  assert.deepEqual(poolOf(evening, { phase: "evening", season: "winter", step: "gloomy" }), ["w"]);
  assert.deepEqual(withExcluded(withExcluded(empty, "a", true), "a", false).excluded, []);
  assert.deepEqual(withOffset(empty, "night", 80).offsets, { night: 60 });
  assert.deepEqual(withOffset(withOffset(empty, "night", 10), "night", 0).offsets, {});
  const s = withSettings(withSettings(empty, { weather: "weather.home", night_from: "22:00" }), { weather: null });
  assert.deepEqual(s.settings, { night_from: "22:00" });
});

test("month-day values", () => {
  assert.equal(isMonthDay("12-24"), true);
  assert.equal(isMonthDay("02-30"), false);
  assert.equal(isMonthDay("1-1"), false);
});
