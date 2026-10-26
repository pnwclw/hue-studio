// The design system (docs/design-system.md): stylesheets take their colors, type sizes, radii,
// shadows and weights from the tokens only.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { CSS } from "../../src/ds/styles/index.ts";
import { COLORS, FONT_SIZES, MOTION, RADII, SHADOWS, SIZES, tokensCss } from "../../src/ds/tokens.ts";

// The panel's stylesheet plus the CSS that cards, sheets and the dialog add to it (read as text:
// those modules need a browser).
const EXTRA = [
  "src/features/cards/cards.ts",
  "src/features/automations/views/automation-sheet.ts",
  "src/features/scenes/views/scene-sheet.ts",
  "src/entries/hue-studio-more-info.ts",
].map((f) => readFileSync(f, "utf8"));
const OWN = CSS.replace(tokensCss(), "");
const ALL = [OWN, ...EXTRA];

test("every part of the stylesheet is in it", async () => {
  // The panel's stylesheet is split by area (src/ds/styles/); the checks below read the joined one.
  for (const file of readdirSync("src/ds/styles").filter((f) => f !== "index.ts")) {
    const parts = Object.values(await import(`../../src/ds/styles/${file}`)) as string[];
    assert.ok(parts.length > 0, file);
    for (const part of parts) assert.ok(CSS.includes(part), `${file} is not joined in index.ts`);
  }
});

const values = (css: string, prop: string) => [...css.matchAll(new RegExp(`(?<![\\w-])${prop}:\\s*([^;}]+)`, "g"))].map((m) => m[1].trim());

test("type sizes come from the scale", () => {
  for (const css of ALL)
    for (const v of values(css, "font-size")) assert.match(v, /^(var\(--fs-[a-z0-9-]+\)|inherit)$/, `font-size: ${v}`);
});

test("weights are 400, 500 and 700 only (HA's Roboto has no others)", () => {
  for (const css of ALL) for (const v of values(css, "font-weight")) assert.match(v, /^(400|500|700)$/, `font-weight: ${v}`);
});

test("radii come from the scale (circles and a pin's drop aside)", () => {
  const ok = /^(var\(--r-[a-z0-9]+\)|0|50%|inherit)$/;
  for (const css of ALL)
    for (const v of values(css, "border-radius")) {
      if (v === "50% 50% 50% 0") continue;
      for (const part of v.split(/\s+/)) assert.match(part, ok, `border-radius: ${v}`);
    }
});

test("named colors live in the tokens only", () => {
  const named = Object.values(COLORS).filter((c) => c.startsWith("#") && c !== "#fff");
  for (const css of ALL) for (const c of named) assert.ok(!css.toLowerCase().includes(c), `${c} outside tokens.ts`);
});

test("every token the stylesheets use exists", () => {
  const known = new Set(
    [
      ...Object.keys(COLORS),
      ...Object.keys(FONT_SIZES).map((k) => `fs-${k}`),
      ...Object.keys(RADII).map((k) => `r-${k}`),
      ...Object.keys(SHADOWS).map((k) => `shadow-${k}`),
      ...Object.keys(SIZES),
      ...Object.keys(MOTION),
    ].map((k) => `--${k}`),
  );
  for (const css of ALL)
    for (const [, name] of css.matchAll(/var\((--(?:fs|r|shadow|press|t)-[a-z0-9-]+)/g)) assert.ok(known.has(name), `${name} is not a token`);
});

test("tokens are valid CSS declarations", () => {
  for (const decl of tokensCss().split("; ")) assert.match(decl, /^--[a-z0-9-]+: [^;]+;?$/);
});
