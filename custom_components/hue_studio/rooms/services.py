"""Room and zone services: Hue rooms aligned with HA areas; Hue zones created, changed
and deleted."""

from __future__ import annotations

from typing import Any

from aiohttp import ClientError
from aiohue.errors import AiohueException
from aiohue.v2.models.resource import ResourceTypes
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
    callback,
)
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.service import (
    async_extract_entity_ids,
    async_register_admin_service,
)
import voluptuous as vol

from ..const import DOMAIN
from ..lights.bridge import async_resolve_lights
from ..lights.targets import async_target_lights
from ..scenes.bridge import HueGroup, async_resolve_group
from .areas import async_align
from .zones import async_wait_zone_entity

SERVICE_CREATE_ZONE = "create_zone"
SERVICE_UPDATE_ZONE = "update_zone"
SERVICE_DELETE_ZONE = "delete_zone"
SERVICE_ALIGN_ROOMS = "align_rooms"

ATTR_NAME = "name"
ATTR_LIGHTS = "lights"
ATTR_DRY_RUN = "dry_run"
ATTR_COMPLETE_SCENES = "complete_scenes"
ATTR_DELETE_EMPTY_ROOMS = "delete_empty_rooms"
ATTR_KEEP_SPLIT_SCENES = "keep_split_scenes"


ZONE_NAME = vol.All(cv.string, vol.Strip, vol.Length(min=1, max=32))

CREATE_ZONE_SCHEMA = cv.make_entity_service_schema({vol.Required(ATTR_NAME): ZONE_NAME})


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
            vol.Optional(ATTR_NAME): ZONE_NAME,
            vol.Optional(ATTR_LIGHTS): vol.All(cv.entity_ids, vol.Length(min=1)),
        }
    ),
    cv.has_at_least_one_key(ATTR_NAME, ATTR_LIGHTS),
)


DELETE_ZONE_SCHEMA = cv.make_entity_service_schema({})


@callback
def async_setup_services(hass: HomeAssistant) -> None:
    """Register the room and zone services."""

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
        zone_id = created[0]["rid"] if created else None
        # Its grouped light, once the native integration has added it.
        entity_id = (
            await async_wait_zone_entity(hass, bridge, zone_id) if zone_id else None
        )
        return {"zone_id": zone_id, "entity_id": entity_id}

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

    async_register_admin_service(
        hass,
        DOMAIN,
        SERVICE_CREATE_ZONE,
        create_zone,
        schema=CREATE_ZONE_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )
    async_register_admin_service(
        hass, DOMAIN, SERVICE_UPDATE_ZONE, update_zone, schema=UPDATE_ZONE_SCHEMA
    )
    async_register_admin_service(
        hass, DOMAIN, SERVICE_DELETE_ZONE, delete_zone, schema=DELETE_ZONE_SCHEMA
    )
    async_register_admin_service(
        hass,
        DOMAIN,
        SERVICE_ALIGN_ROOMS,
        align_rooms,
        schema=ALIGN_ROOMS_SCHEMA,
        supports_response=SupportsResponse.OPTIONAL,
    )


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
