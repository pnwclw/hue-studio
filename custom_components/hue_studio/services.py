"""Services: what the native `hue` integration cannot do.

Palettes, gradients, effects with their parameters, creating and editing scenes, and
the Sync Box; Hue rooms aligned with HA areas, zones.
"""

from __future__ import annotations

import base64
import json
import logging
from typing import Any

from aiohttp import ClientError
from aiohue.errors import AiohueException
from aiohue.v2.models.feature import (
    ColorFeatureBase,
    ColorFeaturePut,
    ColorPoint,
    ColorTemperatureFeaturePut,
    DimmingFeaturePut,
    DynamicsFeaturePut,
    EffectsFeaturePut,
    EffectStatus,
    EffectsV2ActionPut,
    EffectsV2FeaturePut,
    EffectsV2ParametersPut,
    GradientFeatureBase,
    GradientMode,
    GradientPoint,
    OnFeature,
    RecallAction,
    RecallFeature,
)
from aiohue.v2.models.light import LightPut
from aiohue.v2.models.resource import ResourceTypes
from aiohue.v2.models.scene import SceneMetadataPut, ScenePut
from aiohuesyncbox import AiohuesyncboxException, ExecutionMode, HdmiSource, Ir
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
    callback,
)
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.service import async_extract_entity_ids
from homeassistant.helpers.target import (
    TargetSelection,
    async_extract_referenced_entity_ids,
)
import voluptuous as vol

from .adaptive import async_mark_manual
from .const import (
    CONF_KIND,
    CONF_SYNC_ENTRY_ID,
    DOMAIN,
    HUE_DOMAIN,
    KIND_SYNC_BOX,
    KIND_SYNC_BOX_LINK,
)
from .gallery import async_get_gallery_scene
from .lights import (
    LIGHT_DOMAIN,
    NOT_EFFECTS,
    HueLight,
    async_resolve_lights,
    supported_effects,
)
from .positions import async_light_positions, spatial_colors
from .rooms import async_align
from .scenes import (
    SCENE_DOMAIN,
    HueGroup,
    HueScene,
    async_resolve_group,
    async_resolve_scenes,
    captured_actions,
    group_scene_names,
    is_resettable,
    light_entity_ids,
    new_scene,
    palette_actions,
    palette_feature,
    scene_lights,
    scene_post_json,
)
from .sync import (
    INTENSITIES,
    PALETTES,
    SYNC_MODES,
    SyncBoxCoordinator,
    async_streaming_lights,
    hue_target,
    inputs,
    ir_execution,
    pct_to_api,
)
from .sync_follow import async_wake_source
from .sync_link import SyncBoxLink

_LOGGER = logging.getLogger(__name__)

SERVICE_APPLY_PALETTE = "apply_palette"
SERVICE_SET_GRADIENT = "set_gradient"
SERVICE_SET_EFFECT = "set_effect"
SERVICE_CREATE_SCENE = "create_scene"
SERVICE_DELETE_SCENE = "delete_scene"
SERVICE_CREATE_ZONE = "create_zone"
SERVICE_SAVE_SCENE = "save_scene"
SERVICE_RESET_SCENE = "reset_scene"
SERVICE_RECALL_SCENE = "recall_scene"
SERVICE_SET_SYNC = "set_sync"
SERVICE_SAVE_SYNC_PRESET = "save_sync_preset"
SERVICE_DELETE_SYNC_PRESET = "delete_sync_preset"
SERVICE_LEARN_SYNC_IR_CODE = "learn_sync_ir_code"
SERVICE_SET_SYNC_IR_CODE = "set_sync_ir_code"
SERVICE_DELETE_SYNC_IR_CODE = "delete_sync_ir_code"
SERVICE_ALIGN_ROOMS = "align_rooms"
SERVICE_UPDATE_ZONE = "update_zone"
SERVICE_DELETE_ZONE = "delete_zone"

