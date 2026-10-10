"""Render the Hue Studio brand images into custom_components/hue_studio/brand/.

A plain text logo: "Hue Studio" set in Inter (SIL Open Font License), no artwork. It
deliberately imitates nothing of Philips Hue's own logo or lettering. Home Assistant
(2026.3+) shows a custom integration's `brand/` images instead of the brands CDN:

- icon: square, the name in two lines ("Hue" over "Studio");
- logo: the name in one line, trimmed to the text;
- dark_*: the same in light text for dark themes.

The font is downloaded once into the user cache directory.

    uv run python scripts/build_icon.py
"""

from __future__ import annotations

from pathlib import Path
import urllib.request

from PIL import Image, ImageDraw, ImageFont

BRAND = Path(__file__).parent.parent / "custom_components" / "hue_studio" / "brand"
FONT_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf"
FONT_CACHE = Path.home() / ".cache" / "hue_studio" / "Inter.ttf"
SUPERSAMPLE = 4

LIGHT_TEXT = (28, 28, 30, 255)
DARK_TEXT = (255, 255, 255, 255)
# "Hue" bold, "Studio" lighter: the name reads as one word pair without any decoration.
WEIGHT_HUE = 800
WEIGHT_STUDIO = 400
TRACKING = -0.02  # letter spacing, as a share of the font size


def font_path() -> Path:
    """Inter, downloaded on first use."""
    if not FONT_CACHE.exists():
        FONT_CACHE.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(FONT_URL) as response:
            FONT_CACHE.write_bytes(response.read())
    return FONT_CACHE


def font(size: float, weight: int) -> ImageFont.FreeTypeFont:
    face = ImageFont.truetype(str(font_path()), round(size))
    face.set_variation_by_axes([32, weight])  # optical size (display), weight
    return face


def draw_word(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float],
    text: str,
    face: ImageFont.FreeTypeFont,
    color: tuple[int, ...],
) -> float:
    """Draw `text` with tracking from `xy` (left, baseline); return the end x."""
    x, y = xy
    track = TRACKING * face.size
    for char in text:
        draw.text((x, y), char, font=face, fill=color, anchor="ls")
        x += face.getlength(char) + track
    return x - track


def word_width(text: str, face: ImageFont.FreeTypeFont) -> float:
    return sum(face.getlength(c) for c in text) + TRACKING * face.size * (len(text) - 1)


def trim(image: Image.Image, pad: int) -> Image.Image:
    """Crop to the text, keeping `pad` px of transparent margin."""
    left, top, right, bottom = image.getchannel("A").getbbox()
    return image.crop((left - pad, top - pad, right + pad, bottom + pad))


def render_icon(size: int, color: tuple[int, ...]) -> Image.Image:
    """Square: "Hue" over "Studio", both centered and as wide as the canvas allows."""
    big = size * SUPERSAMPLE
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    width = big * 0.86
    # Both lines fill the same width; "Studio" is the longer word, so it sets the size.
    studio_size = big * width / word_width("Studio", font(big, WEIGHT_STUDIO))
    hue_size = big * width / word_width("Hue", font(big, WEIGHT_HUE)) * 0.62
    hue, studio = font(hue_size, WEIGHT_HUE), font(studio_size, WEIGHT_STUDIO)
    hue_cap = hue.getbbox("H", anchor="ls")[1] * -1
    studio_cap = studio.getbbox("S", anchor="ls")[1] * -1
    gap = big * 0.06
    top = (big - (hue_cap + gap + studio_cap)) / 2
    hue_x = (big - word_width("Hue", hue)) / 2
    draw_word(draw, (hue_x, top + hue_cap), "Hue", hue, color)
    draw_word(
        draw,
        ((big - word_width("Studio", studio)) / 2, top + hue_cap + gap + studio_cap),
        "Studio",
        studio,
        color,
    )
    return image.resize((size, size), Image.Resampling.LANCZOS)


def render_logo(height: int, color: tuple[int, ...]) -> Image.Image:
    """One line, trimmed to the text with a small margin; `height` px tall."""
    size = 400 * SUPERSAMPLE
    hue, studio = font(size, WEIGHT_HUE), font(size, WEIGHT_STUDIO)
    space = hue.getlength(" ") * 0.9
    width = word_width("Hue", hue) + space + word_width("Studio", studio)
    image = Image.new("RGBA", (round(width + size), size * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    end = draw_word(draw, (size / 2, size * 1.3), "Hue", hue, color)
    draw_word(draw, (end + space, size * 1.3), "Studio", studio, color)
    image = trim(image, round(size * 0.12))
    return image.resize(
        (round(image.width * height / image.height), height), Image.Resampling.LANCZOS
    )


def main() -> None:
    BRAND.mkdir(parents=True, exist_ok=True)
    images = {
        "icon.png": render_icon(256, LIGHT_TEXT),
        "icon@2x.png": render_icon(512, LIGHT_TEXT),
        "dark_icon.png": render_icon(256, DARK_TEXT),
        "dark_icon@2x.png": render_icon(512, DARK_TEXT),
        "logo.png": render_logo(128, LIGHT_TEXT),
        "logo@2x.png": render_logo(256, LIGHT_TEXT),
        "dark_logo.png": render_logo(128, DARK_TEXT),
        "dark_logo@2x.png": render_logo(256, DARK_TEXT),
    }
    for name, image in images.items():
        image.save(BRAND / name, optimize=True)
        print(BRAND / name)


if __name__ == "__main__":
    main()
