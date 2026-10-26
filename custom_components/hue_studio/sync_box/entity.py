"""Base entity of a Sync Box."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import slugify

from ..const import DOMAIN
from ..core.connections import SETTINGS_URL
from .coordinator import MODELS, SyncBoxCoordinator


class SyncBoxEntity(CoordinatorEntity[SyncBoxCoordinator]):
    """An entity of a Sync Box; names come from translations.

    Entity ids (e.g. `switch.sync_box_light_sync`) match what the popular Sync Box
    integration from HACS uses, so automations keep working after switching over. They
    are suggested from the key, not from the translated name: in languages with native
    entity ids (Polish, German, …) HA would otherwise derive them from the translation.
    """

    _attr_has_entity_name = True
    # The entity domain ("switch", …), set by each platform's entity classes.
    _platform_domain: str

    def __init__(self, coordinator: SyncBoxCoordinator, key: str) -> None:
        """Attach to the box's device."""
        super().__init__(coordinator)
        box_id = coordinator.box_id
        device = coordinator.api.device
        self._attr_translation_key = key
        self._attr_unique_id = f"{box_id}_{key}"
        # Only a suggestion for the first registration; a rename by the user stays.
        self.entity_id = (
            f"{self._platform_domain}.{slugify(coordinator.box_name)}_{key}"
        )
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, box_id)},
            name=coordinator.box_name,
            manufacturer="Signify",
            model=MODELS.get(device.device_type, "Sync Box"),
            model_id=device.device_type,
            sw_version=device.firmware_version,
            serial_number=box_id,
            configuration_url=f"{SETTINGS_URL}/{coordinator.config_entry.entry_id}",
        )
