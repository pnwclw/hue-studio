"""Build the bundled scene gallery from Hypfer/hass-scene_presets (Apache-2.0).

Writes `custom_components/hue_studio/frontend/gallery/`:
  gallery.json   source, categories and scenes (see below)
  thumb/<id>.jpg 480x270 tiles

gallery.json:
  source: {repo, commit}
  categories: [{"id": "dreamy", "name": "Dreamy"}]
  scenes: [{"id": "ocean_dawn", "name": "Ocean dawn", "category": "dreamy",
            "brightness": 84, "kind": "gradient", "points": [[x, y], ...],
            "public_image": "<uuid>", "picture": "<url>"}
           | {..., "kind": "white", "mirek": 370}]

`public_image` is the id of the scene's picture in the Hue app (CLIP v2
`scene.metadata.image`, a `public_image` resource; the same on every bridge). Upstream
does not have it: it comes from `hue_public_images.json` (Hue app scene name -> id),
read off real bridges, and from `hue_scene_pictures.json`. Scenes created from the
gallery carry it, so the Hue app shows their picture, and bridge scenes are matched to
gallery pictures by it.

Upstream pictures are clean-room stand-ins, not the Hue app's. The Hue app loads its
gallery pictures from Signify's content service; `hue_scene_pictures.json` (picture
id -> Hue app scene name and the picture's address there) is read off the Hue app's own
copy of its gallery (`--pictures`). `picture` is that address: Home Assistant downloads
it once and keeps it in its cache (`pictures.py`); the bundled tile stands in until
then and for scenes without one. The pictures themselves are never in this repository.

Usage: uv run python scripts/build_gallery.py [path to a clone]
Without a path the upstream repository is shallow-cloned into a temporary directory.
`--images` only refreshes `public_image` and `picture` in the existing gallery.json.
`--pictures <file>` rewrites `hue_scene_pictures.json` from the Hue app's gallery
(its `CdpStorageScenes` file), then refreshes them.
`--app-defaults <apk>` puts the Hue app's pictures of the defaults (Read, Relax, …),
which it keeps inside the app, into `local/` for this install only: they are Signify's
and the folder is not in the repository (pictures.py serves it first). The Android app's
APK, or its XAPK.
"""

from __future__ import annotations

import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from typing import IO, Any
import unicodedata
import zipfile

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
# The size pictures.py asks the Hue app's pictures in.
PICTURE_SIZE = (960, 540)
APP_PACKAGE = "com.philips.lighting.hue2.apk"
APP_DEFAULTS = "assets/flutter_assets/packages/preset_scenes/assets/scenes/3x/recipes_"
PUBLIC_IMAGES = Path(__file__).resolve().parent / "hue_public_images.json"
PICTURES = Path(__file__).resolve().parent / "hue_scene_pictures.json"
# Scenes the Hue app has renamed since upstream recorded them (same colors), by our id;
# the id stays, so references to it keep working.
HUE_NAMES = {"miami": "Malibu pink"}


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


