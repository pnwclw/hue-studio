"""Config flow for Hue Studio.

A Hue bridge: pick one of the existing native `hue` config entries. Host and app key
are read from that entry, so no second pairing with the bridge button is needed.

A Hue Play HDMI Sync Box: found by zeroconf or entered by address, then paired by
holding its button (Hue Studio gets a registration of its own on the box) — or, when
the HACS `huesyncbox` integration has the box, used through that integration. One box
is only ever set up one way: both kinds of entries are keyed by the box id.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from copy import deepcopy
from typing import Any

from aiohuesyncbox import HueSyncBox, InvalidState, RequestError
from homeassistant.config_entries import (
    SOURCE_REAUTH,
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.const import CONF_ACCESS_TOKEN, CONF_HOST, CONF_NAME
from homeassistant.core import callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    EntitySelector,
    EntitySelectorConfig,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo
import voluptuous as vol

from .const import (
    CONF_BOX_ID,
    CONF_GROUPS,
    CONF_HUE_ENTRY_ID,
    CONF_KIND,
    CONF_MOTION,
    CONF_REGISTRATION_ID,
    CONF_ROOMS,
    CONF_SYNC_ENTRY_ID,
    CONF_TEMPERATURE,
    DOMAIN,
    GROUP_AUTO,
    GROUP_ZONE,
    HUE_CONF_API_VERSION,
    HUE_DOMAIN,
    KIND_SYNC_BOX,
    KIND_SYNC_BOX_LINK,
)
from .options import async_hue_groups, async_light_areas
from .sync import SyncBoxNotFound, async_get_box_id
from .sync_link import async_sync_box_entries, async_sync_box_entry_for

CONF_GROUP = "group"
CONF_TARGET = "target"
CONF_ROOM = "room"

APP_NAME = "Hue Studio"
# How long to wait for the button on the Sync Box to be held.
LINK_TIMEOUT = 60
LINK_RETRY = 1


class HueStudioConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Hue Studio."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> HueStudioOptionsFlow:
        """Room mapping and sensors."""
        return HueStudioOptionsFlow()

    def __init__(self) -> None:
        """Sync Box being paired: host, id and name."""
        self._host = ""
        self._box_id = ""
        self._box_name = ""
        self._link_task: asyncio.Task[tuple[str, str]] | None = None
        self._credentials: tuple[str, str] | None = None
        self._sync_entry: ConfigEntry | None = None

    @classmethod
    @callback
    def async_supports_options_flow(cls, config_entry: ConfigEntry) -> bool:
        """Only bridges have options (room mapping and sensors)."""
        return CONF_KIND not in config_entry.data

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """What to add: a Hue bridge or a Sync Box."""
        return self.async_show_menu(step_id="user", menu_options=["bridge", "sync_box"])

    async def async_step_bridge(
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
            step_id="bridge",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_HUE_ENTRY_ID, default=options[0]["value"]
                    ): SelectSelector(SelectSelectorConfig(options=options))
                }
            ),
        )

    # ---- Sync Box ----

    async def async_step_sync_box(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Pair directly, or use a box the Sync Box integration already has."""
        if not async_sync_box_entries(self.hass):
            return await self.async_step_sync_box_pair()
        return self.async_show_menu(
            step_id="sync_box",
            menu_options=["sync_box_pair", "sync_box_integration"],
        )

    async def async_step_sync_box_integration(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Pick a box of the `huesyncbox` integration; nothing to pair."""
        configured = {uid.upper() for uid in self._async_current_ids() if uid}
        available = {
            entry.entry_id: entry
            for entry in async_sync_box_entries(self.hass)
            if (entry.unique_id or "").upper() not in configured
        }
        if not available:
            return self.async_abort(reason="already_configured")
        if user_input is not None:
            self._sync_entry = available.get(user_input[CONF_SYNC_ENTRY_ID])
            if self._sync_entry is None:
                return self.async_abort(reason="sync_box_not_found")
            return await self._async_create_link()
        options = [
            SelectOptionDict(value=entry_id, label=entry.title)
            for entry_id, entry in available.items()
        ]
        return self.async_show_form(
            step_id="sync_box_integration",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_SYNC_ENTRY_ID, default=options[0]["value"]
                    ): SelectSelector(SelectSelectorConfig(options=options))
                }
            ),
        )

    async def async_step_sync_box_use_integration(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """The box being paired already belongs to the Sync Box integration."""
        assert self._sync_entry is not None
        if user_input is not None:
            return await self._async_create_link()
        return self.async_show_form(
            step_id="sync_box_use_integration",
            description_placeholders={
                CONF_NAME: self._box_name,
                "entry": self._sync_entry.title,
            },
        )

    async def _async_create_link(self) -> ConfigFlowResult:
        assert self._sync_entry is not None
        await self.async_set_unique_id((self._sync_entry.unique_id or "").upper())
        self._abort_if_unique_id_configured()
        return self.async_create_entry(
            title=self._sync_entry.title,
            data={
                CONF_KIND: KIND_SYNC_BOX_LINK,
                CONF_SYNC_ENTRY_ID: self._sync_entry.entry_id,
            },
        )

    async def async_step_sync_box_pair(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Address of the Sync Box."""
        errors: dict[str, str] = {}
        if user_input is not None:
            host = user_input[CONF_HOST].strip()
            try:
                box_id, name = await async_get_box_id(
                    async_get_clientsession(self.hass), host
                )
            except SyncBoxNotFound:
                errors["base"] = "cannot_connect"
            else:
                return await self._async_found_box(host, box_id, name)
        return self.async_show_form(
            step_id="sync_box_pair",
            data_schema=self.add_suggested_values_to_schema(
                vol.Schema({vol.Required(CONF_HOST): str}), user_input
            ),
            errors=errors,
        )

    async def async_step_zeroconf(
        self, discovery_info: ZeroconfServiceInfo
    ) -> ConfigFlowResult:
        """A Sync Box announced itself on the network."""
        box_id = discovery_info.properties.get("uniqueid")
        if not box_id:
            return self.async_abort(reason="not_sync_box")
        return await self._async_found_box(
            discovery_info.host,
            str(box_id),
            str(discovery_info.properties.get("name") or ""),
            confirm=True,
        )

    async def _async_found_box(
        self, host: str, box_id: str, name: str, *, confirm: bool = False
    ) -> ConfigFlowResult:
        await self.async_set_unique_id(box_id.upper())
        existing = next(
            (
                entry
                for entry in self._async_current_entries(include_ignore=False)
                if entry.unique_id == box_id.upper()
            ),
            None,
        )
        if existing is not None and existing.data.get(CONF_KIND) == KIND_SYNC_BOX_LINK:
            # Used through the Sync Box integration: that one follows the address.
            return self.async_abort(reason="already_configured")
        # A known box that moved to another address: just follow it.
        self._abort_if_unique_id_configured(updates={CONF_HOST: host})
        self._host, self._box_id = host, box_id.upper()
        self._box_name = name or "Sync Box"
        self.context["title_placeholders"] = {CONF_NAME: self._box_name}
        # The Sync Box integration has this box: use it instead of pairing again.
        if (sync_entry := async_sync_box_entry_for(self.hass, box_id)) is not None:
            self._sync_entry = sync_entry
            return await self.async_step_sync_box_use_integration()
        if confirm:
            return await self.async_step_sync_box_confirm()
        return await self.async_step_sync_box_link()

    async def async_step_sync_box_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Discovered: ask before pairing (pairing waits for the button)."""
        if user_input is not None:
            return await self.async_step_sync_box_link()
        return self.async_show_form(
            step_id="sync_box_confirm",
            description_placeholders={CONF_NAME: self._box_name},
            last_step=False,
        )

    async def async_step_sync_box_link(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Wait until the button on the box has been held."""
        if self._link_task is None:
            self._link_task = self.hass.async_create_task(self._async_register())
        if not self._link_task.done():
            return self.async_show_progress(
                step_id="sync_box_link",
                progress_action="press_button",
                progress_task=self._link_task,
                description_placeholders={CONF_NAME: self._box_name},
            )
        task, self._link_task = self._link_task, None
        try:
            self._credentials = task.result()
        except TimeoutError, RequestError:
            return self.async_show_progress_done(next_step_id="sync_box_retry")
        return self.async_show_progress_done(next_step_id="sync_box_finish")

    async def _async_register(self) -> tuple[str, str]:
        """(registration id, token) once the button on the box has been held."""
        instance = self.hass.config.location_name or "Home Assistant"
        async with (
            HueSyncBox(self._host, self._box_id) as api,
            asyncio.timeout(LINK_TIMEOUT),
        ):
            while True:
                try:
                    credentials = await api.register(APP_NAME, instance)
                except InvalidState:
                    # The box refuses until its button has been held.
                    await asyncio.sleep(LINK_RETRY)
                    continue
                if credentials is not None:
                    return credentials.registration_id, credentials.access_token
                await asyncio.sleep(LINK_RETRY)

    async def async_step_sync_box_retry(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """The button was not held in time (or the box went away): try again."""
        if user_input is not None:
            return await self.async_step_sync_box_link()
        return self.async_show_form(
            step_id="sync_box_retry",
            description_placeholders={CONF_NAME: self._box_name},
            errors={"base": "link_timeout"},
            last_step=False,
        )

    async def async_step_sync_box_finish(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Store the box with our registration."""
        assert self._credentials is not None
        registration_id, token = self._credentials
        data = {
            CONF_KIND: KIND_SYNC_BOX,
            CONF_HOST: self._host,
            CONF_BOX_ID: self._box_id,
            CONF_ACCESS_TOKEN: token,
            CONF_REGISTRATION_ID: registration_id,
        }
        if self.source == SOURCE_REAUTH:
            return self.async_update_reload_and_abort(
                self._get_reauth_entry(), data_updates=data
            )
        return self.async_create_entry(title=self._box_name, data=data)

    async def async_step_reauth(
        self, entry_data: Mapping[str, Any]
    ) -> ConfigFlowResult:
        """The box no longer accepts our token (e.g. it was reset): pair again."""
        entry = self._get_reauth_entry()
        self._host = entry_data[CONF_HOST]
        self._box_id = entry_data[CONF_BOX_ID]
        self._box_name = entry.title
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Explain, then wait for the button."""
        if user_input is not None:
            return await self.async_step_sync_box_link()
        return self.async_show_form(
            step_id="reauth_confirm",
            description_placeholders={CONF_NAME: self._box_name},
            last_step=False,
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
