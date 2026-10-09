import assert from "node:assert/strict";
import { test } from "node:test";

import { keysOf, localize, LOCALES } from "../../custom_components/hue_studio/frontend/i18n.js";

test("every locale has exactly the English keys", () => {
  const en = keysOf("en").sort();
  for (const lang of LOCALES) assert.deepEqual(keysOf(lang).sort(), en, lang);
});

test("fallback and placeholders", () => {
  const t = localize({ locale: { language: "xx" } });
  assert.equal(t("gallery.applied", { name: "Office" }), "Applied to Office");
  assert.equal(localize({ locale: { language: "pl" } })("nav.home"), "Dom");
});
