"""Constants for Hue Studio."""

from typing import Final

DOMAIN: Final = "hue_studio"

HUE_DOMAIN: Final = "hue"

# Data of the old entries of one bridge each: the native `hue` entry they used.
# Such entries are merged into the Hue Studio entry on setup.
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
CONF_ILLUMINANCE: Final = "illuminance"
GROUP_AUTO: Final = "auto"
GROUP_ZONE: Final = "zone"
# Options: align the bridge's rooms with the HA areas whenever areas change.
CONF_AUTO_ALIGN: Final = "auto_align"
# Options: label, category and area for our scenes and automations in HA (on unless
# False).
CONF_ORGANIZE: Final = "organize"
# Experimental: the "Liquid Glass" footer on phones, and its tabs (panel url paths).
CONF_FOOTER: Final = "footer"
CONF_FOOTER_TABS: Final = "footer_tabs"
FOOTER_MAX_TABS: Final = 5
# Scene gallery: each category only in its time (else all, all year), and the user's
# rules per category that replace the panel's defaults:
# {category: {"seasons": [season], "window": ["MM-DD", "MM-DD"]}}; empty: always.
CONF_GALLERY_SEASONAL: Final = "gallery_seasonal"
CONF_GALLERY_RULES: Final = "gallery_rules"
GALLERY_SEASONS: Final = ("winter", "spring", "summer", "autumn")
# The global light of the day (pool.py): sources, phase times, scene tags.
# {"weather", "season", "light_sensor": entity_id, "night_from": "HH:MM",
#  "shifts": {phase: minutes}, "defaults": bool (ready-made tags),
#  "tags": {scene: {"phases", "seasons", "weather", "moods": [value]}},
#  "merged": bool (automations' own pools were moved in)}
CONF_DAYLIGHT: Final = "daylight"

SIGNAL_CONFIG_UPDATED: Final = "hue_studio_config_updated"
# A bridge connected or went away, or its MotionAware areas changed.
SIGNAL_BRIDGES_UPDATED: Final = "hue_studio_bridges_updated"

# A config entry is the Hue Studio entry (one, for every bridge of the native `hue`
# integration; its options hold the settings) or a Hue Play HDMI Sync Box.
CONF_KIND: Final = "kind"
KIND_STUDIO: Final = "studio"
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
