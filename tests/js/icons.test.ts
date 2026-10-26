import assert from "node:assert/strict";
import { test } from "node:test";

import { HUE_ICONS } from "../../src/ds/hue-icons-data.ts";
import { ARCHETYPE_ICONS, lightIcon, PRODUCT_ICONS } from "../../src/core/model.ts";
import type { HassData } from "../../src/core/types.ts";
import { defaultSceneIcon, SCENE_ICONS } from "../../src/features/scenes/icons.ts";

test("every icon the model names is bundled", () => {
  const named = [...Object.values(ARCHETYPE_ICONS), ...PRODUCT_ICONS.map(([, icon]) => icon)];
  for (const icon of named) {
    assert.ok(icon.startsWith("hue-studio:"), icon);
    assert.ok(HUE_ICONS[icon.slice("hue-studio:".length)], `${icon} is not in hue-icons-data.ts`);
  }
});

test("a light's icon: the user's own, then product, then archetype, then a bulb", () => {
  const hass = { entities: { "light.own": { icon: "mdi:star" } } } as unknown as HassData;
  assert.equal(lightIcon(hass, "light.own", { archetype: "candle_bulb" } as never), "mdi:star");
  assert.equal(lightIcon(hass, "light.a", { archetype: "hue_signe", product: "Signe gradient table" } as never), "hue-studio:signe-gradient-table");
  assert.equal(lightIcon(hass, "light.a", { archetype: "hue_signe", product: "Signe gradient floor" } as never), "hue-studio:signe-gradient-floor");
  assert.equal(lightIcon(hass, "light.a", { archetype: "candle_bulb" } as never), "hue-studio:bulb-candle");
  assert.equal(lightIcon(hass, "light.a", { archetype: "unknown_archetype" } as never), "mdi:lightbulb");
  assert.equal(lightIcon(hass, "light.a", null), "mdi:lightbulb");
});

test("every scene glyph a scene can take is bundled", () => {
  for (const [icon] of SCENE_ICONS) {
    assert.ok(icon.startsWith("hue-studio:scene-"), icon);
    assert.ok(HUE_ICONS[icon.slice("hue-studio:".length)], `${icon} is not in hue-icons-data.ts`);
  }
});

test("default scenes are drawn as the Hue app's discs, others are not", () => {
  const read = defaultSceneIcon({ id: "read", category: "defaults" }, "Read");
  assert.equal(read?.icon, "hue-studio:scene-read");
  assert.equal(defaultSceneIcon({ id: "ocean_dawn", category: "nature" }, "Ocean dawn"), null);
  assert.equal(defaultSceneIcon(null, " Natural light ")?.icon, "mdi:sun-clock");
  assert.equal(defaultSceneIcon(null, "Światło naturalne")?.icon, "mdi:sun-clock");
  assert.equal(defaultSceneIcon(null, "Evening"), null);
});
