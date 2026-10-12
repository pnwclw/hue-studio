import assert from "node:assert/strict";
import { test } from "node:test";

import { allDayDraft, areaFor, daysLine, fromConfig, missing, momentLine, newDraft, offsetDuration, offsetMinutes, toConfig, typeOfPath, whenLine } from "../../src/automations.ts";
import { localize } from "../../src/i18n.ts";

const t = localize(null);

test("a draft becomes a blueprint automation and back", () => {
  const draft = newDraft("wake_up", "Wake up", ["bedroom"], 1_000_000);
  assert.equal(draft.id, "hue_studio_wake_up_lfls");
  assert.equal(draft.input.light, "white");
  const config = toConfig(draft, "link");
  assert.equal(config.use_blueprint?.path, "hue_studio/wake_up.yaml");
  assert.deepEqual(Object.keys(config.use_blueprint!.input).sort(), [
    "brightness", "days", "fade", "kelvin", "light", "off_after", "rooms", "scene_of_the_day", "scenes", "time",
  ]);
  // Inputs of other types are left out.
  const sleep = toConfig({ ...newDraft("go_to_sleep", "Sleep", ["bedroom"]), input: { ...draft.input } }, "");
  assert.deepEqual(Object.keys(sleep.use_blueprint!.input).sort(), ["days", "fade", "rooms", "time"]);
  const back = fromConfig(config)!;
  assert.deepEqual(back, draft);
});

test("configs edited in HA read back with defaults", () => {
  const draft = fromConfig({ id: "x", alias: "Motion", use_blueprint: { path: "hue_studio/motion.yaml", input: { rooms: "office", motion: "binary_sensor.m" } } })!;
  assert.deepEqual(draft.input.rooms, ["office"]);
  assert.deepEqual(draft.input.motion, ["binary_sensor.m"]);
  assert.equal(draft.input.off_after, 15);
  assert.equal(fromConfig({ id: "y", alias: "Other", triggers: [] }), null);
  assert.equal(typeOfPath("someone/else.yaml"), null);
  assert.equal(typeOfPath("hue_studio/unknown.yaml"), null);
});

test("what is missing before saving", () => {
  const draft = newDraft("schedule", "Evening", []);
  assert.equal(missing(draft), "rooms");
  assert.equal(missing({ ...draft, input: { ...draft.input, rooms: ["office"] } }), "scenes");
  assert.equal(missing({ ...draft, input: { ...draft.input, rooms: ["office"], light: "auto" } }), null);
  assert.equal(missing({ ...draft, alias: " " }), "name");
  const motion = newDraft("motion", "Office", ["office"]);
  assert.equal(missing(motion), "motion");
  assert.equal(areaFor(motion), "office");
  assert.equal(areaFor({ ...motion, input: { ...motion.input, rooms: ["a", "b"] } }), null);
});

test("when, in words", () => {
  assert.equal(daysLine(["mon", "tue", "wed", "thu", "fri"], t), "Weekdays");
  assert.equal(daysLine(["sat", "sun"], t), "Weekend");
  assert.equal(daysLine([], t), "Every day");
  assert.equal(daysLine(["wed", "mon"], t), "Mon, Wed");
  assert.equal(momentLine("sunset", undefined, offsetDuration(-30), t), "Sunset −30 min");
  assert.equal(momentLine("time", "07:15:00", undefined, t), "07:15");
  assert.equal(offsetMinutes({ hours: 1, minutes: -15 }), 45);
  const schedule = newDraft("schedule", "Balcony", ["balcony"]);
  schedule.input = { ...schedule.input, start_kind: "sunset", end_kind: "time", end_time: "23:00:00", days: ["sat", "sun"] };
  assert.equal(whenLine(schedule, t), "Sunset – 23:00 · Weekend");
});

test("an all-day scene is a schedule from sunrise showing the scene of the day", () => {
  const draft = allDayDraft("All day", ["office"], 1_000_000);
  assert.equal(draft.type, "schedule");
  assert.equal(draft.input.start_kind, "sunrise");
  assert.equal(draft.input.light, "auto");
  assert.equal(draft.input.end_kind, "none");
  assert.equal(missing(draft), null);
  assert.equal(toConfig(draft, "").use_blueprint?.input?.light, "auto");
});
