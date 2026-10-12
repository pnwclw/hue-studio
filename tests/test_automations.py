"""Tests for automations: blueprints, apply_light, living light, WebSocket API."""

from datetime import timedelta
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

from homeassistant.components.automation import automations_with_blueprint
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import (
    area_registry as ar,
    category_registry as cr,
    device_registry as dr,
    entity_registry as er,
    label_registry as lr,
)
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util
import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
    async_mock_service,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio import automations, daylight
from custom_components.hue_studio.automations import (
    TYPES,
    async_install_blueprints,
    blueprint_path,
    living_lights,
)
from custom_components.hue_studio.const import DOMAIN

from .conftest import BRIDGE_ID

NATURAL = {"settings": {"kelvin": {"morning": 5000, "day": 5000, "golden": 5000}}}
POOLS = {
    "pools": {
        phase: {
            "all": {"clear": [["ocean_dawn"]] * 4 if phase == "day" else ["ocean_dawn"]}
        }
        for phase in daylight.PHASES
    }
}


def _sent(bridge: MagicMock) -> list[tuple[str, Any]]:
    """Every light update sent to the bridge, in order."""
    return [(call.args[0], call.args[1]) for call in bridge.lights.update.mock_calls]


@pytest.fixture
def config_dir(hass: HomeAssistant, tmp_path: Path) -> Path:
    """A config folder of our own (blueprints are written into it)."""
    hass.config.config_dir = str(tmp_path)
    return tmp_path


def _automation(kind: str, inputs: dict[str, Any], suffix: str = "a") -> dict:
    return {
        "id": f"hue_studio_{kind}_{suffix}",
        "alias": f"{kind} {suffix}",
        "use_blueprint": {"path": blueprint_path(kind), "input": inputs},
    }


INPUTS: dict[str, dict[str, Any]] = {
    "wake_up": {"rooms": ["living_room"], "time": "06:30:00", "fade": 20},
    "go_to_sleep": {"rooms": ["living_room"], "days": ["mon", "fri"]},
    "coming_home": {"rooms": ["living_room"], "only_dark": True},
    "leaving_home": {"rooms": ["living_room"]},
    "mimic_presence": {"rooms": ["living_room"], "start_kind": "time"},
    "schedule": {
        "rooms": ["living_room"],
        "start_kind": "sunset",
        "start_offset": {"hours": 0, "minutes": -30, "seconds": 0},
        "end_kind": "time",
        "light": "auto",
        "scene_of_the_day": POOLS,
    },
    "motion": {
        "rooms": ["living_room"],
        "motion": ["binary_sensor.example_motion"],
        "light": "natural",
        "scene_of_the_day": NATURAL,
    },
}


# The template and sun triggers keep timers until the end of the test.
@pytest.mark.parametrize("expected_lingering_timers", [True])
async def test_blueprints_are_valid(
    hass: HomeAssistant, config_dir: Path, hue_lights: MagicMock
) -> None:
    """Every blueprint is installed and gives a working automation in HA."""
    assert set(await async_install_blueprints(hass)) == set(TYPES)
    assert await async_install_blueprints(hass) == []
    assert (config_dir / "blueprints/automation/hue_studio/schedule.yaml").exists()
    assert await async_setup_component(
        hass,
        "automation",
        {"automation": [_automation(kind, INPUTS[kind]) for kind in TYPES]},
    )
    await hass.async_block_till_done()
    for kind in TYPES:
        found = automations_with_blueprint(hass, blueprint_path(kind))
        assert len(found) == 1, kind
        assert hass.states.get(found[0]).state == "on", kind


async def test_changed_blueprint_reloads_automations(
    hass: HomeAssistant, config_dir: Path, hue_lights: MagicMock
) -> None:
    """A blueprint that changed with an update is written again and reloaded."""
    await async_install_blueprints(hass)
    assert await async_setup_component(
        hass,
        "automation",
        {"automation": [_automation("leaving_home", INPUTS["leaving_home"])]},
    )
    await hass.async_block_till_done()
    target = config_dir / "blueprints/automation/hue_studio/leaving_home.yaml"
    target.write_text(target.read_text().replace("Leaving home", "Old"))
    reload = async_mock_service(hass, "automation", "reload")
    assert await async_install_blueprints(hass) == ["leaving_home"]
    assert "Old" not in target.read_text()
    assert len(reload) == 1


async def test_apply_light_white_from_dark(
    hass: HomeAssistant, hue_lights: MagicMock
) -> None:
    """Lights that are off start at 1 % and then fade to the white."""
    hass.states.async_set("light.bulb", "off")
    await hass.services.async_call(
        DOMAIN,
        "apply_light",
        {
            "entity_id": ["light.bulb", "light.strip"],
            "light": "white",
            "kelvin": 4000,
            "brightness": 80,
            "transition": 600,
            "from_dark": True,
        },
        blocking=True,
    )
    sent = _sent(hue_lights)
    first, *rest = sent
    assert first[0] == "res-bulb"
    assert first[1].dimming.brightness == 1
    assert first[1].color_temperature.mirek == 250
    final = dict(rest)
    assert final["res-bulb"].dimming.brightness == 80
    assert final["res-strip"].dynamics.duration == 600_000


