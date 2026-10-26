import assert from "node:assert/strict";
import { test } from "node:test";

import {
  availableEffects,
  effectData,
  effectLights,
  matchesPreset,
  PRESETS,
  SPEED_STEPS,
  speedToStep,
  speedWord,
  stepToSpeed,
} from "../../src/features/color/effects.ts";
import type { LightInfo } from "../../src/core/types.ts";

test("speed steps 1-12 cover the bridge's 0-1 and round-trip", () => {
  assert.equal(speedToStep(0), 1);
  assert.equal(speedToStep(1), SPEED_STEPS);
  for (let step = 1; step <= SPEED_STEPS; step++) assert.equal(speedToStep(stepToSpeed(step)), step);
  assert.deepEqual([3, 4, 7, 8].map(speedWord), ["slow", "medium", "medium", "fast"]);
});

test("effects only go to lights that can play them", () => {
  const info: Record<string, LightInfo> = {
    "light.a": { effects: ["candle", "fire"] },
    "light.b": { effects: ["candle"] },
    "light.c": {},
  };
  const lights = ["light.a", "light.b", "light.c"];
  assert.deepEqual(effectLights(lights, info, "fire"), ["light.a"]);
  assert.deepEqual(availableEffects(lights, info), ["candle", "fire"]);
  assert.deepEqual(availableEffects(["light.c"], info), []);
});

test("a running effect matches its preset by color", () => {
  const [plain, orange, warm] = PRESETS.candle;
  assert.ok(matchesPreset({ effect: "candle" }, plain));
  assert.ok(!matchesPreset({ effect: "candle", xy: [0.6, 0.39] }, plain));
  assert.ok(matchesPreset({ effect: "candle", xy: [0.601, 0.392] }, orange));
  assert.ok(matchesPreset({ effect: "candle", mirek: 450 }, warm));
  assert.ok(!matchesPreset({ effect: "fire" }, plain));
  assert.ok(!matchesPreset(null, plain));
});

test("service data: color or white, speed in percent", () => {
  assert.deepEqual(effectData("candle", { xy: [0.6, 0.39], speed: 0.5, brightness: 40 }), {
    effect: "candle",
    xy_color: [0.6, 0.39],
    speed: 50,
    brightness: 40,
  });
  assert.deepEqual(effectData("candle", { mirek: 453.6 }), { effect: "candle", mirek: 454 });
});

test("a scene's speed reads as the Hue app's steps (measured on the bridge)", async () => {
  const { sceneSpeedToStep, sceneStepToSpeed, sceneSpeedWord } = await import("../../src/features/color/effects.ts");
  // The bridge's default (76/126) is the app's 7, its 111/126 the app's 12.
  assert.equal(sceneSpeedToStep(0.603), 7);
  assert.equal(sceneSpeedToStep(0.8809523), 12);
  assert.equal(sceneSpeedToStep(0), 1);
  assert.equal(sceneSpeedToStep(1), 12);
  for (let step = 1; step <= 12; step++) assert.equal(sceneSpeedToStep(sceneStepToSpeed(step)), step);
  // What the service gets survives the bridge's 126ths.
  for (let step = 1; step <= 12; step++) assert.equal(sceneSpeedToStep(Math.round(sceneStepToSpeed(step) * 126) / 126), step);
  assert.deepEqual([1, 3, 5, 7, 8, 10, 12].map(sceneSpeedWord), ["very_slow", "slow", "medium", "medium", "fast", "very_fast", "extreme"]);
});
