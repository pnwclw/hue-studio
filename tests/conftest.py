"""Shared fixtures for Hue Studio tests."""

from collections.abc import Generator
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from aiohue.v2.models.entertainment_configuration import (
    EntertainmentConfigurationType,
    EntertainmentStatus,
)
from aiohue.v2.models.feature import (
    ColorFeature,
    ColorFeatureBase,
    ColorGamut,
    ColorPoint,
    ColorTemperatureFeature,
    DimmingFeature,
    DimmingFeatureBase,
    DynamicsFeature,
    DynamicStatus,
    EffectStatus,
    EffectsV2ActionGet,
    EffectsV2Feature,
    EffectsV2Status,
    GamutType,
    GradientFeature,
    GradientMode,
    GradientPoint,
    MirekSchema,
    OnFeature,
    PaletteFeature,
    PaletteFeatureColor,
)
from aiohue.v2.models.light import LightMetaData
from aiohue.v2.models.resource import ResourceIdentifier, ResourceTypes
from aiohue.v2.models.room import RoomArchetype
from aiohue.v2.models.scene import (
    Action,
    ActionAction,
    Scene,
    SceneActiveStatus,
    SceneMetadata,
    SceneStatus,
)
from homeassistant.const import CONF_HOST
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.hue_studio.const import (
    CONF_KIND,
    DOMAIN,
    HUE_CONF_API_KEY,
    HUE_CONF_API_VERSION,
    HUE_DOMAIN,
    KIND_STUDIO,
)

BRIDGE_ID = "001788fffe000000"
BRIDGE_HOST = "192.0.2.10"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations: None) -> None:
    """Load custom_components/ in every test."""


@pytest.fixture(autouse=True)
def mock_native_hue_setup() -> Generator[None]:
    """Keep the native `hue` integration (our dependency) off the network."""
    with (
        patch("homeassistant.components.hue.async_setup_entry", return_value=True),
        patch("homeassistant.components.hue.async_unload_entry", return_value=True),
    ):
        yield


@pytest.fixture(autouse=True)
def no_blueprint_install() -> Generator[None]:
    """Setup leaves the test config folder alone (test_automations installs them)."""
    with patch(
        "custom_components.hue_studio.automations.async_install_blueprints",
        AsyncMock(return_value=[]),
    ):
        yield


@pytest.fixture
def hue_entry(hass: HomeAssistant) -> MockConfigEntry:
    """A native Hue config entry using CLIP v2."""
    entry = MockConfigEntry(
        domain=HUE_DOMAIN,
        title="Hue Bridge",
        unique_id=BRIDGE_ID,
        data={
            CONF_HOST: BRIDGE_HOST,
            HUE_CONF_API_KEY: "test-app-key",
            HUE_CONF_API_VERSION: 2,
        },
    )
    entry.add_to_hass(hass)
    return entry


