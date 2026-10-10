import assert from "node:assert/strict";
import { test } from "node:test";

import { galleryMatch } from "../../src/gallery-data.ts";
import type { Gallery } from "../../src/types.ts";

const gallery: Gallery = {
  categories: [{ id: "defaults", name: "Defaults" }],
  scenes: [
    { id: "read", name: "Read", category: "defaults", kind: "white", mirek: 346, public_image: "img-read" },
    { id: "ocean_dawn", name: "Ocean dawn", category: "defaults", kind: "gradient", points: [[0.2, 0.3]] },
  ],
};

test("galleryMatch prefers the Hue app picture id over the name", () => {
  assert.equal(galleryMatch(gallery, "My reading light", "img-read")?.id, "read");
});

test("galleryMatch falls back to the name", () => {
  assert.equal(galleryMatch(gallery, "ocean  Dawn", "img-unknown")?.id, "ocean_dawn");
  assert.equal(galleryMatch(gallery, "Nothing", null), null);
  assert.equal(galleryMatch(null, "Read", "img-read"), null);
});
