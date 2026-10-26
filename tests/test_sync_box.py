"""Tests for the Hue Play HDMI Sync Box: client, pairing, entities, service, WS."""

import asyncio
from collections.abc import Generator
from copy import deepcopy
from datetime import timedelta
from ipaddress import ip_address
from typing import Any
from unittest.mock import MagicMock, patch

from aiohuesyncbox import InvalidState, RequestError, Unauthorized
from aiohuesyncbox.huesyncbox import HueSyncDevice
from homeassistant.auth.models import User
from homeassistant.config_entries import (
    SOURCE_USER,
    SOURCE_ZEROCONF,
    ConfigEntryState,
)
from homeassistant.const import CONF_ACCESS_TOKEN, CONF_HOST
from homeassistant.core import Context, HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.exceptions import (
    ServiceValidationError,
    Unauthorized as HassUnauthorized,
)
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo
from homeassistant.util import dt as dt_util
import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
    async_mock_service,
)
from pytest_homeassistant_custom_component.test_util.aiohttp import (
    AiohttpClientMocker,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.hue_studio import sync_follow
from custom_components.hue_studio.const import (
    CONF_BOX_ID,
    CONF_FOLLOW,
    CONF_KIND,
    CONF_REGISTRATION_ID,
    CONF_SCREEN,
    DOMAIN,
    KIND_SYNC_BOX,
)
from custom_components.hue_studio.sync import (
    SyncBoxNotFound,
    async_get_box_id,
    async_link_box_bridge,
    ir_action,
    ir_execution,
)

from .conftest import ENTERTAINMENT, make_entertainment

BOX_HOST = "192.0.2.20"
BOX_ID = "A1B2C3D4E5F6"


def _port(name: str, status: str = "linked") -> dict[str, Any]:
    return {"name": name, "type": "generic", "status": status, "lastSyncMode": "video"}


# A full state as GET /api/v1 returns it (what aiohuesyncbox's models require).
BOX_STATE: dict[str, Any] = {
    "device": {
        "name": "Sync Box",
        "deviceType": "HSB2",
        "uniqueId": BOX_ID,
        "ipAddress": BOX_HOST,
        "apiLevel": 10,
        "firmwareVersion": "2.5.4",
        "buildNumber": 1,
        "ledMode": 1,
        "wifi": {"ssid": "example", "strength": 3},
    },
    "hue": {
        "connectionState": "connected",
        "groups": {
            "ent-tv": {"name": "TV area", "numLights": 1, "active": False},
            "ent-desk": {"name": "Desk", "numLights": 2, "active": False},
        },
    },
    "execution": {
        "mode": "passthrough",
        "syncActive": False,
        "hdmiActive": True,
        "hdmiSource": "input1",
        "hueTarget": "ent-tv",
        "brightness": 100,
        "lastSyncMode": "video",
        "video": {"intensity": "high", "backgroundLighting": False},
        "game": {"intensity": "moderate", "backgroundLighting": False},
        "music": {"intensity": "subtle", "palette": "neutral"},
    },
    "hdmi": {
        "input1": _port("Media player"),
        "input2": _port("HDMI 2", "unplugged"),
        "input3": _port("Game console", "plugged"),
        "input4": _port("PC"),
        "output": _port("TV"),
        "contentSpecs": "3840 x 2160 @ 60000 - HDR10",
        "videoSyncSupported": True,
        "audioSyncSupported": True,
    },
    "behavior": {
        "inactivePowersave": 20,
        "cecPowersave": True,
        "hpdInputSwitch": True,
        "hpdOutputEnableMs": 1500,
        "input1": {"cecInputSwitch": True, "linkAutoSync": True},
        "input4": {
            "cecInputSwitch": True,
            "linkAutoSync": False,
            "hpdInputPortSwitch": True,
        },
    },
    "registrations": {},
    "presets": {
        "p1": {"name": "Movie night", "lastUsed": None, "execution": {"mode": "video"}},
    },
    "ir": {
        "defaultCodes": True,
        "scan": {"scanning": False, "codes": []},
        "codes": {"aa10": {"name": "Red", "execution": {"toggleSyncActive": True}}},
    },
}


class FakeBox:
    """Stands in for the box behind aiohuesyncbox's request function.

    Everything above it (models, controllers, serialization) is the real library.
    """

    def __init__(self) -> None:
        self.state = deepcopy(BOX_STATE)
        self.calls: list[tuple[str, str, Any]] = []
        self.error: Exception | None = None
        self.button_held = 1  # registration succeeds on this attempt (0: never)
        self._attempts = 0

    async def request(
        self,
        api: HueSyncDevice,
        method: str,
        path: str,
        data: dict | None = None,
        auth: bool = True,
    ) -> Any:
        if self.error is not None:
            raise self.error
        self.calls.append((method, path, data))
        if method == "get" and path == "":
            return deepcopy(self.state)
        if method == "post" and path == "/registrations":
            self._attempts += 1
            if not self.button_held or self._attempts < self.button_held:
                raise InvalidState("16: Invalid state")
            return {"registrationId": "7", "accessToken": "new-token"}
        if method == "put" and path == "/hue" and data:
            hue = self.state["hue"]
            if "bridgeUniqueId" in data:
                # Connected to the other bridge: its entertainment areas.
                hue.update(
                    bridgeUniqueId=data["bridgeUniqueId"],
                    groupId=None,
                    groups={
                        "new-desk": {"name": "Desk", "numLights": 2, "active": False},
                        "new-tv": {"name": "TV area", "numLights": 1, "active": False},
                    },
                )
            if "groupId" in data:
                hue["groupId"] = data["groupId"]
        return None

    def sent(self, method: str = "put", path: str = "/execution") -> list[Any]:
        """Bodies sent with `method` to `path`."""
        return [d for m, p, d in self.calls if (m, p) == (method, path)]

    @property
    def reads(self) -> int:
        """How often the full state was read."""
        return len(self.sent("get", ""))


@pytest.fixture
def box() -> Generator[FakeBox]:
    """The fake box behind the real aiohuesyncbox."""
    fake = FakeBox()
    with patch.object(
        HueSyncDevice, "_request", autospec=True, side_effect=fake.request
    ):
        yield fake


@pytest.fixture
def box_entry(hass: HomeAssistant) -> MockConfigEntry:
    """A paired Sync Box entry."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Sync Box",
        unique_id=BOX_ID,
        data={
            CONF_KIND: KIND_SYNC_BOX,
            CONF_HOST: BOX_HOST,
            CONF_BOX_ID: BOX_ID,
            CONF_ACCESS_TOKEN: "test-token",
            CONF_REGISTRATION_ID: "7",
        },
    )
    entry.add_to_hass(hass)
    return entry


@pytest.fixture
async def sync_box(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> FakeBox:
    """The Sync Box set up with its entities."""
    assert await hass.config_entries.async_setup(box_entry.entry_id)
    await hass.async_block_till_done()
    return box


# ---- finding the box before pairing ----


async def test_box_id_by_address(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker
) -> None:
    """The public device info gives the id the certificate is issued to."""
    aioclient_mock.get(
        f"https://{BOX_HOST}/api/v1/device",
        json={"uniqueId": BOX_ID.lower(), "name": "Box"},
    )
    session = async_get_clientsession(hass)
    assert await async_get_box_id(session, BOX_HOST) == (BOX_ID, "Box")


async def test_not_a_box(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker
) -> None:
    """Something else at the address is no Sync Box."""
    aioclient_mock.get(f"https://{BOX_HOST}/api/v1/device", json={"hello": 1})
    with pytest.raises(SyncBoxNotFound):
        await async_get_box_id(async_get_clientsession(hass), BOX_HOST)


# ---- pairing ----


@pytest.fixture
def register(box: FakeBox) -> Generator[FakeBox]:
    """Registration succeeds on the second try (after the button was held)."""
    box.button_held = 2
    with (
        patch("custom_components.hue_studio.config_flow.LINK_RETRY", 0),
        patch("custom_components.hue_studio.async_setup_entry", return_value=True),
    ):
        yield box


async def _wait_for_link(hass: HomeAssistant, result: dict) -> dict:
    assert result["type"] is FlowResultType.SHOW_PROGRESS
    assert result["progress_action"] == "press_button"
    await hass.async_block_till_done()
    return await hass.config_entries.flow.async_configure(result["flow_id"])


async def test_pair_by_address(hass: HomeAssistant, register: FakeBox) -> None:
    """Address -> hold the button -> an entry with our own registration."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "sync_box"}
    )
    assert result["step_id"] == "sync_box_pair"
    with patch(
        "custom_components.hue_studio.config_flow.async_get_box_id",
        return_value=(BOX_ID, "Living room box"),
    ):
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {CONF_HOST: BOX_HOST}
        )
    result = await _wait_for_link(hass, result)

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Living room box"
    assert result["result"].unique_id == BOX_ID
    assert result["data"] == {
        CONF_KIND: KIND_SYNC_BOX,
        CONF_HOST: BOX_HOST,
        CONF_BOX_ID: BOX_ID,
        CONF_ACCESS_TOKEN: "new-token",
        CONF_REGISTRATION_ID: "7",
    }
    assert len(register.sent("post", "/registrations")) == 2


