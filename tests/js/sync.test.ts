import assert from "node:assert/strict";
import { test } from "node:test";

import {
  boxesForGroup,
  confirmed,
  defaultAction,
  hasFeature,
  inputIcon,
  memoBoxFor,
  predictSync,
  statusKey,
  suggestSignals,
  syncedLights,
  syncingIn,
  syncMemo,
} from "../../src/sync.ts";
import type { SyncBoxInfo } from "../../src/types.ts";

const BOX: SyncBoxInfo = {
  available: true,
  entity_id: "switch.sync_box_light_sync",
  name: "Sync Box",
  power: true,
  syncing: false,
  mode: "video",
  intensity: "high",
  brightness: 50,
  input: "input1",
  inputs: [
    { id: "input1", name: "Media player" },
    { id: "input4", name: "PC" },
  ],
  area: "ent-tv",
  areas: [
    { id: "ent-tv", name: "TV area", active: false, lights: ["light.tv_strip", "light.play_left"] },
    { id: "ent-desk", name: "Desk", active: false, lights: ["light.desk_lamp"] },
  ],
};

const LIVING = { lights: ["light.tv_strip", "light.play_left", "light.candle"] };
const OFFICE = { lights: ["light.desk_lamp"] };

test("a box belongs to rooms that share lights with its current area", () => {
  assert.deepEqual(boxesForGroup({ a: BOX }, LIVING).map(([id]) => id), ["a"]);
  assert.deepEqual(boxesForGroup({ a: BOX }, OFFICE), []);
  assert.deepEqual(boxesForGroup({ a: { ...BOX, available: false } }, LIVING), []);
  // A syncing box comes first.
  const order = boxesForGroup({ a: BOX, b: { ...BOX, syncing: true } }, LIVING).map(([id]) => id);
  assert.deepEqual(order, ["b", "a"]);
});

test("only a syncing box locks lights", () => {
  assert.deepEqual(syncedLights(BOX), []);
  assert.deepEqual(syncingIn({ a: BOX }, LIVING), []);
  const syncing = { ...BOX, syncing: true };
  assert.deepEqual(syncedLights(syncing), ["light.tv_strip", "light.play_left"]);
  assert.deepEqual(syncingIn({ a: syncing }, LIVING), ["light.tv_strip", "light.play_left"]);
  assert.deepEqual(syncingIn({ a: syncing }, OFFICE), []);
});

test("predictions mirror the backend", () => {
  assert.equal(predictSync(BOX, { sync: true }).syncing, true);
  const game = predictSync(BOX, { mode: "game" });
  assert.equal(game.mode, "game");
  assert.equal(game.syncing, true);
  const off = predictSync({ ...BOX, syncing: true }, { power: false, sync: true });
  assert.equal(off.power, false);
  assert.equal(off.syncing, false);
  assert.equal(predictSync({ ...BOX, power: false }, { power: true }).power, true);
  assert.equal(predictSync(BOX, { input: "PC" }).input, "input4");
  assert.equal(predictSync(BOX, { entertainment_area: "Desk" }).area, "ent-desk");
  assert.equal(predictSync(BOX, { input: "VCR" }).input, "input1");
  assert.equal(predictSync(BOX, { brightness: 90 }).brightness, 90);
});

test("a prediction is confirmed when the box reports it", () => {
  const predicted = predictSync(BOX, { sync: true, intensity: "subtle" });
  assert.equal(confirmed(predicted, BOX), false);
  assert.equal(confirmed(predicted, { ...BOX, syncing: true, intensity: "subtle", content: "4K" }), true);
});

test("status", () => {
  assert.equal(statusKey(BOX), "sync.ready");
  assert.equal(statusKey({ ...BOX, syncing: true }), "sync.syncing");
  assert.equal(statusKey({ ...BOX, power: false }), "sync.off");
  assert.equal(statusKey({ ...BOX, available: false }), "sync.unavailable");
});

test("music palette and background lighting are predicted too", () => {
  const box = { ...BOX, mode: "video" as const, palette: "neutral", background_lighting: { video: false, game: false } };
  assert.equal(predictSync(box, { palette: "happy_calm" }).palette, "happy_calm");
  assert.deepEqual(predictSync(box, { background_lighting: true }).background_lighting, { video: true, game: false });
  assert.equal(hasFeature(box, "presets"), false);
  assert.equal(hasFeature({ ...box, features: ["presets"] }, "presets"), true);
});

test("the sync memo answers more-info from the switch's state", () => {
  const memo = syncMemo({ tv: BOX });
  assert.deepEqual(memo, { tv: { entity: "switch.sync_box_light_sync", lights: ["light.tv_strip", "light.play_left"] } });
  const on = { "switch.sync_box_light_sync": { state: "on" } };
  assert.equal(memoBoxFor(memo, on, "light.play_left"), "tv");
  assert.equal(memoBoxFor(memo, on, "light.candle"), null);
  assert.equal(memoBoxFor(memo, { "switch.sync_box_light_sync": { state: "off" } }, "light.play_left"), null);
});

test("a picture's default action follows the input's type", () => {
  assert.equal(defaultAction("desktop"), "game");
  assert.equal(defaultAction("playstation"), "game");
  assert.equal(defaultAction("soundbar"), "music");
  assert.equal(defaultAction("appletv"), "video");
  assert.equal(defaultAction(null), "video");
});

test("signals and wake entities are suggested for an input", () => {
  const candidates = [
    { entity_id: "media_player.living_room", name: "Living room", platform: "apple_tv" },
    { entity_id: "media_player.example_tv", name: "TV", platform: "braviatv" },
    { entity_id: "sensor.example_pc_monitorpowerstate", name: "Example PC MonitorPowerState" },
    { entity_id: "button.wake_on_lan_example_pc", name: "Wake on LAN" },
    { entity_id: "binary_sensor.office_motion", name: "Office motion" },
  ];
  assert.deepEqual(suggestSignals({ name: "Apple TV", type: "appletv" }, candidates), ["media_player.living_room"]);
  assert.deepEqual(suggestSignals({ name: "PC", type: "desktop" }, candidates), [
    "sensor.example_pc_monitorpowerstate",
    "button.wake_on_lan_example_pc",
  ]);
  assert.deepEqual(suggestSignals({ name: "HDMI 2", type: "generic" }, candidates), []);
  assert.equal(inputIcon({ id: "input1", name: "x", type: "xbox" }), "mdi:microsoft-xbox");
  assert.equal(inputIcon({ id: "input1", name: "x", type: "unknown" }), "mdi:hdmi-port");
});
