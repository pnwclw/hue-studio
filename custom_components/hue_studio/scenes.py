"""Hue scenes: resolve scene entities, describe them, save and reset them.

The native `hue` integration recalls scenes (also dynamically, `hue.activate_scene`);
editing them is ours: saving the current light states into a scene (like the Hue app's
"Save" while editing a scene) and rebuilding a scene from its palette ("Reset scene").
"""

from __future__ import annotations

from collections.abc import Iterable
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
    SceneEffectsV2Feature,
)
from aiohue.v2.models.light import Light
from aiohue.v2.models.resource import ResourceTypes
from aiohue.v2.models.scene import Action, ActionAction, Scene
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

    Gradient lights get as many palette colors as they can show, other color lights one
    color each (palette order, optionally shuffled), white lights the palette's white;
    effects in the palette go to every light that supports them.
    """
    palette = scene.resource.palette
    assert palette is not None
    colors = list(palette.color)
    whites = list(palette.color_temperature or [])
    effects = list(palette.effects_v2 or [])
    if shuffle:
        random.shuffle(colors)
        random.shuffle(whites)
    default_brightness = palette.dimming[0].brightness if palette.dimming else None

    actions: list[Action] = []
    for index, action in enumerate(scene.resource.actions):
        light = (
            scene.bridge.lights.get(action.target.rid)
            if action.target.rtype == ResourceTypes.LIGHT
            else None
        )
        if light is None:
            actions.append(action)
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
            actions.append(action)
            continue
        if brightness is not None and light.dimming is not None:
            new.dimming = DimmingFeatureBase(brightness=max(1.0, brightness))
        actions.append(Action(target=action.target, action=new))
    return actions
