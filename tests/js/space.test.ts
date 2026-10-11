import assert from "node:assert/strict";
import { test } from "node:test";

import { allPositions, canSpread, fromView, roundPoint, toView } from "../../src/space.ts";
import type { PositionsMessage } from "../../src/types.ts";

const msg: PositionsMessage = {
  office: {
    lights: {
      "light.a": { positions: [[-1, 1, 0]], source: "bridge" },
      "light.b": { positions: [], source: null },
    },
    configuration: { id: "ent", name: "Desk", streaming: false },
  },
  living_room: { lights: { "light.c": { positions: [[1, -1, 0.5]], source: "store" } }, configuration: null },
};

test("placed lights and whether a palette can be spread", () => {
  assert.deepEqual(Object.keys(allPositions(msg)), ["light.a", "light.c"]);
  assert.equal(canSpread(msg, ["light.a", "light.c"]), true);
  assert.equal(canSpread(msg, ["light.a", "light.b"]), false);
  assert.equal(canSpread(null, ["light.a"]), false);
});

test("top view: front at the top, round trip", () => {
  assert.deepEqual(toView([-1, 1, 0]), { left: 0, top: 0 });
  assert.deepEqual(toView([1, -1, 0]), { left: 100, top: 100 });
  assert.deepEqual(fromView(0.5, 0.25), [0, 0.5]);
  assert.deepEqual(fromView(-0.2, 1.4), [-1, -1]);
  assert.deepEqual(roundPoint([0.123456789, 2, -0.5]), [0.12346, 1, -0.5]);
});