async def test_pair_cannot_connect(hass: HomeAssistant) -> None:
    """No box at the address: the form shows an error."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "sync_box"}
    )
    with patch(
        "custom_components.hue_studio.config_flow.async_get_box_id",
        side_effect=SyncBoxNotFound,
    ):
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {CONF_HOST: BOX_HOST}
        )
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "cannot_connect"}


def _zeroconf(host: str = BOX_HOST) -> ZeroconfServiceInfo:
    return ZeroconfServiceInfo(
        ip_address=ip_address(host),
        ip_addresses=[ip_address(host)],
        hostname=f"{BOX_ID}.local.",
        name="Sync Box._huesync._tcp.local.",
        port=443,
        type="_huesync._tcp.local.",
        properties={"uniqueid": BOX_ID, "name": "Sync Box", "path": "/api"},
    )


async def test_pair_discovered(hass: HomeAssistant, register: FakeBox) -> None:
    """A discovered box asks first, then pairs."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_ZEROCONF}, data=_zeroconf()
    )
    assert result["step_id"] == "sync_box_confirm"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    result = await _wait_for_link(hass, result)
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"][CONF_HOST] == BOX_HOST


async def test_discovery_follows_new_address(
    hass: HomeAssistant, box_entry: MockConfigEntry
) -> None:
    """A known box on a new address only updates the entry."""
    with patch("custom_components.hue_studio.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": SOURCE_ZEROCONF}, data=_zeroconf("192.0.2.21")
        )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"
    assert box_entry.data[CONF_HOST] == "192.0.2.21"


async def test_pair_button_not_held(hass: HomeAssistant, box: FakeBox) -> None:
    """Nobody held the button: offer to try again."""
    box.button_held = 0
    with (
        patch("custom_components.hue_studio.config_flow.LINK_RETRY", 0),
        patch("custom_components.hue_studio.config_flow.LINK_TIMEOUT", 0.05),
    ):
        result = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": SOURCE_ZEROCONF}, data=_zeroconf()
        )
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
        result = await _wait_for_link(hass, result)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "sync_box_retry"
    assert result["errors"] == {"base": "link_timeout"}


# ---- entities ----


async def test_entities(hass: HomeAssistant, sync_box: FakeBox) -> None:
    """Entity ids and options match the HACS Sync Box integration."""
    states = {
        "switch.sync_box_power": "on",
        "switch.sync_box_light_sync": "off",
        "select.sync_box_sync_mode": "video",
        "select.sync_box_intensity": "high",
        "select.sync_box_hdmi_input": "Media player",
        "select.sync_box_entertainment_area": "TV area",
        "select.sync_box_led_indicator": "normal",
        "number.sync_box_brightness": "50",
        "sensor.sync_box_hdmi1_status": "linked",
        "sensor.sync_box_hdmi2_status": "unplugged",
        "sensor.sync_box_content_info": "3840 x 2160 @ 60000 - HDR10",
        "sensor.sync_box_bridge_connection": "connected",
        "sensor.sync_box_wifi_quality": "good",
    }
    for entity_id, expected in states.items():
        state = hass.states.get(entity_id)
        assert state is not None, entity_id
        assert state.state == expected, entity_id
    inputs = hass.states.get("select.sync_box_hdmi_input").attributes["options"]
    assert inputs == ["Media player", "HDMI 2", "Game console", "PC"]
    areas = hass.states.get("select.sync_box_entertainment_area").attributes
    assert areas["options"] == ["Desk", "TV area"]


