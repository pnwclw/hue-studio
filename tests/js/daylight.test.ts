import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dayConfig,
  hasOwnPhases,
  isLegacy,
  phaseTimes,
  scenesOf,
  splitLegacy,
  tagsFor,
  viewCounts,
  withExcluded,
  withIncluded,
  withOffset,
  withOwnPhases,
  withSettings,
  withTag,
} from "../../src/daylight.ts";
import type { SceneTags } from "../../src/types.ts";

test("an automation's extra and skipped scenes, offsets and settings", () => {
  const empty = dayConfig(null);
  const extra = withIncluded(empty, "a", true);
  assert.deepEqual([extra.include, extra.exclude], [["a"], []]);
  // Skipping a scene takes it out of the extra ones, and the other way round.
  const skipped = withExcluded(extra, "a", true);
  assert.deepEqual([skipped.include, skipped.exclude], [[], ["a"]]);
  assert.deepEqual(withIncluded(skipped, "a", true).exclude, []);
  assert.deepEqual(withExcluded(skipped, "a", false).exclude, []);
  assert.deepEqual(empty.include, [], "the original stays as it was");
  assert.deepEqual(withOffset(empty, "night", 80).offsets, { night: 60 });
  assert.deepEqual(withOffset(withOffset(empty, "night", 10), "night", 0).offsets, {});
  const s = withSettings(withSettings(empty, { gradient_mode: "random_pixelated", night_from: "22:00" }), { gradient_mode: null });
  assert.deepEqual(s.settings, { night_from: "22:00" });
});

test("own phase times start from the global ones", () => {
  const global = { night_from: "22:30", shifts: { day: 30 } };
  const own = withOwnPhases(dayConfig(null), true, global);
  assert.equal(hasOwnPhases(own.settings), true);
  assert.deepEqual(phaseTimes(own.settings, { night_from: "01:00" }), {
    night_from: "22:30",
    shifts: { morning: 0, day: 30, golden: 50, evening: 0 },
  });
  const back = withOwnPhases(own, false, global);
  assert.equal(hasOwnPhases(back.settings), false);
  assert.equal(phaseTimes(back.settings, global).night_from, "22:30");
  assert.equal(phaseTimes({}, undefined).night_from, "23:00");
});

test("scene tags", () => {
  let tags: SceneTags = {};
  tags = withTag(tags, "seasons", "winter", true);
  tags = withTag(tags, "phases", "night", true);
  tags = withTag(tags, "phases", "morning", true);
  assert.deepEqual(tags, { phases: ["morning", "night"], seasons: ["winter"] });
  assert.deepEqual(withTag(tags, "seasons", "winter", false), { phases: ["morning", "night"] });
});

test("the pool by phase, season and mood", () => {
  const tags: Record<string, SceneTags> = {
    a: { phases: ["evening"] },
    b: { phases: ["evening"], seasons: ["winter"] },
    c: { moods: ["party"] },
    d: { phases: ["day"], moods: ["party"] },
  };
  const order = ["a", "b", "c", "d", "e"];
  assert.deepEqual(scenesOf({ phase: "evening", season: null }, tags, order), ["a", "b"]);
  assert.deepEqual(scenesOf({ phase: "evening", season: "summer" }, tags, order), ["a"]);
  assert.deepEqual(scenesOf({ mood: "party" }, tags, order), ["c", "d"]);
  assert.deepEqual(scenesOf({ out: true }, tags, order), ["e"]);
  assert.deepEqual(viewCounts(tags), { evening: 2, party: 2, day: 1 });
  // Added while summer is shown: it gets the phase and fits summer too.
  assert.deepEqual(tagsFor({ phase: "evening", season: "summer" }, tags.b, true), { phases: ["evening"], seasons: ["winter", "summer"] });
  assert.deepEqual(tagsFor({ phase: "evening", season: null }, tags.b, false), { seasons: ["winter"] });
  assert.deepEqual(tagsFor({ mood: "cozy" }, {}, true), { moods: ["cozy"] });
});

test("pools of an automation from before 0.10", () => {
  const old = {
    pools: { evening: { all: { clear: ["a"] } } },
    holidays: [{ from: "12-24", to: "12-26", phases: ["evening" as const], pool: ["x"] }],
    excluded: ["b"],
    offsets: { evening: 10 },
    settings: { weather: "weather.home", night_from: "22:00", brightness: { day: 80 } },
  };
  assert.equal(isLegacy(old), true);
  assert.equal(isLegacy(dayConfig(null)), false);
  const split = splitLegacy(old);
  assert.deepEqual(split.sources, { weather: "weather.home" });
  assert.deepEqual(split.pools, old.pools);
  assert.deepEqual(split.holidays, old.holidays);
  assert.deepEqual(split.local, {
    include: [],
    exclude: ["b"],
    offsets: { evening: 10 },
    settings: { night_from: "22:00", brightness: { day: 80 } },
  });
  assert.equal(isLegacy(split.local), false);
});
