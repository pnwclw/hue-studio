"""Waiting for the entity `hue` adds for a resource we just made."""

from __future__ import annotations

import asyncio
from collections.abc import Callable

from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er

# How long a resource we made waits for `hue` to add its entity.
ENTITY_TIMEOUT = 10.0


async def async_wait_entity(
    hass: HomeAssistant,
    find: Callable[[], str | None],
    wait: float | None = None,
) -> str | None:
    """The entity `find` returns, once it is in the registry (None: not in time)."""
    if (found := find()) is not None:
        return found
    done: asyncio.Future[str] = hass.loop.create_future()

    @callback
    def created(event: Event[er.EventEntityRegistryUpdatedData]) -> None:
        if (
            event.data["action"] == "create"
            and not done.done()
            and (entity_id := find())
        ):
            done.set_result(entity_id)

    unsub = hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, created)
    try:
        async with asyncio.timeout(wait or ENTITY_TIMEOUT):
            return await done
    except TimeoutError:
        return None
    finally:
        unsub()