ATTR_GALLERY_SCENE = "gallery_scene"
ATTR_PALETTE = "palette"
ATTR_TRANSITION = "transition"
ATTR_POINTS = "points"
ATTR_MIREK = "mirek"
ATTR_BRIGHTNESS = "brightness"
ATTR_MODE = "mode"
ATTR_EFFECT = "effect"
ATTR_SPEED = "speed"
ATTR_XY_COLOR = "xy_color"
ATTR_NAME = "name"
ATTR_AUTO_DYNAMIC = "auto_dynamic"
ATTR_CAPTURE = "capture"
ATTR_SHUFFLE = "shuffle"
ATTR_RECALL = "recall"
ATTR_DYNAMIC = "dynamic"
ATTR_POWER = "power"
ATTR_SYNC = "sync"
ATTR_INTENSITY = "intensity"
ATTR_INPUT = "input"
ATTR_AREA = "entertainment_area"
ATTR_BACKGROUND = "background_lighting"
ATTR_PRESET = "preset"
ATTR_CODE = "code"
ATTR_ACTION = "action"
ATTR_DRY_RUN = "dry_run"
ATTR_COMPLETE_SCENES = "complete_scenes"
ATTR_DELETE_EMPTY_ROOMS = "delete_empty_rooms"
ATTR_KEEP_SPLIT_SCENES = "keep_split_scenes"
ATTR_LIGHTS = "lights"
ATTR_LAYOUT = "layout"
LAYOUTS = ("classic", "spatial")

XY_POINT = vol.All(
    vol.ExactSequence([vol.Coerce(float), vol.Coerce(float)]),
    vol.Length(min=2, max=2),
    lambda p: [min(1.0, max(0.0, v)) for v in p],
)
BRIGHTNESS = vol.All(vol.Coerce(float), vol.Range(min=1, max=100))
MIREK = vol.All(vol.Coerce(int), vol.Range(min=153, max=500))
# Percent, like the native `hue.activate_scene`; the bridge wants 0-1.
SPEED = vol.All(vol.Coerce(float), vol.Range(min=0, max=100))
# Seconds; the bridge takes up to 6000 s in 100 ms steps.
TRANSITION = vol.All(vol.Coerce(float), vol.Range(min=0, max=6000))
EFFECTS = [effect.value for effect in EffectStatus if effect != EffectStatus.UNKNOWN]

APPLY_PALETTE_SCHEMA = vol.All(
    cv.make_entity_service_schema(
        {
            # "gallery:<id>", "b64:<json palette>" or a gallery id.
            vol.Exclusive(ATTR_PALETTE, "palette"): cv.string,
            vol.Exclusive(ATTR_GALLERY_SCENE, "palette"): cv.string,
            vol.Exclusive(ATTR_POINTS, "palette"): vol.All(
                [XY_POINT], vol.Length(min=1, max=5)
            ),
            vol.Exclusive(ATTR_MIREK, "palette"): MIREK,
            vol.Optional(ATTR_BRIGHTNESS): BRIGHTNESS,
            vol.Optional(ATTR_TRANSITION): TRANSITION,
            # How gradient lights lay the colors out (if they support the mode).
            vol.Optional(ATTR_MODE): vol.In([mode.value for mode in GradientMode]),
            # "spatial": colors by where the lights stand (positions.py).
            vol.Optional(ATTR_LAYOUT, default="classic"): vol.In(LAYOUTS),
        }
    ),
    cv.has_at_least_one_key(ATTR_PALETTE, ATTR_GALLERY_SCENE, ATTR_POINTS, ATTR_MIREK),
)

INLINE_PALETTE = vol.Any(
    vol.Schema(
        {
            vol.Required("kind"): "white",
            vol.Required(ATTR_MIREK): MIREK,
            vol.Optional(ATTR_BRIGHTNESS): BRIGHTNESS,
        },
        extra=vol.REMOVE_EXTRA,
    ),
    vol.Schema(
        {
            vol.Optional("kind", default="gradient"): "gradient",
            vol.Required(ATTR_POINTS): vol.All([XY_POINT], vol.Length(min=1, max=5)),
            vol.Optional(ATTR_BRIGHTNESS): BRIGHTNESS,
        },
        extra=vol.REMOVE_EXTRA,
    ),
)

SET_GRADIENT_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Required(ATTR_POINTS): vol.All([XY_POINT], vol.Length(min=2, max=5)),
        vol.Optional(ATTR_MODE): vol.In([mode.value for mode in GradientMode]),
        vol.Optional(ATTR_BRIGHTNESS): BRIGHTNESS,
    }
)

