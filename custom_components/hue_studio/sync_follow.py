"""Following the picture: what HDMI CEC does, for sources that have none.

A Sync Box switches inputs by itself only when a source sends CEC "active source" or
when its 5V/hot plug appears. A PC has no CEC, and an EDID manager between it and the
box (one that holds hot plug so the PC keeps its display) hides it turning on. Yet the
box reports each input's link honestly: `linked` while a picture (TMDS) comes in. So
here the box switches to an input the moment it gets a picture, in the mode chosen
for that input (or just showing it), and goes back to another input with a picture
when the current one has lost its own for a while.

A screen (a media player) can be linked too: it turns on and switches to the box's
input when a picture appears, and turns off when no followed input has had one for a
while, unless it shows something else by then.

Only edges count (a picture appearing or going away), never the state as such: a
choice made by hand in the meantime stays. Settings are the box entry's options,
changed from the panel (hue_studio/sync/follow).
"""

from __future__ import annotations

import asyncio
from collections.abc import Coroutine
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

from .const import CONF_FOLLOW, CONF_SCREEN

if TYPE_CHECKING:
    from homeassistant.core import EventStateChangedData

    from .sync import SyncBoxCoordinator

_LOGGER = logging.getLogger(__name__)

# What an input's picture starts: just showing it, or syncing in a mode.
ACTIONS = ["passthrough", "video", "game", "music"]
# How long the current input may stay without a picture before another one with a
# picture takes over (a source changing resolution or HDR drops it for a moment).
LOST_AFTER = 10
# The screen: off after this long without a picture by default; how long it may take
# to turn on, and to settle before it takes a source.
SCREEN_OFF_AFTER = 300
SCREEN_OFF_AFTER_MAX = 4 * 3600
SCREEN_WAKE = 40
SCREEN_SETTLE = 3

SCREEN_OFF = (STATE_OFF, STATE_STANDBY)
SCREEN_GONE = (STATE_UNAVAILABLE, STATE_UNKNOWN)


