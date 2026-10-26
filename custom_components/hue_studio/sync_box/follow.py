"""Following the picture: what HDMI CEC does, for sources that have none.

A Sync Box switches inputs by itself only when a source sends CEC "active source" or
when its 5V/hot plug appears. A PC has no CEC, and an EDID manager between it and the
box (one that holds hot plug so the PC keeps its display) hides it turning on. Nor can
the box tell: it reports a picture (`linked`) only on the input it is on, and none
while it sleeps. So an input's picture is known from Home Assistant: an entity of its
source (its player, or a sensor that is on while it sends a picture), and the box's
own link for the input it is on. When an input's picture appears, the box switches to
it in the mode chosen for that input (or just shows it), waking up if it sleeps; when
the current input has lost its picture for a while, the latest other input with one
takes over.

All of this is the home-made HDMI CEC the box's page offers in place of the box's own
("HDMI CEC: Hue Studio", which turns the box's following of the TV off); while the
box does CEC itself, nothing here acts.

A screen (a media player) is linked too: it turns on and switches to the box's
input when a picture appears, and turns off when no followed input has had one for a
while, unless it shows something else by then. Turned on by hand while the box
sleeps, it wakes the box on the input with the latest picture.

Only edges count (a picture appearing or going away), never the state as such: a
choice made by hand in the meantime stays. Settings are the box entry's options,
changed from the panel (hue_studio/sync/follow).
"""

from __future__ import annotations

import asyncio
from collections.abc import Coroutine, Mapping
import contextlib
import logging
from typing import TYPE_CHECKING, Any

from aiohuesyncbox import ExecutionMode, HdmiSource
from homeassistant.components.media_player import (
    ATTR_INPUT_SOURCE,
    DOMAIN as MEDIA_PLAYER_DOMAIN,
    SERVICE_SELECT_SOURCE,
)
from homeassistant.const import (
    ATTR_ENTITY_ID,
    SERVICE_TURN_OFF,
    SERVICE_TURN_ON,
    STATE_OFF,
    STATE_STANDBY,
    STATE_UNAVAILABLE,
    STATE_UNKNOWN,
)
from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.event import async_call_later, async_track_state_change_event

from ..const import CONF_FOLLOW, CONF_SCREEN

# HDMI inputs of a box (sync.INPUTS; not imported: sync imports this module).
INPUTS = ["input1", "input2", "input3", "input4"]

if TYPE_CHECKING:
    from homeassistant.core import EventStateChangedData

    from .coordinator import SyncBoxCoordinator

_LOGGER = logging.getLogger(__name__)

# What an input's picture starts: just showing it, or syncing in a mode.
ACTIONS = ["passthrough", "video", "game", "music"]
# Entities that may tell an input's picture: on (a player: not off, a sensor: not
# one of NO_PICTURE) while its source sends one.
SIGNAL_DOMAINS = [
    "binary_sensor",
    "input_boolean",
    "media_player",
    "remote",
    "sensor",
    "switch",
]
# A signal's states (any case) that mean no picture, e.g. a PC agent's "PowerOff".
NO_PICTURE = frozenset(
    {"off", "standby", "poweroff", "sleep", "sleeping", "false", "0", "none"}
    | {STATE_UNAVAILABLE, STATE_UNKNOWN}
)
# Entities that turn a source on: a Wake on LAN button, a remote, a player, a script.
WAKE_DOMAINS = ["button", "input_button", "media_player", "remote", "script", "switch"]
SYNC_MODES = (ExecutionMode.VIDEO, ExecutionMode.GAME, ExecutionMode.MUSIC)
# How long the current input may stay without a picture before another one with a
# picture takes over (a source changing resolution or HDR drops it for a moment).
LOST_AFTER = 10
# The screen: off after this long without a picture by default; how long it may take
# to turn on, and to settle before it takes a source.
SCREEN_OFF_AFTER = 300
SCREEN_OFF_AFTER_MAX = 4 * 3600
SCREEN_WAKE = 40
SCREEN_SETTLE = 3
# A picture back just as the screen was being turned off: wait (at most this long)
# for it to be off, give it a moment, then turn it on again.
SCREEN_REWAKE_WINDOW = 60
SCREEN_OFF_WAIT = 15
SCREEN_REWAKE = 3
# A signal back within this long of not being known (Home Assistant starting, an
# agent reconnecting) is not its source turning on.
SIGNAL_FLAP = 60