@pytest.fixture
def studio_entry(hass: HomeAssistant, hue_entry: MockConfigEntry) -> MockConfigEntry:
    """The Hue Studio entry (it uses `hue_entry`'s bridge)."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Hue Studio",
        unique_id=DOMAIN,
        data={CONF_KIND: KIND_STUDIO},
    )
    entry.add_to_hass(hass)
    return entry


GAMUT_C = ColorGamut(
    red=ColorPoint(0.6915, 0.3083),
    green=ColorPoint(0.17, 0.7),
    blue=ColorPoint(0.1532, 0.0475),
)


def make_light(
    resource_id: str, *, gradient_points: int = 0, color: bool = True
) -> SimpleNamespace:
    """A stand-in for aiohue's Light with the features Hue Studio reads."""
    effects = [EffectStatus.NO_EFFECT, EffectStatus.CANDLE, EffectStatus.FIRE]
    return SimpleNamespace(
        id=resource_id,
        # The device owning the light: `dev-<resource id>`.
        owner=ResourceIdentifier(rid=f"dev-{resource_id}", rtype=ResourceTypes.DEVICE),
        on=OnFeature(on=True),
        dimming=DimmingFeature(brightness=50.0),
        metadata=LightMetaData(archetype="hue_lightstrip", name=resource_id),
        effects=None,
        dynamics=DynamicsFeature(
            speed=0.5, speed_valid=True, status=DynamicStatus.NONE
        ),
        effects_v2=EffectsV2Feature(
            action=EffectsV2ActionGet(effect_values=effects),
            status=EffectsV2Status(
                effect=EffectStatus.NO_EFFECT, effect_values=effects
            ),
        ),
        color=ColorFeature(
            xy=ColorPoint(0.5, 0.4), gamut_type=GamutType.C, gamut=GAMUT_C
        )
        if color
        else None,
        color_temperature=ColorTemperatureFeature(
            mirek=None, mirek_schema=MirekSchema(153, 454), mirek_valid=False
        ),
        gradient=GradientFeature(
            points=[
                GradientPoint(color=ColorFeatureBase(xy=ColorPoint(0.6, 0.35))),
                GradientPoint(color=ColorFeatureBase(xy=ColorPoint(0.2, 0.3))),
            ],
            points_capable=gradient_points,
            mode=GradientMode.INTERPOLATED_PALETTE,
            mode_values=[GradientMode.INTERPOLATED_PALETTE],
        )
        if gradient_points
        else None,
    )


# resource id -> light; entity ids are registered by the `hue_lights` fixture.
LIGHTS = {
    "res-bulb": make_light("res-bulb"),
    "res-strip": make_light("res-strip", gradient_points=5),
}


def _light_action(resource_id: str) -> Action:
    return Action(
        target=ResourceIdentifier(rid=resource_id, rtype=ResourceTypes.LIGHT),
        action=ActionAction(on=OnFeature(on=True)),
    )


def _palette_color(x: float, y: float, brightness: float) -> PaletteFeatureColor:
    return PaletteFeatureColor(
        color=ColorFeatureBase(xy=ColorPoint(x, y)),
        dimming=DimmingFeatureBase(brightness=brightness),
    )


def make_scene(resource_id: str, *, palette: bool = True) -> Scene:
    """A Hue scene for the strip and the bulb, with a 3-color palette."""
    return Scene(
        id=resource_id,
        metadata=SceneMetadata(name="Sunset"),
        group=ResourceIdentifier(rid="res-room", rtype=ResourceTypes.ROOM),
        actions=[_light_action("res-strip"), _light_action("res-bulb")],
        speed=0.5,
        auto_dynamic=False,
        status=SceneStatus(active=SceneActiveStatus.STATIC),
        palette=PaletteFeature(
            color=[
                _palette_color(0.6, 0.35, 80),
                _palette_color(0.2, 0.3, 60),
                _palette_color(0.4, 0.4, 40),
            ],
            dimming=[],
            color_temperature=[],
        )
        if palette
        else None,
    )


# resource id -> scene; entity ids are registered by the `hue_lights` fixture.
SCENES = {
    "res-scene": make_scene("res-scene"),
    "res-plain": make_scene("res-plain", palette=False),
}


# resource id -> the scenes' Hue room (its grouped light `grp-room`).
ROOMS = {
    "res-room": SimpleNamespace(
        id="res-room",
        grouped_light="grp-room",
        metadata=SimpleNamespace(
            name="Living room", archetype=RoomArchetype.LIVING_ROOM
        ),
        services=[
            ResourceIdentifier(rid="grp-room", rtype=ResourceTypes.GROUPED_LIGHT)
        ],
    ),
}


def make_entertainment(
    resource_id: str, name: str, lights: list[str], *, active: bool = False
) -> SimpleNamespace:
    """A stand-in for aiohue's EntertainmentConfiguration."""
    return SimpleNamespace(
        id=resource_id,
        id_v1=None,
        metadata=SimpleNamespace(name=name),
        configuration_type=EntertainmentConfigurationType.SCREEN,
        status=EntertainmentStatus.ACTIVE if active else EntertainmentStatus.INACTIVE,
        light_services=[
            ResourceIdentifier(rid=rid, rtype=ResourceTypes.LIGHT) for rid in lights
        ],
        # Entertainment service `ent-<light>` of each light at x = its index.
        locations=SimpleNamespace(
            service_locations=[
                SimpleNamespace(
                    service=ResourceIdentifier(
                        rid=f"ent-{rid}", rtype=ResourceTypes.ENTERTAINMENT
                    ),
                    positions=[SimpleNamespace(x=float(i), y=0.5, z=0.0)],
                    equalization_factor=1.0,
                )
                for i, rid in enumerate(lights)
            ]
        ),
    )


