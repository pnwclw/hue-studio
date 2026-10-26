import assert from "node:assert/strict";
import { test } from "node:test";

import { fromJson, paletteShare, readShareLink, shareLink, SHARE_PAGE, sharedPalette, toJson, whiteOf } from "../../src/features/scenes/share.ts";

// A link the Hue app gave: five colors and a cool white, all at 100 %, speed 0.5.
const LINK =
  "https://scenesharing.meethue.com/data/?eJxtzDEKgDAQRNG7TD3I7pqNYa8SbPQCgmXI3UUbhdj-x0zDgagNO6KaO9UK1fJKbAgV6XxtSTSZBxKqZpr7OLorzeXn7iFPg2j5tJU4ETJ5vwBDXyg1";

test("a Hue app link is read", async () => {
  const scene = await readShareLink(LINK);
  assert.ok(scene);
  assert.equal(scene.image, null);
  assert.equal(scene.speed, 0.5);
  assert.equal(scene.colors.length, 6);
  assert.deepEqual(scene.colors[5], { mirek: 184, brightness: 100 });
  assert.ok(scene.colors[0].xy);
  // Only the data, or the link inside a message, is read too; anything else is not.
  assert.ok(await readShareLink(`Look: ${LINK} !`));
  assert.ok(await readShareLink(LINK.slice(SHARE_PAGE.length)));
  assert.equal(await readShareLink("https://example.com/?abc"), null);
  assert.equal(await readShareLink(`${SHARE_PAGE}AAAAAAAAAAAAAAAAAAAA`), null);
});

test("our link reads back as the same scene", async () => {
  const scene = paletteShare({ points: [[0.6, 0.35], [0.2, 0.3]], mirek: null, brightness: 80, image: "abc", speed: 0.7 });
  const link = await shareLink(scene);
  assert.ok(link.startsWith(SHARE_PAGE));
  // URL-safe and padded to whole groups of four (the share page refuses anything else).
  const data = link.slice(SHARE_PAGE.length);
  assert.ok(/^[A-Za-z0-9_-]+=*$/.test(data));
  assert.equal(data.length % 4, 0);
  const back = await readShareLink(link);
  assert.deepEqual(toJson(back!), toJson(scene));
});

test("the JSON is the Hue app's: its keys, effects by code, empty fields left out", () => {
  assert.deepEqual(
    toJson({ image: null, colors: [{ mirek: 366, brightness: 50 }, { effect: "candle", brightness: 100, speed: 0.25 }], speed: 0.5 }),
    { p: [{ c: [366], b: 50 }, { e: 1, b: 100, s: 0.25 }], s: 0.5 },
  );
  // Within the page's rules: whites 153-500, brightness 0-100, speeds 0-1, an entry's only with an effect.
  assert.deepEqual(
    toJson({ image: null, colors: [{ mirek: 100, brightness: 120, speed: 0.3 }], speed: 2 }),
    { p: [{ c: [153], b: 100 }], s: 1 },
  );
});

test("colors alone get a white, as every Hue palette has one", () => {
  const json = toJson(paletteShare({ points: [[0.6, 0.35], [0.5, 0.41]], mirek: null, brightness: 70 })) as { p: { c: number[]; b: number }[] };
  assert.equal(json.p.length, 3);
  assert.equal(json.p[2].c.length, 1);
  assert.ok(json.p[2].c[0] >= 153 && json.p[2].c[0] <= 500);
  assert.equal(json.p[2].b, 70);
  // Warm colors give a warm white, blue ones a cool one.
  assert.ok(whiteOf([0.5, 0.41]) > 300);
  assert.ok(whiteOf([0.17, 0.05]) < 200);
  assert.ok(Math.abs(whiteOf([0.3127, 0.329]) - 154) < 20);
  // Ten entries at most, the white kept.
  const many = toJson(paletteShare({ points: Array.from({ length: 12 }, (_, i): [number, number] => [0.2 + i * 0.03, 0.3]), mirek: null })) as { p: { c: number[] }[] };
  assert.equal(many.p.length, 10);
  assert.equal(many.p[9].c.length, 1);
  assert.equal(fromJson({ p: [{ e: 10 }], s: 0 })?.colors[0].effect, "enchant");
  assert.equal(fromJson({ p: [], s: 0 }), null);
  assert.equal(fromJson("nope"), null);
});

test("a shared scene as our palette: its colors (whites left to white lights), else a white", () => {
  const mixed = sharedPalette({ image: null, colors: [{ xy: [0.6, 0.35], brightness: 100 }, { mirek: 184, brightness: 50 }], speed: 0.5 });
  assert.equal(mixed.points.length, 1);
  assert.equal(mixed.mirek, null);
  assert.equal(mixed.brightness, 75);
  assert.deepEqual(sharedPalette({ image: null, colors: [{ mirek: 400 }], speed: 0.5 }), { points: [], mirek: 400, brightness: null });
});
