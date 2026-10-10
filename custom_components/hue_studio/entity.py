"""Base entity of a Sync Box."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .sync import MODELS, SyncBoxCoordinator


class SyncBoxEntity(CoordinatorEntity[SyncBoxCoordinator]):
    """An entity of a Sync Box; names come from translations.

    Translation keys (and so entity ids, e.g. `switch.sync_box_light_sync`) match what
    the popular Sync Box integration from HACS uses, so automations keep working after
    switching over.
    """

    _attr_has_entity_name = True

    def __init__(self, coordinator: SyncBoxCoordinator, key: str) -> None:
        """Attach to the box's device."""
        super().__init__(coordinator)
        box_id = coordinator.box.box_id
        device = coordinator.data["device"]
        self._attr_translation_key = key
        self._attr_unique_id = f"{box_id}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, box_id)},
            name=coordinator.box_name,
            manufacturer="Signify",
            model=MODELS.get(device.get("deviceType"), "Sync Box"),
            model_id=device.get("deviceType"),
            sw_version=device.get("firmwareVersion"),
            serial_number=box_id,
        )