@pytest.mark.parametrize(
    ("domain", "service", "data", "sent"),
    [
        (
            "switch",
            "turn_on",
            {"entity_id": "switch.sync_box_light_sync"},
            {"syncActive": True},
        ),
        (
            "switch",
            "turn_off",
            {"entity_id": "switch.sync_box_power"},
            {"mode": "powersave"},
        ),
        (
            "switch",
            "turn_on",
            {"entity_id": "switch.sync_box_power"},
            {"mode": "passthrough"},
        ),
        (
            "select",
            "select_option",
            {"entity_id": "select.sync_box_hdmi_input", "option": "PC"},
            {"hdmiSource": "input4"},
        ),
        (
            "select",
            "select_option",
            {"entity_id": "select.sync_box_entertainment_area", "option": "Desk"},
            {"hueTarget": "ent-desk"},
        ),
        (
            "select",
            "select_option",
            {"entity_id": "select.sync_box_sync_mode", "option": "game"},
            {"mode": "game"},
        ),
        (
            # Not syncing: the mode's own settings carry the intensity.
            "select",
            "select_option",
            {"entity_id": "select.sync_box_intensity", "option": "intense"},
            {"video": {"intensity": "intense", "backgroundLighting": False}},
        ),
        (
            "number",
            "set_value",
            {"entity_id": "number.sync_box_brightness", "value": 100},
            {"brightness": 200},
        ),
    ],
)
async def test_entity_commands(
    hass: HomeAssistant,
    sync_box: FakeBox,
    domain: str,
    service: str,
    data: dict[str, Any],
    sent: dict[str, Any],
) -> None:
    """Entities send one execution change and read the state back."""
    reads = sync_box.reads
    await hass.services.async_call(domain, service, data, blocking=True)
    assert sync_box.sent() == [sent]
    assert sync_box.reads == reads + 1


