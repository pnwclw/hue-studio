import assert from "node:assert/strict";
import { test } from "node:test";

import { categoryShown, inWindow, isMonthDay, monthDay, sameRule, seasonEntity, seasonNow, shownCategories } from "../../src/seasons.ts";

const NO_SEASON = { states: {}, entities: {} };
const WITH_SEASON = {
  states: { "sensor.season": { entity_id: "sensor.season", state: "winter", attributes: {} } },
  entities: { "sensor.season": { entity_id: "sensor.season", platform: "season" } },
};
const CATEGORIES = ["defaults", "halloween", "winter_holidays", "refreshing", "vibrant", "rustic", "winter_whisper"].map((id) => ({ id }));

test("month-day values and windows, including one over the new year", () => {
  assert.equal(monthDay(new Date(2026, 9, 5)), "10-05");
  assert.ok(isMonthDay("02-29") && !isMonthDay("13-01") && !isMonthDay("1-5"));
  assert.ok(inWindow("10-31", ["10-01", "11-02"]));
  assert.ok(!inWindow("11-03", ["10-01", "11-02"]));
  assert.ok(inWindow("12-24", ["12-01", "01-06"]) && inWindow("01-06", ["12-01", "01-06"]));
  assert.ok(!inWindow("01-07", ["12-01", "01-06"]));
});

test("the season comes from the Season integration, else by month", () => {
  assert.equal(seasonEntity(WITH_SEASON as never), "sensor.season");
  assert.equal(seasonNow(WITH_SEASON as never, new Date(2026, 6, 1)), "winter");
  assert.equal(seasonNow(NO_SEASON as never, new Date(2026, 6, 1)), "summer");
  assert.equal(seasonNow(NO_SEASON as never, new Date(2026, 9, 12)), "autumn");
});

test("all categories unless seasonal", () => {
  assert.equal(shownCategories(CATEGORIES, {}, NO_SEASON as never, new Date(2026, 6, 1)).length, CATEGORIES.length);
  assert.ok(categoryShown("halloween", { seasonal: false }, "summer", new Date(2026, 6, 1)));
});

test("seasonal: everyday always, holidays in their window, seasons in season", () => {
  const october = shownCategories(CATEGORIES, { seasonal: true }, NO_SEASON as never, new Date(2026, 9, 12));
  assert.deepEqual(october, ["defaults", "halloween", "rustic"]);
  const christmas = shownCategories(CATEGORIES, { seasonal: true }, NO_SEASON as never, new Date(2026, 11, 24));
  assert.deepEqual(christmas, ["defaults", "winter_holidays", "winter_whisper"]);
});

test("the user's rules replace the defaults: always, seasons, dates, or both", () => {
  const october = new Date(2026, 9, 12);
  const rules = {
    halloween: { window: ["10-25", "11-01"] as [string, string] },
    rustic: {},
    defaults: { seasons: ["winter" as const] },
    romantic: { seasons: ["summer" as const], window: ["02-10", "02-15"] as [string, string] },
  };
  const options = { seasonal: true, rules };
  assert.ok(!categoryShown("halloween", options, "autumn", october));
  assert.ok(categoryShown("rustic", options, "spring", october));
  assert.ok(!categoryShown("defaults", options, "autumn", october));
  assert.ok(categoryShown("romantic", options, "winter", new Date(2026, 1, 14)));
  assert.ok(categoryShown("romantic", options, "summer", new Date(2026, 6, 1)));
  assert.ok(!categoryShown("romantic", options, "autumn", october));
});

test("rules compare by meaning", () => {
  assert.ok(sameRule({ seasons: ["winter", "spring"] }, { seasons: ["spring", "winter"] }));
  assert.ok(!sameRule({}, { seasons: ["winter"] }));
  assert.ok(sameRule({ window: ["10-01", "11-02"] }, { window: ["10-01", "11-02"] }));
});