SCREEN_OFF = (STATE_OFF, STATE_STANDBY)
SCREEN_GONE = (STATE_UNAVAILABLE, STATE_UNKNOWN)


def box_does_cec(coordinator: SyncBoxCoordinator) -> bool:
    """Whether the box does HDMI CEC itself (follows the TV); else Hue Studio does."""
    behavior = coordinator.api.behavior
    return behavior is not None and bool(behavior.cec_powersave)


def own_switching_on(coordinator: SyncBoxCoordinator) -> bool:
    """Whether the box would still switch inputs by itself (CEC, hot plug)."""
    behavior = coordinator.api.behavior
    if behavior is None:
        return False
    inputs = [getattr(behavior, key) for key in INPUTS]
    return bool(behavior.hpd_input_switch) or any(
        i is not None and (i.cec_input_switch or i.hpd_input_port_switch)
        for i in inputs
    )


def has_picture(hass: HomeAssistant, entity_id: str | None) -> bool:
    """Whether a signal entity says its source sends a picture."""
    state = hass.states.get(entity_id) if entity_id else None
    return state is not None and state.state.casefold() not in NO_PICTURE


def follow_rules(options: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """Input -> {"action", "signal", "wake"} for the inputs that are followed.

    0.10.0-alpha.5 stored the action alone.
    """
    rules: dict[str, dict[str, Any]] = {}
    for key, rule in (options.get(CONF_FOLLOW) or {}).items():
        if isinstance(rule, str):
            rule = {"action": rule}
        if isinstance(rule, dict) and rule.get("action") in ACTIONS:
            rules[key] = {
                "action": rule["action"],
                "signal": rule.get("signal"),
                "wake": rule.get("wake"),
            }
    return rules


class PictureFollower:
    """Follows the pictures of one directly paired box's inputs."""

    def __init__(self, hass: HomeAssistant, coordinator: SyncBoxCoordinator) -> None:
        """Nothing runs until `async_start`."""
        self.hass = hass
        self.coordinator = coordinator
        self.entry = coordinator.config_entry
        # Whether each followed input had a picture last time (None: not read yet).
        self._pictures: dict[str, bool] | None = None
        # When each input last got its picture (loop time): the latest one wins.
        self._since: dict[str, float] = {}
        self._screen_on: bool | None = None
        self._awake: bool | None = None
        self._input: str | None = None
        # Light sync stopped by hand while the picture stayed: it stays stopped until
        # no input has a picture (or it is started again), as on the box itself.
        self._paused = False
        self._mode: ExecutionMode | None = None
        # The input and mode last sent (a stop of ours is not a pause).
        self._sent: tuple[str, ExecutionMode] | None = None
        self._tracked: frozenset[str] = frozenset()
        self._untrack: CALLBACK_TYPE | None = None
        self._lost: CALLBACK_TYPE | None = None
        self._dark: CALLBACK_TYPE | None = None
        self._screen_task: asyncio.Task[None] | None = None
        # When the screen was last told to turn off (loop time), and whether that
        # command is still on its way (it is never cancelled half way).
        # Since when each followed input's signal has been unknown or unavailable.
        self._unknown_since: dict[str, float] = {}
        self._off_sent: float | None = None
        self._turning_off = False
        self._quieting = False

    @property
    def rules(self) -> dict[str, dict[str, Any]]:
        """Input -> {"action", "signal", "wake"}, for the inputs that are followed."""
        return follow_rules(self.entry.options)

    @property
    def screen(self) -> dict[str, Any] | None:
        """The linked screen's settings, if one is linked and Hue Studio does CEC."""
        if box_does_cec(self.coordinator):
            return None
        screen = self.entry.options.get(CONF_SCREEN)
        return screen if screen and screen.get(ATTR_ENTITY_ID) else None

    @callback
    def async_start(self) -> CALLBACK_TYPE:
        """Watch the box's polls and the signals; returns what stops it."""
        remove = self.coordinator.async_add_listener(self._evaluate)
        self._evaluate()

        @callback
        def stop() -> None:
            remove()
            if self._untrack:
                self._untrack()
            self._cancel_lost()
            self._cancel_dark()
            if self._screen_task:
                self._screen_task.cancel()

        return stop

    def _current(self) -> str | None:
        source = self.coordinator.api.execution.hdmi_source
        return source.value if source else None

    def _asleep(self) -> bool:
        return self.coordinator.api.execution.mode == ExecutionMode.POWERSAVE

    def _is_on(self, entity_id: str | None, off: tuple[str, ...]) -> bool:
        state = self.hass.states.get(entity_id) if entity_id else None
        return state is not None and state.state not in off + SCREEN_GONE

    def _read_pictures(self, rules: dict[str, dict[str, Any]]) -> dict[str, bool]:
        """Each followed input's picture: its signal, or the box's own link while it
        is the input the box is on."""
        # A sleeping box sees no picture at all.
        links = {} if self._asleep() else self.coordinator.links()
        current = self._current()
        return {
            key: has_picture(self.hass, rule["signal"])
            or (key == current and links.get(key, False))
            for key, rule in rules.items()
        }

    @callback
    def _track(self, rules: dict[str, dict[str, Any]]) -> None:
        """Hear the signals and the screen change (follows changed settings)."""
        screen = self.screen
        wanted = frozenset(
            [rule["signal"] for rule in rules.values() if rule["signal"]]
            + ([screen[ATTR_ENTITY_ID]] if screen else [])
        )
        if wanted == self._tracked:
            return
        if self._untrack:
            self._untrack()
            self._untrack = None
        self._tracked = wanted
        if wanted:
            self._untrack = async_track_state_change_event(
                self.hass, list(wanted), self._on_state
            )

    @callback
    def _on_state(self, _event: Event[EventStateChangedData]) -> None:
        self._evaluate()

    @callback
    def _evaluate(self) -> None:
        """A poll, a command, a signal or a change of the settings: look for edges."""
        if not self.coordinator.last_update_success:
            return
        if (
            not box_does_cec(self.coordinator)
            and own_switching_on(self.coordinator)
            and not self._quieting
        ):
            # Hue Studio does CEC: the box switching inputs by itself would fight it
            # (turned back on in the Hue Sync app, or from before).
            self._quieting = True
            self.entry.async_create_background_task(
                self.hass,
                self._async_quiet_box(),
                f"hue_studio_sync_quiet_{self.entry.entry_id}",
            )
        rules = self.rules
        self._track(rules)
        pictures = self._read_pictures(rules)
        screen = self.screen
        screen_on = self._is_on(screen[ATTR_ENTITY_ID], SCREEN_OFF) if screen else None
        first = self._pictures is None
        before = self._pictures or {}
        screen_before = self._screen_on
        awake = not self._asleep()
        awake_before = self._awake
        self._pictures = pictures
        self._screen_on = screen_on
        self._awake = awake
        now = self.hass.loop.time()
        flapped = self._watch_unknown(rules, now)
        gained = [
            key
            for key, on in pictures.items()
            if on and not before.get(key) and key not in flapped
        ]
        for key in gained:
            self._since[key] = now
        self._watch_pause(rules, pictures)
        if first:
            self._input = self._current()
            return
        if box_does_cec(self.coordinator):
            self._cancel_lost()
            self._cancel_dark()
            return

        if (
            awake
            and awake_before is False
            and screen
            and not screen_on
            and not gained
            and (self._screen_task is None or self._screen_task.done())
        ):
            # The box woke up (by hand, its remote, the panel): its screen comes on.
            self._run_screen(self._async_screen_on(select=False))

        current = self._current()
        current_before, self._input = self._input, current
        if gained:
            self._go(max(gained, key=lambda key: self._since[key]), screen=True)
        elif (
            current != current_before
            and current in rules
            and pictures.get(current)
            and awake
        ):
            # Switched by hand (the panel, a remote, a dashboard): that input's mode,
            # and its screen on, as a source becoming active does over HDMI CEC.
            self._go(current, screen=True)
        elif (
            screen_on
            and screen_before is False
            and self._asleep()
            and (latest := self._latest(pictures))
        ):
            # The screen was turned on by hand: the box wakes up on the latest picture.
            self._go(latest, screen=False)

        if current in rules and not pictures.get(current) and not self._asleep():
            if self._lost is None:
                self._lost = async_call_later(self.hass, LOST_AFTER, self._on_lost)
        else:
            self._cancel_lost()

        off_after = screen.get("off_after", SCREEN_OFF_AFTER) if screen else 0
        if rules and off_after and not any(pictures.values()):
            if self._dark is None:
                self._dark = async_call_later(self.hass, off_after, self._on_dark)
        else:
            self._cancel_dark()

    def _watch_unknown(self, rules: dict[str, dict[str, Any]], now: float) -> set[str]:
        """Inputs whose signal is back after being unknown only for a moment."""
        flapped: set[str] = set()
        for key, rule in rules.items():
            state = self.hass.states.get(rule["signal"]) if rule["signal"] else None
            if state is not None and state.state in SCREEN_GONE:
                self._unknown_since.setdefault(key, now)
            elif (since := self._unknown_since.pop(key, None)) is not None and (
                now - since < SIGNAL_FLAP
            ):
                flapped.add(key)
        return flapped

    def _watch_pause(
        self, rules: dict[str, dict[str, Any]], pictures: dict[str, bool]
    ) -> None:
        """Light sync stopped while the box's own link shows the picture is still
        there (and not by us): paused until the session ends or it syncs again."""
        mode = self.coordinator.api.execution.mode
        current = self._current()
        if mode in SYNC_MODES or not any(pictures.values()):
            self._paused = False
        elif (
            mode == ExecutionMode.PASSTHROUGH
            and self._mode in SYNC_MODES
            and current in rules
            and self.coordinator.links().get(current or "")
            and self._sent != (current, mode)
        ):
            self._paused = True
        self._mode = mode

    def _latest(self, pictures: dict[str, bool], but: str | None = None) -> str | None:
        """The input whose picture appeared last, of those that have one."""
        keys = [k for k, on in pictures.items() if on and k != but and k in self._since]
        return max(keys, key=lambda key: self._since[key]) if keys else None

    @callback
    def _on_lost(self, _now: Any) -> None:
        """The current input has had no picture for a while: the latest other one."""
        self._lost = None
        if latest := self._latest(self._pictures or {}, but=self._current()):
            self._go(latest, screen=False)

    @callback
    def _on_dark(self, _now: Any) -> None:
        """No followed input has had a picture for a while: the screen goes off."""
        self._dark = None
        self._run_screen(self._async_screen_off())

    def _cancel_lost(self) -> None:
        if self._lost:
            self._lost()
            self._lost = None

    def _cancel_dark(self) -> None:
        if self._dark:
            self._dark()
            self._dark = None

    @callback
    def _go(self, key: str, *, screen: bool) -> None:
        """Switch to an input and start what its picture starts."""
        mode = ExecutionMode(self.rules[key]["action"])
        if self._paused and mode in SYNC_MODES:
            mode = ExecutionMode.PASSTHROUGH
        execution = self.coordinator.api.execution
        if self._current() != key or execution.mode != mode:
            _LOGGER.debug("%s: picture on %s, %s", self.entry.title, key, mode.value)
            self.entry.async_create_background_task(
                self.hass,
                self._async_box(key, mode),
                f"hue_studio_sync_follow_{self.entry.entry_id}",
            )
        if screen:
            self._run_screen(self._async_screen_on())

    async def _async_quiet_box(self) -> None:
        _LOGGER.info("%s: turning off the box's own input switching", self.entry.title)
        try:
            await self.coordinator.async_configure(tv_power=False)
        except HomeAssistantError as err:
            _LOGGER.warning("%s: %s", self.entry.title, err)
        finally:
            self._quieting = False

    async def _async_box(self, key: str, mode: ExecutionMode) -> None:
        self._sent = (key, mode)
        try:
            await self.coordinator.async_set_state(
                hdmi_source=HdmiSource(key), mode=mode
            )
        except HomeAssistantError as err:
            _LOGGER.warning(
                "%s: could not switch to %s: %s", self.entry.title, key, err
            )

    def _run_screen(self, coro: Coroutine[Any, Any, None]) -> None:
        """One screen command at a time: a newer one replaces a running one."""
        if self.screen is None:
            coro.close()
            return
        previous = self._screen_task
        if previous and not previous.done() and self._turning_off:
            # A turn-off already on its way is let through; this one follows it.
            coro = self._async_after(previous, coro)
        elif previous:
            previous.cancel()
        self._screen_task = self.entry.async_create_background_task(
            self.hass, coro, f"hue_studio_sync_screen_{self.entry.entry_id}"
        )

    @staticmethod
    async def _async_after(
        previous: asyncio.Task[None], coro: Coroutine[Any, Any, None]
    ) -> None:
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.shield(previous)
        await coro

    async def _async_screen_on(self, *, select: bool = True) -> None:
        """Turn the screen on (and wait for it), then onto the box's input."""
        if (screen := self.screen) is None:
            return
        entity_id: str = screen[ATTR_ENTITY_ID]
        if (state := self.hass.states.get(entity_id)) is None:
            return
        loop = self.hass.loop
        if (
            self._off_sent is not None
            and loop.time() - self._off_sent < SCREEN_REWAKE_WINDOW
        ):
            # Told to turn off a moment ago: its state may still say on. Let it get
            # there, then turn it on again.
            await self._async_wait(entity_id, False, SCREEN_OFF_WAIT)
            await asyncio.sleep(SCREEN_REWAKE)
            self._off_sent = None
            state = self.hass.states.get(entity_id) or state
        if state.state in SCREEN_OFF + SCREEN_GONE or not self._is_on(
            entity_id, SCREEN_OFF
        ):
            for _attempt in range(2):
                await self._async_media(SERVICE_TURN_ON, entity_id)
                if await self._async_wait(entity_id, True, SCREEN_WAKE / 2):
                    break
            else:
                _LOGGER.warning("%s did not turn on", entity_id)
                return
            await asyncio.sleep(SCREEN_SETTLE)
        source = screen.get("source") if select else None
        state = self.hass.states.get(entity_id)
        if source and state and state.attributes.get(ATTR_INPUT_SOURCE) != source:
            await self._async_media(
                SERVICE_SELECT_SOURCE, entity_id, {ATTR_INPUT_SOURCE: source}
            )

    async def _async_screen_off(self) -> None:
        """Turn the screen off, unless it is off already or shows something else."""
        if (screen := self.screen) is None:
            return
        entity_id: str = screen[ATTR_ENTITY_ID]
        state = self.hass.states.get(entity_id)
        if state is None or state.state in SCREEN_OFF + SCREEN_GONE:
            return
        shown = state.attributes.get(ATTR_INPUT_SOURCE)
        if (source := screen.get("source")) and shown not in (None, source):
            return
        self._off_sent = self.hass.loop.time()
        self._turning_off = True
        try:
            await self._async_media(SERVICE_TURN_OFF, entity_id)
        finally:
            self._turning_off = False

    async def _async_wait(self, entity_id: str, on: bool, seconds: float) -> bool:
        """Whether the screen is (or gets) on, or off, within `seconds`."""
        reached = asyncio.Event()

        def there() -> bool:
            return self._is_on(entity_id, SCREEN_OFF) == on

        @callback
        def changed(_event: Event[EventStateChangedData]) -> None:
            if there():
                reached.set()

        remove = async_track_state_change_event(self.hass, [entity_id], changed)
        try:
            if there():
                return True
            async with asyncio.timeout(seconds):
                await reached.wait()
        except TimeoutError:
            return False
        finally:
            remove()
        return True

    async def _async_media(
        self, service: str, entity_id: str, data: dict[str, Any] | None = None
    ) -> None:
        try:
            await self.hass.services.async_call(
                MEDIA_PLAYER_DOMAIN,
                service,
                {ATTR_ENTITY_ID: entity_id, **(data or {})},
                blocking=True,
            )
        except HomeAssistantError as err:
            _LOGGER.warning(
                "%s.%s on %s failed: %s", MEDIA_PLAYER_DOMAIN, service, entity_id, err
            )


async def async_wake_source(
    hass: HomeAssistant, coordinator: SyncBoxCoordinator, key: str
) -> None:
    """Turn an input's source on (its wake entity) unless it sends a picture."""
    rule = follow_rules(coordinator.config_entry.options).get(key)
    if box_does_cec(coordinator):
        return
    if not rule or not (wake := rule["wake"]) or has_picture(hass, rule["signal"]):
        return
    domain = wake.split(".")[0]
    service = "press" if domain in ("button", "input_button") else SERVICE_TURN_ON
    try:
        await hass.services.async_call(
            domain, service, {ATTR_ENTITY_ID: wake}, blocking=True
        )
    except HomeAssistantError as err:
        _LOGGER.warning("Could not wake %s with %s: %s", key, wake, err)


@callback
def async_set_follow(
    hass: HomeAssistant,
    coordinator: SyncBoxCoordinator,
    *,
    follow: dict[str, dict[str, Any] | None] | None = None,
    screen: dict[str, Any] | None = None,
    unlink_screen: bool = False,
) -> None:
    """Change the settings from the panel: `follow` input -> {"action", "signal",
    "wake"} merged into its rule (None, or no action left: not followed), `screen`
    merged into the linked screen's (or `unlink_screen`)."""
    entry = coordinator.config_entry
    options = dict(entry.options)
    if follow:
        rules = follow_rules(options)
        for key, change in follow.items():
            rule = {
                **rules.get(key, {"signal": None, "wake": None}),
                **(change or {"action": None}),
            }
            if rule.get("action") in ACTIONS:
                rules[key] = rule
            else:
                rules.pop(key, None)
        options[CONF_FOLLOW] = rules
    if unlink_screen:
        options.pop(CONF_SCREEN, None)
    elif screen:
        options[CONF_SCREEN] = {**(options.get(CONF_SCREEN) or {}), **screen}
    hass.config_entries.async_update_entry(entry, options=options)
    # The panel's payload and the follower's timers.
    coordinator.async_update_listeners()


def follow_info(coordinator: SyncBoxCoordinator) -> dict[str, Any]:
    """The settings as the panel shows them (part of the box's payload)."""
    options = coordinator.config_entry.options
    screen = options.get(CONF_SCREEN)
    return {
        "follow": follow_rules(options),
        "screen": {
            "entity_id": screen[ATTR_ENTITY_ID],
            "source": screen.get("source"),
            "off_after": screen.get("off_after", SCREEN_OFF_AFTER),
        }
        if screen and screen.get(ATTR_ENTITY_ID)
        else None,
    }
