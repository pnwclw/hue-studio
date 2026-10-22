"""Gallery pictures: the Hue app's own, downloaded once and kept in HA's cache.

The bundled tiles are clean-room stand-ins (scripts/build_gallery.py). A gallery scene
with a `picture` (the address of its picture in the Hue app's gallery) is served from
that picture instead: downloaded on first use into `.cache/hue_studio/gallery/` and from
there on served locally. Until it is there, when it can't be downloaded and for scenes
without one, the bundled tile is served.

A picture in `frontend/gallery/local/<scene id>.jpg` comes before all of them: pictures
an install has of its own and may not share (the Hue app's defaults, which it keeps
inside the app: `build_gallery.py --app-defaults`). The folder is not in the repository.
"""

from __future__ import annotations

import asyncio
from hashlib import sha256
from http import HTTPStatus
import logging
from pathlib import Path
import time

from aiohttp import ClientError, ClientTimeout, web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN
from .gallery import async_gallery_scenes

_LOGGER = logging.getLogger(__name__)

PICTURE_URL = f"/api/{DOMAIN}/gallery/{{scene_id}}.jpg"
THUMB_DIR = Path(__file__).parent / "frontend" / "gallery" / "thumb"
LOCAL_DIR = Path(__file__).parent / "frontend" / "gallery" / "local"
# Twice the 480x270 tile (sharp on phones), cropped to fill, as JPEG.
PICTURE_QUERY = {"w": "960", "h": "540", "fit": "fill", "fm": "jpg", "q": "80"}
MAX_BYTES = 2_000_000
TIMEOUT = ClientTimeout(total=20)
# A picture that failed to download is tried again after this many seconds.
RETRY_AFTER = 600
CACHED = "public, max-age=604800"


class GalleryPictureView(HomeAssistantView):
    """A gallery scene's picture: the Hue app's if it can be had, else the tile."""

    url = PICTURE_URL
    name = f"api:{DOMAIN}:gallery_picture"
    # Pictures are <img> and CSS backgrounds, which carry no token. Only gallery scenes
    # are served, from addresses in our own gallery.json.
    requires_auth = False

    def __init__(self, hass: HomeAssistant) -> None:
        """Remember where pictures are kept."""
        self.hass = hass
        self._dir = Path(hass.config.cache_path(DOMAIN, "gallery"))
        self._locks: dict[str, asyncio.Lock] = {}
        self._failed: dict[str, float] = {}

    async def get(self, request: web.Request, scene_id: str) -> web.StreamResponse:
        """Serve the picture of a gallery scene."""
        scene = (await async_gallery_scenes(self.hass)).get(scene_id)
        if scene is None:
            return web.Response(status=HTTPStatus.NOT_FOUND)
        local = LOCAL_DIR / f"{scene_id}.jpg"
        if await self.hass.async_add_executor_job(local.is_file):
            return web.FileResponse(local, headers={"Cache-Control": CACHED})
        if (url := scene.get("picture")) and (path := await self._picture(url)):
            return web.FileResponse(path, headers={"Cache-Control": CACHED})
        # The browser asks again next time, when the picture may be there.
        return web.FileResponse(
            THUMB_DIR / f"{scene_id}.jpg", headers={"Cache-Control": "no-cache"}
        )

    async def _picture(self, url: str) -> Path | None:
        """Return the cached picture, downloading it first; None if that failed."""
        path = self._dir / f"{sha256(url.encode()).hexdigest()[:20]}.jpg"
        if await self.hass.async_add_executor_job(path.is_file):
            return path
        if time.monotonic() < self._failed.get(url, 0):
            return None
        async with self._locks.setdefault(url, asyncio.Lock()):
            if await self.hass.async_add_executor_job(path.is_file):
                return path
            try:
                data = await self._download(url)
            except (ClientError, TimeoutError, ValueError) as err:
                _LOGGER.debug("Gallery picture %s not downloaded: %s", url, err)
                self._failed[url] = time.monotonic() + RETRY_AFTER
                return None
            await self.hass.async_add_executor_job(_write, path, data)
            self._failed.pop(url, None)
        return path

    async def _download(self, url: str) -> bytes:
        session = async_get_clientsession(self.hass)
        async with session.get(url, params=PICTURE_QUERY, timeout=TIMEOUT) as resp:
            resp.raise_for_status()
            if not resp.content_type.startswith("image/"):
                raise ValueError(f"not a picture: {resp.content_type}")
            data = bytearray()
            async for chunk in resp.content.iter_chunked(65536):
                data += chunk
                if len(data) > MAX_BYTES:
                    raise ValueError(f"over {MAX_BYTES} bytes")
            if (size := resp.headers.get("Content-Length")) and len(data) != int(size):
                raise ValueError(f"{len(data)} of {size} bytes")
        if not data:
            raise ValueError("empty")
        return bytes(data)


def _write(path: Path, data: bytes) -> None:
    """Write a picture whole, so a half-written file is never served."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    tmp.write_bytes(data)
    tmp.replace(path)