async def test_apply_light_scene(hass: HomeAssistant, hue_lights: MagicMock) -> None:
    """A scene is played as it is set up, with the transition."""
    await hass.services.async_call(
        DOMAIN,
        "apply_light",
        {
            "entity_id": "light.bulb",
            "light": "scene",
            "scenes": ["scene.sunset"],
            "transition": 30,
            "brightness": None,
            "kelvin": "",
        },
        blocking=True,
    )
    put = hue_lights.scenes.scene.update.call_args.args[1]
    assert put.recall.action.value == "active"
    assert put.recall.duration == 30_000
    assert put.recall.dimming is None


async def test_apply_light_off_only_if_off_and_toggle(
    hass: HomeAssistant, hue_lights: MagicMock
) -> None:
    """Off goes through light.turn_off; only_if_off and toggle look at the lights."""
    turn_off = async_mock_service(hass, "light", "turn_off")
    await hass.services.async_call(
        DOMAIN,
        "apply_light",
        {"entity_id": "light.bulb", "light": "off", "transition": 3},
        blocking=True,
    )
    assert turn_off[-1].data == {"entity_id": ["light.bulb"], "transition": 3}

    await hass.services.async_call(
        DOMAIN,
        "apply_light",
        {"entity_id": "light.bulb", "light": "white", "only_if_off": True},
        blocking=True,
    )
    assert _sent(hue_lights) == []

    await hass.services.async_call(
        DOMAIN,
        "apply_light",
        {"entity_id": "light.bulb", "light": "white", "toggle": True},
        blocking=True,
    )
    assert len(turn_off) == 2


async def test_scene_of_the_day_without_scenes(
    hass: HomeAssistant, hue_lights: MagicMock
) -> None:
    """A scene of the day with empty pools is an error the automation trace shows."""
    with pytest.raises(ServiceValidationError) as err:
        await hass.services.async_call(
            DOMAIN,
            "apply_light",
            {"entity_id": "light.bulb", "light": "auto"},
            blocking=True,
        )
    assert err.value.translation_key == "no_scene_of_the_day"


async def test_living_light(hass: HomeAssistant, hue_lights: MagicMock) -> None:
    """Natural light keeps up with the day until someone changes the lights."""
    await hass.services.async_call(
        DOMAIN,
        "apply_light",
        {
            "entity_id": ["light.bulb"],
            "light": "natural",
            "scene_of_the_day": {
                "settings": {"kelvin": {p: 4000 for p in daylight.PHASES}}
            },
        },
        blocking=True,
    )
    assert _sent(hue_lights)[-1][1].color_temperature.mirek == 250
    living = living_lights(hass)
    assert "light.bulb" in living.by_light

    # The selection changes: shown again, with the living transition.
    group = living.by_light["light.bulb"]
    group.config["settings"]["kelvin"] = {p: 2000 for p in daylight.PHASES}
    hue_lights.lights.update.reset_mock()
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(minutes=2))
    await hass.async_block_till_done()
    put = _sent(hue_lights)[-1][1]
    assert put.color_temperature.mirek == 454  # clipped to the light's range
    assert put.dynamics.duration == 60_000

    # Our own command settling is ignored; a change by hand stops it.
    hass.states.async_set("light.bulb", "on", {"brightness": 10})
    assert "light.bulb" in living.by_light
    group.quiet_until = 0
    hass.states.async_set("light.bulb", "on", {"brightness": 200})
    assert "light.bulb" not in living.by_light


async def test_living_light_released_by_new_command(
    hass: HomeAssistant, hue_lights: MagicMock
) -> None:
    """Another apply_light takes the lights over."""
    data = {"entity_id": ["light.bulb", "light.strip"], "light": "natural"}
    await hass.services.async_call(DOMAIN, "apply_light", data, blocking=True)
    living = living_lights(hass)
    assert set(living.by_light) == {"light.bulb", "light.strip"}
    await hass.services.async_call(
        DOMAIN,
        "apply_light",
        {"entity_id": "light.bulb", "light": "white"},
        blocking=True,
    )
    assert living.by_light == {}


