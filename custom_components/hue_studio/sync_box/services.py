"""Sync Box services: what it does in one command (set_sync), its presets and remote
buttons."""

from __future__ import annotations

from typing import Any

from aiohuesyncbox import AiohuesyncboxException, ExecutionMode, HdmiSource, Ir
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
    callback,
)
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.service import (
    async_extract_entity_ids,
    async_register_admin_service,
)
import voluptuous as vol

from ..const import (
    CONF_KIND,
    CONF_SYNC_ENTRY_ID,
    DOMAIN,
    KIND_SYNC_BOX,
    KIND_SYNC_BOX_LINK,
)
from ..lights.targets import ATTR_BRIGHTNESS, BRIGHTNESS
from .coordinator import (
    INTENSITIES,
    PALETTES,
    SYNC_MODES,
    SyncBoxCoordinator,
    hue_target,
    inputs,
    ir_execution,
    pct_to_api,
)
from .follow import async_wake_source
from .link import SyncBoxLink

SERVICE_SET_SYNC = "set_sync"
SERVICE_SAVE_SYNC_PRESET = "save_sync_preset"
SERVICE_DELETE_SYNC_PRESET = "delete_sync_preset"
SERVICE_LEARN_SYNC_IR_CODE = "learn_sync_ir_code"
SERVICE_SET_SYNC_IR_CODE = "set_sync_ir_code"
SERVICE_DELETE_SYNC_IR_CODE = "delete_sync_ir_code"

ATTR_NAME = "name"
ATTR_MODE = "mode"
ATTR_PALETTE = "palette"
ATTR_POWER = "power"
ATTR_SYNC = "sync"
ATTR_INTENSITY = "intensity"
ATTR_INPUT = "input"
ATTR_AREA = "entertainment_area"
ATTR_BACKGROUND = "background_lighting"
ATTR_PRESET = "preset"
ATTR_CODE = "code"
ATTR_ACTION = "action"


SET_SYNC_SCHEMA = vol.All(
    cv.make_entity_service_schema(
        {
            vol.Optional(ATTR_POWER): cv.boolean,
            vol.Optional(ATTR_SYNC): cv.boolean,
            vol.Optional(ATTR_MODE): vol.In(SYNC_MODES),
            vol.Optional(ATTR_INTENSITY): vol.In(INTENSITIES),
            # input1-4 or the name given to the input.
            vol.Optional(ATTR_INPUT): cv.string,
            # Id or name of an entertainment area.
            vol.Optional(ATTR_AREA): cv.string,
            vol.Optional(ATTR_BRIGHTNESS): BRIGHTNESS,
            # Direct pairing only: music palette, background lighting, a preset.
            vol.Optional(ATTR_PALETTE): vol.In(list(PALETTES)),
            vol.Optional(ATTR_BACKGROUND): cv.boolean,
            # Id or name of a preset of the box.
            vol.Optional(ATTR_PRESET): cv.string,
        }
    ),
    cv.has_at_least_one_key(
        ATTR_POWER,
        ATTR_SYNC,
        ATTR_MODE,
        ATTR_INTENSITY,
        ATTR_INPUT,
        ATTR_AREA,
        ATTR_BRIGHTNESS,
        ATTR_PALETTE,
        ATTR_BACKGROUND,
        ATTR_PRESET,
    ),
)
# The box keeps names of presets and remote buttons in 24 bytes.
SYNC_NAME = vol.All(
    cv.string, vol.Length(min=1), lambda v: v.encode()[:24].decode(errors="ignore")
)
SAVE_SYNC_PRESET_SCHEMA = cv.make_entity_service_schema(
    {vol.Required(ATTR_NAME): SYNC_NAME}
)
DELETE_SYNC_PRESET_SCHEMA = cv.make_entity_service_schema(
    {vol.Required(ATTR_PRESET): cv.string}
)
LEARN_SYNC_IR_CODE_SCHEMA = cv.make_entity_service_schema({})
SET_SYNC_IR_CODE_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Required(ATTR_CODE): cv.matches_regex(r"^[0-9a-fA-F]{2,32}$"),
        vol.Required(ATTR_NAME): SYNC_NAME,
        # toggle_sync, mode_video, input:input2, preset:<id>, … (sync.IR_ACTIONS)
        vol.Required(ATTR_ACTION): cv.string,
    }
)
DELETE_SYNC_IR_CODE_SCHEMA = cv.make_entity_service_schema(
    {vol.Required(ATTR_CODE): cv.string}
)


