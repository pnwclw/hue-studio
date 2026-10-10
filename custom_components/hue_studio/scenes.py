"""Hue scenes: resolve scene entities, describe, create, save and reset them.

The native `hue` integration recalls scenes (also dynamically, `hue.activate_scene`);
editing them is ours: creating a scene in a Hue room or zone (from the current light
states or a palette), saving the current light states into a scene (like the Hue app's
"Save" while editing a scene) and rebuilding a scene from its palette ("Reset scene").
Scenes live on the bridge only, so the Hue app sees every change.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
import random
from typing import Any

from aiohue import HueBridgeV2
from aiohue.v2.models.feature import (
    ColorFeatureBase,
    ColorPoint,
    ColorTemperatureFeatureBase,
    DimmingFeatureBase,
    EffectsV2Action,
    EffectsV2Parameters,
    GradientFeatureBase,
    GradientPoint,
    OnFeature,
    PaletteFeature,
    PaletteFeatureColor,
    PaletteFeatureColorTemperature,
    SceneEffectsV2Feature,
)
from aiohue.v2.models.light import Light
from aiohue.v2.models.resource import ResourceIdentifier, ResourceTypes
from aiohue.v2.models.scene import (
    Action,
    ActionAction,
    Scene,
    SceneMetadata,
    ScenePost,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN, HUE_DOMAIN
from .lights import LIGHT_DOMAIN, NOT_EFFECTS, async_bridges, supported_effects

SCENE_DOMAIN = "scene"


@dataclass(frozen=True, slots=True)
class HueScene:
    """A Hue scene entity together with its bridge resource."""

    entity_id: str
    bridge: HueBridgeV2
    resource: Scene


@callback
def async_all_scenes(hass: HomeAssistant) -> list[HueScene]:
    """Every regular Hue scene (no smart scenes) on a bridge connected to us."""
    bridges = async_bridges(hass)
    scenes: list[HueScene] = []
    for entry in er.async_get(hass).entities.values():
        if (
            entry.domain != SCENE_DOMAIN
            or entry.platform != HUE_DOMAIN
            or entry.config_entry_id not in bridges
        ):
            continue
        bridge = bridges[entry.config_entry_id]
        if (resource := bridge.scenes.scene.get(entry.unique_id)) is not None:
            scenes.append(HueScene(entry.entity_id, bridge, resource))
    return scenes


@callback
def async_resolve_scenes(
    hass: HomeAssistant, entity_ids: Iterable[str]
) -> list[HueScene]:
    """Resolve scene entity ids; anything but a regular Hue scene is an error."""
    by_entity = {scene.entity_id: scene for scene in async_all_scenes(hass)}
    scenes: list[HueScene] = []
    for entity_id in entity_ids:
        if (scene := by_entity.get(entity_id)) is None:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="not_hue_scene",
                translation_placeholders={"entity_id": entity_id},
            )
        scenes.append(scene)
    return scenes


def scene_lights(scene: HueScene) -> list[Light]:
    """Light resources the scene has actions for, in the scene's order."""
    lights = (
        scene.bridge.lights.get(action.target.rid)
        for action in scene.resource.actions
        if action.target.rtype == ResourceTypes.LIGHT
    )
    return [light for light in lights if light is not None]


@callback
def light_entity_ids(hass: HomeAssistant, lights: Iterable[Light]) -> list[str]:
    """Entity ids of light resources (lights without an entity are skipped)."""
    registry = er.async_get(hass)
    ids = (
        registry.async_get_entity_id(LIGHT_DOMAIN, HUE_DOMAIN, light.id)
        for light in lights
    )
    return [entity_id for entity_id in ids if entity_id]


def _xy(color: ColorFeatureBase) -> ColorFeatureBase:
    return ColorFeatureBase(xy=ColorPoint(color.xy.x, color.xy.y))


def is_dynamic(resource: Scene) -> bool:
    """Whether the scene can play dynamically (same rule as the native integration)."""
    palette = resource.palette
    return bool(
        palette and (len(palette.color) > 1 or len(palette.color_temperature or []) > 1)
    )


def is_resettable(resource: Scene) -> bool:
    """Whether the scene has a palette to rebuild its light settings from."""
    palette = resource.palette
    return bool(
        palette and (palette.color or palette.color_temperature or palette.effects_v2)
    )