SET_EFFECT_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Required(ATTR_EFFECT): vol.In(EFFECTS),
        vol.Optional(ATTR_SPEED): SPEED,
        vol.Exclusive(ATTR_XY_COLOR, "color"): XY_POINT,
        vol.Exclusive(ATTR_MIREK, "color"): MIREK,
        vol.Optional(ATTR_BRIGHTNESS): BRIGHTNESS,
    }
)

SCENE_NAME = vol.All(cv.string, vol.Strip, vol.Length(min=1, max=32))

# A gallery scene with `points`: its picture, the colors in that order (shuffled).
CREATE_SCENE_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Required(ATTR_NAME): SCENE_NAME,
        vol.Optional(ATTR_GALLERY_SCENE): cv.string,
        vol.Exclusive(ATTR_POINTS, "palette"): vol.All(
            [XY_POINT], vol.Length(min=1, max=9)
        ),
        vol.Exclusive(ATTR_MIREK, "palette"): MIREK,
        vol.Optional(ATTR_BRIGHTNESS): BRIGHTNESS,
    }
)

DELETE_SCENE_SCHEMA = cv.make_entity_service_schema({})

CREATE_ZONE_SCHEMA = cv.make_entity_service_schema(
    {vol.Required(ATTR_NAME): SCENE_NAME}
)

# Without a target: every Hue light; with one: only moves of the targeted lights.
ALIGN_ROOMS_SCHEMA = vol.Schema(
    {
        **cv.ENTITY_SERVICE_FIELDS,
        vol.Optional(ATTR_DRY_RUN, default=False): cv.boolean,
        vol.Optional(ATTR_COMPLETE_SCENES, default=True): cv.boolean,
        vol.Optional(ATTR_DELETE_EMPTY_ROOMS, default=False): cv.boolean,
        vol.Optional(ATTR_KEEP_SPLIT_SCENES, default=False): cv.boolean,
    }
)

UPDATE_ZONE_SCHEMA = vol.All(
    cv.make_entity_service_schema(
        {
            vol.Optional(ATTR_NAME): SCENE_NAME,
            vol.Optional(ATTR_LIGHTS): vol.All(cv.entity_ids, vol.Length(min=1)),
        }
    ),
    cv.has_at_least_one_key(ATTR_NAME, ATTR_LIGHTS),
)

DELETE_ZONE_SCHEMA = cv.make_entity_service_schema({})

SAVE_SCENE_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Optional(ATTR_NAME): SCENE_NAME,
        vol.Optional(ATTR_SPEED): SPEED,
        vol.Optional(ATTR_AUTO_DYNAMIC): cv.boolean,
        vol.Optional(ATTR_CAPTURE, default=True): cv.boolean,
    }
)

RESET_SCENE_SCHEMA = cv.make_entity_service_schema(
    {
        vol.Optional(ATTR_SHUFFLE, default=False): cv.boolean,
        vol.Optional(ATTR_RECALL, default=True): cv.boolean,
    }
)

