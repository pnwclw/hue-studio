"""Tests for automations: blueprints, apply_light, living light, WebSocket API."""

import asyncio
from datetime import timedelta
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

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
from custom_components.hue_studio.pool import async_update_settings

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
    # The other ways of each: with sunrise; only by a button.
    "wake_up_sunrise": {
        "rooms": ["living_room"],
        "start_kind": "sunrise",
        "start_offset": {"hours": 0, "minutes": -15, "seconds": 0},
    },
    "go_to_sleep_button": {
        "rooms": ["living_room"],
        "use_time": False,
        "buttons": ["event.example_button"],
    },
    "coming_home": {"rooms": ["living_room"], "only_dark": True},
    "leaving_home": {"zones": ["light.example_zone"]},
    "mimic_presence": {
        "rooms": ["living_room"],
        "zones": ["light.example_zone"],
        "start_kind": "time",
    },
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
    variants = {"wake_up": "wake_up_sunrise", "go_to_sleep": "go_to_sleep_button"}
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": [_automation(kind, INPUTS[kind]) for kind in TYPES]
            + [
                _automation(kind, INPUTS[variant], "b")
                for kind, variant in variants.items()
            ]
        },
    )
    await hass.async_block_till_done()
    for kind in TYPES:
        found = automations_with_blueprint(hass, blueprint_path(kind))
        assert len(found) == (2 if kind in variants else 1), kind
        for entity_id in found:
            assert hass.states.get(entity_id).state == "on", entity_id


async def test_go_to_sleep_by_button(hass: HomeAssistant, config_dir: Path) -> None:
    """Without a time, a short press of a chosen button starts going to sleep."""
    apply = async_mock_service(hass, DOMAIN, "apply_light")
    hass.states.async_set("event.example_button", "2026-10-22T20:00:00+00:00")
    await async_install_blueprints(hass)
    assert await async_setup_component(
        hass,
        "automation",
        {"automation": [_automation("go_to_sleep", INPUTS["go_to_sleep_button"])]},
    )
    await hass.async_block_till_done()
    press = {"event_type": "long_release"}
    hass.states.async_set("event.example_button", "2026-10-22T20:01:00+00:00", press)
    await hass.async_block_till_done()
    assert not apply
    press = {"event_type": "short_release"}
    hass.states.async_set("event.example_button", "2026-10-22T20:02:00+00:00", press)
    await hass.async_block_till_done()
    assert len(apply) == 1
    assert apply[0].data["light"] == "off"
    assert apply[0].data["transition"] == 1800


@pytest.mark.parametrize("expected_lingering_timers", [True])
async def test_motion_off_by_part_of_the_day(
    hass: HomeAssistant, config_dir: Path, freezer: Any
) -> None:
    """The lights go off after the minutes of the part of the day the motion ends in."""
    apply = async_mock_service(hass, DOMAIN, "apply_light")
    hass.states.async_set("binary_sensor.example_motion", "off")
    hass.states.async_set("sensor.hue_studio_phase", "night")
    await async_install_blueprints(hass)
    inputs = {
        "rooms": ["living_room"],
        "motion": ["binary_sensor.example_motion"],
        "off_after": 10,
        "off_after_phases": {"night": 1},
    }
    assert await async_setup_component(
        hass, "automation", {"automation": [_automation("motion", inputs)]}
    )
    await hass.async_block_till_done()

    async def walk_by() -> None:
        hass.states.async_set("binary_sensor.example_motion", "on")
        await hass.async_block_till_done()
        hass.states.async_set("binary_sensor.example_motion", "off")
        await hass.async_block_till_done()

    async def wait(minutes: float) -> None:
        freezer.tick(timedelta(minutes=minutes))
        async_fire_time_changed(hass)
        await hass.async_block_till_done()

    # At night: one minute.
    await walk_by()
    assert [c.data["light"] for c in apply] == ["auto"]
    await wait(1.1)
    assert [c.data["light"] for c in apply] == ["auto", "off"]
    # During the day: the minutes for every other part of the day.
    hass.states.async_set("sensor.hue_studio_phase", "day")
    await walk_by()
    await wait(5)
    assert [c.data["light"] for c in apply] == ["auto", "off", "auto"]
    await wait(5.1)
    assert [c.data["light"] for c in apply] == ["auto", "off", "auto", "off"]


@pytest.mark.parametrize("expected_lingering_timers", [True])
async def test_wake_up_with_sunrise(
    hass: HomeAssistant, config_dir: Path, freezer: Any
) -> None:
    """With sunrise: the fade ends with the lights full at sunrise plus the offset."""
    await hass.config.async_set_time_zone("UTC")
    freezer.move_to("2026-10-22 05:00:00+00:00")
    apply = async_mock_service(hass, DOMAIN, "apply_light")
    hass.states.async_set(
        "sun.sun", "below_horizon", {"next_rising": "2026-10-22T05:40:00+00:00"}
    )
    await async_install_blueprints(hass)
    inputs = {**INPUTS["wake_up_sunrise"], "fade": 20}
    assert await async_setup_component(
        hass, "automation", {"automation": [_automation("wake_up", inputs)]}
    )
    await hass.async_block_till_done()
    # 05:40 sunrise, 15 min before it, a 20 min fade: from 05:05.
    freezer.move_to("2026-10-22 05:04:00+00:00")
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert not apply
    freezer.move_to("2026-10-22 05:05:00+00:00")
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert len(apply) == 1
    assert apply[0].data["transition"] == 1200


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


