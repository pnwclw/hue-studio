"""Constants for Hue Studio."""

from typing import Final

DOMAIN: Final = "hue_studio"

HUE_DOMAIN: Final = "hue"

# Config entry data: id of the native `hue` entry we borrow host and app key from.
CONF_HUE_ENTRY_ID: Final = "hue_entry_id"

# Keys of the native `hue` entry data (homeassistant/components/hue/const.py).
HUE_CONF_API_KEY: Final = "api_key"
HUE_CONF_API_VERSION: Final = "api_version"
