import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clipToGamut,
  inGamut,
  mirekToWheelY,
  rgbToXy,
  wheelToRgb,
  wheelToXy,
  wheelYToMirek,
  xyToRgb,
  xyToWheel,
} from "../../src/color.ts";
import type { XY } from "../../src/types.ts";

const GAMUT_C: XY[] = [[0.6915, 0.3083], [0.17, 0.7], [0.1532, 0.0475]];
const near = (a: number, b: number, eps: number) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

test("xy and rgb round-trip", () => {
  for (const xy of [[0.5, 0.4], [0.3, 0.3], [0.2, 0.15], [0.4, 0.5]] as XY[]) {
    const back = rgbToXy(...xyToRgb(...xy));
    near(back[0], xy[0], 0.01);
    near(back[1], xy[1], 0.01);
  }
});

test("wheel center is white, edge at the red angle is red", () => {
  assert.deepEqual(wheelToRgb(0, 0), [255, 255, 255]);
  const a = (-20 * Math.PI) / 180;
  assert.deepEqual(wheelToRgb(Math.sin(a), -Math.cos(a)), [255, 0, 0]);
});

test("wheel and xy round-trip", () => {
  for (const p of [[0.3, -0.4], [-0.5, 0.2], [0.1, 0.7]] as XY[]) {
    const back = xyToWheel(...wheelToXy(...p));
    near(back[0], p[0], 0.03);
    near(back[1], p[1], 0.03);
  }
});

test("gamut clipping", () => {
  assert.ok(inGamut([0.35, 0.35], GAMUT_C));
  assert.deepEqual(clipToGamut([0.35, 0.35], GAMUT_C), [0.35, 0.35]);
  const clipped = clipToGamut([0.08, 0.85], GAMUT_C);
  assert.ok(!inGamut([0.08, 0.85], GAMUT_C));
  near(clipped[0], 0.17, 0.02);
  near(clipped[1], 0.7, 0.02);
  assert.deepEqual(clipToGamut([0.08, 0.85], null), [0.08, 0.85]);
});

test("white scale", () => {
  assert.equal(wheelYToMirek(-1), 153);
  assert.equal(wheelYToMirek(1), 500);
  near(mirekToWheelY(wheelYToMirek(0.3)), 0.3, 0.01);
});