RECALL_SCENE_SCHEMA = cv.make_entity_service_schema(
    {
        # Unset: as the scene is set up (its own auto-play).
        vol.Optional(ATTR_DYNAMIC): cv.boolean,
        vol.Optional(ATTR_BRIGHTNESS): BRIGHTNESS,
        vol.Optional(ATTR_TRANSITION): TRANSITION,
    }
)

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
    """Register the integration services."""

    async def apply_palette(call: ServiceCall) -> None:
        lights = await async_target_lights(hass, call)
        palette = await _async_palette(hass, call.data)
        brightness = call.data.get(ATTR_BRIGHTNESS, palette.get("brightness"))
        transition = call.data.get(ATTR_TRANSITION)
        mode = call.data.get(ATTR_MODE)
        spatial = (
            _spatial(hass, lights, palette)
            if call.data.get(ATTR_LAYOUT) == "spatial"
            else {}
        )
        # Sequential on purpose: one command per light, at most a handful per room;
        # aiohue additionally caps concurrent requests and retries on 429.
        for index, light in enumerate(lights):
            if (colors := spatial.get(light.resource.id)) is not None:
                put = _colors_put(light, colors, brightness, mode)
            else:
                put = _palette_put(light, palette, index, brightness, mode)
            if transition is not None:
                put.dynamics = DynamicsFeaturePut(duration=round(transition * 1000))
            await _async_update(light, put)
        await async_mark_manual(hass, _touched(call, lights))

    async def set_gradient(call: ServiceCall) -> None:
        lights = await async_target_lights(hass, call)
        points = call.data[ATTR_POINTS]
        for light in lights:
            if light.resource.gradient is None:
                raise ServiceValidationError(
                    translation_domain=DOMAIN,
                    translation_key="not_gradient_light",
                    translation_placeholders={"entity_id": light.entity_id},
                )
        for light in lights:
            put = _base_put(call.data.get(ATTR_BRIGHTNESS))
            put.gradient = _gradient(light, points, call.data.get(ATTR_MODE))
            await _async_update(light, put)
        await async_mark_manual(hass, _touched(call, lights))

    async def set_effect(call: ServiceCall) -> None:
        lights = await async_target_lights(hass, call)
        effect = EffectStatus(call.data[ATTR_EFFECT])
        if effect != EffectStatus.NO_EFFECT:
            for light in lights:
                if effect not in supported_effects(light.resource):
                    raise ServiceValidationError(
                        translation_domain=DOMAIN,
                        translation_key="effect_not_supported",
                        translation_placeholders={
                            "entity_id": light.entity_id,
                            "effect": effect.value,
                        },
                    )
        for light in lights:
            await _async_update(light, _effect_put(light, effect, call.data))
        await async_mark_manual(hass, _touched(call, lights))

    async def create_scene(call: ServiceCall) -> ServiceResponse:
        """Create a scene in a Hue room or zone, from a palette or the lights' state.

        It lives on the bridge, so the Hue app shows it (with the gallery picture when
        made from a gallery scene) and the native integration adds its entity.
        """
        found = await async_extract_entity_ids(call, expand_group=False)
        if len(found) != 1:
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key="one_group"
            )
        group = async_resolve_group(hass, found.pop())
        name = call.data[ATTR_NAME]
        if name.casefold() in group_scene_names(group):
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="scene_name_taken",
                translation_placeholders={"name": name},
            )
        palette = image = None
        if call.data.keys() & {ATTR_GALLERY_SCENE, ATTR_POINTS, ATTR_MIREK}:
            colors = {k: v for k, v in call.data.items() if k != ATTR_GALLERY_SCENE}
            own = ATTR_POINTS in call.data or ATTR_MIREK in call.data
            source = await _async_palette(hass, colors if own else call.data)
            palette = palette_feature(source, call.data.get(ATTR_BRIGHTNESS))
            image = source.get("public_image")
            if own and ATTR_GALLERY_SCENE in call.data:
                gallery = {ATTR_GALLERY_SCENE: call.data[ATTR_GALLERY_SCENE]}
                image = (await _async_palette(hass, gallery)).get("public_image")
        post = new_scene(group, name, palette, image)
        try:
            created = await group.bridge.request(
                "post",
                "clip/v2/resource/scene",
                json=scene_post_json(post),
            )
        except (AiohueException, ClientError, TimeoutError) as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="command_failed",
                translation_placeholders={"entity_id": group.entity_id},
            ) from err
        return {"scene_id": created[0]["rid"] if created else None}

    async def delete_scene(call: ServiceCall) -> None:
        """Delete scenes from the bridge (and so from the Hue app and HA)."""
        for scene in await _async_target_scenes(hass, call):
            try:
                await scene.bridge.request(
                    "delete", f"clip/v2/resource/scene/{scene.resource.id}"
                )
            except (AiohueException, ClientError, TimeoutError) as err:
                raise HomeAssistantError(
                    translation_domain=DOMAIN,
                    translation_key="command_failed",
                    translation_placeholders={"entity_id": scene.entity_id},
                ) from err

    async def create_zone(call: ServiceCall) -> ServiceResponse:
        """Create a Hue zone of the targeted lights (e.g. all Hue lights of an area).

        Scenes live in Hue rooms and zones; an area without one gets a zone, which then
        matches the area automatically (same lights) and shows up in the Hue app.
        """
        lights = await async_target_lights(hass, call, skip_streaming=False)
        bridges = {id(light.bridge): light.bridge for light in lights}
        if len(bridges) != 1:
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key="one_bridge"
            )
        bridge = lights[0].bridge
        body = {
            "type": "zone",
            "metadata": {"name": call.data[ATTR_NAME], "archetype": "other"},
            "children": [
                {"rid": light.resource.id, "rtype": "light"} for light in lights
            ],
        }
        try:
            created = await bridge.request("post", "clip/v2/resource/zone", json=body)
        except (AiohueException, ClientError, TimeoutError) as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="command_failed",
                translation_placeholders={"entity_id": lights[0].entity_id},
            ) from err
        return {"zone_id": created[0]["rid"] if created else None}

    async def update_zone(call: ServiceCall) -> None:
        """Rename a Hue zone or give it other lights (rooms are aligned instead)."""
        found = await async_extract_entity_ids(call, expand_group=False)
        if len(found) != 1:
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key="one_group"
            )
        zone = _resolve_zone(hass, found.pop())
        body: dict[str, Any] = {}
        if ATTR_NAME in call.data:
            body["metadata"] = {"name": call.data[ATTR_NAME]}
        if ATTR_LIGHTS in call.data:
            lights = async_resolve_lights(hass, call.data[ATTR_LIGHTS])
            if any(light.bridge is not zone.bridge for light in lights):
                raise ServiceValidationError(
                    translation_domain=DOMAIN, translation_key="one_bridge"
                )
            body["children"] = [
                {"rid": light.resource.id, "rtype": "light"} for light in lights
            ]
        await _async_zone_request(
            zone, "put", f"clip/v2/resource/zone/{zone.group.rid}", body
        )

    async def delete_zone(call: ServiceCall) -> None:
        """Delete Hue zones (with their scenes) from the bridge."""
        found = await async_extract_entity_ids(call, expand_group=False)
        zones = [_resolve_zone(hass, entity_id) for entity_id in sorted(found)]
        if not zones:
            raise ServiceValidationError(
                translation_domain=DOMAIN, translation_key="one_group"
            )
        for zone in zones:
            await _async_zone_request(
                zone, "delete", f"clip/v2/resource/zone/{zone.group.rid}", None
            )

    async def align_rooms(call: ServiceCall) -> ServiceResponse:
        """Bring the bridge's rooms in line with the HA areas (or show the plan)."""
        only: set[str] | None = None
        if set(call.data) & set(cv.ENTITY_SERVICE_FIELDS):
            lights = await async_target_lights(hass, call, skip_streaming=False)
            only = {light.entity_id for light in lights}
        return await async_align(
            hass,
            only=only,
            dry_run=call.data[ATTR_DRY_RUN],
            complete_scenes=call.data[ATTR_COMPLETE_SCENES],
            delete_empty=call.data[ATTR_DELETE_EMPTY_ROOMS],
            keep_split_scenes=call.data[ATTR_KEEP_SPLIT_SCENES],
        )

    async def save_scene(call: ServiceCall) -> None:
        """Store what the scene's lights show now (plus name/speed/auto-play).

        `capture` off keeps the scene's lights as they are: only the name, speed or
        auto-play change (a playing dynamic scene would be caught mid-way otherwise).
        """
        for scene in await _async_target_scenes(hass, call):
            put = ScenePut()
            if call.data[ATTR_CAPTURE]:
                put.actions = captured_actions(scene)
            if ATTR_NAME in call.data:
                put.metadata = SceneMetadataPut(name=call.data[ATTR_NAME])
            if ATTR_SPEED in call.data:
                put.speed = call.data[ATTR_SPEED] / 100
            if ATTR_AUTO_DYNAMIC in call.data:
                put.auto_dynamic = call.data[ATTR_AUTO_DYNAMIC]
            await _async_update_scene(scene, put)

    async def reset_scene(call: ServiceCall) -> None:
        """Rebuild the scene from its palette and show it."""
        scenes = await _async_target_scenes(hass, call)
        for scene in scenes:
            if not is_resettable(scene.resource):
                raise ServiceValidationError(
                    translation_domain=DOMAIN,
                    translation_key="scene_not_resettable",
                    translation_placeholders={"entity_id": scene.entity_id},
                )
        for scene in scenes:
            actions = palette_actions(scene, call.data[ATTR_SHUFFLE])
            await _async_update_scene(scene, ScenePut(actions=actions))
            if call.data[ATTR_RECALL]:
                try:
                    await scene.bridge.scenes.scene.recall(scene.resource.id)
                except (AiohueException, ClientError, TimeoutError) as err:
                    raise HomeAssistantError(
                        translation_domain=DOMAIN,
                        translation_key="command_failed",
                        translation_placeholders={"entity_id": scene.entity_id},
                    ) from err
                await async_mark_manual(
                    hass, light_entity_ids(hass, scene_lights(scene))
                )

    async def recall_scene(call: ServiceCall) -> None:
        """Play a scene dynamically or statically, or as it is set up."""
        dynamic = call.data.get(ATTR_DYNAMIC)
        action = (
            RecallAction.ACTIVE
            if dynamic is None
            else RecallAction.DYNAMIC_PALETTE
            if dynamic
            else RecallAction.STATIC
        )
        for scene in await _async_target_scenes(hass, call):
            recall = RecallFeature(action=action)
            if (brightness := call.data.get(ATTR_BRIGHTNESS)) is not None:
                recall.dimming = DimmingFeaturePut(brightness=brightness)
            if (transition := call.data.get(ATTR_TRANSITION)) is not None:
                recall.duration = round(transition * 1000)
            await _async_update_scene(scene, ScenePut(recall=recall))
            await async_mark_manual(hass, light_entity_ids(hass, scene_lights(scene)))

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
        hass.services.async_register(DOMAIN, name, handler, schema=schema)
    hass.services.async_register(
        DOMAIN, SERVICE_RECALL_SCENE, recall_scene, schema=RECALL_SCENE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_APPLY_PALETTE, apply_palette, schema=APPLY_PALETTE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_EFFECT, set_effect, schema=SET_EFFECT_SCHEMA
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_CREATE_SCENE,
        create_scene,
        schema=CREATE_SCENE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_DELETE_SCENE, delete_scene, schema=DELETE_SCENE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_CREATE_ZONE,
        create_zone,
        schema=CREATE_ZONE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_UPDATE_ZONE, update_zone, schema=UPDATE_ZONE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_DELETE_ZONE, delete_zone, schema=DELETE_ZONE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_ALIGN_ROOMS,
        align_rooms,
        schema=ALIGN_ROOMS_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SAVE_SCENE, save_scene, schema=SAVE_SCENE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_RESET_SCENE, reset_scene, schema=RESET_SCENE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_GRADIENT, set_gradient, schema=SET_GRADIENT_SCHEMA
    )