class PictureFollower:
    """Follows the pictures on one directly paired box's inputs."""

    def __init__(self, hass: HomeAssistant, coordinator: SyncBoxCoordinator) -> None:
        """Nothing runs until `async_start`."""
        self.hass = hass
        self.coordinator = coordinator
        self.entry = coordinator.config_entry
        # Whether each input had a picture at the last poll (None: not read yet).
        self._linked: dict[str, bool] | None = None
        # When each input last got its picture (loop time): the latest one wins.
        self._since: dict[str, float] = {}
        self._lost: CALLBACK_TYPE | None = None
        self._dark: CALLBACK_TYPE | None = None
        self._screen_task: asyncio.Task[None] | None = None

    @property
    def rules(self) -> dict[str, str]:
        """Input -> what its picture starts, for the inputs that are followed."""
        follow = self.entry.options.get(CONF_FOLLOW) or {}
        return {key: action for key, action in follow.items() if action in ACTIONS}

    @property
    def screen(self) -> dict[str, Any] | None:
        """The linked screen's settings, if one is linked."""
        screen = self.entry.options.get(CONF_SCREEN)
        return screen if screen and screen.get(ATTR_ENTITY_ID) else None

    @callback
    def async_start(self) -> CALLBACK_TYPE:
        """Watch the box's polls; returns what stops it."""
        self._linked = self.coordinator.links()
        now = self.hass.loop.time()
        self._since = {key: now for key, on in self._linked.items() if on}
        remove = self.coordinator.async_add_listener(self._on_update)

        @callback
        def stop() -> None:
            remove()
            self._cancel_lost()
            self._cancel_dark()
            if self._screen_task:
                self._screen_task.cancel()

        return stop

    @callback
    def _on_update(self) -> None:
        """A poll (or a command, or a change of the settings): look for edges."""
        if not self.coordinator.last_update_success:
            return
        linked = self.coordinator.links()
        before = self._linked or {}
        self._linked = linked
        now = self.hass.loop.time()
        gained = [key for key, on in linked.items() if on and not before.get(key)]
        for key in gained:
            self._since[key] = now
        rules = self.rules

        if picked := [key for key in gained if key in rules]:
            self._go(max(picked, key=lambda key: self._since[key]), screen=True)

        current = self._current()
        if current in rules and not linked.get(current):
            if self._lost is None:
                self._lost = async_call_later(self.hass, LOST_AFTER, self._on_lost)
        else:
            self._cancel_lost()

        screen = self.screen
        off_after = screen.get("off_after", SCREEN_OFF_AFTER) if screen else 0
        if rules and off_after and not any(linked.get(key) for key in rules):
            if self._dark is None:
                self._dark = async_call_later(self.hass, off_after, self._on_dark)
        else:
            self._cancel_dark()

    def _current(self) -> str | None:
        source = self.coordinator.api.execution.hdmi_source
        return source.value if source else None

    @callback
    def _on_lost(self, _now: Any) -> None:
        """The current input has had no picture for a while: the latest other one."""
        self._lost = None
        linked = self._linked or {}
        others = [
            key
            for key in self.rules
            if linked.get(key) and key != self._current() and key in self._since
        ]
        if others:
            self._go(max(others, key=lambda key: self._since[key]), screen=False)

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
        mode = ExecutionMode(self.rules[key])
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

    async def _async_box(self, key: str, mode: ExecutionMode) -> None:
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
        if self._screen_task:
            self._screen_task.cancel()
        self._screen_task = self.entry.async_create_background_task(
            self.hass, coro, f"hue_studio_sync_screen_{self.entry.entry_id}"
        )

    async def _async_screen_on(self) -> None:
        """Turn the screen on (and wait for it), then onto the box's input."""
        if (screen := self.screen) is None:
            return
        entity_id: str = screen[ATTR_ENTITY_ID]
        if (state := self.hass.states.get(entity_id)) is None:
            return
        if state.state in SCREEN_OFF:
            await self._async_media(SERVICE_TURN_ON, entity_id)
            if not await self._async_wait_on(entity_id):
                return
            await asyncio.sleep(SCREEN_SETTLE)
        source = screen.get("source")
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
        await self._async_media(SERVICE_TURN_OFF, entity_id)

    async def _async_wait_on(self, entity_id: str) -> bool:
        """Whether the screen came on within SCREEN_WAKE."""
        on = asyncio.Event()

        def is_on() -> bool:
            state = self.hass.states.get(entity_id)
            return state is not None and state.state not in SCREEN_OFF + SCREEN_GONE

        @callback
        def changed(_event: Event[EventStateChangedData]) -> None:
            if is_on():
                on.set()

        remove = async_track_state_change_event(self.hass, [entity_id], changed)
        try:
            if is_on():
                return True
            async with asyncio.timeout(SCREEN_WAKE):
                await on.wait()
        except TimeoutError:
            _LOGGER.warning("%s did not turn on", entity_id)
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


@callback
def async_set_follow(
    hass: HomeAssistant,
    coordinator: SyncBoxCoordinator,
    *,
    follow: dict[str, str | None] | None = None,
    screen: dict[str, Any] | None = None,
    unlink_screen: bool = False,
) -> None:
    """Change the settings from the panel: `follow` input -> action (None: not
    followed), `screen` merged into the linked screen's (or `unlink_screen`)."""
    entry = coordinator.config_entry
    options = dict(entry.options)
    if follow:
        rules = dict(options.get(CONF_FOLLOW) or {})
        for key, action in follow.items():
            if action in ACTIONS:
                rules[key] = action
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
        "follow": {
            key: action
            for key, action in (options.get(CONF_FOLLOW) or {}).items()
            if action in ACTIONS
        },
        "screen": {
            "entity_id": screen[ATTR_ENTITY_ID],
            "source": screen.get("source"),
            "off_after": screen.get("off_after", SCREEN_OFF_AFTER),
        }
        if screen and screen.get(ATTR_ENTITY_ID)
        else None,
    }
