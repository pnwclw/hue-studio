"""Auto light settings per HA area: scene pools, holidays, exclusions, offsets.

The bridge has no place for them, so they live in `helpers.storage.Store`
(`.storage/hue_studio.auto_light`) and are read/written only through services and the
WebSocket API. Picking a scene from them is `auto_select.py`, acting on it
`auto_control.py`.

Per area (the format of the legacy prototype's `rooms.<room>.auto`, plus settings):
    {"pools": {phase: {season | "all": {"clear": [gallery ids], "gloomy": [...]}}},
     "holidays": [{"from": "MM-DD", "to": "MM-DD", "phases": [...], "pool": [...]}],
     "names": {gallery id: name}, "excluded": [gallery ids], "offsets": {phase: %},
     "settings": {"night_from": "HH:MM", "shifts": {phase: minutes},
                  "weather" | "light_sensor" | "season": entity id,
                  "brightness": {phase: %}, "gradient_mode": mode},
     "control": "auto" | "off", "skip": {"date", "phase", "n"}}
The "day" phase has four brightness steps: its pools are four lists instead of one.
An area with settings here gets auto light entities (auto_control.py).
"""

from __future__ import annotations

from copy import deepcopy
import json
import logging
from pathlib import Path
from typing import Any

from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
)
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import (
    area_registry as ar,
    config_validation as cv,
    entity_registry as er,
)
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.util.hass_dict import HassKey
import voluptuous as vol

from .auto_select import KELVIN_MAX, KELVIN_MIN, STYLES
from .const import DOMAIN
from .gallery import async_gallery_scenes

_LOGGER = logging.getLogger(__name__)

STORAGE_KEY = f"{DOMAIN}.auto_light"
STORAGE_VERSION = 1
SIGNAL_AUTO_LIGHT_UPDATED = "hue_studio_auto_light_updated"

PHASES = ("morning", "day", "golden", "evening", "night")
SEASONS = ("all", "winter", "spring", "summer", "autumn")
MOODS = ("clear", "gloomy")
DAY_STEPS = 4
MAX_OFFSET = 60
SHIFTS = ("morning", "day", "golden", "evening")
MAX_SHIFT = 240
CONTROL_AUTO = "auto"
CONTROL_MANUAL = "manual"
CONTROL_OFF = "off"
CONTROLS = (CONTROL_AUTO, CONTROL_MANUAL, CONTROL_OFF)

SERVICE_EXCLUDE = "auto_light_exclude"
SERVICE_POOL = "auto_light_pool"
SERVICE_OFFSET = "auto_light_offset"
SERVICE_IMPORT_LEGACY = "import_legacy"

ATTR_AREA = "area"
ATTR_SCENE = "scene"
ATTR_EXCLUDED = "excluded"
ATTR_PHASE = "phase"
ATTR_SEASON = "season"
ATTR_STEP = "step"
ATTR_SCENES = "scenes"
ATTR_DELTA = "delta"
ATTR_PATH = "path"
ATTR_OVERWRITE = "overwrite"

_DATA: HassKey[AutoLightStore] = HassKey(f"{DOMAIN}_auto_light")

IDS = vol.All(cv.ensure_list, [cv.string])
POOL = vol.Schema({vol.In(MOODS): list})
AREA_CONFIG = vol.Schema(
    {
        vol.Optional("pools", default=dict): {vol.In(PHASES): {vol.In(SEASONS): POOL}},
        vol.Optional("holidays", default=list): [
            vol.Schema(
                {
                    vol.Required("from"): cv.matches_regex(r"^\d\d-\d\d$"),
                    vol.Required("to"): cv.matches_regex(r"^\d\d-\d\d$"),
                    vol.Optional("phases", default=list): [vol.In(PHASES)],
                    vol.Optional("pool", default=list): IDS,
                },
                extra=vol.ALLOW_EXTRA,
            )
        ],
        vol.Optional("names", default=dict): {cv.string: cv.string},
        vol.Optional("excluded", default=list): IDS,
        vol.Optional("offsets", default=dict): {
            vol.In(PHASES): vol.All(
                vol.Coerce(int), vol.Range(min=-MAX_OFFSET, max=MAX_OFFSET)
            )
        },
        # How phases, season, weather and brightness are worked out (auto_select.py).
        vol.Optional("settings", default=dict): vol.Schema(
            {
                vol.Optional("night_from"): cv.matches_regex(r"^\d\d:\d\d$"),
                vol.Optional("shifts"): {
                    vol.In(SHIFTS): vol.All(
                        vol.Coerce(int), vol.Range(min=-MAX_SHIFT, max=MAX_SHIFT)
                    )
                },
                vol.Optional("weather"): vol.Any(None, cv.entity_id),
                vol.Optional("light_sensor"): vol.Any(None, cv.entity_id),
                vol.Optional("season"): vol.Any(None, cv.entity_id),
                vol.Optional("brightness"): {
                    vol.In(PHASES): vol.All(vol.Coerce(int), vol.Range(min=1, max=100))
                },
                vol.Optional("gradient_mode"): vol.Any(None, cv.string),
                # "natural": a white per phase instead of scenes (auto_select.py).
                vol.Optional("style"): vol.In(STYLES),
                vol.Optional("kelvin"): {
                    vol.In(PHASES): vol.All(
                        vol.Coerce(int), vol.Range(min=KELVIN_MIN, max=KELVIN_MAX)
                    )
                },
            }
        ),
        # "off": auto light is off for the area ("manual" is not stored).
        vol.Optional("control", default=CONTROL_AUTO): vol.In(
            [CONTROL_AUTO, CONTROL_OFF]
        ),
        # Presses of "next scene": {"date", "phase", "n"} (auto_select.select).
        vol.Optional("skip", default=dict): dict,
    }
)


