"""MkDocs hook: the services reference, from services.yaml and translations/en.json.

`docs/reference/services.md` holds the prose (groups, notes) and a marker per service,
`<!-- service: apply_palette -->`, replaced at build time by that service's name,
description, target and fields, as the automation editor shows them. A service of
services.yaml without a marker, or a marker without a service, is a warning (an error
with `mkdocs build --strict`, as CI builds it).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
import re
from typing import Any

import yaml

PAGE = "reference/services.md"
ROOT = Path(__file__).resolve().parent.parent / "custom_components" / "hue_studio"
MARKER = re.compile(r"<!-- service: ([a-z_]+) -->")

log = logging.getLogger("mkdocs.plugins.hue_studio")


def on_page_markdown(markdown: str, page: Any, **_: Any) -> str:
    """Replace the service markers of the services page."""
    if page.file.src_uri != PAGE:
        return markdown
    services = yaml.safe_load((ROOT / "services.yaml").read_text())
    strings = json.loads((ROOT / "translations" / "en.json").read_text())
    placed = set(MARKER.findall(markdown))
    for name in sorted(set(services) - placed):
        log.warning("%s: hue_studio.%s has no marker", PAGE, name)
    for name in sorted(placed - set(services)):
        log.warning("%s: hue_studio.%s is not in services.yaml", PAGE, name)

    def render(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in services:
            return ""
        return _service(name, services[name] or {}, strings)

    return MARKER.sub(render, markdown)


def _service(name: str, service: dict[str, Any], strings: dict[str, Any]) -> str:
    text = strings["services"].get(name, {})
    lines = [
        f"### {text.get('name', name)} {{ #{name} }}",
        "",
        f"`hue_studio.{name}`",
        "",
        text.get("description", ""),
        "",
    ]
    if target := service.get("target"):
        lines += [f"**Target:** {_target(target)}", ""]
    if fields := service.get("fields"):
        lines += ["| Field | Description | Values |", "|---|---|---|"]
        for key, field in fields.items():
            ftext = text.get("fields", {}).get(key, {})
            label = f"`{key}`"
            if field.get("required"):
                label += " *required*"
            about = ftext.get("name", "")
            if description := ftext.get("description"):
                about = f"**{about}** — {description}" if about else description
            lines.append(
                f"| {label} | {_cell(about)} | {_cell(_values(field, strings))} |"
            )
        lines.append("")
    return "\n".join(lines)


def _target(target: dict[str, Any]) -> str:
    entities = target.get("entity", [])
    if isinstance(entities, dict):
        entities = [entities]
    kinds = []
    for entity in entities:
        integration = {
            "hue": "Philips Hue",
            "hue_studio": "Hue Studio",
            "huesyncbox": "Hue Sync Box",
        }.get(entity.get("integration", ""), entity.get("integration", ""))
        domain = entity.get("domain")
        kinds.append(f"`{domain}` entities of {integration}" if domain else integration)
    what = " or ".join(kinds) or "entities"
    return f"{what} (or areas, devices and labels that hold them)"


def _values(field: dict[str, Any], strings: dict[str, Any]) -> str:
    selector = field.get("selector") or {}
    kind, config = next(iter(selector.items()), (None, None))
    config = config or {}
    out = ""
    if kind == "number" or kind == "color_temp":
        unit = config.get("unit_of_measurement") or config.get("unit", "")
        unit = {"kelvin": "K", "mired": "mired"}.get(unit, unit)
        if "min" in config and "max" in config:
            out = f"{config['min']}\N{EN DASH}{config['max']}"
            out += f" {unit}" if unit and unit != "%" else unit
        else:
            out = unit
    elif kind == "select":
        labels = strings["selector"].get(config.get("translation_key", ""), {})
        options = []
        for option in config.get("options", []):
            value = option["value"] if isinstance(option, dict) else option
            label = labels.get("options", {}).get(value)
            options.append(f"`{value}` ({label})" if label else f"`{value}`")
        out = ", ".join(options)
    elif kind == "boolean":
        out = "`true` / `false`"
    elif kind == "entity":
        domain = config.get("domain")
        out = f"`{domain}` entities" if domain else "entities"
        if config.get("multiple"):
            out += ", a list"
    elif kind == "object":
        out = "YAML / JSON"
    elif kind:
        out = kind
    if "default" in field:
        default = field["default"]
        if not isinstance(default, str):
            default = json.dumps(default)
        out += f"; default `{default}`"
    if "example" in field:
        out += f"; e.g. `{field['example']}`"
    return out.lstrip("; ")


def _cell(text: str) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ")
