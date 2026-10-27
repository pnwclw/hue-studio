"""Screenshots for the documentation, taken from the dev harness with headless Chrome.

The harness (dev/panel.html, dev/cards.html) renders the built panel with a fake `hass`
and neutral demo data, so nothing of a real home ends up in the pictures. Build first
(`npm run build`), then:

    uv run python scripts/docs_screenshots.py            # every shot
    uv run python scripts/docs_screenshots.py home room  # some of them

Pictures go to docs/assets/screenshots/<name>.webp. Phones are shot at 402 px (iPhone 17
Pro) with its safe areas; headless Chrome windows can't be narrower than ~500 px, so the
page pins the layout width (`w=`) and the shot is cropped. Chrome is found in the usual
places or taken from $CHROME.
"""

from __future__ import annotations

from functools import partial
import http.server
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "assets" / "screenshots"
PHONE = (402, 874)
DESKTOP = (1440, 900)

# name: (page, query, size). Phone shots get the safe areas of an iPhone 17 Pro.
SHOTS: dict[str, tuple[str, str, tuple[int, int]]] = {
    "home": ("panel", "", PHONE),
    "home-desktop": ("panel", "", DESKTOP),
    "room": ("panel", "path=/room/area.office", PHONE),
    "color": ("panel", "path=/room/area.living_room/color", PHONE),
    "gallery": ("panel", "path=/gallery&room=area.office", PHONE),
    "space": ("panel", "path=/room/area.living_room/space", PHONE),
    "rooms": ("panel", "path=/rooms&drift=1", PHONE),
    "automations": ("panel", "path=/automations", PHONE),
    "automation-new": ("panel", "path=/automations/new", PHONE),
    "daylight": ("panel", "path=/settings/daylight", PHONE),
    "settings": ("panel", "path=/settings", PHONE),
    "sync": ("panel", "path=/sync", PHONE),
    "more-info": ("panel", "moreinfo=light.desk_lamp", DESKTOP),
    "cards": ("cards", "", DESKTOP),
}

CHROMES = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
)


def main(names: list[str]) -> None:
    """Take the named shots (all without names)."""
    unknown = set(names) - set(SHOTS)
    if unknown:
        sys.exit(f"unknown shots: {', '.join(sorted(unknown))}")
    if not (ROOT / "dev" / "build" / "fixture.js").exists():
        sys.exit("build the frontend first: npm run build")
    chrome = _chrome()
    frame = _frame(chrome)
    OUT.mkdir(parents=True, exist_ok=True)
    handler = partial(_QuietHandler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_address[1]}/dev"
        for name in names or SHOTS:
            page, query, size = SHOTS[name]
            url = f"{base}/{page}.html?lang=en&{query}"
            _shoot(chrome, url, size, frame, OUT / f"{name}.webp")
            print(f"{name}: {OUT.relative_to(ROOT) / name}.webp")


def _shoot(chrome: str, url: str, size: tuple[int, int], frame: int, out: Path) -> None:
    width, height = size
    window = max(width, 520)
    if width < window:
        url += f"&w={width}&inset=59,34"
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "shot.png"
        # A blank shot (black, or only the page's background) is a headless quirk: a
        # shorter time budget fixes it.
        for budget in (6000, 3000, 1500):
            subprocess.run(
                [
                    chrome,
                    "--headless=new",
                    "--hide-scrollbars",
                    "--force-device-scale-factor=1",
                    f"--user-data-dir={Path(tmp) / 'profile'}",
                    f"--window-size={window},{height + frame}",
                    f"--virtual-time-budget={budget}",
                    f"--screenshot={png}",
                    url,
                ],
                check=True,
                capture_output=True,
                timeout=120,
            )
            image = Image.open(png).convert("RGB").crop((0, 0, width, height))
            if any(low != high for low, high in image.getextrema()):
                break
        image.save(out, "WEBP", quality=90, method=6)


def _frame(chrome: str) -> int:
    """How much taller a headless window is than the page inside it."""
    with tempfile.TemporaryDirectory() as tmp:
        dom = subprocess.run(
            [
                chrome,
                "--headless=new",
                f"--user-data-dir={tmp}",
                "--window-size=520,900",
                "--dump-dom",
                "data:text/html,<body><script>document.body.textContent=innerHeight"
                "</script>",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        ).stdout
    return 900 - int(dom.split("<body>")[1].split("<")[0])


def _chrome() -> str:
    for candidate in (os.environ.get("CHROME"), *CHROMES):
        if candidate and (Path(candidate).exists() or shutil.which(candidate)):
            return candidate
    sys.exit("Chrome not found: set $CHROME")


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        pass


if __name__ == "__main__":
    main(sys.argv[1:])