async def test_entity_ids_ignore_language(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """Polish has native entity ids; ours stay compatible anyway."""
    hass.config.language = "pl"
    assert await hass.config_entries.async_setup(box_entry.entry_id)
    await hass.async_block_till_done()
    assert hass.states.get("switch.sync_box_light_sync") is not None
    assert hass.states.get("select.sync_box_hdmi_input") is not None
    assert hass.states.get("sensor.sync_box_wifi_quality") is not None
    assert hass.states.get("switch.sync_box_power").name == "Sync Box Zasilanie"


async def test_led_indicator(hass: HomeAssistant, sync_box: FakeBox) -> None:
    """The LED is a device setting."""
    await hass.services.async_call(
        "select",
        "select_option",
        {"entity_id": "select.sync_box_led_indicator", "option": "dimmed"},
        blocking=True,
    )
    assert sync_box.sent(path="/device") == [{"ledMode": 2}]


@pytest.mark.parametrize(
    ("data", "sent"),
    [
        (
            {"mode": "game", "intensity": "moderate", "input": "PC", "brightness": 1},
            {
                "mode": "game",
                "game": {"intensity": "moderate", "backgroundLighting": False},
                "hdmiSource": "input4",
                "brightness": 0,
            },
        ),
        (
            {"sync": True, "entertainment_area": "Desk"},
            {"syncActive": True, "hueTarget": "ent-desk"},
        ),
        ({"power": False, "sync": True}, {"mode": "powersave"}),
        ({"sync": False, "mode": "video"}, {"syncActive": False}),
        (
            {"mode": "music", "palette": "happy_calm"},
            {"mode": "music", "music": {"intensity": "subtle", "palette": "happyCalm"}},
        ),
        (
            {"background_lighting": True, "intensity": "intense"},
            {"video": {"intensity": "intense", "backgroundLighting": True}},
        ),
    ],
)
async def test_set_sync(
    hass: HomeAssistant,
    sync_box: FakeBox,
    data: dict[str, Any],
    sent: dict[str, Any],
) -> None:
    """set_sync sends everything in one command."""
    await hass.services.async_call(
        DOMAIN,
        "set_sync",
        {"entity_id": "switch.sync_box_light_sync", **data},
        blocking=True,
    )
    assert sync_box.sent() == [sent]


def test_ir_actions() -> None:
    """Remote button actions and the execution changes the box stores for them."""
    assert ir_execution("toggle_sync") == {"toggleSyncActive": True}
    assert ir_execution("input:input3") == {"hdmiSource": "input3"}
    assert ir_execution("preset:p1") == {"preset": "p1"}
    assert ir_execution("input:input9") is None
    assert ir_execution("dance") is None
    for action in ("darker", "mode_game", "input:input2", "preset:p1"):
        assert ir_action(ir_execution(action)) == action
    assert ir_action({"mode": "video", "brightness": 10}) is None


async def test_presets(hass: HomeAssistant, sync_box: FakeBox) -> None:
    """A preset is started by name, saved from the current state, deleted."""
    target = {"entity_id": "switch.sync_box_light_sync"}
    await hass.services.async_call(
        DOMAIN, "set_sync", {**target, "preset": "Movie night"}, blocking=True
    )
    assert sync_box.sent() == [{"preset": "p1"}]

    response = await hass.services.async_call(
        DOMAIN,
        "save_sync_preset",
        {**target, "name": "Evening"},
        blocking=True,
        return_response=True,
    )
    assert response == {"presets": {BOX_ID: None}}
    assert sync_box.sent("post", "/presets") == [
        {
            "name": "Evening",
            "execution": {
                "mode": "passthrough",
                "hdmiSource": "input1",
                "brightness": 100,
                "hueTarget": "ent-tv",
                "video": {"intensity": "high", "backgroundLighting": False},
            },
        }
    ]

    await hass.services.async_call(
        DOMAIN, "delete_sync_preset", {**target, "preset": "p1"}, blocking=True
    )
    assert sync_box.sent("delete", "/presets/p1") == [None]
    with pytest.raises(ServiceValidationError, match="Gone"):
        await hass.services.async_call(
            DOMAIN, "set_sync", {**target, "preset": "Gone"}, blocking=True
        )


async def test_box_settings_admin_only(
    hass: HomeAssistant, sync_box: FakeBox, hass_read_only_user: User
) -> None:
    """Deleting presets and changing remote buttons needs an admin."""
    target = {"entity_id": "switch.sync_box_light_sync"}
    context = Context(user_id=hass_read_only_user.id)
    for service, data in (
        ("delete_sync_preset", {"preset": "p1"}),
        ("learn_sync_ir_code", {}),
        ("set_sync_ir_code", {"code": "AB", "name": "Red", "action": "toggle_sync"}),
        ("delete_sync_ir_code", {"code": "AB"}),
    ):
        with pytest.raises(HassUnauthorized):
            await hass.services.async_call(
                DOMAIN, service, {**target, **data}, blocking=True, context=context
            )
    assert sync_box.sent("delete", "/presets/p1") == []


async def test_ir_codes(hass: HomeAssistant, sync_box: FakeBox) -> None:
    """Learning a remote button, giving it an action, forgetting it."""
    target = {"entity_id": "switch.sync_box_light_sync"}
    await hass.services.async_call(DOMAIN, "learn_sync_ir_code", target, blocking=True)
    assert sync_box.sent(path="/ir/scan") == [{"scanning": True}]
    await hass.services.async_call(
        DOMAIN,
        "set_sync_ir_code",
        {**target, "code": "BB20", "name": "Blue", "action": "preset:Movie night"},
        blocking=True,
    )
    assert sync_box.sent(path="/ir/codes/bb20") == [
        {"name": "Blue", "execution": {"preset": "p1"}}
    ]
    await hass.services.async_call(
        DOMAIN, "delete_sync_ir_code", {**target, "code": "aa10"}, blocking=True
    )
    assert sync_box.sent("delete", "/ir/codes/aa10") == [None]
    with pytest.raises(ServiceValidationError, match="dance"):
        await hass.services.async_call(
            DOMAIN,
            "set_sync_ir_code",
            {**target, "code": "cc", "name": "X", "action": "dance"},
            blocking=True,
        )


async def test_set_sync_errors(hass: HomeAssistant, sync_box: FakeBox) -> None:
    """Unknown names and foreign entities are rejected."""
    with pytest.raises(ServiceValidationError, match="VCR"):
        await hass.services.async_call(
            DOMAIN,
            "set_sync",
            {"entity_id": "switch.sync_box_light_sync", "input": "VCR"},
            blocking=True,
        )
    hass.states.async_set("switch.other", "on")
    with pytest.raises(ServiceValidationError, match=r"switch\.other"):
        await hass.services.async_call(
            DOMAIN,
            "set_sync",
            {"entity_id": "switch.other", "sync": True},
            blocking=True,
        )
    assert sync_box.sent() == []


async def test_auth_failure_starts_reauth(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """A revoked token asks the user to pair again."""
    box.error = Unauthorized("2: Unauthorized")
    await hass.config_entries.async_setup(box_entry.entry_id)
    await hass.async_block_till_done()
    assert box_entry.state is ConfigEntryState.SETUP_ERROR
    flows = hass.config_entries.flow.async_progress()
    assert [f["step_id"] for f in flows] == ["reauth_confirm"]


async def test_unreachable_retries(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """An unreachable box is retried later."""
    box.error = RequestError("Error requesting data")
    await hass.config_entries.async_setup(box_entry.entry_id)
    assert box_entry.state is ConfigEntryState.SETUP_RETRY


async def test_remove_unregisters(
    hass: HomeAssistant, box_entry: MockConfigEntry, sync_box: FakeBox
) -> None:
    """Removing the box removes our registration from it."""
    await hass.config_entries.async_remove(box_entry.entry_id)
    assert sync_box.sent("delete", "/registrations/7") == [None]


async def test_no_options_for_sync_box(
    hass: HomeAssistant, box_entry: MockConfigEntry
) -> None:
    """Only bridges have room options."""
    assert not box_entry.supports_options


# ---- panel API and the bridge ----


async def test_subscribe_sync(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    hue_lights: MagicMock,
    sync_box: FakeBox,
    box_entry: MockConfigEntry,
) -> None:
    """The panel gets the box with its areas resolved to Hue light entities."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/sync/subscribe"})
    assert (await client.receive_json())["success"]

    boxes = (await client.receive_json())["event"]["boxes"]
    box = boxes[box_entry.entry_id]
    assert box["entity_id"] == "switch.sync_box_light_sync"
    assert box["model"] == "Hue Play HDMI Sync Box 8K"
    assert (box["power"], box["syncing"], box["mode"]) == (True, False, "video")
    assert box["intensity"] == "high"
    assert box["input"] == "input1"
    assert [i["name"] for i in box["inputs"]][:2] == ["Media player", "HDMI 2"]
    assert box["area"] == "ent-tv"
    assert box["areas"] == [
        {"id": "ent-desk", "name": "Desk", "active": False, "lights": []},
        {"id": "ent-tv", "name": "TV area", "active": False, "lights": ["light.strip"]},
    ]

    # The box starts syncing: the next poll pushes the change.
    assert box["palette"] == "neutral"
    assert box["background_lighting"] == {"video": False, "game": False}
    assert box["presets"] == [{"id": "p1", "name": "Movie night", "last_used": None}]
    assert box["ir"] == {
        "scanning": False,
        "scanned": [],
        "codes": [{"code": "aa10", "name": "Red", "action": "toggle_sync"}],
    }
    assert box["features"] == [
        "palette",
        "background_lighting",
        "presets",
        "settings",
        "follow",
        "ir",
    ]
    assert box["device"]["ha_device"] is not None
    assert box["device"] | {"ha_device": None} == {
        "id": BOX_ID,
        "host": BOX_HOST,
        "firmware": "2.5.4",
        "update": None,
        "wifi": 3,
        "wifi_name": "example",
        "bluetooth": None,
        "led": "normal",
        "tv_power": True,
        "auto_update": None,
        "network": None,
        "code": "HSB2",
        "ha_device": None,
    }

    sync_box.state["execution"].update(mode="video", syncActive=True)
    await box_entry.runtime_data.sync.async_refresh()
    box = (await client.receive_json())["event"]["boxes"][box_entry.entry_id]
    assert box["syncing"] is True


async def test_palette_skips_syncing_lights(
    hass: HomeAssistant, hue_lights: MagicMock
) -> None:
    """Lights an entertainment area streams to are left alone."""
    ENTERTAINMENT[:] = [
        make_entertainment("ent-tv", "TV area", ["res-strip"], active=True)
    ]
    await hass.services.async_call(
        DOMAIN,
        "apply_palette",
        {"entity_id": ["light.strip", "light.bulb"], "points": [[0.5, 0.4]]},
        blocking=True,
    )
    assert [c.args[0] for c in hue_lights.lights.update.await_args_list] == ["res-bulb"]

    with pytest.raises(ServiceValidationError, match="syncing"):
        await hass.services.async_call(
            DOMAIN,
            "apply_palette",
            {"entity_id": "light.strip", "points": [[0.5, 0.4]]},
            blocking=True,
        )


async def test_bridge_streaming_refreshes_box(
    hass: HomeAssistant, hue_lights: MagicMock, sync_box: FakeBox
) -> None:
    """A streaming change on the bridge refreshes the box right away."""
    on_change = hue_lights.config.entertainment_configuration.subscribe.call_args.args[
        0
    ]
    reads = sync_box.reads
    on_change("update", ENTERTAINMENT[0])
    await hass.async_block_till_done()
    assert sync_box.reads == reads + 1


async def test_registry_unique_ids(hass: HomeAssistant, sync_box: FakeBox) -> None:
    """Unique ids are per box and key."""
    entry = er.async_get(hass).async_get("switch.sync_box_light_sync")
    assert entry is not None
    assert entry.unique_id == f"{BOX_ID}_light_sync"


async def test_configure(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    sync_box: FakeBox,
    box_entry: MockConfigEntry,
) -> None:
    """The box's own settings from the panel: name, LED, following the TV."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "hue_studio/sync/configure",
            "entry_id": box_entry.entry_id,
            "name": " Living room box ",
            "led": "off",
            "tv_power": False,
        }
    )
    assert (await client.receive_json())["success"]
    assert sync_box.sent(path="/device") == [
        {"name": "Living room box"},
        {"ledMode": 0},
    ]
    # "HDMI CEC: Hue Studio": the box's own CEC and hot plug switching go off as a
    # whole (as 0/1); each input keeps its own automatic sync.
    assert sync_box.sent(path="/behavior") == [
        {
            "cecPowersave": 0,
            "hpdInputSwitch": 0,
            "input1": {"cecInputSwitch": 0, "linkAutoSync": 1},
            "input4": {"cecInputSwitch": 0, "linkAutoSync": 0, "hpdInputPortSwitch": 0},
        }
    ]
    device = dr.async_get(hass).async_get_device_by_identifier(
        (DOMAIN, BOX_ID), box_entry.entry_id
    )
    assert device is not None
    assert device.name == "Living room box"

    await client.send_json_auto_id(
        {"type": "hue_studio/sync/configure", "entry_id": "nope", "led": "off"}
    )
    assert not (await client.receive_json())["success"]


async def test_move_box_to_bridge(
    hass: HomeAssistant,
    sync_box: FakeBox,
    box_entry: MockConfigEntry,
    aioclient_mock: AiohttpClientMocker,
) -> None:
    """The bridge's button gives the box its own credentials for another bridge; the
    box connects there and streams to the area of the same name."""
    bridge = MockConfigEntry(
        domain="hue", unique_id="0017881a2b3c", data={"host": "192.0.2.30"}
    )
    bridge.add_to_hass(hass)
    sync_box.state["hue"]["groupId"] = "ent-tv"
    aioclient_mock.get(
        "https://192.0.2.30/api/config", json={"bridgeid": "001788FFFE1A2B3C"}
    )
    aioclient_mock.post(
        "https://192.0.2.30/api",
        json=[{"success": {"username": "app-key", "clientkey": "0" * 32}}],
    )
    coordinator = box_entry.runtime_data.sync
    steps: list[dict[str, Any]] = []
    area = await async_link_box_bridge(hass, coordinator, bridge.entry_id, steps.append)
    assert area == "TV area"
    assert [s["step"] for s in steps] == ["press", "connecting"]
    sent = sync_box.sent("put", "/hue")
    assert sent[0] == {
        "bridgeUniqueId": "001788FFFE1A2B3C",
        "username": "app-key",
        "clientKey": "0" * 32,
    }
    assert sent[-1] == {"groupId": "new-tv"}
    assert coordinator.panel_info()["bridge"] == bridge.entry_id


async def test_box_behavior(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    sync_box: FakeBox,
    box_entry: MockConfigEntry,
) -> None:
    """The Hue app's "Automatic control" and "Advanced" from the panel: the box's
    behavior as 0/1, an input's switches whole."""
    info = box_entry.runtime_data.sync.panel_info()
    assert info["behavior"] == {
        "cec_power": True,
        "hpd_power": True,
        "usb_power": None,
        "hpd_switch": True,
        "inactivity": 20,
        "arc_bypass": None,
        "inputs": {
            "input1": {"cec_switch": True, "hpd_switch": None, "auto_sync": True},
            "input4": {"cec_switch": True, "hpd_switch": True, "auto_sync": False},
        },
    }
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "hue_studio/sync/behavior",
            "entry_id": box_entry.entry_id,
            "hpd_power": False,
            "usb_power": True,
            "inactivity": 0,
            "arc_bypass": False,
            "inputs": {"input4": {"auto_sync": True}, "input2": {"cec_switch": True}},
        }
    )
    assert (await client.receive_json())["success"]
    # input2 has no behavior of its own on this box: left alone.
    assert sync_box.sent(path="/behavior") == [
        {
            "inactivePowersave": 0,
            "usbPowersave": 1,
            "hpdOutputEnableMs": 0,
            "arcBypassMode": 0,
            "input4": {"cecInputSwitch": 1, "linkAutoSync": 1, "hpdInputPortSwitch": 1},
        }
    ]
    await client.send_json_auto_id(
        {"type": "hue_studio/sync/behavior", "entry_id": "nope", "cec_power": True}
    )
    assert not (await client.receive_json())["success"]


