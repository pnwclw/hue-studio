"""Config flow for Hue Studio.

A single step: pick one of the existing native `hue` config entries. Host and app
key are read from that entry, so no second pairing with the bridge button is needed.
"""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult
from homeassistant.helpers.selector import (
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
)
import voluptuous as vol

from .const import CONF_HUE_ENTRY_ID, DOMAIN, HUE_CONF_API_VERSION, HUE_DOMAIN


class HueStudioConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Hue Studio."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Let the user choose a Hue bridge configured by the native integration."""
        candidates = {
            entry.entry_id: entry
            for entry in self.hass.config_entries.async_entries(HUE_DOMAIN)
            if _is_supported(entry)
        }
        configured = self._async_current_ids(include_ignore=False)
        available = {
            entry_id: entry
            for entry_id, entry in candidates.items()
            if entry.unique_id not in configured
        }

        if user_input is not None:
            hue_entry = available.get(user_input[CONF_HUE_ENTRY_ID])
            if hue_entry is None:
                return self.async_abort(reason="bridge_not_found")
            await self.async_set_unique_id(hue_entry.unique_id)
            self._abort_if_unique_id_configured()
            return self.async_create_entry(
                title=hue_entry.title,
                data={CONF_HUE_ENTRY_ID: hue_entry.entry_id},
            )

        if not candidates:
            return self.async_abort(reason="no_bridges")
        if not available:
            return self.async_abort(reason="already_configured")

        options = [
            SelectOptionDict(value=entry_id, label=entry.title)
            for entry_id, entry in available.items()
        ]
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_HUE_ENTRY_ID, default=options[0]["value"]
                    ): SelectSelector(SelectSelectorConfig(options=options))
                }
            ),
        )


def _is_supported(entry: ConfigEntry) -> bool:
    """Return True for enabled native Hue entries that talk CLIP v2."""
    return (
        entry.disabled_by is None
        and entry.unique_id is not None
        and entry.data.get(HUE_CONF_API_VERSION) == 2
    )
