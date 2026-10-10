"""Render the Hue Studio icon into custom_components/hue_studio/brand/.

The icon is the panel's own color wheel: hue around the circle, white towards the
center, with three light pins joined by a gradient line, as the wheel shows a gradient
light. Home Assistant (2026.3+) shows a custom integration's `brand/` images in the
integrations list instead of the brands CDN.

    uv run python scripts/build_icon.py
"""

from __future__ import annotations

import colorsys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

BRAND = Path(__file__).parent.parent / "custom_components" / "hue_studio" / "brand"
SUPERSAMPLE = 4
# Size of the canvas in units of the final image; everything below is in these units.
UNIT = 512

WHEEL_RADIUS = 0.47
# Pins: (angle in degrees, distance from the center as a share of the wheel radius).
PINS = [(32.0, 0.66), (300.0, 0.74), (196.0, 0.56)]
PIN_RADIUS = 0.082
PIN_RING = 0.022
LINE_WIDTH = 0.014


# Angle around the wheel (0-1, clockwise from the top) -> hue in degrees. Warm colors
# get more room and green less, closer to the Hue app's wheel than a plain HSV circle.
HUE_STOPS = (
    (0.0, 0.14, 0.26, 0.40, 0.55, 0.70, 0.85, 1.0),
    (0.0, 28.0, 52.0, 115.0, 190.0, 232.0, 288.0, 360.0),
)
MAX_SATURATION = 0.9


def hue_at(turn: np.ndarray | float) -> np.ndarray:
    """Hue (0-1) at a position around the wheel (0-1)."""
    return np.interp(np.asarray(turn) % 1.0, *HUE_STOPS) / 360.0


def saturation_at(dist: np.ndarray | float) -> np.ndarray:
    """White in the middle, rising towards the rim."""
    return np.clip(np.asarray(dist), 0, 1) ** 0.75 * MAX_SATURATION


def wheel_rgb(angle: np.ndarray, dist: np.ndarray) -> np.ndarray:
    """RGB 0-1 of the wheel: hue by angle, saturation rising from a white center."""
    hue = hue_at(angle / (2 * np.pi))
    sat = saturation_at(dist)
    # Vectorized HSV -> RGB with V = 1.
    i = np.floor(hue * 6).astype(int) % 6
    f = hue * 6 - np.floor(hue * 6)
    p = 1 - sat
    q = 1 - sat * f
    t = 1 - sat * (1 - f)
    one = np.ones_like(hue)
    r = np.choose(i, [one, q, p, p, t, one])
    g = np.choose(i, [t, one, one, q, p, p])
    b = np.choose(i, [p, p, t, one, one, q])
    # A slight darkening at the rim gives the disc some depth.
    shade = 1 - 0.1 * np.clip(dist, 0, 1) ** 8
    return np.stack([r, g, b], axis=-1) * shade[..., None]


def pin_color(angle_deg: float, dist: float) -> tuple[int, int, int]:
    """The wheel's color under a pin."""
    rgb = colorsys.hsv_to_rgb(
        float(hue_at(angle_deg / 360)), float(saturation_at(dist)), 1.0
    )
    return tuple(round(c * 255) for c in rgb)  # type: ignore[return-value]


def render(size: int) -> Image.Image:
    """The icon at `size` px (square, transparent background)."""
    big = size * SUPERSAMPLE
    s = big / UNIT  # pixels per unit
    center = big / 2
    radius = WHEEL_RADIUS * UNIT * s

    # Wheel: angle 0 at the top, clockwise (like the panel's wheel).
    ys, xs = np.mgrid[0:big, 0:big].astype(np.float64) + 0.5
    dx, dy = xs - center, ys - center
    dist = np.hypot(dx, dy) / radius
    angle = np.arctan2(dx, -dy)
    rgb = wheel_rgb(angle, dist)
    alpha = (dist <= 1.0).astype(np.float64)
    wheel = Image.fromarray(
        np.dstack([rgb * 255, alpha * 255]).round().astype(np.uint8), "RGBA"
    )

    def point(angle_deg: float, share: float) -> tuple[float, float]:
        a = np.radians(angle_deg)
        return (
            center + np.sin(a) * share * radius,
            center - np.cos(a) * share * radius,
        )

    points = [point(a, d) for a, d in PINS]
    pin_r = PIN_RADIUS * UNIT * s
    ring = PIN_RING * UNIT * s

    # Soft shadow under the pins and the line.
    shadow = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    offset = 0.012 * UNIT * s
    for x, y in points:
        sd.ellipse(
            (
                x - pin_r - ring,
                y - pin_r - ring + offset,
                x + pin_r + ring,
                y + pin_r + ring + offset,
            ),
            fill=(0, 0, 0, 110),
        )
    shadow = shadow.filter(ImageFilter.GaussianBlur(0.02 * UNIT * s))

    overlay = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.line(
        points,
        fill=(255, 255, 255, 235),
        width=round(LINE_WIDTH * UNIT * s),
        joint="curve",
    )
    for (x, y), (a, d) in zip(points, PINS, strict=True):
        od.ellipse(
            (x - pin_r - ring, y - pin_r - ring, x + pin_r + ring, y + pin_r + ring),
            fill=(255, 255, 255, 255),
        )
        od.ellipse(
            (x - pin_r, y - pin_r, x + pin_r, y + pin_r), fill=(*pin_color(a, d), 255)
        )

    image = Image.alpha_composite(wheel, shadow)
    # Shadows only on the wheel, not outside it.
    image.putalpha(wheel.getchannel("A"))
    image = Image.alpha_composite(image, overlay)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    BRAND.mkdir(parents=True, exist_ok=True)
    for name, size in (("icon.png", 256), ("icon@2x.png", 512)):
        render(size).save(BRAND / name, optimize=True)
        print(f"{BRAND / name}")


if __name__ == "__main__":
    main()