async def test_box_updates_and_restart(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    sync_box: FakeBox,
    box_entry: MockConfigEntry,
) -> None:
    """Updates at night on or off (at the box's own hour), restart, look for one."""
    update = {"autoUpdateEnabled": False, "autoUpdateTime": 3}
    sync_box.state["device"]["update"] = update
    sync_box.state["device"]["wifiState"] = "wan"
    await box_entry.runtime_data.sync.async_refresh()
    device = box_entry.runtime_data.sync.panel_info()["device"]
    assert device["auto_update"] is False
    assert (device["network"], device["code"]) == ("wan", "HSB2")
    client = await hass_ws_client(hass)
    changes = (
        {"auto_update": True},
        {"action": "restart"},
        {"action": "check_update"},
        {"background": {"game": True}},
    )
    for change in changes:
        await client.send_json_auto_id(
            {
                "type": "hue_studio/sync/configure",
                "entry_id": box_entry.entry_id,
                **change,
            }
        )
        assert (await client.receive_json())["success"]
    assert sync_box.sent(path="/device") == [
        {"update": {"autoUpdateEnabled": True, "autoUpdateTime": 3}},
        {"action": "doSoftwareRestart"},
        {"action": "checkForFirmwareUpdates"},
    ]
    # A mode's background lighting without switching to it.
    assert sync_box.sent()[-1] == {
        "game": {"intensity": "moderate", "backgroundLighting": True}
    }


async def test_box_diagnostics(
    hass: HomeAssistant, sync_box: FakeBox, box_entry: MockConfigEntry
) -> None:
    """Diagnostics show the box's own state without its token or addresses."""
    from custom_components.hue_studio.diagnostics import (
        async_get_config_entry_diagnostics,
    )

    data = await async_get_config_entry_diagnostics(hass, box_entry)
    assert data["data"][CONF_ACCESS_TOKEN] == "**REDACTED**"
    assert data["box"]["behavior"]["inactivePowersave"] == 20
    assert data["box"]["device"]["ipAddress"] == "**REDACTED**"
    assert data["box"]["device"]["wifi"]["ssid"] == "**REDACTED**"


async def test_box_bluetooth(
    hass: HomeAssistant, sync_box: FakeBox, box_entry: MockConfigEntry
) -> None:
    """The box's Bluetooth goes on (the Hue Sync app changes its Wi-Fi over it)."""
    await box_entry.runtime_data.sync.async_configure(bluetooth=True)
    assert sync_box.sent("put", "/device") == [{"bluetooth": True}]


# ---- following the picture (no HDMI CEC) ----

SCREEN = "media_player.example_tv"
PC = "binary_sensor.example_pc_picture"
PLAYER = "media_player.example_player"