def thumbnail(
    src: Path | IO[bytes], dst: Path, size: tuple[int, int] = THUMB_SIZE
) -> None:
    """Center-crop to 16:9 and save a JPEG tile."""
    im = Image.open(src).convert("RGB")
    w, h = im.size
    tw, th = (w, round(w * 9 / 16)) if w * 9 / 16 <= h else (round(h * 16 / 9), h)
    box = ((w - tw) // 2, (h - th) // 2, (w + tw) // 2, (h + th) // 2)
    im.crop(box).resize(size, Image.Resampling.LANCZOS).save(
        dst, quality=78, optimize=True, progressive=True
    )


def import_app_defaults(src: Path) -> list[str]:
    """Write the Hue app's pictures of the defaults to `local/`; return their ids."""
    gallery = json.loads((OUT / "gallery.json").read_text())
    ids = {s["id"] for s in gallery["scenes"] if s["category"] == "defaults"}
    with zipfile.ZipFile(src) as outer:
        apk = (
            zipfile.ZipFile(io.BytesIO(outer.read(APP_PACKAGE)))
            if APP_PACKAGE in outer.namelist()
            else outer
        )
        local = OUT / "local"
        local.mkdir(exist_ok=True)
        done = []
        for scene_id in sorted(ids):
            name = f"{APP_DEFAULTS}{scene_id}.webp"
            if name in apk.namelist():
                picture = io.BytesIO(apk.read(name))
                thumbnail(picture, local / f"{scene_id}.jpg", PICTURE_SIZE)
                done.append(scene_id)
    return done


def add_public_images(scenes: list[dict[str, Any]]) -> tuple[int, int]:
    """Set `public_image` and `picture` where the Hue app's are known.

    Return how many scenes got a picture id and how many a picture.
    """
    pictures: dict[str, dict[str, str]] = json.loads(PICTURES.read_text())
    known = {
        name.casefold(): rid
        for name, rid in json.loads(PUBLIC_IMAGES.read_text()).items()
    }
    known |= {p["name"].casefold(): rid for rid, p in pictures.items()}
    ids = urls = 0
    for scene in scenes:
        scene.pop("public_image", None)
        scene.pop("picture", None)
        scene["name"] = HUE_NAMES.get(scene["id"], scene["name"])
        if (rid := known.get(scene["name"].casefold())) is None:
            continue
        scene["public_image"] = rid
        ids += 1
        if (picture := pictures.get(rid)) is not None:
            scene["picture"] = picture["picture"]
            urls += 1
    return ids, urls


def import_pictures(src: Path) -> int:
    """Rewrite `hue_scene_pictures.json` from the Hue app's gallery; return count.

    `src` is the app's `CdpStorageScenes`: {"jsonData": "<json>"} whose `scenes` map a
    picture id to the scene (`name`, `sceneImage.image.url`).
    """
    scenes = json.loads(json.loads(src.read_text())["jsonData"])["scenes"]
    pictures = {}
    for rid, scene in scenes.items():
        url = ((scene.get("sceneImage") or {}).get("image") or {}).get("url")
        if url:
            # Without the app's size query: pictures.py asks for its own.
            name = scene["name"].strip()
            pictures[rid] = {"name": name, "picture": url.split("?")[0]}
    PICTURES.write_text(
        json.dumps(dict(sorted(pictures.items())), indent=1, ensure_ascii=False) + "\n"
    )
    return len(pictures)


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

    ids, urls = add_public_images(scenes)
    write(
        {
            "source": {"repo": REPO, "commit": commit},
            "categories": categories,
            "scenes": scenes,
        }
    )
    print(
        f"{len(scenes)} scenes in {len(categories)} categories "
        f"({ids} with a Hue app picture id, {urls} with its picture) -> {OUT}"
    )


def main() -> None:
    """Entry point."""
    if sys.argv[1:2] == ["--app-defaults"] and len(sys.argv) == 3:
        done = import_app_defaults(Path(sys.argv[2]))
        print(f"{len(done)} defaults from the Hue app -> {OUT / 'local'}: {done}")
        return
    if sys.argv[1:2] == ["--pictures"] and len(sys.argv) == 3:
        print(f"{import_pictures(Path(sys.argv[2]))} Hue app pictures -> {PICTURES}")
    if sys.argv[1:2] in (["--images"], ["--pictures"]):
        gallery = json.loads((OUT / "gallery.json").read_text())
        ids, urls = add_public_images(gallery["scenes"])
        write(gallery)
        print(f"{ids} scenes with a Hue app picture id, {urls} with its picture")
        return
    if len(sys.argv) > 1:
        build(Path(sys.argv[1]))
        return
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["git", "clone", "-q", "--depth", "1", REPO, tmp], check=True)
        build(Path(tmp))


if __name__ == "__main__":
    main()