async def async_target_lights(
    hass: HomeAssistant, call: ServiceCall, *, skip_streaming: bool = True
) -> list[HueLight]:
    """Resolve the service target; explicitly listed entities keep their order.

    Areas, devices and labels contribute their Hue lights (and Hue rooms/zones) only;
    an explicitly listed light that is not a Hue light is an error. Lights that an
    entertainment area streams to right now (Sync Box, PC or TV sync) are left alone:
    the stream would overwrite the command anyway.
    """
    selected = async_extract_referenced_entity_ids(
        hass, TargetSelection(call.data), expand_group=False
    )
    registry = er.async_get(hass)
    indirect = {
        entity_id
        for entity_id in selected.indirectly_referenced
        if (entry := registry.async_get(entity_id)) is not None
        and entry.domain == LIGHT_DOMAIN
        and entry.platform == HUE_DOMAIN
    }
    found = selected.referenced | indirect
    explicit = [e for e in _explicit_ids(call) if e in found]
    ordered = explicit + sorted(found.difference(explicit))
    if not ordered:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="no_lights"
        )
    lights = async_resolve_lights(hass, ordered)
    if skip_streaming and (streaming := async_streaming_lights(hass)):
        skipped = [light.entity_id for light in lights if light.entity_id in streaming]
        if skipped:
            _LOGGER.debug("Skipping lights that are syncing: %s", skipped)
            lights = [light for light in lights if light.entity_id not in streaming]
            if not lights:
                raise ServiceValidationError(
                    translation_domain=DOMAIN,
                    translation_key="lights_syncing",
                    translation_placeholders={"entity_id": ", ".join(skipped)},
                )
    return lights