# Entertainment areas of the mocked bridge; tests may replace the list contents.
ENTERTAINMENT: list[SimpleNamespace] = []


@pytest.fixture(autouse=True)
def reset_entertainment() -> Generator[None]:
    """Every test starts with one idle entertainment area (the strip)."""
    ENTERTAINMENT[:] = [make_entertainment("ent-tv", "TV area", ["res-strip"])]
    yield


@pytest.fixture
def mock_bridge() -> Generator[MagicMock]:
    """Patch aiohue's HueBridgeV2 used by Hue Studio."""
    with patch(
        "custom_components.hue_studio.connections.HueBridgeV2", autospec=True
    ) as bridge_cls:
        bridge = bridge_cls.return_value
        bridge.initialize = AsyncMock()
        bridge.close = AsyncMock()
        bridge.lights = MagicMock()
        bridge.lights.get.side_effect = LIGHTS.get
        bridge.lights.update = AsyncMock()
        bridge.lights.subscribe.return_value = MagicMock()
        bridge.scenes = MagicMock()
        bridge.scenes.scene.get.side_effect = SCENES.get
        bridge.scenes.scene.update = AsyncMock()
        bridge.scenes.scene.recall = AsyncMock()
        bridge.scenes.scene.subscribe.return_value = MagicMock()
        bridge.scenes.smart_scene.get.return_value = None
        bridge.groups = MagicMock()
        bridge.groups.room.get.side_effect = ROOMS.get
        bridge.groups.zone.get.return_value = None
        bridge.config = MagicMock()
        configs = bridge.config.entertainment_configuration
        configs.__iter__.side_effect = lambda: iter(ENTERTAINMENT)
        configs.subscribe.return_value = MagicMock()
        # Entertainment services: `ent-<light>` renders light `<light>`.
        bridge.config.entertainment.__iter__.side_effect = lambda: iter(
            SimpleNamespace(
                id=f"ent-{rid}",
                renderer_reference=ResourceIdentifier(
                    rid=rid, rtype=ResourceTypes.LIGHT
                ),
            )
            for rid in LIGHTS
        )
        yield bridge_cls


@pytest.fixture
async def hue_lights(
    hass: HomeAssistant,
    hue_entry: MockConfigEntry,
    studio_entry: MockConfigEntry,
    mock_bridge: MagicMock,
) -> MagicMock:
    """Register native Hue lights, scenes and a Hue room; set up Hue Studio.

    Returns the mocked bridge instance.
    """
    registry = er.async_get(hass)
    for object_id, unique_id in (("bulb", "res-bulb"), ("strip", "res-strip")):
        registry.async_get_or_create(
            "light",
            HUE_DOMAIN,
            unique_id,
            config_entry=hue_entry,
            suggested_object_id=object_id,
        )
        hass.states.async_set(f"light.{object_id}", "on")
    for object_id, unique_id in (("sunset", "res-scene"), ("plain", "res-plain")):
        registry.async_get_or_create(
            "scene",
            HUE_DOMAIN,
            unique_id,
            config_entry=hue_entry,
            suggested_object_id=object_id,
        )
        hass.states.async_set(f"scene.{object_id}", "unknown")
    registry.async_get_or_create(
        "light", "demo", "other", suggested_object_id="other_brand"
    )
    hass.states.async_set(
        "light.room",
        "on",
        {"is_hue_group": True, "entity_id": ["light.strip", "light.bulb"]},
    )
    assert await hass.config_entries.async_setup(studio_entry.entry_id)
    await hass.async_block_till_done()
    return mock_bridge.return_value