@callback
def async_setup_services(hass: HomeAssistant) -> None:
    """Register the Sync Box services."""

    async def set_sync(call: ServiceCall) -> None:
        """Change a Sync Box in one command (power, sync, mode, input, …)."""
        for box in await _async_target_boxes(hass, call):
            if isinstance(box, SyncBoxLink):
                if {ATTR_PALETTE, ATTR_BACKGROUND, ATTR_PRESET} & set(call.data):
                    raise _link_unsupported(box.sync_entry.title)
                await box.async_set_sync(dict(call.data))
                continue
            if (source := call.data.get(ATTR_INPUT)) is not None:
                # Its source is turned on too (when it can be and sends no picture).
                await async_wake_source(hass, box, _input_id(box, source))
            if (preset := call.data.get(ATTR_PRESET)) is not None:
                preset_id = _preset_id(box, preset)
                await box.async_command(box.presets.activate(preset_id))
            if changes := _sync_changes(box, call.data):
                await box.async_set_state(**changes)

    async def save_sync_preset(call: ServiceCall) -> ServiceResponse:
        """Save what a box does now (mode, input, area, brightness, …) as a preset."""
        saved: dict[str, str | None] = {}
        for box in _direct_boxes(await _async_target_boxes(hass, call)):
            create = box.presets.create(call.data[ATTR_NAME], box.current_execution())
            try:
                saved[box.box_id] = await create
            except AiohuesyncboxException as err:
                raise _box_failed(box) from err
            await box.async_refresh()
        return {"presets": saved}

    async def delete_sync_preset(call: ServiceCall) -> None:
        for box in _direct_boxes(await _async_target_boxes(hass, call)):
            preset_id = _preset_id(box, call.data[ATTR_PRESET])
            await box.async_command(box.presets.delete(preset_id))

    async def learn_sync_ir_code(call: ServiceCall) -> None:
        """Listen for a remote button (the box stops after one code or 20 s)."""
        for box in _direct_boxes(await _async_target_boxes(hass, call)):
            await box.async_command(_ir(box).set_scanning(True))

    async def set_sync_ir_code(call: ServiceCall) -> None:
        """Make a remote button do something on the box."""
        execution = ir_execution(call.data[ATTR_ACTION])
        if execution is None:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="unknown_ir_action",
                translation_placeholders={"action": call.data[ATTR_ACTION]},
            )
        for box in _direct_boxes(await _async_target_boxes(hass, call)):
            if "preset" in execution:
                execution = {"preset": _preset_id(box, execution["preset"])}
            command = _ir(box).set_code(
                call.data[ATTR_CODE].lower(), call.data[ATTR_NAME], execution
            )
            await box.async_command(command)

    async def delete_sync_ir_code(call: ServiceCall) -> None:
        for box in _direct_boxes(await _async_target_boxes(hass, call)):
            await box.async_command(_ir(box).delete_code(call.data[ATTR_CODE].lower()))

    hass.services.async_register(
        DOMAIN, SERVICE_SET_SYNC, set_sync, schema=SET_SYNC_SCHEMA
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_SAVE_SYNC_PRESET,
        save_sync_preset,
        schema=SAVE_SYNC_PRESET_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
    for name, handler, schema in (
        (SERVICE_DELETE_SYNC_PRESET, delete_sync_preset, DELETE_SYNC_PRESET_SCHEMA),
        (SERVICE_LEARN_SYNC_IR_CODE, learn_sync_ir_code, LEARN_SYNC_IR_CODE_SCHEMA),
        (SERVICE_SET_SYNC_IR_CODE, set_sync_ir_code, SET_SYNC_IR_CODE_SCHEMA),
        (SERVICE_DELETE_SYNC_IR_CODE, delete_sync_ir_code, DELETE_SYNC_IR_CODE_SCHEMA),
    ):
        async_register_admin_service(hass, DOMAIN, name, handler, schema=schema)


async def _async_target_boxes(
    hass: HomeAssistant, call: ServiceCall
) -> list[SyncBoxCoordinator | SyncBoxLink]:
    """Sync Boxes owning any of the targeted entities.

    An entity of a box paired directly is ours; one of the `huesyncbox` integration
    counts when a Hue Studio entry uses that box.
    """
    registry = er.async_get(hass)
    links = {
        entry.data[CONF_SYNC_ENTRY_ID]: entry.runtime_data.link
        for entry in hass.config_entries.async_loaded_entries(DOMAIN)
        if entry.data.get(CONF_KIND) == KIND_SYNC_BOX_LINK
        and entry.runtime_data.link is not None
    }
    boxes: dict[str, SyncBoxCoordinator | SyncBoxLink] = {}
    for entity_id in sorted(await async_extract_entity_ids(call)):
        entry_id = (entry := registry.async_get(entity_id)) and entry.config_entry_id
        config_entry = hass.config_entries.async_get_entry(entry_id or "")
        if config_entry is not None and config_entry.entry_id in links:
            boxes[config_entry.entry_id] = links[config_entry.entry_id]
            continue
        if (
            config_entry is None
            or config_entry.domain != DOMAIN
            or config_entry.data.get(CONF_KIND) != KIND_SYNC_BOX
            or getattr(config_entry, "runtime_data", None) is None
            or config_entry.runtime_data.sync is None
        ):
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="not_sync_box",
                translation_placeholders={"entity_id": entity_id},
            )
        boxes[config_entry.entry_id] = config_entry.runtime_data.sync
    if not boxes:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="no_sync_box"
        )
    return list(boxes.values())


