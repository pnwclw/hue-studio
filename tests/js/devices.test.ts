import assert from "node:assert/strict";
import { test } from "node:test";

import { areaOfRoom, hasPro, newDevices, parseSerials, searchOver, searchProgress, wifiKey } from "../../src/devices.ts";
import type { BridgeDevices, BridgeInfo, HueDeviceInfo } from "../../src/types.ts";

const device = (id: string, extra: Partial<HueDeviceInfo> = {}): HueDeviceInfo => ({
  id,
  name: id,
  product: "Hue color lamp",
  model: "LCA006",
  archetype: "sultan_bulb",
  kind: "light",
  new: false,
  found: null,
  area: null,
  lights: [],
  ha_device: null,
  sensitivity: null,
  ...extra,
});

const bridge = (extra: Partial<BridgeDevices> = {}): BridgeDevices => ({ name: "Hue Bridge", searching: false, devices: [], ...extra });

test("serial numbers: 6 hex characters, upper case, no repeats, up to 10", () => {
  assert.deepEqual(parseSerials(" a1b2c3, A1B2C3;d4e5f6\n"), { codes: ["A1B2C3", "D4E5F6"], invalid: [], tooMany: false });
  assert.deepEqual(parseSerials("abc, 12345g").invalid, ["ABC", "12345G"]);
  assert.deepEqual(parseSerials(""), { codes: [], invalid: [], tooMany: false });
  const many = parseSerials(Array.from({ length: 11 }, (_, i) => `ABCD${String(i).padStart(2, "0")}`).join(" "));
  assert.equal(many.codes.length, 10);
  assert.equal(many.tooMany, true);
});

test("a search is over once the bridge stops it, or never started it, or after too long", () => {
  const start = 1_000_000;
  assert.equal(searchOver(bridge({ searching: true }), start, start + 30_000, true), false);
  assert.equal(searchOver(bridge(), start, start + 30_000, true), true);
  // Not reported as running yet: the event may still come.
  assert.equal(searchOver(bridge(), start, start + 2_000, false), false);
  assert.equal(searchOver(bridge(), start, start + 11_000, false), true);
  assert.equal(searchOver(bridge({ searching: true }), start, start + 200_000, true), true);
  assert.equal(searchOver(undefined, start, start, false), true);
});

test("search progress stays short of done while the bridge searches", () => {
  assert.equal(searchProgress(0, 30_000), 0.5);
  assert.equal(searchProgress(0, 120_000), 0.97);
  assert.equal(searchProgress(10, 0), 0);
});

test("new devices of every bridge, newest first, optionally found since a time", () => {
  const msg = {
    a: bridge({ devices: [device("old"), device("lamp", { new: true, found: 100 }), device("dial", { new: true, found: 200, kind: "switch" })] }),
    b: bridge({ devices: [device("strip", { new: true, found: 150 })] }),
  };
  assert.deepEqual(
    newDevices(msg).map((d) => [d.id, d.bridge]),
    [
      ["dial", "a"],
      ["strip", "b"],
      ["lamp", "a"],
    ],
  );
  assert.deepEqual(
    newDevices(msg, 150_000).map((d) => d.id),
    ["dial", "strip"],
  );
  assert.deepEqual(newDevices(null), []);
});

test("a room's area, a Bridge Pro, Wi-Fi words", () => {
  assert.equal(areaOfRoom("area.office"), "office");
  assert.equal(areaOfRoom("hue.light.upstairs"), null);
  assert.equal(areaOfRoom(null), null);
  const plain: BridgeInfo = { name: "Hue Bridge", host: null, id: "1", model: "Hue Bridge", software: null, pro: false, motion_areas: null };
  assert.equal(hasPro({ a: plain }), false);
  assert.equal(hasPro({ a: plain, b: { ...plain, pro: true, motion_areas: [] } }), true);
  assert.equal(hasPro(null), false);
  assert.deepEqual([0, 2, 4, 9].map(wifiKey), ["none", "fair", "excellent", "excellent"]);
  assert.equal(wifiKey(null), null);
});