def _resolve_zone(hass: HomeAssistant, entity_id: str) -> HueGroup:
    """The Hue zone behind a grouped light entity (a Hue room is an error)."""
    group = async_resolve_group(hass, entity_id)
    if group.group.rtype != ResourceTypes.ZONE:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="not_hue_zone",
            translation_placeholders={"entity_id": entity_id},
        )
    return group


async def _async_zone_request(
    zone: HueGroup, method: str, path: str, body: dict[str, Any] | None
) -> None:
    try:
        if body is None:
            await zone.bridge.request(method, path)
        else:
            await zone.bridge.request(method, path, json=body)
    except (AiohueException, ClientError, TimeoutError) as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="command_failed",
            translation_placeholders={"entity_id": zone.entity_id},
        ) from err


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


async def _async_target_scenes(
    hass: HomeAssistant, call: ServiceCall
) -> list[HueScene]:
    """Resolve the service target to Hue scenes."""
    found = await async_extract_entity_ids(call)
    ids = sorted(e for e in found if e.startswith(f"{SCENE_DOMAIN}."))
    if not ids:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="no_scenes"
        )
    return async_resolve_scenes(hass, ids)


async def _async_palette(hass: HomeAssistant, data: dict[str, Any]) -> dict[str, Any]:
    """Return a palette dict: {"kind": "gradient", "points": [...]} or white."""
    if (reference := data.get(ATTR_PALETTE)) is not None:
        if reference.startswith("b64:"):
            return _inline_palette(reference[4:])
        data = {ATTR_GALLERY_SCENE: reference.removeprefix("gallery:")}
    if (scene_id := data.get(ATTR_GALLERY_SCENE)) is not None:
        scene = await async_get_gallery_scene(hass, scene_id)
        if scene is None:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="unknown_gallery_scene",
                translation_placeholders={"scene": scene_id},
            )
        return scene
    if ATTR_MIREK in data:
        return {"kind": "white", "mirek": data[ATTR_MIREK]}
    return {"kind": "gradient", "points": data[ATTR_POINTS]}