@pytest.mark.parametrize("expected_lingering_timers", [True])
async def test_zones_are_targets(
    hass: HomeAssistant, config_dir: Path, hue_lights: MagicMock
) -> None:
    """A Hue room/zone (group light) works like an area, also picked at random."""
    turn_off = async_mock_service(hass, "light", "turn_off")
    await async_install_blueprints(hass)
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": [
                _automation("leaving_home", {"zones": ["light.room"]}),
                _automation(
                    "mimic_presence",
                    {
                        "zones": ["light.room"],
                        "only_away": False,
                        "start_kind": "time",
                        "end_time": "00:00:00",
                    },
                ),
            ]
        },
    )
    await hass.async_block_till_done()
    lights = ["light.strip", "light.bulb"]
    for runs, entity_id in enumerate(
        ("automation.leaving_home_a", "automation.mimic_presence_a"), start=1
    ):
        # Not blocking: mimic presence keeps waiting until its end.
        await hass.services.async_call(
            "automation", "trigger", {"entity_id": entity_id, "skip_condition": True}
        )
        for _ in range(100):
            if len(turn_off) == runs:
                break
            await asyncio.sleep(0.01)
        # Both lights are on, so mimic presence toggles them off.
        assert sorted(turn_off[-1].data["entity_id"]) == sorted(lights), entity_id
    assert len(turn_off) == 2
    await hass.services.async_call(
        "automation",
        "turn_off",
        {"entity_id": "automation.mimic_presence_a"},
        blocking=True,
    )


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
            "entity_id": ["light.bulb", "light.strip"],
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


async def test_apply_light_scene_on_some_lights(
    hass: HomeAssistant, hue_lights: MagicMock
) -> None:
    """Some of a scene's lights chosen: it shows on those only, light by light."""
    hue_lights.request = AsyncMock()
    await hass.services.async_call(
        DOMAIN,
        "apply_light",
        {
            "entity_id": "light.bulb",
            "light": "scene",
            "scenes": ["scene.sunset"],
            "transition": 30,
            "brightness": 40,
        },
        blocking=True,
    )
    hue_lights.scenes.scene.update.assert_not_called()
    hue_lights.request.assert_awaited_once_with(
        "put",
        "clip/v2/resource/light/res-bulb",
        json={
            "on": {"on": True},
            "dimming": {"brightness": 40},
            "dynamics": {"duration": 30_000},
        },
    )


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
    """A scene of the day with an empty pool is an error the automation trace shows."""
    async_update_settings(hass, {"defaults": False})
    with pytest.raises(ServiceValidationError) as err:
        await hass.services.async_call(
            DOMAIN,
            "apply_light",
            {"entity_id": "light.bulb", "light": "auto"},
            blocking=True,
        )
    assert err.value.translation_key == "no_scene_of_the_day"


async def test_scene_of_the_day_from_the_global_pool(
    hass: HomeAssistant, hue_lights: MagicMock
) -> None:
    """The ready-made pool works without settings; the mood changes it at once."""
    await hass.services.async_call(
        DOMAIN,
        "apply_light",
        {"entity_id": "light.bulb", "light": "auto"},
        blocking=True,
    )
    group = living_lights(hass).by_light["light.bulb"]
    assert group.selection.scene is not None
    assert group.selection.mood is None
    hue_lights.lights.update.reset_mock()
    await hass.services.async_call(
        "select",
        "select_option",
        {"entity_id": "select.hue_studio_mood", "option": "party"},
        blocking=True,
    )
    await hass.async_block_till_done()
    assert group.selection.mood == "party"
    assert _sent(hue_lights)[-1][1].dynamics.duration == 2000


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
    group.local["settings"]["kelvin"] = {p: 2000 for p in daylight.PHASES}
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
    er.async_get(hass).async_update_entity("light.bulb", area_id=area.id)
    hass.states.async_set("light.example_zone", "on", {"is_hue_group": True})
    await async_install_blueprints(hass)
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": [
                _automation(
                    "leaving_home",
                    {"rooms": [area.id], "zones": ["light.example_zone"]},
                ),
                {
                    "id": "hue_studio_schedule_taken",
                    "alias": "taken",
                    "triggers": [],
                    "actions": [
                        {
                            "action": "hue_studio.apply_light",
                            "target": {"area_id": area.id, "entity_id": "light.bulb"},
                            "data": {"light": "off"},
                        }
                    ],
                },
                {
                    "id": "leak",
                    "alias": "leak",
                    "triggers": [
                        {
                            "trigger": "state",
                            "entity_id": "binary_sensor.leak",
                            "to": "on",
                        }
                    ],
                    "conditions": [
                        {
                            "condition": "state",
                            "entity_id": "binary_sensor.leak",
                            "state": "on",
                        }
                    ],
                    "actions": [
                        {"action": "switch.turn_off", "target": {"area_id": area.id}}
                    ],
                },
                {
                    "id": "area_light",
                    "alias": "area_light",
                    "triggers": [],
                    "actions": [
                        {
                            "if": [
                                {
                                    "condition": "state",
                                    "entity_id": "sun.sun",
                                    "state": "below_horizon",
                                }
                            ],
                            "then": [
                                {
                                    "action": "light.turn_on",
                                    "target": {"area_id": [area.id]},
                                }
                            ],
                        }
                    ],
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
            "areas": [area.id],
            "groups": ["light.example_zone"],
            "lights": [],
        },
        "automation.taken": {
            "id": "hue_studio_schedule_taken",
            "type": "schedule",
            "custom": True,
            "areas": [area.id],
            "groups": [],
            "lights": ["light.bulb"],
        },
    }
    # The leak automation names the area only to switch a plug off: not about light.
    assert event["related"] == ["automation.area_light", "automation.other"]
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