async def test_subscribe_and_organize(
    hass: HomeAssistant,
    config_dir: Path,
    hue_lights: MagicMock,
    hass_ws_client: WebSocketGenerator,
) -> None:
    """Our automations (blueprint or taken over) and others touching Hue lights."""
    area = ar.async_get(hass).async_create("Living room")
    await async_install_blueprints(hass)
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": [
                _automation("leaving_home", {"rooms": [area.id]}),
                {
                    "id": "hue_studio_schedule_taken",
                    "alias": "taken",
                    "triggers": [],
                    "actions": [],
                },
                {
                    "id": "other",
                    "alias": "other",
                    "triggers": [],
                    "actions": [
                        {
                            "action": "light.turn_on",
                            "target": {"entity_id": "light.bulb"},
                        }
                    ],
                },
            ]
        },
    )
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/automations/subscribe"})
    assert (await client.receive_json())["success"]
    event = (await client.receive_json())["event"]
    assert event["automations"] == {
        "automation.leaving_home_a": {
            "type": "leaving_home",
            "custom": False,
            "id": "hue_studio_leaving_home_a",
        },
        "automation.taken": {
            "id": "hue_studio_schedule_taken",
            "type": "schedule",
            "custom": True,
        },
    }
    assert event["related"] == ["automation.other"]
    assert event["reloads"] == 0

    # Created with our id: label and category at once; the area from the panel.
    entities = er.async_get(hass)
    entry = entities.async_get("automation.leaving_home_a")
    label = lr.async_get(hass).async_get_label_by_name("Hue Studio")
    assert label is not None and label.label_id in entry.labels
    category = cr.async_get(hass).async_get_category(
        scope="automation", category_id=entry.categories["automation"]
    )
    assert category.name == "Hue Studio"
    await client.send_json_auto_id(
        {
            "type": "hue_studio/automations/organize",
            "entity_id": "automation.leaving_home_a",
            "area_id": area.id,
        }
    )
    assert (await client.receive_json())["success"]
    assert entities.async_get("automation.leaving_home_a").area_id == area.id

    # The user's own choices stay.
    other_area = ar.async_get(hass).async_create("Kitchen")
    entities.async_update_entity(
        "automation.taken", area_id=other_area.id, categories={"automation": "mine"}
    )
    await client.send_json_auto_id(
        {
            "type": "hue_studio/automations/organize",
            "entity_id": "automation.taken",
            "area_id": area.id,
        }
    )
    assert (await client.receive_json())["success"]
    taken = entities.async_get("automation.taken")
    assert taken.area_id == other_area.id
    assert taken.categories == {"automation": "mine"}
    assert label.label_id in taken.labels


async def test_preview(
    hass: HomeAssistant, hue_lights: MagicMock, hass_ws_client: WebSocketGenerator
) -> None:
    """The editor sees what a scene of the day shows now."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": "hue_studio/automations/preview", "scene_of_the_day": POOLS}
    )
    result = (await client.receive_json())["result"]
    assert result["scene"] == "ocean_dawn"
    assert result["scene_name"]
    assert result["phase"] in daylight.PHASES

    await client.send_json_auto_id(
        {"type": "hue_studio/automations/preview", "natural": True}
    )
    result = (await client.receive_json())["result"]
    assert result["kelvin"] in daylight.NATURAL_KELVIN.values()


async def test_legacy_auto_light(
    hass: HomeAssistant,
    hass_storage: dict[str, Any],
    hass_ws_client: WebSocketGenerator,
    hue_lights: MagicMock,
) -> None:
    """The old auto light's settings are offered to new automations."""
    hass_storage[automations.LEGACY_STORAGE_KEY] = {
        "version": 1,
        "data": {
            "areas": {
                "office": {**POOLS, "control": "auto", "skip": {}},
                "hall": {"settings": {"style": "natural"}},
            }
        },
    }
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/automations/legacy_auto_light"})
    result = (await client.receive_json())["result"]
    assert result["office"]["natural"] is False
    assert result["office"]["config"]["pools"]["evening"] == {
        "all": {"clear": ["ocean_dawn"]}
    }
    assert "control" not in result["office"]["config"]
    assert result["hall"]["natural"] is True


async def test_old_auto_light_devices_removed(
    hass: HomeAssistant,
    hue_entry: MockConfigEntry,
    studio_entry: MockConfigEntry,
    mock_bridge: MagicMock,
) -> None:
    """Devices and entities of the old auto light go away on setup."""
    devices = dr.async_get(hass)
    device = devices.async_get_or_create(
        config_entry_id=studio_entry.entry_id,
        identifiers={(DOMAIN, "auto_light_office")},
    )
    er.async_get(hass).async_get_or_create(
        "sensor",
        DOMAIN,
        "auto_light_office_light_scene",
        config_entry=studio_entry,
        device_id=device.id,
    )
    keep = devices.async_get_or_create(
        config_entry_id=studio_entry.entry_id, identifiers={(DOMAIN, BRIDGE_ID)}
    )
    # Old integrations left identifiers with three parts.
    legacy = devices.async_get_or_create(
        config_entry_id=studio_entry.entry_id,
        identifiers={("other", "a", "b")},  # type: ignore[arg-type]
    )
    assert await hass.config_entries.async_setup(studio_entry.entry_id)
    await hass.async_block_till_done()
    assert devices.async_get(device.id) is None
    assert devices.async_get(keep.id) is not None
    assert devices.async_get(legacy.id) is not None
    assert not [
        e
        for e in er.async_get(hass).entities.values()
        if e.unique_id.startswith("auto_light_")
    ]
