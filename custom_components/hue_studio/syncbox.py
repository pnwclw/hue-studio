"""A small client for the local API of the Hue Play HDMI Sync Box (API v1).

Only what Hue Studio needs: read the whole state, change execution (sync, mode,
intensity, input, entertainment area, brightness) and device settings, register and
unregister. No third-party library on purpose: Hue Studio must not pin anything that
another integration installed next to it (e.g. a Sync Box integration from HACS) also
requires.

The box serves HTTPS with a certificate signed by its own Philips root and issued to
its id (12 hex digits). Requests are verified against that root with the id as the
server name, so the connection is authenticated although the box has a LAN address.
"""

from __future__ import annotations

from http import HTTPStatus
import ssl
from typing import Any

from aiohttp import ClientError, ClientSession, ClientTimeout
from homeassistant.core import HomeAssistant
from homeassistant.util.json import json_loads

API_PATH = "/api/v1"
REQUEST_TIMEOUT = ClientTimeout(total=10)

# Error codes of the API (response body {"code": n, "message": "..."}).
_AUTH_CODES = {1, 2, 3}
# "Invalid state": registration while the button has not been held yet.
_INVALID_STATE = 16

# Root certificate of Sync Box devices, as published with aiohuesyncbox (Apache-2.0).
SYNC_BOX_CA = """
-----BEGIN CERTIFICATE-----
MIIBwDCCAWagAwIBAgIBATAKBggqhkjOPQQDAjA2MQswCQYDVQQGEwJOTDEUMBIG
A1UECgwLUGhpbGlwcyBIdWUxETAPBgNVBAMMCHJvb3QtaHNiMCAXDTE3MDEwMTAw
MDAwMFoYDzk5OTkxMjMxMjM1OTU5WjA2MQswCQYDVQQGEwJOTDEUMBIGA1UECgwL
UGhpbGlwcyBIdWUxETAPBgNVBAMMCHJvb3QtaHNiMFkwEwYHKoZIzj0CAQYIKoZI
zj0DAQcDQgAEr9FgOxnsonsrnUZr3C4ggST7YCR9wISvDuwlNdZcAz4HiVCNmAAP
tAnAFDG0U19Rmc4MfRYBMO8GrOHrOkZ7sKNjMGEwHQYDVR0OBBYEFCK+VIWZqp++
DHqmGLWEZHYdH9v7MB8GA1UdIwQYMBaAFCK+VIWZqp++DHqmGLWEZHYdH9v7MA8G
A1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgGGMAoGCCqGSM49BAMCA0gAMEUC
IAFDI0Q4IOPxV7cY4wSVOJAn4y5AdZwrItJ1XuNpmCltAiEA5c6wcu6qmF596uyA
r7xLnr3/F5zJxrE3AyLD4t+5oKs=
-----END CERTIFICATE-----
"""

_SSL_CONTEXT = "hue_studio_sync_box_ssl"


class SyncBoxError(Exception):
    """The Sync Box could not be reached or rejected a request."""


class SyncBoxAuthError(SyncBoxError):
    """The access token is missing, wrong or was revoked."""


class SyncBoxNotLinked(SyncBoxError):
    """Registration refused: the button on the box has not been held yet."""


async def async_ssl_context(hass: HomeAssistant) -> ssl.SSLContext:
    """SSL context trusting the Sync Box root (built once, off the event loop)."""
    if (context := hass.data.get(_SSL_CONTEXT)) is None:

        def build() -> ssl.SSLContext:
            ctx = ssl.create_default_context(cadata=SYNC_BOX_CA)
            # Box certificates carry their id only as the common name.
            ctx.hostname_checks_common_name = True
            return ctx

        context = hass.data[_SSL_CONTEXT] = await hass.async_add_executor_job(build)
    return context


async def async_get_device(session: ClientSession, host: str) -> dict[str, Any]:
    """Read the box's public device info (name, id, type) without a token.

    Used once while setting up, before the id (the certificate name) is known; the
    connection is not verified here, every later request is.
    """
    try:
        async with session.get(
            f"https://{host}{API_PATH}/device", ssl=False, timeout=REQUEST_TIMEOUT
        ) as resp:
            if resp.status != HTTPStatus.OK:
                raise SyncBoxError(f"Unexpected status {resp.status}")
            data = await resp.json(content_type=None)
    except (ClientError, TimeoutError, ValueError) as err:
        raise SyncBoxError(f"Cannot reach a Sync Box at {host}") from err
    if not isinstance(data, dict) or not data.get("uniqueId"):
        raise SyncBoxError(f"No Sync Box at {host}")
    return data


class SyncBox:
    """One Sync Box, addressed by host and verified by its id."""

    def __init__(
        self,
        session: ClientSession,
        context: ssl.SSLContext,
        host: str,
        box_id: str,
        token: str | None = None,
    ) -> None:
        """Store connection details; no I/O."""
        self._session = session
        self._context = context
        self.host = host
        self.box_id = box_id
        self.token = token

    async def state(self) -> dict[str, Any]:
        """Everything: device, hue, execution, hdmi, behavior (needs a token)."""
        data = await self._request("get", "")
        if not isinstance(data, dict) or "execution" not in data:
            raise SyncBoxError("Incomplete state")
        return data

    async def execution(self, changes: dict[str, Any]) -> None:
        """Change sync state; keys as in the API (camelCase), only those to change."""
        await self._request("put", "/execution", changes)

    async def device(self, changes: dict[str, Any]) -> None:
        """Change device settings (e.g. ledMode)."""
        await self._request("put", "/device", changes)

    async def register(self, app_name: str, instance_name: str) -> tuple[str, str]:
        """Register; returns (registration id, access token).

        Raises SyncBoxNotLinked until the button on the box has been held for a few
        seconds, so callers retry for a while.
        """
        data = await self._request(
            "post",
            "/registrations",
            {"appName": app_name, "instanceName": instance_name},
            auth=False,
        )
        if not isinstance(data, dict) or "accessToken" not in data:
            raise SyncBoxError("Registration returned no token")
        return str(data["registrationId"]), str(data["accessToken"])

    async def unregister(self, registration_id: str) -> None:
        """Remove our registration (only our own can be removed with our token)."""
        await self._request("delete", f"/registrations/{registration_id}")

    async def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        *,
        auth: bool = True,
    ) -> Any:
        headers = {}
        if auth and self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        try:
            async with self._session.request(
                method,
                f"https://{self.host}{API_PATH}{path}",
                json=body,
                headers=headers,
                ssl=self._context,
                server_hostname=self.box_id,
                timeout=REQUEST_TIMEOUT,
            ) as resp:
                text = await resp.text()
                data = json_loads(text) if text.strip() else None
                if resp.status == HTTPStatus.OK:
                    return data
                code = data.get("code") if isinstance(data, dict) else None
                if resp.status == HTTPStatus.UNAUTHORIZED or code in _AUTH_CODES:
                    raise SyncBoxAuthError(f"Unauthorized ({code})")
                if code == _INVALID_STATE:
                    raise SyncBoxNotLinked
                raise SyncBoxError(f"Request failed: {resp.status} {data}")
        except (ClientError, TimeoutError) as err:
            raise SyncBoxError(f"Cannot reach the Sync Box at {self.host}") from err
        except ValueError as err:
            raise SyncBoxError("Invalid response") from err
