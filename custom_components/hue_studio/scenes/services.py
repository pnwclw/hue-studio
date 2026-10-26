"""Scene services: create, save, reset, recall and delete bridge scenes; export and
import them."""

from __future__ import annotations

from aiohttp import ClientError
from aiohue.errors import AiohueException
from aiohue.v2.models.feature import DimmingFeaturePut, RecallAction, RecallFeature
from aiohue.v2.models.scene import SceneMetadataPut, ScenePut
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

from ..const import DOMAIN, HUE_DOMAIN
from ..core.entities import async_wait_entity
from ..lights.palettes import ATTR_GALLERY_SCENE, ATTR_MIREK, ATTR_POINTS, async_palette
from ..lights.targets import (
    ATTR_BRIGHTNESS,
    ATTR_SPEED,
    ATTR_TRANSITION,
    BRIGHTNESS,
    MIREK,
    SPEED,
    TRANSITION,
    XY_POINT,
)
from .backup import KEEP, async_export, async_import
from .bridge import (
    SCENE_DOMAIN,
    HueScene,
    async_resolve_group,
    async_resolve_scenes,
    captured_actions,
    captured_palette,
    group_scene_names,
    is_custom,
    is_resettable,
    new_scene,
    palette_actions,
    palette_feature,
    scene_post_json,
    scene_put_json,
)
from .covers import COVERS

SERVICE_CREATE_SCENE = "create_scene"
SERVICE_DELETE_SCENE = "delete_scene"
SERVICE_SAVE_SCENE = "save_scene"
SERVICE_RESET_SCENE = "reset_scene"
SERVICE_RECALL_SCENE = "recall_scene"
SERVICE_EXPORT_SCENES = "export_scenes"
SERVICE_IMPORT_SCENES = "import_scenes"

ATTR_NAME = "name"
ATTR_AUTO_DYNAMIC = "auto_dynamic"
ATTR_CAPTURE = "capture"
ATTR_SHUFFLE = "shuffle"
ATTR_RECALL = "recall"
ATTR_DYNAMIC = "dynamic"
ATTR_DRY_RUN = "dry_run"
ATTR_KEEP = "keep"
ATTR_FILE = "file"
ATTR_REPLACE = "replace"
ATTR_ICON = "icon"
ATTR_IMAGE = "image"


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
        # Its icon in HA's entity settings, and a picture of its own (covers.py): an
        # image uploaded to Home Assistant.
        vol.Optional(ATTR_ICON): cv.icon,
        vol.Optional(ATTR_IMAGE): vol.All(cv.string, vol.Length(max=64)),
    }
)


DELETE_SCENE_SCHEMA = cv.make_entity_service_schema({})


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


EXPORT_SCENES_SCHEMA = vol.Schema(
    {
        **cv.ENTITY_SERVICE_FIELDS,
        vol.Optional(ATTR_KEEP, default=KEEP): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=100)
        ),
    }
)


IMPORT_SCENES_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_FILE): cv.string,
        vol.Optional(ATTR_DRY_RUN, default=False): cv.boolean,
        vol.Optional(ATTR_REPLACE, default=False): cv.boolean,
    }
)


@callback
def async_setup_services(hass: HomeAssistant) -> None:
    """Register the scene services."""

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
        # Captured from the lights or made from colors: a scene of your own.
        own = ATTR_GALLERY_SCENE not in call.data or bool(
            call.data.keys() & {ATTR_POINTS, ATTR_MIREK}
        )
        if call.data.keys() & {ATTR_GALLERY_SCENE, ATTR_POINTS, ATTR_MIREK}:
            colors = {k: v for k, v in call.data.items() if k != ATTR_GALLERY_SCENE}
            source = await async_palette(hass, colors if own else call.data)
            palette = palette_feature(source, call.data.get(ATTR_BRIGHTNESS))
            image = source.get("public_image")
            if own and ATTR_GALLERY_SCENE in call.data:
                gallery = {ATTR_GALLERY_SCENE: call.data[ATTR_GALLERY_SCENE]}
                image = (await async_palette(hass, gallery)).get("public_image")
        post = new_scene(group, name, palette, image, custom=own)
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
        scene_id = created[0]["rid"] if created else None
        if scene_id is None:
            return {"scene_id": None, "entity_id": None}
        if ATTR_IMAGE in call.data:
            hass.data[COVERS].async_set(scene_id, call.data[ATTR_IMAGE])
        # Its entity, once the native integration has added it.
        registry = er.async_get(hass)
        entity_id = await async_wait_entity(
            hass,
            lambda: registry.async_get_entity_id(SCENE_DOMAIN, HUE_DOMAIN, scene_id),
        )
        if entity_id is not None and ATTR_ICON in call.data:
            registry.async_update_entity(entity_id, icon=call.data[ATTR_ICON])
        return {"scene_id": scene_id, "entity_id": entity_id}

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
            if covers := hass.data.get(COVERS):
                covers.async_set(scene.resource.id, None)

    async def export_scenes(call: ServiceCall) -> ServiceResponse:
        """Write the scenes (of the targeted Hue rooms/zones) to a file."""
        groups: set[str] | None = None
        if set(call.data) & set(cv.ENTITY_SERVICE_FIELDS):
            registry = er.async_get(hass)
            groups = set()
            for entity_id in await async_extract_entity_ids(call, expand_group=False):
                # A Hue room or zone, else an error.
                async_resolve_group(hass, entity_id)
                if (grouped := registry.async_get(entity_id)) is not None:
                    groups.add(grouped.unique_id)
        return await async_export(hass, groups, call.data[ATTR_KEEP])

    async def import_scenes(call: ServiceCall) -> ServiceResponse:
        """Make the scenes of a file again (or show what would happen)."""
        return await async_import(
            hass,
            call.data.get(ATTR_FILE),
            dry_run=call.data[ATTR_DRY_RUN],
            replace=call.data[ATTR_REPLACE],
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
                # A scene of your own keeps the palette of what it shows, as the Hue
                # app does on saving (its dynamic play and shuffle come from it).
                if is_custom(scene.resource):
                    put.palette = captured_palette(put.actions)
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

    hass.services.async_register(
        DOMAIN,
        SERVICE_CREATE_SCENE,
        create_scene,
        schema=CREATE_SCENE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
    async_register_admin_service(
        hass, DOMAIN, SERVICE_DELETE_SCENE, delete_scene, schema=DELETE_SCENE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SAVE_SCENE, save_scene, schema=SAVE_SCENE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_RESET_SCENE, reset_scene, schema=RESET_SCENE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_RECALL_SCENE, recall_scene, schema=RECALL_SCENE_SCHEMA
    )
    for name, handler, schema in (
        (SERVICE_EXPORT_SCENES, export_scenes, EXPORT_SCENES_SCHEMA),
        (SERVICE_IMPORT_SCENES, import_scenes, IMPORT_SCENES_SCHEMA),
    ):
        async_register_admin_service(
            hass,
            DOMAIN,
            name,
            handler,
            schema=schema,
            supports_response=SupportsResponse.OPTIONAL,
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


async def _async_update_scene(scene: HueScene, put: ScenePut) -> None:
    try:
        if put.palette is not None:
            # aiohue would send the palette with both effects lists, which the bridge
            # refuses as mutually exclusive.
            await scene.bridge.request(
                "put",
                f"clip/v2/resource/scene/{scene.resource.id}",
                json=scene_put_json(put),
            )
        else:
            await scene.bridge.scenes.scene.update(scene.resource.id, put)
    except (AiohueException, ClientError, TimeoutError) as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="command_failed",
            translation_placeholders={"entity_id": scene.entity_id},
        ) from err
