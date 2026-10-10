"""Build the bundled scene gallery from Hypfer/hass-scene_presets (Apache-2.0).

Writes `custom_components/hue_studio/frontend/gallery/`:
  gallery.json   source, categories and scenes (see below)
  thumb/<id>.jpg 480x270 tiles

gallery.json:
  source: {repo, commit}
  categories: [{"id": "dreamy", "name": "Dreamy"}]
  scenes: [{"id": "ocean_dawn", "name": "Ocean dawn", "category": "dreamy",
            "brightness": 84, "kind": "gradient", "points": [[x, y], ...],
            "public_image": "<uuid>"}
           | {..., "kind": "white", "mirek": 370}]

`public_image` is the id of the scene's picture in the Hue app (CLIP v2
`scene.metadata.image`, a `public_image` resource; the same on every bridge). Upstream
does not have it: it comes from `hue_public_images.json` (Hue app scene name -> id),
read off real bridges. Scenes created from the gallery carry it, so the Hue app shows
their picture, and bridge scenes are matched to gallery pictures by it.

Usage: uv run python scripts/build_gallery.py [path to a clone]
Without a path the upstream repository is shallow-cloned into a temporary directory.
`--images` only refreshes `public_image` in the existing gallery.json.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from typing import Any
import unicodedata

from PIL import Image

REPO = "https://github.com/Hypfer/hass-scene_presets"
OUT = (
    Path(__file__).resolve().parent.parent
    / "custom_components"
    / "hue_studio"
    / "frontend"
    / "gallery"
)
# The upstream author's own presets, not part of the Hue app gallery.
SKIP_CATEGORIES = {"Misc Additions"}
THUMB_SIZE = (480, 270)
PUBLIC_IMAGES = Path(__file__).resolve().parent / "hue_public_images.json"


def slug(name: str, taken: set[str]) -> str:
    """Return a unique ASCII snake_case id for a name."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
    out, n = s, 2
    while out in taken:
        out, n = f"{s}_{n}", n + 1
    taken.add(out)
    return out


def white_mirek(x: float, y: float) -> int | None:
    """Return mirek for a point close to the black-body curve, else None.

    Uses McCamy's CCT approximation; tinted colors fall outside 2000-6500 K or too far
    from the Planckian locus.
    """
    n = (x - 0.3320) / (0.1858 - y)
    cct = 449 * n**3 + 3525 * n**2 + 6823.3 * n + 5520.33
    on_locus = abs(y - (-3.0 * x * x + 2.87 * x - 0.275)) < 0.02
    if 2000 <= cct <= 6500 and on_locus:
        return max(153, min(500, round(1e6 / cct)))
    return None


def thumbnail(src: Path, dst: Path) -> None:
    """Center-crop to 16:9 and save a JPEG tile."""
    im = Image.open(src).convert("RGB")
    w, h = im.size
    tw, th = (w, round(w * 9 / 16)) if w * 9 / 16 <= h else (round(h * 16 / 9), h)
    box = ((w - tw) // 2, (h - th) // 2, (w + tw) // 2, (h + th) // 2)
    im.crop(box).resize(THUMB_SIZE, Image.Resampling.LANCZOS).save(
        dst, quality=78, optimize=True, progressive=True
    )


def add_public_images(scenes: list[dict[str, Any]]) -> int:
    """Set `public_image` on scenes whose Hue app picture id is known; return count."""
    known = {
        name.casefold(): rid
        for name, rid in json.loads(PUBLIC_IMAGES.read_text()).items()
    }
    count = 0
    for scene in scenes:
        scene.pop("public_image", None)
        if (rid := known.get(scene["name"].casefold())) is not None:
            scene["public_image"] = rid
            count += 1
    return count


def write(gallery: dict[str, Any]) -> None:
    """Write gallery.json."""
    (OUT / "gallery.json").write_text(json.dumps(gallery, indent=1) + "\n")


def build(src: Path) -> None:
    """Convert the upstream presets into gallery.json and thumbnails."""
    commit = subprocess.run(
        ["git", "-C", str(src), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    base = src / "custom_components" / "scene_presets"
    data = json.loads((base / "presets.json").read_text())

    thumbs = OUT / "thumb"
    thumbs.mkdir(parents=True, exist_ok=True)
    for old in thumbs.glob("*.jpg"):
        old.unlink()

    taken_categories: set[str] = set()
    categories: list[dict[str, str]] = []
    category_ids: dict[str, str] = {}
    for category in data["categories"]:
        if category["name"] in SKIP_CATEGORIES:
            continue
        category_ids[category["id"]] = slug(category["name"], taken_categories)
        categories.append(
            {"id": category_ids[category["id"]], "name": category["name"]}
        )

    taken: set[str] = set()
    scenes: list[dict[str, Any]] = []
    for preset in data["presets"]:
        if preset["categoryId"] not in category_ids:
            continue
        scene_id = slug(preset["name"], taken)
        points = [[round(p["x"], 4), round(p["y"], 4)] for p in preset["lights"]]
        scene: dict[str, Any] = {
            "id": scene_id,
            "name": preset["name"],
            "category": category_ids[preset["categoryId"]],
            "brightness": max(1, round(preset["bri"] / 254 * 100)),
        }
        mirek = white_mirek(*points[0]) if len(points) == 1 else None
        if mirek is not None:
            scene.update({"kind": "white", "mirek": mirek})
        else:
            scene.update({"kind": "gradient", "points": points})
        thumbnail(base / "assets" / preset["img"], thumbs / f"{scene_id}.jpg")
        scenes.append(scene)

    images = add_public_images(scenes)
    write(
        {
            "source": {"repo": REPO, "commit": commit},
            "categories": categories,
            "scenes": scenes,
        }
    )
    print(
        f"{len(scenes)} scenes in {len(categories)} categories "
        f"({images} with a Hue app picture id) -> {OUT}"
    )


def main() -> None:
    """Entry point."""
    if sys.argv[1:] == ["--images"]:
        gallery = json.loads((OUT / "gallery.json").read_text())
        images = add_public_images(gallery["scenes"])
        write(gallery)
        print(f"{images} scenes with a Hue app picture id")
        return
    if len(sys.argv) > 1:
        build(Path(sys.argv[1]))
        return
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["git", "clone", "-q", "--depth", "1", REPO, tmp], check=True)
        build(Path(tmp))


if __name__ == "__main__":
    main()