def _inline_palette(encoded: str) -> dict[str, Any]:
    """A palette passed as base64 JSON: {"kind": "white", "mirek"} or with "points"."""
    try:
        palette = json.loads(base64.b64decode(encoded, validate=True))
        return INLINE_PALETTE(palette)
    except (ValueError, TypeError, vol.Invalid) as err:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="bad_palette"
        ) from err


def _touched(call: ServiceCall, lights: list[HueLight]) -> list[str]:
    """Lights we changed plus the groups the caller named (AL may list either)."""
    return [light.entity_id for light in lights] + _explicit_ids(call)


def _explicit_ids(call: ServiceCall) -> list[str]:
    """Entity ids listed in the call (not "all", not area/device targets)."""
    ids = call.data.get(ATTR_ENTITY_ID, [])
    return [] if isinstance(ids, str) else list(ids)


def _base_put(brightness: float | None) -> LightPut:
    put = LightPut(on=OnFeature(on=True))
    if brightness is not None:
        put.dimming = DimmingFeaturePut(brightness=brightness)
    return put


def _palette_put(
    light: HueLight,
    palette: dict[str, Any],
    index: int,
    brightness: float | None,
    mode: str | None = None,
) -> LightPut:
    """Gradient lights get the whole palette, other lights one color each."""
    put = _base_put(brightness)
    resource = light.resource
    if palette["kind"] == "white":
        if resource.color_temperature is not None:
            schema = resource.color_temperature.mirek_schema
            mirek = min(
                schema.mirek_maximum, max(schema.mirek_minimum, palette["mirek"])
            )
            put.color_temperature = ColorTemperatureFeaturePut(mirek=mirek)
        return put
    points: list[list[float]] = palette["points"]
    if resource.gradient is not None and len(points) >= 2:
        supported = {m.value for m in resource.gradient.mode_values}
        put.gradient = _gradient(light, points, mode if mode in supported else None)
    elif resource.color is not None:
        x, y = points[index % len(points)]
        put.color = ColorFeaturePut(xy=ColorPoint(x, y))
    return put


