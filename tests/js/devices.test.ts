import assert from "node:assert/strict";
import { test } from "node:test";

import {
  areaOfRoom,
  byLocation,
  deviceIcon,
  deviceTypes,
  filterDevices,
  groupOf,
  hasPro,
  newDevices,
  NO_AREA,
  parseQr,
  parseSerials,
  withCodes,
  searchOver,
  searchProgress,
  wifiKey,
} from "../../src/features/devices/devices.ts";
import type { BridgeDevices, BridgeInfo, HassData, HueDeviceInfo } from "../../src/core/types.ts";

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
  assert.deepEqual(parseSerials(" a1b2c3, A1B2C3;d4e5f6\n"), { codes: ["A1B2C3", "D4E5F6"], qr: [], invalid: [], tooMany: false });
  assert.deepEqual(parseSerials("abc, 12345g").invalid, ["ABC", "12345G"]);
  assert.deepEqual(parseSerials(""), { codes: [], qr: [], invalid: [], tooMany: false });
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

test("Settings → Devices: kinds, search, filters, rooms", () => {
  const list = [
    device("strip", { name: "Taśma Play", product: "Hue Play gradient lightstrip", area: "living" }),
    device("bulb", { name: "Kitchen bulb", area: "kitchen" }),
    device("lamp", { name: "Hall lamp", area: null }),
    device("old", { name: "Old lamp", area: "gone" }),
  ];
  assert.deepEqual([groupOf("light"), groupOf("switch"), groupOf("sensor"), groupOf("other")], ["lights", "switches", "sensors", "other"]);
  const all = { query: "", area: null, type: null };
  // Without diacritics, by product too.
  assert.deepEqual(filterDevices(list, { ...all, query: " tasma " }).map((d) => d.id), ["strip"]);
  assert.deepEqual(filterDevices(list, { ...all, query: "gradient" }).map((d) => d.id), ["strip"]);
  assert.deepEqual(filterDevices(list, { ...all, area: "kitchen" }).map((d) => d.id), ["bulb"]);
  assert.deepEqual(filterDevices(list, { ...all, area: NO_AREA }).map((d) => d.id), ["lamp"]);
  assert.deepEqual(filterDevices(list, { ...all, type: "Hue color lamp" }).map((d) => d.id), ["bulb", "lamp", "old"]);
  assert.deepEqual(deviceTypes(list), ["Hue color lamp", "Hue Play gradient lightstrip"]);
  // Areas by name, a device whose area is gone counts as in none, those last.
  const names: Record<string, string> = { living: "Living room", kitchen: "Kitchen" };
  const sections = byLocation(list, (id) => names[id], "No room");
  assert.deepEqual(
    sections.map((s) => [s.name, s.devices.map((d) => d.id)]),
    [["Kitchen", ["bulb"]], ["Living room", ["strip"]], ["No room", ["lamp", "old"]]],
  );
});

test("a device's picture: own icon, product, shape, kind", () => {
  const hass = { states: {}, entities: { "light.own": { icon: "mdi:star" } } } as unknown as HassData;
  assert.equal(deviceIcon(hass, device("a", { lights: ["light.own"] })), "mdi:star");
  assert.equal(deviceIcon(hass, device("b", { product: "Signe gradient table", archetype: "hue_signe" })), "hue-studio:signe-gradient-table");
  assert.equal(deviceIcon(hass, device("c", { archetype: "hue_play" })), "hue-studio:play");
  assert.equal(deviceIcon(hass, device("d", { archetype: "nothing_known" })), "mdi:lightbulb-on-outline");
  assert.equal(deviceIcon(hass, device("e", { kind: "sensor", product: "Hue outdoor motion sensor", sensitivity: { value: 2, max: 4 } })), "hue-studio:outdoor-motion");
  assert.equal(deviceIcon(hass, device("f", { kind: "switch" })), "mdi:light-switch");
});

test("a device's QR code: its MAC and install code", () => {
  const code = "0123456789ABCDEF0123456789ABCDEF0123";
  const hue = `HUE:Z:${code.toLowerCase()} M:0017880100000042 D:X1Y23 A:1000`;
  const lamp = { mac: "00:17:88:01:00:00:00:42", code };
  assert.deepEqual(parseQr(hue), lamp);
  assert.deepEqual(parseQr(`Z:0017880100000043$I:${code}%G$M:1234`), { mac: "00:17:88:01:00:00:00:43", code });
  assert.equal(parseQr("A1B2C3"), null);
  assert.equal(parseQr("https://example.com/"), null);
  assert.equal(parseQr(`HUE:Z:${code.slice(2)} M:0017880100000042`), null);
  // Pasted among serial numbers.
  const parsed = parseSerials(`a1b2c3, ${hue}, ${hue}`);
  assert.deepEqual([parsed.codes, parsed.qr, parsed.invalid], [["A1B2C3"], [lamp], []]);
  assert.deepEqual(withCodes([lamp], [{ ...lamp, code: "F".repeat(36) }, { mac: "AA", code }]), [
    { ...lamp, code: "F".repeat(36) },
    { mac: "AA", code },
  ]);
});