class AutoLightStore:
    """Auto light settings of every area, persisted in `.storage`."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Create the store (load it with `async_load`)."""
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, STORAGE_KEY, private=False
        )
        self.areas: dict[str, dict[str, Any]] = {}

    async def async_load(self) -> None:
        """Read the stored settings."""
        data = await self._store.async_load() or {}
        self.areas = {}
        for area_id, config in (data.get("areas") or {}).items():
            # Fills keys added since the data was written (settings, control, …).
            try:
                self.areas[area_id] = AREA_CONFIG(config)
            except vol.Invalid as err:
                _LOGGER.warning("Auto light of %s ignored: %s", area_id, err)

    def area(self, area_id: str) -> dict[str, Any]:
        """Settings of an area (defaults for one without any yet)."""
        if (config := self.areas.get(area_id)) is not None:
            return deepcopy(config)
        config = AREA_CONFIG({})
        if season := native_season_sensor(self.hass):
            config["settings"]["season"] = season
        return config

    async def async_remove(self, area_id: str) -> None:
        """Forget an area's auto light."""
        if self.areas.pop(area_id, None) is not None:
            await self._store.async_save({"areas": self.areas})
            async_dispatcher_send(self.hass, SIGNAL_AUTO_LIGHT_UPDATED)

    async def async_set(self, area_id: str, config: dict[str, Any]) -> None:
        """Replace an area's settings; written at once so other readers see it."""
        self.areas[area_id] = AREA_CONFIG(config)
        await self._store.async_save({"areas": self.areas})
        async_dispatcher_send(self.hass, SIGNAL_AUTO_LIGHT_UPDATED)


def native_season_sensor(hass: HomeAssistant) -> str | None:
    """The sensor of Home Assistant's own Season integration, when it is set up."""
    return next(
        (
            entry.entity_id
            for entry in er.async_get(hass).entities.values()
            if entry.platform == "season"
            and entry.domain == "sensor"
            and not entry.disabled
        ),
        None,
    )


def auto_light_store(hass: HomeAssistant) -> AutoLightStore:
    """The store (loaded with the integration)."""
    return hass.data[_DATA]