def _spatial(
    hass: HomeAssistant, lights: list[HueLight], palette: dict[str, Any]
) -> dict[str, list[tuple[float, float]]]:
    """Colors per light (resource id) by position; lights without one are left out."""
    if palette["kind"] != "gradient" or len(palette["points"]) < 2:
        return {}
    positions = async_light_positions(hass, lights)
    counts = {
        light.resource.id: light.resource.gradient.points_capable
        if light.resource.gradient and light.resource.gradient.points_capable >= 2
        else 1
        for light in lights
    }
    points = [(x, y) for x, y in palette["points"]]
    return spatial_colors(points, positions, counts)


def _colors_put(
    light: HueLight,
    colors: list[tuple[float, float]],
    brightness: float | None,
    mode: str | None,
) -> LightPut:
    """Exact colors for one light: a gradient, or one color."""
    put = _base_put(brightness)
    resource = light.resource
    if resource.gradient is not None and len(colors) >= 2:
        supported = {m.value for m in resource.gradient.mode_values}
        put.gradient = _gradient(
            light, [list(c) for c in colors], mode if mode in supported else None
        )
    elif resource.color is not None:
        put.color = ColorFeaturePut(xy=ColorPoint(*colors[0]))
    return put


def _gradient(
    light: HueLight, points: list[list[float]], mode: str | None
) -> GradientFeatureBase:
    capable = light.resource.gradient.points_capable if light.resource.gradient else 0
    return GradientFeatureBase(
        points=[
            GradientPoint(color=ColorFeatureBase(xy=ColorPoint(x, y)))
            for x, y in points[: capable or None]
        ],
        mode=GradientMode(mode) if mode else None,
    )


def _effect_put(
    light: HueLight, effect: EffectStatus, data: dict[str, Any]
) -> LightPut:
    """Start (or stop, with no_effect) an effect; effects_v2 carries its parameters."""
    put = _base_put(data.get(ATTR_BRIGHTNESS))
    resource = light.resource
    if effect == EffectStatus.NO_EFFECT and not any(
        _running(e) for e in (resource.effects_v2, resource.effects)
    ):
        # Stopping an effect that does not run can upset the bridge (as the native
        # integration notes); just make sure the light is on.
        return put
    if resource.effects_v2 is None:
        put.effects = EffectsFeaturePut(effect=effect)
        return put
    params = EffectsV2ParametersPut()
    if (xy := data.get(ATTR_XY_COLOR)) is not None:
        params.color = ColorFeaturePut(xy=ColorPoint(*xy))
    if (mirek := data.get(ATTR_MIREK)) is not None and resource.color_temperature:
        schema = resource.color_temperature.mirek_schema
        mirek = min(schema.mirek_maximum, max(schema.mirek_minimum, mirek))
        params.color_temperature = ColorTemperatureFeaturePut(mirek=mirek)
    if (speed := data.get(ATTR_SPEED)) is not None:
        params.speed = speed / 100
    has_params = any(v is not None for v in vars(params).values())
    put.effects_v2 = EffectsV2FeaturePut(
        action=EffectsV2ActionPut(
            effect=effect,
            parameters=params
            if has_params and effect != EffectStatus.NO_EFFECT
            else None,
        )
    )
    return put


def _running(feature: Any) -> bool:
    """Whether an effects/effects_v2 feature reports a running effect."""
    if feature is None:
        return False
    status = getattr(feature.status, "effect", feature.status)
    return status not in NOT_EFFECTS


async def _async_update_scene(scene: HueScene, put: ScenePut) -> None:
    try:
        await scene.bridge.scenes.scene.update(scene.resource.id, put)
    except (AiohueException, ClientError, TimeoutError) as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="command_failed",
            translation_placeholders={"entity_id": scene.entity_id},
        ) from err


async def _async_update(light: HueLight, put: LightPut) -> None:
    try:
        await light.bridge.lights.update(light.resource.id, put)
    except (AiohueException, ClientError, TimeoutError) as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="command_failed",
            translation_placeholders={"entity_id": light.entity_id},
        ) from err


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
