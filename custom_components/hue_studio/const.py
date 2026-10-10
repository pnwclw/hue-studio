"""Constants for Hue Studio."""

from typing import Final

DOMAIN: Final = "hue_studio"

HUE_DOMAIN: Final = "hue"

# Config entry data: id of the native `hue` entry we borrow host and app key from.
CONF_HUE_ENTRY_ID: Final = "hue_entry_id"

# Keys of the native `hue` entry data (homeassistant/components/hue/const.py).
HUE_CONF_API_KEY: Final = "api_key"
HUE_CONF_API_VERSION: Final = "api_version"

# Options: how Hue rooms/zones map onto HA areas, and sensors per room.
# {"groups": {<grouped light unique_id>: "auto" | "zone" | <area_id>},
#  "rooms": {"area.<area_id>" | "hue.<grouped light unique_id>":
#            {"motion": [entity_id], "temperature": [entity_id]}}}
CONF_GROUPS: Final = "groups"
CONF_ROOMS: Final = "rooms"
CONF_MOTION: Final = "motion"
CONF_TEMPERATURE: Final = "temperature"
GROUP_AUTO: Final = "auto"
GROUP_ZONE: Final = "zone"

SIGNAL_CONFIG_UPDATED: Final = "hue_studio_config_updated"

# A config entry is either a Hue bridge (no `kind`, the original entry type) or a Hue
# Play HDMI Sync Box paired directly with Hue Studio.
CONF_KIND: Final = "kind"
KIND_SYNC_BOX: Final = "sync_box"
# Sync Box entry data (besides host): box id (certificate common name) and our
# registration on the box.
CONF_BOX_ID: Final = "box_id"
CONF_REGISTRATION_ID: Final = "registration_id"

# Bridge event: an entertainment area started or stopped streaming.
SIGNAL_ENTERTAINMENT_UPDATED: Final = "hue_studio_entertainment_updated"

# A Sync Box used through the HACS `huesyncbox` integration instead of being paired
# directly: no entities or connection of our own, its entities and service are used.
KIND_SYNC_BOX_LINK: Final = "sync_box_link"
CONF_SYNC_ENTRY_ID: Final = "sync_entry_id"
SYNC_BOX_INTEGRATION: Final = "huesyncbox"
