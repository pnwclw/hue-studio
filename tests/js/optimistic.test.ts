import assert from "node:assert/strict";
import { test } from "node:test";

import { Optimistic, predict } from "../../src/optimistic.ts";

const hass = {
  states: {
    "light.a": { state: "off", attributes: {} },
    "light.b": { state: "off", attributes: {} },
    "light.room": { state: "off", attributes: { is_hue_group: true, entity_id: ["light.a", "light.b"] } },
  },
};

test("turning on a Hue group predicts its members", () => {
  const p = predict(hass, "light", "turn_on", { entity_id: ["light.room"], brightness_pct: 50 });
  assert.deepEqual([...p.keys()].sort(), ["light.a", "light.b", "light.room"]);
  assert.equal(p.get("light.a")?.state, "on");
  assert.equal(p.get("light.a")?.attributes?.brightness, 127);
});

test("patches show until HA confirms or they expire", () => {
  let now = 0;
  const o = new Optimistic(() => now);
  o.add(predict(hass, "light", "turn_on", { entity_id: "light.a", brightness_pct: 50 }));
  assert.equal(o.apply(hass).states["light.a"].state, "on");

  // HA reports "on" but an old brightness: keep showing the prediction.
  const half = { states: { ...hass.states, "light.a": { state: "on", attributes: { brightness: 10 } } } };
  assert.equal(o.apply(half).states["light.a"].attributes.brightness, 127);

  // Confirmed: the real state is used again and the patch is gone.
  const done = { states: { ...hass.states, "light.a": { state: "on", attributes: { brightness: 126 } } } };
  assert.equal(o.apply(done), done);
  assert.equal(o.items.size, 0);

  o.add(predict(hass, "light", "turn_on", { entity_id: "light.b" }));
  now = 6000;
  assert.equal(o.apply(hass), hass);
});