def _sync_changes(
    coordinator: SyncBoxCoordinator, data: dict[str, Any]
) -> dict[str, Any]:
    """`execution.set_state` arguments for a set_sync call (one command)."""
    if data.get(ATTR_POWER) is False:
        return {"mode": ExecutionMode.POWERSAVE}
    state = coordinator.state
    changes: dict[str, Any] = {}
    if (mode := data.get(ATTR_MODE)) is not None and data.get(ATTR_SYNC) is not False:
        changes["mode"] = ExecutionMode(mode)
    elif (sync := data.get(ATTR_SYNC)) is not None:
        changes["sync_active"] = sync
    elif data.get(ATTR_POWER) and not state.power:
        changes["mode"] = ExecutionMode.PASSTHROUGH
    settings = {
        "intensity": data.get(ATTR_INTENSITY),
        "background_lighting": data.get(ATTR_BACKGROUND),
        "palette": data.get(ATTR_PALETTE),
    }
    if any(v is not None for v in settings.values()):
        changes.update(coordinator.mode_changes(mode, **settings))
    if (source := data.get(ATTR_INPUT)) is not None:
        changes["hdmi_source"] = HdmiSource(_input_id(coordinator, source))
    if (area := data.get(ATTR_AREA)) is not None:
        changes["hue_target"] = hue_target(_area_id(coordinator, area))
    if (brightness := data.get(ATTR_BRIGHTNESS)) is not None:
        changes["brightness"] = pct_to_api(brightness)
    return changes


def _input_id(coordinator: SyncBoxCoordinator, value: str) -> str:
    for key, port in inputs(coordinator.api).items():
        if value in (key, port.name):
            return key
    raise ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key="unknown_input",
        translation_placeholders={"input": value},
    )


def _area_id(coordinator: SyncBoxCoordinator, value: str) -> str:
    for group in coordinator.api.hue.groups:
        if value in (group.id, group.name):
            return group.id
    raise ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key="unknown_area",
        translation_placeholders={"area": value},
    )


def _direct_boxes(
    boxes: list[SyncBoxCoordinator | SyncBoxLink],
) -> list[SyncBoxCoordinator]:
    """Boxes paired directly; presets and remote buttons are not offered through
    the huesyncbox integration."""
    for box in boxes:
        if isinstance(box, SyncBoxLink):
            raise _link_unsupported(box.sync_entry.title)
    return [box for box in boxes if isinstance(box, SyncBoxCoordinator)]


def _link_unsupported(name: str) -> ServiceValidationError:
    return ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key="sync_box_link_unsupported",
        translation_placeholders={"name": name},
    )


def _box_failed(box: SyncBoxCoordinator) -> HomeAssistantError:
    return HomeAssistantError(
        translation_domain=DOMAIN,
        translation_key="sync_box_command_failed",
        translation_placeholders={"name": box.box_name},
    )


def _preset_id(box: SyncBoxCoordinator, value: str) -> str:
    """A preset of the box by id or name."""
    for preset in box.api.presets:
        if value in (preset.id, preset.name):
            return preset.id
    raise ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key="unknown_sync_preset",
        translation_placeholders={"preset": value},
    )


def _ir(box: SyncBoxCoordinator) -> Ir:
    if box.api.ir is None:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="sync_box_no_ir",
            translation_placeholders={"name": box.box_name},
        )
    return box.api.ir
