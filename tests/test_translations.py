"""Every backend locale must have exactly the keys of en.json."""

import json
from pathlib import Path

from homeassistant.helpers.service import _SERVICES_SCHEMA
from homeassistant.util.yaml import load_yaml
import pytest

TRANSLATIONS = (
    Path(__file__).parent.parent / "custom_components/hue_studio/translations"
)


def _keys(data: dict, prefix: str = "") -> set[str]:
    keys: set[str] = set()
    for key, value in data.items():
        path = f"{prefix}{key}"
        keys |= _keys(value, f"{path}.") if isinstance(value, dict) else {path}
    return keys


@pytest.mark.parametrize(
    "path", sorted(TRANSLATIONS.glob("*.json")), ids=lambda p: p.name
)
def test_same_keys_as_english(path: Path) -> None:
    """A translation file mirrors en.json."""
    english = _keys(json.loads((TRANSLATIONS / "en.json").read_text()))
    assert _keys(json.loads(path.read_text())) == english


def test_services_yaml_is_valid() -> None:
    """services.yaml passes HA's schema (a bad file is only a warning in HA)."""
    path = TRANSLATIONS.parent / "services.yaml"
    _SERVICES_SCHEMA(load_yaml(str(path)))
