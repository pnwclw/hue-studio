import assert from "node:assert/strict";
import { test } from "node:test";

import { allDayDraft, areaFor, controlsGroup, daysLine, fromConfig, missing, momentLine, newDraft, offsetDuration, offsetMinutes, placesOf, roomsLine, toConfig, typeOfPath, whenLine, withPlace } from "../../src/automations.ts";
import { localize } from "../../src/i18n.ts";

const t = localize(null);

test("a draft becomes a blueprint automation and back", () => {
  const draft = newDraft("wake_up", "Wake up", ["area.bedroom"], 1_000_000);
  assert.equal(draft.id, "hue_studio_wake_up_lfls");
  assert.equal(draft.input.light, "white");
  const config = toConfig(draft, "link");
  assert.equal(config.use_blueprint?.path, "hue_studio/wake_up.yaml");
  assert.deepEqual(Object.keys(config.use_blueprint!.input).sort(), [
    "brightness", "days", "fade", "kelvin", "light", "off_after", "rooms", "scene_of_the_day", "scenes", "time", "zones",
  ]);
  // Inputs of other types are left out.
  const sleep = toConfig({ ...newDraft("go_to_sleep", "Sleep", ["area.bedroom"]), input: { ...draft.input } }, "");
  assert.deepEqual(Object.keys(sleep.use_blueprint!.input).sort(), ["days", "fade", "rooms", "time", "zones"]);
  const back = fromConfig(config)!;
  assert.deepEqual(back, draft);
});

test("configs edited in HA read back with defaults", () => {
  const draft = fromConfig({ id: "x", alias: "Motion", use_blueprint: { path: "hue_studio/motion.yaml", input: { rooms: "office", motion: "binary_sensor.m" } } })!;
  assert.deepEqual(draft.input.rooms, ["office"]);
  assert.deepEqual(draft.input.motion, ["binary_sensor.m"]);
  assert.deepEqual(draft.input.zones, []);
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
  const motion = newDraft("motion", "Office", ["area.office"]);
  assert.equal(missing(motion), "motion");
  assert.equal(areaFor(motion), "office");
  assert.equal(areaFor({ ...motion, input: { ...motion.input, rooms: ["a", "b"] } }), null);
  assert.equal(areaFor({ ...motion, input: { ...motion.input, zones: ["light.tv_area"] } }), null);
  // A zone alone is enough.
  assert.equal(missing({ ...draft, input: { ...draft.input, zones: ["light.tv_area"], light: "auto" } }), null);
});

test("when, in words", () => {
  assert.equal(daysLine(["mon", "tue", "wed", "thu", "fri"], t), "Weekdays");
  assert.equal(daysLine(["sat", "sun"], t), "Weekend");
  assert.equal(daysLine([], t), "Every day");
  assert.equal(daysLine(["wed", "mon"], t), "Mon, Wed");
  assert.equal(momentLine("sunset", undefined, offsetDuration(-30), t), "Sunset −30 min");
  assert.equal(momentLine("time", "07:15:00", undefined, t), "07:15");
  assert.equal(offsetMinutes({ hours: 1, minutes: -15 }), 45);
  const schedule = newDraft("schedule", "Balcony", ["area.balcony"]);
  schedule.input = { ...schedule.input, start_kind: "sunset", end_kind: "time", end_time: "23:00:00", days: ["sat", "sun"] };
  assert.equal(whenLine(schedule, t), "Sunset – 23:00 · Weekend");
});

test("an all-day scene is a schedule from sunrise showing the scene of the day", () => {
  const draft = allDayDraft("All day", ["hue.light.tv_area"], 1_000_000);
  assert.equal(draft.type, "schedule");
  assert.equal(draft.input.start_kind, "sunrise");
  assert.equal(draft.input.light, "auto");
  assert.equal(draft.input.end_kind, "none");
  assert.equal(missing(draft), null);
  assert.equal(toConfig(draft, "").use_blueprint?.input?.light, "auto");
});

test("rooms and zones of an automation", () => {
  const draft = newDraft("schedule", "Evening", ["area.office", "hue.light.tv_area"]);
  assert.deepEqual(draft.input.rooms, ["office"]);
  assert.deepEqual(draft.input.zones, ["light.tv_area"]);
  assert.deepEqual(placesOf(draft.input), ["area.office", "hue.light.tv_area"]);
  assert.deepEqual(withPlace(draft.input, "area.office"), { rooms: [], zones: ["light.tv_area"] });
  assert.deepEqual(withPlace(draft.input, "area.balcony"), { rooms: ["office", "balcony"], zones: ["light.tv_area"] });
  const hass = { areas: { office: { area_id: "office", name: "Office" } }, states: { "light.tv_area": { entity_id: "light.tv_area", state: "on", attributes: { friendly_name: "TV area" } } } };
  assert.equal(roomsLine(hass as never, draft.input), "Office, TV area");
  // Listed under a room or zone by what HA reports the automation controls.
  const controls = { areas: ["office"], groups: ["light.tv_area"] };
  assert.equal(controlsGroup(controls, "area.office", "light.office"), true);
  assert.equal(controlsGroup(controls, "hue.light.tv_area", "light.tv_area"), true);
  assert.equal(controlsGroup(controls, "area.balcony", "light.balcony"), false);
  assert.equal(controlsGroup({}, "area.office", null), false);
});
