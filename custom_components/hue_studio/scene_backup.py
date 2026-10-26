"""Bridge scenes to a file in the HA config folder and back (`export_scenes`,
`import_scenes`), so Home Assistant's own backups hold them.

A copy is one JSON file in `<config>/hue_studio/scenes/`: per bridge, every scene of a
Hue room or zone with its room or zone's name and everything the bridge needs to make
it again (actions, palette, speed, auto-play, picture, `metadata.appdata`), and each of
its lights by Zigbee MAC (the same after re-pairing or on a new bridge), name and HA
entity id. Copies are kept for a while: the newest `keep`, plus an older one that still
holds a scene no newer copy has, so an export right after a scene was deleted never
drops it from the backup.

An import makes a copy's scenes again in the room or zone of the same name (the same
bridge first), its lights found by MAC, else by name. A scene of that name there already
is left alone unless `replace`; `dry_run` only says what would happen.
"""

from __future__ import annotations

from collections.abc import Iterable
import json
import logging
from pathlib import Path
from typing import Any

from aiohttp import ClientError
from aiohue import HueBridgeV2
from aiohue.errors import AiohueException
from aiohue.util import dataclass_to_dict
from aiohue.v2.models.resource import ResourceTypes
from aiohue.v2.models.scene import Scene
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from .bridges import bridge_name
from .const import DOMAIN, HUE_DOMAIN
from .identity import device_mac
from .lights import LIGHT_DOMAIN, async_bridges
from .scenes import SCENE_DOMAIN

_LOGGER = logging.getLogger(__name__)

FOLDER = ("hue_studio", "scenes")
PREFIX = "scenes-"
VERSION = 1
KEEP = 7
SCENE_PATH = "clip/v2/resource/scene"


def backup_folder(hass: HomeAssistant) -> Path:
    """Where the copies live (in the HA config folder, so HA's backups hold them)."""
    return Path(hass.config.path(*FOLDER))


def scene_key(bridge: dict[str, Any], scene: dict[str, Any]) -> str:
    """What makes a scene the same one across copies (its id changes when remade)."""
    group = scene["group"]
    return f"{bridge['id']}/{group['type']}/{group['name']}/{scene['name']}"


def copy_keys(data: dict[str, Any]) -> set[str]:
    """Every scene of a copy."""
    return {
        scene_key(bridge, scene)
        for bridge in data.get("bridges", [])
        for scene in bridge.get("scenes", [])
    }


def stale_copies(copies: list[tuple[str, set[str]]], keep: int) -> list[str]:
    """Copies to delete: (name, scene keys), newest first.

    The newest `keep` stay; an older one stays while it holds a scene that no copy
    newer than it (and kept) has, so a deleted scene stays in the backup.
    """
    stale: list[str] = []
    kept: set[str] = set()
    for index, (name, keys) in enumerate(copies):
        if index < keep or not keys <= kept:
            kept |= keys
        else:
            stale.append(name)
    return stale


def scene_body(scene: Scene) -> dict[str, Any]:
    """A scene as a POST body, its group left out (set where it is made again)."""
    metadata: dict[str, Any] = {"name": scene.metadata.name}
    if (image := scene.metadata.image) is not None:
        metadata["image"] = {"rid": image.rid, "rtype": image.rtype.value}
    if scene.metadata.appdata:
        metadata["appdata"] = scene.metadata.appdata
    body: dict[str, Any] = {
        "metadata": metadata,
        "actions": [dataclass_to_dict(a, skip_none=True) for a in scene.actions],
    }
    if scene.palette is not None:
        palette = dataclass_to_dict(scene.palette, skip_none=True)
        # The bridge refuses `effects` next to `effects_v2` (scenes.scene_post_json).
        palette.pop("effects", None)
        body["palette"] = palette
    if scene.speed is not None:
        body["speed"] = scene.speed
    if scene.auto_dynamic is not None:
        body["auto_dynamic"] = scene.auto_dynamic
    return body


def _group(bridge: HueBridgeV2, ref: Any) -> tuple[str, Any] | None:
    """A scene's Hue room or zone: ("room" | "zone", the group)."""
    if ref.rtype == ResourceTypes.ROOM:
        group = bridge.groups.room.get(ref.rid)
        return ("room", group) if group is not None else None
    if ref.rtype == ResourceTypes.ZONE:
        group = bridge.groups.zone.get(ref.rid)
        return ("zone", group) if group is not None else None
    return None


def _group_lights(bridge: HueBridgeV2, kind: str, group_id: str) -> set[str]:
    controller = bridge.groups.room if kind == "room" else bridge.groups.zone
    return {light.id for light in controller.get_lights(group_id)}