@callback
def scene_info(hass: HomeAssistant, scene: HueScene) -> dict[str, Any]:
    """Describe a scene for the frontend (what HA's scene entity does not expose)."""
    resource = scene.resource
    palette = resource.palette
    status = resource.status.active.value if resource.status else "inactive"
    return {
        "active": status,
        # Id of the scene's picture in the Hue app (the gallery's `public_image`).
        "image": resource.metadata.image.rid if resource.metadata.image else None,
        "dynamic": is_dynamic(resource),
        "resettable": is_resettable(resource),
        "speed": resource.speed,
        "auto_dynamic": bool(resource.auto_dynamic),
        "palette": [[c.color.xy.x, c.color.xy.y] for c in palette.color]
        if palette
        else [],
        "mirek": [
            c.color_temperature.mirek
            for c in (palette.color_temperature if palette else [])
            if c.color_temperature.mirek
        ],
        "lights": light_entity_ids(hass, scene_lights(scene)),
    }


# ---------- save: current light states -> scene actions ----------


def capture_action(light: Light) -> ActionAction:
    """What a light shows now, as a scene action."""
    action = ActionAction(on=OnFeature(on=light.on.on))
    if not light.on.on:
        return action
    if light.dimming is not None:
        action.dimming = DimmingFeatureBase(brightness=light.dimming.brightness)
    if (
        light.effects_v2 is not None
        and (status := light.effects_v2.status).effect not in NOT_EFFECTS
    ):
        params = status.parameters
        action.effects_v2 = SceneEffectsV2Feature(
            action=EffectsV2Action(
                effect=status.effect,
                parameters=EffectsV2Parameters(
                    color=_xy(params.color) if params.color else None,
                    color_temperature=ColorTemperatureFeatureBase(
                        mirek=params.color_temperature.mirek
                    )
                    if params.color_temperature and params.color_temperature.mirek
                    else None,
                    speed=params.speed,
                )
                if params
                else None,
            )
        )
        return action
    temperature = light.color_temperature
    if temperature is not None and temperature.mirek_valid and temperature.mirek:
        action.color_temperature = ColorTemperatureFeatureBase(mirek=temperature.mirek)
    elif light.gradient is not None and len(light.gradient.points) >= 2:
        action.gradient = GradientFeatureBase(
            points=[GradientPoint(color=_xy(p.color)) for p in light.gradient.points],
            mode=light.gradient.mode,
        )
    elif light.color is not None:
        action.color = _xy(light.color)
    return action


def captured_actions(scene: HueScene) -> list[Action]:
    """The scene's actions with every light replaced by its current state."""
    return [
        Action(target=action.target, action=capture_action(light))
        if action.target.rtype == ResourceTypes.LIGHT
        and (light := scene.bridge.lights.get(action.target.rid)) is not None
        else action
        for action in scene.resource.actions
    ]


# ---------- reset: palette -> scene actions ----------