async def _follow(
    hass: HomeAssistant,
    entry: MockConfigEntry,
    box: FakeBox,
    follow: dict[str, Any],
    screen: dict[str, Any] | None = None,
    *,
    cec: bool = False,
) -> None:
    """Set the box up with these options; Hue Studio does CEC unless `cec`."""
    box.state["behavior"]["cecPowersave"] = cec
    options: dict[str, Any] = {CONF_FOLLOW: follow}
    if screen:
        options[CONF_SCREEN] = {"entity_id": SCREEN} | screen
    hass.config_entries.async_update_entry(entry, options=options)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()


async def _poll(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    await entry.runtime_data.sync.async_refresh()
    await hass.async_block_till_done()


def _later(hass: HomeAssistant, seconds: float) -> None:
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=seconds))


async def test_follow_signal(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """An input's signal turning on switches the box to it in its mode at once; the
    box's link of an input it is not on, and states already there, change nothing."""
    hass.states.async_set(PC, "off")
    await _follow(hass, box_entry, box, {"input4": {"action": "game", "signal": PC}})
    assert box.sent() == []

    box.state["hdmi"]["input3"]["status"] = "linked"
    await _poll(hass, box_entry)
    assert box.sent() == []

    hass.states.async_set(PC, "on")
    await hass.async_block_till_done()
    assert box.sent() == [{"hdmiSource": "input4", "mode": "game"}]

    await _poll(hass, box_entry)
    assert len(box.sent()) == 1


async def test_follow_current_link(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """Without a signal, the box's own link counts for the input it is on; settings
    from 0.10.0-alpha.5 (the action alone) still work."""
    box.state["hdmi"]["input1"]["status"] = "plugged"
    await _follow(hass, box_entry, box, {"input1": "video", "input4": "game"})
    box.state["hdmi"]["input1"]["status"] = "linked"
    await _poll(hass, box_entry)
    assert box.sent() == [{"hdmiSource": "input1", "mode": "video"}]


async def test_follow_already_there(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """A picture on the input already shown in its mode sends nothing."""
    box.state["execution"].update(mode="video", syncActive=True)
    box.state["hdmi"]["input1"]["status"] = "plugged"
    await _follow(hass, box_entry, box, {"input1": {"action": "video"}})
    box.state["hdmi"]["input1"]["status"] = "linked"
    await _poll(hass, box_entry)
    assert box.sent() == []


async def test_follow_wakes_box(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """A sleeping box sees no picture, but a signal wakes it on its input."""
    box.state["execution"]["mode"] = "powersave"
    hass.states.async_set(PLAYER, "off")
    await _follow(
        hass, box_entry, box, {"input1": {"action": "video", "signal": PLAYER}}
    )
    hass.states.async_set(PLAYER, "idle")
    await hass.async_block_till_done()
    assert box.sent() == [{"hdmiSource": "input1", "mode": "video"}]


async def test_follow_lost_picture(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """The current input without a picture for a while: the latest other followed
    input with one takes over; a short drop, or a box asleep, changes nothing."""
    box.state["execution"].update(hdmiSource="input4", mode="game")
    hass.states.async_set(PLAYER, "playing")
    await _follow(
        hass,
        box_entry,
        box,
        {"input1": {"action": "video", "signal": PLAYER}, "input4": {"action": "game"}},
    )

    box.state["hdmi"]["input4"]["status"] = "plugged"
    await _poll(hass, box_entry)
    _later(hass, 5)
    box.state["hdmi"]["input4"]["status"] = "linked"
    await _poll(hass, box_entry)
    _later(hass, sync_follow.LOST_AFTER + 1)
    await hass.async_block_till_done()
    assert box.sent() == []

    box.state["execution"]["mode"] = "powersave"
    box.state["hdmi"]["input4"]["status"] = "plugged"
    await _poll(hass, box_entry)
    _later(hass, 30)
    await hass.async_block_till_done()
    assert box.sent() == []

    box.state["execution"]["mode"] = "game"
    await _poll(hass, box_entry)
    _later(hass, 50)
    await hass.async_block_till_done()
    assert box.sent() == [{"hdmiSource": "input1", "mode": "video"}]


async def test_follow_screen_on(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """A picture turns the linked screen on, then onto the box's input."""
    turn_on = async_mock_service(hass, "media_player", "turn_on")
    select = async_mock_service(hass, "media_player", "select_source")
    hass.states.async_set(SCREEN, "off")
    hass.states.async_set(PC, "off")
    await _follow(
        hass,
        box_entry,
        box,
        {"input4": {"action": "game", "signal": PC}},
        {"source": "HDMI 3"},
    )

    with patch.object(sync_follow, "SCREEN_SETTLE", 0):
        hass.states.async_set(PC, "on")
        await hass.async_block_till_done()
        assert [c.data for c in turn_on] == [{"entity_id": SCREEN}]
        assert select == []
        hass.states.async_set(SCREEN, "on", {"source": "HDMI 1"})
        await hass.async_block_till_done()
        await asyncio.sleep(0)
        await hass.async_block_till_done()
    assert [c.data for c in select] == [{"entity_id": SCREEN, "source": "HDMI 3"}]


async def test_follow_screen_wakes_box(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """The screen turned on by hand while the box sleeps: the box wakes on the input
    with the latest picture; while it is awake, nothing happens."""
    box.state["execution"]["mode"] = "powersave"
    hass.states.async_set(SCREEN, "off")
    hass.states.async_set(PC, "on")
    await _follow(
        hass,
        box_entry,
        box,
        {"input4": {"action": "game", "signal": PC}},
        {"off_after": 0},
    )
    hass.states.async_set(SCREEN, "on")
    await hass.async_block_till_done()
    assert box.sent() == [{"hdmiSource": "input4", "mode": "game"}]

    box.state["execution"]["mode"] = "game"
    await _poll(hass, box_entry)
    hass.states.async_set(SCREEN, "off")
    await hass.async_block_till_done()
    hass.states.async_set(SCREEN, "on")
    await hass.async_block_till_done()
    assert len(box.sent()) == 1


async def test_follow_screen_off(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """No picture on any followed input for a while: the screen goes off, unless it
    shows something else by then."""
    turn_off = async_mock_service(hass, "media_player", "turn_off")
    hass.states.async_set(SCREEN, "on", {"source": "HDMI 3"})
    hass.states.async_set(PC, "on")
    await _follow(
        hass,
        box_entry,
        box,
        {"input4": {"action": "game", "signal": PC}},
        {"source": "HDMI 3", "off_after": 60},
    )
    hass.states.async_set(PC, "off")
    await hass.async_block_till_done()
    _later(hass, 30)
    await hass.async_block_till_done()
    assert turn_off == []
    _later(hass, 61)
    await hass.async_block_till_done()
    assert [c.data for c in turn_off] == [{"entity_id": SCREEN}]

    # Again, but the screen shows another input by then.
    hass.states.async_set(PC, "on")
    await hass.async_block_till_done()
    hass.states.async_set(PC, "off")
    hass.states.async_set(SCREEN, "on", {"source": "HDMI 1"})
    await hass.async_block_till_done()
    _later(hass, 200)
    await hass.async_block_till_done()
    assert len(turn_off) == 1


async def test_follow_settings(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    sync_box: FakeBox,
    box_entry: MockConfigEntry,
) -> None:
    """The panel changes the settings and gets them back with the box."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "hue_studio/sync/subscribe"})
    assert (await client.receive_json())["success"]
    box = (await client.receive_json())["event"]["boxes"][box_entry.entry_id]
    assert "follow" in box["features"]
    assert (box["follow"], box["screen"]) == ({}, None)

    shown = [box]

    async def follow(**change: Any) -> dict[str, Any]:
        await client.send_json_auto_id(
            {"type": "hue_studio/sync/follow", "entry_id": box_entry.entry_id} | change
        )
        # A new payload (if anything changed) comes before the result.
        message = await client.receive_json()
        if message["type"] == "result":
            return message if not message["success"] else shown[-1]
        assert (await client.receive_json())["success"]
        shown.append(message["event"]["boxes"][box_entry.entry_id])
        return shown[-1]

    box = await follow(
        follow={
            "input4": {"action": "game", "signal": PC},
            "input1": {"action": "video"},
        }
    )
    assert box["follow"] == {
        "input4": {"action": "game", "signal": PC, "wake": None},
        "input1": {"action": "video", "signal": None, "wake": None},
    }
    box = await follow(follow={"input4": {"signal": None}, "input1": None})
    assert box["follow"] == {"input4": {"action": "game", "signal": None, "wake": None}}
    # A signal alone follows nothing.
    box = await follow(follow={"input2": {"signal": PLAYER}})
    assert "input2" not in box["follow"]

    box = await follow(screen={"entity_id": SCREEN})
    assert box["screen"] == {
        "entity_id": SCREEN,
        "source": None,
        "off_after": sync_follow.SCREEN_OFF_AFTER,
    }
    box = await follow(screen={"source": "HDMI 3", "off_after": 0})
    assert box["screen"] == {"entity_id": SCREEN, "source": "HDMI 3", "off_after": 0}
    box = await follow(screen=None)
    assert box["screen"] is None
    assert box_entry.options == {
        CONF_FOLLOW: {"input4": {"action": "game", "signal": None, "wake": None}}
    }

    assert not (await follow(screen={"entity_id": "light.example_lamp"}))["success"]
    assert not (await follow(follow={"input9": {"action": "game"}}))["success"]
    assert not (await follow(follow={"input1": {"signal": "light.example_lamp"}}))[
        "success"
    ]
    assert not (await follow(follow={"input1": {"wake": "light.example_lamp"}}))[
        "success"
    ]


async def test_follow_sensor_signal(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """A sensor is a signal too: a PC agent's monitor state, "PowerOff" is none."""
    monitor = "sensor.example_pc_monitor"
    hass.states.async_set(monitor, "PowerOff")
    await _follow(
        hass, box_entry, box, {"input4": {"action": "game", "signal": monitor}}
    )
    hass.states.async_set(monitor, "Dimmed")
    await hass.async_block_till_done()
    assert box.sent() == [{"hdmiSource": "input4", "mode": "game"}]


async def test_follow_pause(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """Light sync stopped by hand while the picture stays: switches carry no sync
    until no input has a picture."""
    box.state["execution"].update(hdmiSource="input4", mode="game", syncActive=True)
    hass.states.async_set(PLAYER, "off")
    await _follow(
        hass,
        box_entry,
        box,
        {"input1": {"action": "video", "signal": PLAYER}, "input4": {"action": "game"}},
    )
    box.state["execution"].update(mode="passthrough", syncActive=False)
    await _poll(hass, box_entry)

    hass.states.async_set(PLAYER, "playing")
    await hass.async_block_till_done()
    assert box.sent() == [{"hdmiSource": "input1", "mode": "passthrough"}]

    # The session ends (no picture anywhere): the next one syncs again.
    hass.states.async_set(PLAYER, "off")
    box.state["execution"].update(hdmiSource="input1")
    box.state["hdmi"]["input1"]["status"] = "plugged"
    box.state["hdmi"]["input4"]["status"] = "plugged"
    await _poll(hass, box_entry)
    hass.states.async_set(PLAYER, "playing")
    await hass.async_block_till_done()
    assert box.sent()[-1] == {"hdmiSource": "input1", "mode": "video"}


async def test_follow_box_wakes_screen(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """The box woken any way turns its screen on (its input left as it is)."""
    turn_on = async_mock_service(hass, "media_player", "turn_on")
    select = async_mock_service(hass, "media_player", "select_source")
    box.state["execution"]["mode"] = "powersave"
    box.state["hdmi"]["input1"]["status"] = "plugged"
    hass.states.async_set(SCREEN, "off")
    await _follow(
        hass, box_entry, box, {"input1": {"action": "video"}}, {"source": "HDMI 3"}
    )
    box.state["execution"]["mode"] = "passthrough"
    await _poll(hass, box_entry)
    assert [c.data for c in turn_on] == [{"entity_id": SCREEN}]
    hass.states.async_set(SCREEN, "on", {"source": "HDMI 1"})
    await hass.async_block_till_done()
    assert select == []


async def test_set_sync_wakes_source(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """Picking an input turns its source on first, unless it sends a picture."""
    press = async_mock_service(hass, "button", "press")
    wol = "button.example_wake_on_lan"
    hass.states.async_set(PC, "off")
    await _follow(
        hass, box_entry, box, {"input4": {"action": "game", "signal": PC, "wake": wol}}
    )
    await hass.services.async_call(
        DOMAIN,
        "set_sync",
        {"entity_id": "switch.sync_box_light_sync", "input": "PC"},
        blocking=True,
    )
    assert [c.data for c in press] == [{"entity_id": wol}]
    assert box.sent()[-1] == {"hdmiSource": "input4"}

    hass.states.async_set(PC, "on")
    await hass.async_block_till_done()
    await hass.services.async_call(
        DOMAIN,
        "set_sync",
        {"entity_id": "switch.sync_box_light_sync", "input": "input4"},
        blocking=True,
    )
    assert len(press) == 1


async def test_input_name_and_type(
    hass: HomeAssistant,
    hass_ws_client: WebSocketGenerator,
    sync_box: FakeBox,
    box_entry: MockConfigEntry,
) -> None:
    """An input's name and type (its icon) are written to the box."""
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "hue_studio/sync/input",
            "entry_id": box_entry.entry_id,
            "input": "input1",
            "name": " Apple TV ",
            "port_type": "appletv",
        }
    )
    answer = await client.receive_json()
    assert answer["success"], answer
    await client.send_json_auto_id(
        {
            "type": "hue_studio/sync/input",
            "entry_id": box_entry.entry_id,
            "input": "input4",
            "port_type": "desktop",
        }
    )
    assert (await client.receive_json())["success"]
    assert sync_box.sent("put", "/hdmi/input1") == [
        {"name": "Apple TV", "type": "appletv"}
    ]
    assert sync_box.sent("put", "/hdmi/input4") == [{"type": "desktop"}]

    await client.send_json_auto_id(
        {
            "type": "hue_studio/sync/input",
            "entry_id": box_entry.entry_id,
            "input": "input1",
            "port_type": "toaster",
        }
    )
    assert not (await client.receive_json())["success"]


async def test_follow_input_picked_by_hand(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """An input picked by hand that has a picture gets its own mode."""
    box.state["execution"].update(hdmiSource="input1", mode="video", syncActive=True)
    hass.states.async_set(PC, "on")
    await _follow(
        hass,
        box_entry,
        box,
        {"input1": {"action": "video"}, "input4": {"action": "game", "signal": PC}},
    )
    box.state["execution"]["hdmiSource"] = "input4"
    await _poll(hass, box_entry)
    assert box.sent() == [{"hdmiSource": "input4", "mode": "game"}]


async def test_follow_none_with_box_cec(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """While the box does HDMI CEC itself, Hue Studio switches, wakes and turns the
    screen on for nothing."""
    turn_on = async_mock_service(hass, "media_player", "turn_on")
    press = async_mock_service(hass, "button", "press")
    hass.states.async_set(SCREEN, "off")
    hass.states.async_set(PC, "off")
    rule = {"action": "game", "signal": PC, "wake": "button.example_wake_on_lan"}
    await _follow(hass, box_entry, box, {"input4": rule}, {"off_after": 0}, cec=True)
    hass.states.async_set(PC, "on")
    await hass.async_block_till_done()
    hass.states.async_set(PC, "off")
    await hass.services.async_call(
        DOMAIN,
        "set_sync",
        {"entity_id": "switch.sync_box_light_sync", "input": "PC"},
        blocking=True,
    )
    assert box.sent() == [{"hdmiSource": "input4"}]
    assert (turn_on, press) == ([], [])


async def test_follow_picture_back_while_screen_turns_off(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """A picture back just as the screen is being turned off (still "on" in HA): the
    turn-off runs to its end, then the screen is turned on again."""
    off_calls: list[dict[str, Any]] = []
    release = asyncio.Event()

    async def slow_off(call: Any) -> None:
        off_calls.append(dict(call.data))
        await release.wait()

    hass.services.async_register("media_player", "turn_off", slow_off)
    turn_on = async_mock_service(hass, "media_player", "turn_on")
    hass.states.async_set(SCREEN, "on", {"source": "HDMI 3"})
    hass.states.async_set(PC, "on")
    await _follow(
        hass,
        box_entry,
        box,
        {"input4": {"action": "game", "signal": PC}},
        {"source": "HDMI 3", "off_after": 30},
    )
    with (
        patch.object(sync_follow, "SCREEN_REWAKE", 0),
        patch.object(sync_follow, "SCREEN_SETTLE", 0),
    ):
        hass.states.async_set(PC, "off")
        await hass.async_block_till_done()
        _later(hass, 31)
        await hass.async_block_till_done()
        assert off_calls == [{"entity_id": SCREEN}]

        # The PC's screen is back while the TV is still on its way off.
        hass.states.async_set(PC, "on")
        await hass.async_block_till_done()
        assert turn_on == []
        release.set()
        hass.states.async_set(SCREEN, "off")
        for _ in range(3):
            await hass.async_block_till_done()
            await asyncio.sleep(0)
        assert [c.data for c in turn_on] == [{"entity_id": SCREEN}]


async def test_follow_input_by_hand_turns_screen_on(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """An input picked by hand while the screen is off turns the screen on."""
    turn_on = async_mock_service(hass, "media_player", "turn_on")
    box.state["execution"].update(hdmiSource="input1", mode="video")
    hass.states.async_set(SCREEN, "off")
    hass.states.async_set(PC, "on")
    await _follow(
        hass,
        box_entry,
        box,
        {"input1": {"action": "video"}, "input4": {"action": "game", "signal": PC}},
        {"off_after": 0},
    )
    box.state["execution"]["hdmiSource"] = "input4"
    await _poll(hass, box_entry)
    assert [c.data for c in turn_on] == [{"entity_id": SCREEN}]


async def test_follow_signal_back_after_a_moment_unknown(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """A signal unknown for a moment (an agent reconnecting) and back is not its
    source turning on; back after a long while (the PC was off), it is."""
    box.state["execution"]["mode"] = "powersave"
    box.state["hdmi"]["input4"]["status"] = "plugged"
    hass.states.async_set(PC, "on")
    await _follow(hass, box_entry, box, {"input4": {"action": "game", "signal": PC}})
    hass.states.async_set(PC, "unavailable")
    await hass.async_block_till_done()
    hass.states.async_set(PC, "on")
    await hass.async_block_till_done()
    assert box.sent() == []

    hass.states.async_set(PC, "unavailable")
    await hass.async_block_till_done()
    with patch.object(sync_follow, "SIGNAL_FLAP", 0):
        hass.states.async_set(PC, "on")
        await hass.async_block_till_done()
    assert box.sent() == [{"hdmiSource": "input4", "mode": "game"}]


async def test_follow_quiets_box_switching(
    hass: HomeAssistant, box_entry: MockConfigEntry, box: FakeBox
) -> None:
    """With Hue Studio doing CEC, the box's own input switching left on (or turned
    back on in the Hue Sync app) is turned off."""
    await _follow(hass, box_entry, box, {"input4": {"action": "game"}})
    assert box.sent("put", "/behavior") == [
        {
            "cecPowersave": 0,
            "hpdInputSwitch": 0,
            "input1": {"cecInputSwitch": 0, "linkAutoSync": 1},
            "input4": {"cecInputSwitch": 0, "linkAutoSync": 0, "hpdInputPortSwitch": 0},
        }
    ]
    box.state["behavior"].update(
        hpdInputSwitch=False,
        input1={"cecInputSwitch": False, "linkAutoSync": True},
        input4={
            "cecInputSwitch": False,
            "linkAutoSync": False,
            "hpdInputPortSwitch": False,
        },
    )
    await _poll(hass, box_entry)
    assert len(box.sent("put", "/behavior")) == 1