def _light_key(bridge: HueBridgeV2, light_id: str) -> tuple[str, int] | None:
    """A light by its device's Zigbee MAC and its place among the device's lights."""
    light = bridge.lights.get(light_id)
    if light is None or light.owner is None:
        return None
    mac = device_mac(bridge, light.owner.rid)
    device = bridge.devices.get(light.owner.rid)
    if not mac or device is None:
        return None
    lights = [s.rid for s in device.services if s.rtype == ResourceTypes.LIGHT]
    return mac.lower(), lights.index(light_id) if light_id in lights else 0


def _bridge_copy(
    hass: HomeAssistant,
    entry_id: str,
    bridge: HueBridgeV2,
    groups: set[str] | None,
) -> dict[str, Any]:
    """One bridge's part of a copy (only scenes of `groups`, grouped light ids)."""
    registry = er.async_get(hass)
    lights: dict[str, dict[str, Any]] = {}
    scenes = []
    for scene in bridge.scenes.scene:
        found = _group(bridge, scene.group)
        if found is None:
            continue
        kind, group = found
        grouped = next(
            (s.rid for s in group.services if s.rtype == ResourceTypes.GROUPED_LIGHT),
            None,
        )
        if groups is not None and grouped not in groups:
            continue
        for action in scene.actions:
            rid = action.target.rid
            if rid in lights:
                continue
            light = bridge.lights.get(rid)
            key = _light_key(bridge, rid)
            lights[rid] = {
                "mac": key[0] if key else None,
                "index": key[1] if key else 0,
                "name": light.metadata.name if light else None,
                "entity_id": registry.async_get_entity_id(
                    LIGHT_DOMAIN, HUE_DOMAIN, rid
                ),
            }
        scenes.append(
            {
                "id": scene.id,
                "name": scene.metadata.name,
                "group": {"type": kind, "name": group.metadata.name},
                "entity_id": registry.async_get_entity_id(
                    SCENE_DOMAIN, HUE_DOMAIN, scene.id
                ),
                "body": scene_body(scene),
            }
        )
    return {
        "id": bridge.config.bridge_id,
        "name": bridge_name(hass, entry_id, bridge),
        "lights": lights,
        "scenes": scenes,
    }


def _write(folder: Path, name: str, data: dict[str, Any], keep: int) -> list[str]:
    """Write a copy and delete the stale ones (in the executor)."""
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_text(json.dumps(data, indent=2, ensure_ascii=False))
    copies = []
    for path in sorted(folder.glob(f"{PREFIX}*.json"), reverse=True):
        try:
            copies.append((path.name, copy_keys(json.loads(path.read_text()))))
        except OSError, ValueError:
            _LOGGER.warning("Could not read the scene backup %s", path)
    stale = stale_copies(copies, keep)
    for old in stale:
        (folder / old).unlink(missing_ok=True)
    return stale


async def async_export(
    hass: HomeAssistant, groups: Iterable[str] | None = None, keep: int = KEEP
) -> dict[str, Any]:
    """Write a copy of the scenes (only of these grouped lights, if given)."""
    wanted = set(groups) if groups is not None else None
    bridges = [
        _bridge_copy(hass, entry_id, bridge, wanted)
        for entry_id, bridge in async_bridges(hass).items()
    ]
    if not bridges:
        raise HomeAssistantError(
            translation_domain=DOMAIN, translation_key="not_set_up"
        )
    now = dt_util.utcnow()
    data = {"version": VERSION, "created": now.isoformat(), "bridges": bridges}
    name = f"{PREFIX}{now.strftime('%Y%m%d-%H%M%S')}.json"
    removed = await hass.async_add_executor_job(
        _write, backup_folder(hass), name, data, keep
    )
    return {
        "file": name,
        "scenes": sum(len(b["scenes"]) for b in bridges),
        "removed": removed,
    }


def _list(folder: Path) -> list[dict[str, Any]]:
    copies = []
    for path in sorted(folder.glob(f"{PREFIX}*.json"), reverse=True):
        try:
            data = json.loads(path.read_text())
        except OSError, ValueError:
            continue
        copies.append(
            {
                "file": path.name,
                "created": data.get("created"),
                "scenes": sum(
                    len(b.get("scenes", [])) for b in data.get("bridges", [])
                ),
                "bridges": [b.get("name") for b in data.get("bridges", [])],
            }
        )
    return copies


async def async_list(hass: HomeAssistant) -> list[dict[str, Any]]:
    """The copies, newest first."""
    folder = backup_folder(hass)
    return await hass.async_add_executor_job(_list, folder)


def _read(folder: Path, name: str | None) -> tuple[str, dict[str, Any]] | None:
    if name is None:
        paths = sorted(folder.glob(f"{PREFIX}*.json"), reverse=True)
        if not paths:
            return None
        path = paths[0]
    else:
        path = folder / name
    if not path.is_file():
        return None
    return path.name, json.loads(path.read_text())


