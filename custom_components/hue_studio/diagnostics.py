"""Diagnostics: what a Sync Box paired with Hue Studio reports, as it reports it.

The box's whole state (GET /api/v1) with its registrations, Wi-Fi name and address
redacted, so what the Hue app shows can be matched with the box's own fields. The Hue
Studio entry and a box used through `huesyncbox` give their options only.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.const import CONF_ACCESS_TOKEN, CONF_HOST
from homeassistant.core import HomeAssistant

if TYPE_CHECKING:
    from . import HueStudioConfigEntry

TO_REDACT = {
    CONF_ACCESS_TOKEN,
    CONF_HOST,
    "accessToken",
    "registrations",
    "ipAddress",
    "ssid",
    "uniqueId",
    "bridgeUniqueId",
    "bridgeIpAddress",
    "username",
    "clientKey",
}


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: HueStudioConfigEntry
) -> dict[str, Any]:
    """The entry's data and options; a paired box's state as the box reports it."""
    data: dict[str, Any] = {
        "data": async_redact_data(dict(entry.data), TO_REDACT),
        "options": async_redact_data(dict(entry.options), TO_REDACT),
    }
    runtime = getattr(entry, "runtime_data", None)
    if runtime is not None and (box := runtime.sync) is not None:
        data["box"] = async_redact_data(box.api.last_response or {}, TO_REDACT)
    return data