def _spread(colors: list[Any], count: int, offset: int) -> list[Any]:
    """`count` colors for one gradient light: the palette in order, starting at offset.

    A shorter palette is stretched (each color covers neighboring points) instead of
    repeated, so a gradient stays a gradient.
    """
    n = len(colors)
    if n >= count:
        return [colors[(offset + k) % n] for k in range(count)]
    return [colors[(offset + k * n // count) % n] for k in range(count)]


def palette_actions(scene: HueScene, shuffle: bool = False) -> list[Action]:
    """Spread the scene's palette over its lights, like the Hue app's "Reset scene".

    Actions for anything but a light the palette can drive are kept as they are.
    """
    palette = scene.resource.palette
    assert palette is not None
    lights = [
        scene.bridge.lights.get(action.target.rid)
        if action.target.rtype == ResourceTypes.LIGHT
        else None
        for action in scene.resource.actions
    ]
    spread = spread_palette(palette, lights, shuffle)
    return [
        action if new is None else Action(target=action.target, action=new)
        for action, new in zip(scene.resource.actions, spread, strict=True)
    ]


def spread_palette(
    palette: PaletteFeature, lights: Sequence[Light | None], shuffle: bool = False
) -> list[ActionAction | None]:
    """One action per light: the palette spread over the lights in order.

    Gradient lights get as many palette colors as they can show, other color lights one
    color each (palette order, optionally shuffled), white lights the palette's white;
    effects in the palette go to every light that supports them. None where the palette
    has nothing for the light (or there is no light).
    """
    colors = list(palette.color)
    whites = list(palette.color_temperature or [])
    effects = list(palette.effects_v2 or [])
    if shuffle:
        random.shuffle(colors)
        random.shuffle(whites)
    default_brightness = palette.dimming[0].brightness if palette.dimming else None

    actions: list[ActionAction | None] = []
    for index, light in enumerate(lights):
        if light is None:
            actions.append(None)
            continue
        new = ActionAction(on=OnFeature(on=True))
        brightness = default_brightness
        effect = (
            next(
                (
                    e
                    for e in effects[index % len(effects) :] + effects
                    if e.action.effect in supported_effects(light)
                ),
                None,
            )
            if effects
            else None
        )
        if effect is not None:
            new.effects_v2 = effect
        if colors and light.color is not None:
            gradient = light.gradient
            gradient_capable = gradient is not None and gradient.points_capable >= 2
            if gradient_capable and len(colors) > 1:
                assert gradient is not None
                picked = _spread(colors, gradient.points_capable, index)
                new.gradient = GradientFeatureBase(
                    points=[GradientPoint(color=_xy(c.color)) for c in picked],
                    mode=gradient.mode,
                )
            else:
                picked = [colors[index % len(colors)]]
                new.color = _xy(picked[0].color)
            brightness = sum(c.dimming.brightness for c in picked) / len(picked)
        elif whites and light.color_temperature is not None:
            white = whites[index % len(whites)]
            new.color_temperature = ColorTemperatureFeatureBase(
                mirek=white.color_temperature.mirek
            )
            brightness = white.dimming.brightness
        elif effect is None:
            actions.append(None)
            continue
        if brightness is not None and light.dimming is not None:
            new.dimming = DimmingFeatureBase(brightness=max(1.0, brightness))
        actions.append(new)
    return actions


def palette_feature(
    palette: dict[str, Any], brightness: float | None
) -> PaletteFeature:
    """A scene palette from one of ours: gradient points or a white (mirek)."""
    level = brightness or palette.get("brightness") or 100
    dimming = DimmingFeatureBase(brightness=float(level))
    if palette["kind"] == "white":
        return PaletteFeature(
            color=[],
            dimming=[dimming],
            color_temperature=[
                PaletteFeatureColorTemperature(
                    color_temperature=ColorTemperatureFeatureBase(
                        mirek=palette["mirek"]
                    ),
                    dimming=dimming,
                )
            ],
        )
    return PaletteFeature(
        color=[
            PaletteFeatureColor(
                color=ColorFeatureBase(xy=ColorPoint(x, y)), dimming=dimming
            )
            for x, y in palette["points"]
        ],
        dimming=[dimming],
        color_temperature=[],
    )


# ---------- create / delete scenes in a Hue room or zone ----------


@dataclass(frozen=True, slots=True)
class HueGroup:
    """A Hue room or zone, reached through its grouped light entity."""

    entity_id: str
    bridge: HueBridgeV2
    group: ResourceIdentifier
    lights: list[Light]


@callback
def async_resolve_group(hass: HomeAssistant, entity_id: str) -> HueGroup:
    """The Hue room/zone behind a grouped light entity; anything else is an error."""
    entry = er.async_get(hass).async_get(entity_id)
    bridge = async_bridges(hass).get(entry.config_entry_id or "") if entry else None
    grouped = (
        bridge.groups.grouped_light.get(entry.unique_id) if entry and bridge else None
    )
    owner = grouped.owner if grouped is not None else None
    if (
        entry is None
        or bridge is None
        or owner is None
        or owner.rtype not in (ResourceTypes.ROOM, ResourceTypes.ZONE)
    ):
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="not_hue_group",
            translation_placeholders={"entity_id": entity_id},
        )
    controller = (
        bridge.groups.room if owner.rtype == ResourceTypes.ROOM else bridge.groups.zone
    )
    return HueGroup(entity_id, bridge, owner, list(controller.get_lights(owner.rid)))


def group_scene_names(group: HueGroup) -> set[str]:
    """Names of the regular scenes in the group (case-insensitive)."""
    return {
        scene.metadata.name.casefold()
        for scene in group.bridge.scenes.scene
        if scene.group.rid == group.group.rid
    }


def new_scene(
    group: HueGroup,
    name: str,
    palette: PaletteFeature | None,
    image: str | None = None,
) -> ScenePost:
    """A scene for every light of the group.

    With a palette, it is spread over the lights (and stored, so the Hue app can play
    and shuffle it); without one, the scene stores what the lights show now.
    """
    if palette is not None:
        spread = spread_palette(palette, group.lights)
        actions = [
            Action(target=_light_ref(light), action=new or capture_action(light))
            for light, new in zip(group.lights, spread, strict=True)
        ]
    else:
        actions = [
            Action(target=_light_ref(light), action=capture_action(light))
            for light in group.lights
        ]
    return ScenePost(
        metadata=SceneMetadata(
            name=name,
            image=ResourceIdentifier(rid=image, rtype=ResourceTypes.PUBLIC_IMAGE)
            if image
            else None,
        ),
        group=group.group,
        actions=actions,
        palette=palette,
    )


def _light_ref(light: Light) -> ResourceIdentifier:
    return ResourceIdentifier(rid=light.id, rtype=ResourceTypes.LIGHT)
