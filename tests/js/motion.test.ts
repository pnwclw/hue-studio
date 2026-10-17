import assert from "node:assert/strict";
import { test } from "node:test";

import {
  activeResponses,
  areaState,
  calibrationProgress,
  defaultName,
  enoughLights,
  findArea,
  flipLight,
  groupChoices,
  lightsInAreas,
  motionBridges,
} from "../../src/motion.ts";
import type { BridgeInfo, MotionArea } from "../../src/types.ts";

const light = (n: string, health: string | null = "healthy") => ({ id: `cand-${n}`, device: `dev-${n}`, entity_id: `light.${n}`, health });

const area = (patch: Partial<MotionArea> = {}): MotionArea => ({
  id: "ma-1",
  name: "Office",
  group: "Office",
  group_id: "room-1",
  group_type: "room",
  enabled: true,
  health: "healthy",
  calibrating: false,
  calibration_started: null,
  lights: [light("a"), light("b"), light("c")],
  sensitivity: { value: 2, max: 4 },
  security_sensitivity: { value: 2, max: 4 },
  sensor: "binary_sensor.office",
  responses: [],
  ...patch,
});

const bridge = (patch: Partial<BridgeInfo> = {}): BridgeInfo => ({
  name: "Bridge Pro",
  host: null,
  id: "b1",
  model: "Hue Bridge Pro",
  software: null,
  pro: true,
  motion_areas: [area()],
  motion_lights: ["a", "b", "c", "d", "e"].map((n) => ({ id: `cand-${n}`, device: `dev-${n}`, entity_id: `light.${n}`, name: n })),
  motion_groups: [
    { id: "z", type: "zone", name: "Downstairs", lights: ["cand-a", "cand-b", "cand-c", "cand-d"] },
    { id: "r2", type: "room", name: "Kitchen", lights: ["cand-e"] },
    { id: "r1", type: "room", name: "Office", lights: ["cand-a", "cand-b", "cand-c", "cand-d"] },
  ],
  ...patch,
});

test("an area's state: off, calibrating, working, a problem", () => {
  assert.equal(areaState(area({ enabled: false, health: "not_running" })), "off");
  assert.equal(areaState(area({ calibrating: true, lights: [light("a", "unhealthy")] })), "calibrating");
  assert.equal(areaState(area()), "working");
  // Not calibrating, still a light that is not healthy: something is wrong.
  assert.equal(areaState(area({ lights: [light("a"), light("b", "unhealthy")] })), "problem");
  assert.equal(areaState(area({ health: "degraded" })), "problem");
  // A light the bridge said nothing about yet is no problem.
  assert.equal(areaState(area({ lights: [light("a", null)] })), "working");
});

test("calibration progress: by time, and lights that are done", () => {
  const started = 1000;
  const calibrating = area({ calibrating: true, calibration_started: started, lights: [light("a", "unhealthy"), light("b", "unhealthy")] });
  assert.equal(calibrationProgress(calibrating, started * 1000), 0);
  assert.equal(calibrationProgress(calibrating, started * 1000 + 15_000), 0.5);
  // Never full until the bridge says so.
  assert.equal(calibrationProgress(calibrating, started * 1000 + 60_000), 0.95);
  assert.equal(calibrationProgress({ ...calibrating, lights: [light("a"), light("b")] }, started * 1000), 1);
  assert.equal(calibrationProgress({ ...calibrating, calibration_started: null, lights: [light("a"), light("b", "unhealthy")] }, 0), 0.5);
});

test("rooms then zones; fewer than three sensing lights cannot hold an area", () => {
  const choices = groupChoices(bridge());
  assert.deepEqual(
    choices.map((c) => [c.group.name, c.lights.length, c.reason]),
    [
      ["Kitchen", 1, "few"],
      ["Office", 4, null],
      ["Downstairs", 4, null],
    ],
  );
});

test("lights in other areas; picking three or four", () => {
  assert.deepEqual([...lightsInAreas(bridge()).keys()], ["light.a", "light.b", "light.c"]);
  assert.equal(lightsInAreas(bridge(), "ma-1").size, 0);
  let picked: string[] = [];
  for (const id of ["a", "b"]) picked = flipLight(picked, id);
  assert.equal(enoughLights(picked), false);
  for (const id of ["c", "d", "e"]) picked = flipLight(picked, id);
  assert.deepEqual(picked, ["a", "b", "c", "d"]);
  assert.equal(enoughLights(picked), true);
  assert.deepEqual(flipLight(picked, "b"), ["a", "c", "d"]);
});

test("a new area's name, finding areas, responses that still switch lights", () => {
  const b = bridge();
  assert.equal(defaultName(b, b.motion_groups![1]), "Kitchen");
  assert.equal(defaultName(b, b.motion_groups![2]), "Office 2");
  const bridges = { e1: b, e2: bridge({ motion_areas: null }) };
  assert.equal(findArea(bridges, "ma-1")?.[0], "e1");
  assert.equal(findArea(bridges, "x"), null);
  assert.deepEqual(motionBridges(bridges).map(([id]) => id), ["e1"]);
  const responses = [
    { id: "r1", name: "A", enabled: true, slots: 3 },
    { id: "r2", name: "B", enabled: false, slots: 1 },
  ];
  assert.deepEqual(activeResponses(area({ responses })).map((r) => r.id), ["r1"]);
});
