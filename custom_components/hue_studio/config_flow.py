"""Config flow for Hue Studio.

A single step: pick one of the existing native `hue` config entries. Host and app
key are read from that entry, so no second pairing with the bridge button is needed.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers.selector import (
    EntitySelector,
    EntitySelectorConfig,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)
import voluptuous as vol

from .const import (
    CONF_GROUPS,
    CONF_HUE_ENTRY_ID,
    CONF_MOTION,
    CONF_ROOMS,
    CONF_TEMPERATURE,
    DOMAIN,
    GROUP_AUTO,
    GROUP_ZONE,
    HUE_CONF_API_VERSION,
    HUE_DOMAIN,
)
from .options import async_hue_groups, async_light_areas

CONF_GROUP = "group"
CONF_TARGET = "target"
CONF_ROOM = "room"


class HueStudioConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Hue Studio."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> HueStudioOptionsFlow:
        """Room mapping and sensors."""
        return HueStudioOptionsFlow()

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


class HueStudioOptionsFlow(OptionsFlow):
    """Map Hue rooms/zones onto HA areas and attach sensors to rooms.

    Works like a settings screen: a menu, a two-step editor for each part (pick the
    item, then edit it), back to the menu; "Save" stores everything at once.
    """

    def __init__(self) -> None:
        """Start from the stored options."""
        self._options: dict[str, Any] | None = None
        self._selected: str | None = None

    @property
    def _opts(self) -> dict[str, Any]:
        if self._options is None:
            self._options = deepcopy(dict(self.config_entry.options))
            self._options.setdefault(CONF_GROUPS, {})
            self._options.setdefault(CONF_ROOMS, {})
        return self._options

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Menu."""
        return self.async_show_menu(
            step_id="init", menu_options=["group_select", "room_select", "save"]
        )

    async def async_step_save(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Store the options."""
        return self.async_create_entry(data=self._opts)

    # ---- Hue room/zone -> HA area ----

    async def async_step_group_select(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Pick a Hue room or zone."""
        groups = async_hue_groups(self.hass, self.config_entry.data[CONF_HUE_ENTRY_ID])
        if not groups:
            return self.async_abort(reason="no_groups")
        if user_input is not None:
            self._selected = user_input[CONF_GROUP]
            return await self.async_step_group_target()
        areas = {
            area.id: area.name for area in ar.async_get(self.hass).async_list_areas()
        }
        options = [
            SelectOptionDict(
                value=g.unique_id,
                label=_group_label(
                    g.name, self._opts[CONF_GROUPS].get(g.unique_id), areas
                ),
            )
            for g in groups
        ]
        return self.async_show_form(
            step_id="group_select",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_GROUP): SelectSelector(
                        SelectSelectorConfig(
                            options=options, mode=SelectSelectorMode.LIST
                        )
                    )
                }
            ),
        )

    async def async_step_group_target(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Choose what a Hue room/zone is in HA: an area, a zone, or automatic."""
        assert self._selected is not None
        if user_input is not None:
            target = user_input[CONF_TARGET]
            groups = self._opts[CONF_GROUPS]
            if target == GROUP_AUTO:
                groups.pop(self._selected, None)
            else:
                groups[self._selected] = target
            return await self.async_step_init()
        name = next(
            (
                g.name
                for g in async_hue_groups(self.hass)
                if g.unique_id == self._selected
            ),
            self._selected,
        )
        options = [
            SelectOptionDict(value=GROUP_AUTO, label=GROUP_AUTO),
            SelectOptionDict(value=GROUP_ZONE, label=GROUP_ZONE),
            *(
                SelectOptionDict(value=area.id, label=area.name)
                for area in ar.async_get(self.hass).async_list_areas()
            ),
        ]
        current = self._opts[CONF_GROUPS].get(self._selected, GROUP_AUTO)
        return self.async_show_form(
            step_id="group_target",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_TARGET, default=current): SelectSelector(
                        SelectSelectorConfig(
                            options=options,
                            mode=SelectSelectorMode.DROPDOWN,
                            translation_key="group_target",
                        )
                    )
                }
            ),
            description_placeholders={"group": name},
        )

    # ---- sensors per room ----

    async def async_step_room_select(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Pick a room (HA area with Hue lights) or a Hue room/zone."""
        if user_input is not None:
            self._selected = user_input[CONF_ROOM]
            return await self.async_step_room_sensors()
        hue_entry_id = self.config_entry.data[CONF_HUE_ENTRY_ID]
        options = [
            *(
                SelectOptionDict(value=f"area.{area.id}", label=area.name)
                for area in async_light_areas(self.hass)
            ),
            *(
                SelectOptionDict(value=f"hue.{g.unique_id}", label=f"{g.name} (Hue)")
                for g in async_hue_groups(self.hass, hue_entry_id)
            ),
        ]
        if not options:
            return self.async_abort(reason="no_groups")
        return self.async_show_form(
            step_id="room_select",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_ROOM): SelectSelector(
                        SelectSelectorConfig(
                            options=options, mode=SelectSelectorMode.LIST
                        )
                    )
                }
            ),
        )

    async def async_step_room_sensors(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Motion and temperature sensors of the selected room."""
        assert self._selected is not None
        rooms = self._opts[CONF_ROOMS]
        if user_input is not None:
            value = {
                CONF_MOTION: user_input.get(CONF_MOTION, []),
                CONF_TEMPERATURE: user_input.get(CONF_TEMPERATURE, []),
            }
            if value[CONF_MOTION] or value[CONF_TEMPERATURE]:
                rooms[self._selected] = value
            else:
                rooms.pop(self._selected, None)
            return await self.async_step_init()
        current = rooms.get(self._selected, {})
        return self.async_show_form(
            step_id="room_sensors",
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        CONF_MOTION,
                        description={"suggested_value": current.get(CONF_MOTION, [])},
                    ): EntitySelector(
                        EntitySelectorConfig(
                            domain="binary_sensor",
                            device_class=["motion", "occupancy", "presence"],
                            multiple=True,
                        )
                    ),
                    vol.Optional(
                        CONF_TEMPERATURE,
                        description={
                            "suggested_value": current.get(CONF_TEMPERATURE, [])
                        },
                    ): EntitySelector(
                        EntitySelectorConfig(
                            domain="sensor", device_class="temperature", multiple=True
                        )
                    ),
                }
            ),
            description_placeholders={"room": self._room_name(self._selected)},
        )

    def _room_name(self, key: str) -> str:
        kind, _, ident = key.partition(".")
        if kind == "area":
            area = next(
                (a for a in async_light_areas(self.hass) if a.id == ident), None
            )
            return area.name if area else ident
        group = next(
            (g for g in async_hue_groups(self.hass) if g.unique_id == ident), None
        )
        return group.name if group else ident


def _group_label(name: str, target: str | None, areas: dict[str, str]) -> str:
    """Group name plus its current mapping, e.g. `Downstairs → Kitchen`."""
    if target in (None, GROUP_AUTO):
        return name
    return f"{name} → {areas.get(target, target)}"


def _is_supported(entry: ConfigEntry) -> bool:
    """Return True for enabled native Hue entries that talk CLIP v2."""
    return (
        entry.disabled_by is None
        and entry.unique_id is not None
        and entry.data.get(HUE_CONF_API_VERSION) == 2
    )
