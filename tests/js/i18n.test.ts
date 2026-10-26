import assert from "node:assert/strict";
import { test } from "node:test";

import { keysOf, localize, LOCALES } from "../../src/i18n/index.ts";

test("every locale has exactly the English keys", () => {
  const en = keysOf("en").sort();
  for (const lang of LOCALES) assert.deepEqual(keysOf(lang).sort(), en, lang);
});

test("fallback and placeholders", () => {
  const t = localize({ locale: { language: "xx" } });
  assert.equal(t("gallery.saved", { name: "Office" }), "Saved as a scene in Office");
  assert.equal(localize({ locale: { language: "pl" } })("nav.home"), "Dom");
});