async def async_setup_auto_light(hass: HomeAssistant) -> None:
    """Load the store, register services and the WebSocket API."""
    store = hass.data[_DATA] = AutoLightStore(hass)
    await store.async_load()

    async def exclude(call: ServiceCall) -> None:
        """Never (or again) pick a gallery scene in an area's auto light."""
        area_id = _area_id(hass, call.data[ATTR_AREA])
        scene = call.data[ATTR_SCENE]
        await _async_check_scenes(hass, [scene])
        config = store.area(area_id)
        excluded = [s for s in config["excluded"] if s != scene]
        if call.data[ATTR_EXCLUDED]:
            excluded.append(scene)
        config["excluded"] = excluded
        await store.async_set(area_id, config)

    async def pool(call: ServiceCall) -> None:
        """Set the scenes of one pool (for "day": of one brightness step)."""
        area_id = _area_id(hass, call.data[ATTR_AREA])
        phase, season = call.data[ATTR_PHASE], call.data[ATTR_SEASON]
        step = call.data[ATTR_STEP]
        scenes = list(dict.fromkeys(call.data[ATTR_SCENES]))
        gallery = await _async_check_scenes(hass, scenes)
        if phase == "day" and step not in {str(n) for n in range(DAY_STEPS)}:
            raise _invalid("auto_light_bad_step", step=step)
        if phase != "day" and step not in MOODS:
            raise _invalid("auto_light_bad_step", step=step)
        config = store.area(area_id)
        pools = config["pools"].setdefault(phase, {}).setdefault(season, {})
        if phase == "day":
            # Both weathers share the steps: gloomy weather shifts the step instead.
            for mood in MOODS:
                current = pools.setdefault(mood, [])
                current.extend([] for _ in range(DAY_STEPS - len(current)))
                current[int(step)] = scenes
        else:
            pools[step] = scenes
        for scene in scenes:
            config["names"][scene] = gallery[scene]["name"]
        await store.async_set(area_id, config)

    async def offset(call: ServiceCall) -> ServiceResponse:
        """Shift a phase's brightness by delta percent (0 resets it)."""
        area_id = _area_id(hass, call.data[ATTR_AREA])
        phase, delta = call.data[ATTR_PHASE], call.data[ATTR_DELTA]
        config = store.area(area_id)
        current = config["offsets"].get(phase, 0)
        value = 0 if delta == 0 else max(-MAX_OFFSET, min(MAX_OFFSET, current + delta))
        config["offsets"][phase] = value
        await store.async_set(area_id, config)
        return {"offset": value}

    async def import_legacy(call: ServiceCall) -> ServiceResponse:
        """Import auto light from the legacy prototype's lights.json.

        Rooms are matched to areas by id, then by name. Palettes are not imported:
        they are scenes on the bridge now (`create_scene`).
        """
        path = Path(hass.config.path(call.data[ATTR_PATH]))
        try:
            data = await hass.async_add_executor_job(_read_json, path)
        except (OSError, ValueError) as err:
            raise _invalid("legacy_unreadable", path=str(path)) from err
        imported: list[str] = []
        skipped: list[str] = []
        for room, value in (data.get("rooms") or {}).items():
            if not isinstance(value, dict) or not value.get("auto"):
                continue
            area_id = _match_area(hass, room, value.get("name"))
            if area_id is None or (
                area_id in store.areas and not call.data[ATTR_OVERWRITE]
            ):
                skipped.append(room)
                continue
            try:
                await store.async_set(area_id, value["auto"])
            except vol.Invalid as err:
                _LOGGER.warning("Auto light of %s not imported: %s", room, err)
                skipped.append(room)
                continue
            imported.append(area_id)
        return {
            "imported": imported,
            "skipped": skipped,
            "palettes": len(data.get("palettes") or []),
        }

    area = vol.All(cv.string, vol.Length(min=1))
    hass.services.async_register(
        DOMAIN,
        SERVICE_EXCLUDE,
        exclude,
        schema=vol.Schema(
            {
                vol.Required(ATTR_AREA): area,
                vol.Required(ATTR_SCENE): cv.string,
                vol.Optional(ATTR_EXCLUDED, default=True): cv.boolean,
            }
        ),
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_POOL,
        pool,
        schema=vol.Schema(
            {
                vol.Required(ATTR_AREA): area,
                vol.Required(ATTR_PHASE): vol.In(PHASES),
                vol.Required(ATTR_SEASON): vol.In(SEASONS),
                vol.Required(ATTR_STEP): vol.All(vol.Coerce(str), vol.Lower),
                vol.Required(ATTR_SCENES): IDS,
            }
        ),
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_OFFSET,
        offset,
        schema=vol.Schema(
            {
                vol.Required(ATTR_AREA): area,
                vol.Required(ATTR_PHASE): vol.In(PHASES),
                vol.Required(ATTR_DELTA): vol.All(
                    vol.Coerce(int), vol.Range(min=-100, max=100)
                ),
            }
        ),
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_IMPORT_LEGACY,
        import_legacy,
        schema=vol.Schema(
            {
                vol.Optional(ATTR_PATH, default="lights.json"): cv.string,
                vol.Optional(ATTR_OVERWRITE, default=False): cv.boolean,
            }
        ),
        supports_response=SupportsResponse.ONLY,
    )


def _invalid(key: str, **placeholders: str) -> ServiceValidationError:
    return ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key=key,
        translation_placeholders=placeholders,
    )


def _area_id(hass: HomeAssistant, value: str) -> str:
    """An area id, or the id of the area with that name."""
    if (area_id := _match_area(hass, value, value)) is None:
        raise _invalid("unknown_ha_area", area=value)
    return area_id


def _match_area(hass: HomeAssistant, area_id: str, name: str | None) -> str | None:
    registry = ar.async_get(hass)
    if registry.async_get_area(area_id) is not None:
        return area_id
    if name and (area := registry.async_get_area_by_name(name)) is not None:
        return area.id
    return None


async def _async_check_scenes(
    hass: HomeAssistant, ids: list[str]
) -> dict[str, dict[str, Any]]:
    """The gallery; unknown scene ids are an error."""
    gallery = await async_gallery_scenes(hass)
    if unknown := [i for i in ids if i not in gallery]:
        raise _invalid("unknown_gallery_scene", scene=", ".join(unknown))
    return gallery


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))
