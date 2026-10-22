import assert from "node:assert/strict";
import { test } from "node:test";

import { allDayDraft, areaFor, cardLines, controlsGroup, pickedOf, withGroup, withLight, daysLine, fromConfig, isOurAutomation, lightLine, missing, momentLine, newDraft, offsetDuration, offsetMinutes, placesOf, roomsLine, summaryRows, toConfig, typeOfPath, whenLine, withPlace } from "../../src/automations.ts";
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

test("an automation's card: the time before the name, the days under it (the Hue app's)", () => {
  const wake = newDraft("wake_up", "Wake up", ["area.office"]);
  wake.input = { ...wake.input, time: "07:00:00", days: ["mon", "tue", "wed", "thu", "fri"] };
  assert.deepEqual(cardLines(wake, "Wake up", t), { title: "07:00 • Wake up", sub: "Weekdays" });
  const motion = newDraft("motion", "Office light", ["area.office"]);
  assert.deepEqual(cardLines(motion, "Office light", t), { title: "Office light", sub: "On motion" });
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
  // Some lights of a room: listed under that room.
  assert.equal(controlsGroup({ lights: ["light.desk"] }, "area.office", null, ["light.desk", "light.lamp"]), true);
  assert.equal(controlsGroup({ lights: ["light.desk"] }, "area.balcony", null, ["light.garland"]), false);
});

test("lights of a room are picked like in the Hue app's picker", () => {
  const office = { key: "area.office", lights: ["light.desk", "light.lamp", "light.strip"] };
  const zone = { key: "hue.light.tv_area", lights: ["light.desk"] };
  let input = newDraft("go_to_sleep", "Sleep", ["area.office"]).input;
  assert.equal(pickedOf(input, office), "all");
  // One light out of the whole room: the others stay as single lights.
  input = { ...input, ...withLight(input, office, "light.lamp") };
  assert.deepEqual(input.rooms, []);
  assert.deepEqual(input.zones, ["light.desk", "light.strip"]);
  assert.deepEqual(pickedOf(input, office), ["light.desk", "light.strip"]);
  assert.deepEqual(pickedOf(input, zone), []);
  // Back in: every light chosen is the room again.
  input = { ...input, ...withLight(input, office, "light.lamp") };
  assert.deepEqual(input.rooms, ["office"]);
  assert.deepEqual(input.zones, []);
  // The room's check: out (with its lights), then whole again.
  input = { ...input, ...withLight(input, office, "light.lamp") };
  input = { ...input, ...withGroup(input, office) };
  assert.deepEqual([input.rooms, input.zones], [["office"], []]);
  input = { ...input, ...withGroup(input, office) };
  assert.deepEqual([input.rooms, input.zones], [[], []]);
  // A zone is whole or not at all; a room's single light stays a light.
  input = { ...input, ...withGroup(input, zone) };
  input = { ...input, ...withLight(input, office, "light.strip") };
  assert.deepEqual(input.zones, ["light.tv_area", "light.strip"]);
  // Single lights are named by their room.
  const hass = {
    areas: { office: { area_id: "office", name: "Office" } },
    entities: { "light.strip": { entity_id: "light.strip", area_id: "office" } },
    states: { "light.tv_area": { entity_id: "light.tv_area", state: "on", attributes: { friendly_name: "TV area", is_hue_group: true } } },
  };
  assert.equal(roomsLine(hass as never, input), "TV area, Office");
});

test("the more-info sheet opens only for automations made with Hue Studio", () => {
  // By the id prefix (it survives a takeover in HA) ...
  assert.equal(isOurAutomation("automation.wake_up", "hue_studio_wake_up_abc", null), true);
  // ... or because HA reports it uses one of our blueprints (made in HA's editor).
  assert.equal(isOurAutomation("automation.motion", "1712345678901", { "automation.motion": {} }), true);
  assert.equal(isOurAutomation("automation.other", "1712345678901", { "automation.motion": {} }), false);
  assert.equal(isOurAutomation("automation.other", undefined, null), false);
  // Never anything but an automation.
  assert.equal(isOurAutomation("light.example_lamp", "hue_studio_x", null), false);
  assert.equal(isOurAutomation(undefined, "hue_studio_x", null), false);
});

test("the sheet sums an automation up in Hue words", () => {
  const hass = {
    areas: { office: { area_id: "office", name: "Office" } },
    states: { "scene.office_relax": { entity_id: "scene.office_relax", state: "", attributes: { friendly_name: "Relax" } } },
  } as never;
  const wake = newDraft("wake_up", "Wake up", ["area.office"]);
  assert.equal(lightLine(hass, wake, t), "4000 K · 100%");
  assert.deepEqual(summaryRows(hass, wake, t), [
    { label: "When", value: "07:00 · Every day" },
    { label: "Rooms and zones", value: "Office" },
    { label: "Light", value: "4000 K · 100%" },
  ]);
  const scene = { ...wake, input: { ...wake.input, light: "scene" as const, scenes: ["scene.office_relax"], brightness: null } };
  assert.equal(lightLine(hass, scene, t), "Relax");
  assert.equal(lightLine(hass, { ...scene, input: { ...scene.input, scenes: [] } }, t), "Scene");
  assert.equal(lightLine(hass, { ...wake, input: { ...wake.input, light: "natural" } }, t), "Natural light · 100%");
  assert.equal(lightLine(hass, { ...wake, input: { ...wake.input, light: "auto", brightness: null } }, t), "Scene of the day");
  // Types that only turn lights off.
  assert.equal(lightLine(hass, newDraft("leaving_home", "Away", ["area.office"]), t), "Off");
  // No rooms: that row is left out.
  assert.deepEqual(
    summaryRows(hass, newDraft("motion", "Motion"), t).map((r) => r.label),
    ["When", "Light"],
  );
  // Polish, like the live instance.
  const pl = localize({ language: "pl" });
  assert.equal(summaryRows(hass, wake, pl)[0].label, "Kiedy");
});