async def _async_read(hass: HomeAssistant, name: str | None) -> tuple[str, dict]:
    # Only a file of ours: a name, never a path.
    if name is not None and (
        Path(name).name != name or not name.startswith(PREFIX) or ".." in name
    ):
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="unknown_scene_backup",
            translation_placeholders={"file": name},
        )
    try:
        found = await hass.async_add_executor_job(_read, backup_folder(hass), name)
    except (OSError, ValueError) as err:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="unknown_scene_backup",
            translation_placeholders={"file": name or ""},
        ) from err
    if (
        found is None
        or found[1].get("version") != VERSION
        or not isinstance(found[1].get("bridges"), list)
    ):
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="unknown_scene_backup",
            translation_placeholders={"file": name or ""},
        )
    return found


def _light_map(bridge: HueBridgeV2, saved: dict[str, dict[str, Any]]) -> dict[str, str]:
    """Saved light id -> the light on this bridge: by MAC, else by name."""
    by_key: dict[tuple[str, int], str] = {}
    by_name: dict[str, str] = {}
    for light in bridge.lights:
        if (key := _light_key(bridge, light.id)) is not None:
            by_key[key] = light.id
        by_name.setdefault(light.metadata.name.casefold(), light.id)
    found = {}
    for rid, light in saved.items():
        new = None
        if light.get("mac"):
            new = by_key.get((light["mac"].lower(), light.get("index", 0)))
        if new is None and light.get("name"):
            new = by_name.get(light["name"].casefold())
        if new is not None:
            found[rid] = new
    return found


def _target_group(
    candidates: list[HueBridgeV2], kind: str, name: str
) -> tuple[HueBridgeV2, Any] | None:
    for bridge in candidates:
        controller = bridge.groups.room if kind == "room" else bridge.groups.zone
        for group in controller:
            if group.metadata.name.casefold() == name.casefold():
                return bridge, group
    return None


async def async_import(
    hass: HomeAssistant,
    name: str | None = None,
    *,
    dry_run: bool = False,
    replace: bool = False,
) -> dict[str, Any]:
    """Make a copy's scenes again; returns what was (or would be) done."""
    file, data = await _async_read(hass, name)
    connected = list(async_bridges(hass).values())
    if not connected:
        raise HomeAssistantError(
            translation_domain=DOMAIN, translation_key="not_set_up"
        )
    result: dict[str, Any] = {
        "file": file,
        "created": [],
        "replaced": [],
        "skipped": [],
        "missing_lights": [],
    }
    for saved in data["bridges"]:
        same = [b for b in connected if b.config.bridge_id == saved["id"]]
        candidates = same or connected
        maps: dict[int, dict[str, str]] = {}
        for scene in saved["scenes"]:
            label = {"scene": scene["name"], "group": scene["group"]["name"]}
            found = _target_group(
                candidates, scene["group"]["type"], scene["group"]["name"]
            )
            if found is None:
                result["skipped"].append({**label, "reason": "no_group"})
                continue
            bridge, group = found
            lights = maps.setdefault(id(bridge), _light_map(bridge, saved["lights"]))
            members = _group_lights(bridge, scene["group"]["type"], group.id)
            actions, missing = [], []
            for action in scene["body"]["actions"]:
                rid = action["target"]["rid"]
                new = lights.get(rid)
                if new is None or new not in members:
                    missing.append(saved["lights"].get(rid, {}).get("name") or rid)
                    continue
                actions.append({**action, "target": {"rid": new, "rtype": "light"}})
            if not actions:
                result["skipped"].append({**label, "reason": "no_lights"})
                continue
            if missing:
                result["missing_lights"].append({**label, "lights": missing})
            existing = next(
                (
                    s
                    for s in bridge.scenes.scene
                    if s.group.rid == group.id
                    and s.metadata.name.casefold() == scene["name"].casefold()
                ),
                None,
            )
            if existing is not None and not replace:
                result["skipped"].append({**label, "reason": "exists"})
                continue
            result["replaced" if existing else "created"].append(label)
            if dry_run:
                continue
            body = {**scene["body"], "actions": actions}
            if existing is not None:
                # A PUT takes no picture: the scene keeps its own.
                body.pop("metadata", None)
                path, method = f"{SCENE_PATH}/{existing.id}", "put"
            else:
                body["group"] = {"rid": group.id, "rtype": scene["group"]["type"]}
                path, method = SCENE_PATH, "post"
            await _async_request(bridge, method, path, body, scene["name"])
    return result


async def _async_request(
    bridge: HueBridgeV2, method: str, path: str, body: dict[str, Any], name: str
) -> None:
    try:
        await bridge.request(method, path, json=body)
    except (AiohueException, ClientError, TimeoutError) as err:
        raise HomeAssistantError(
            translation_domain=DOMAIN,
            translation_key="scene_restore_failed",
            translation_placeholders={"name": name},
        ) from err
