// Everything that depends on Home Assistant frontend internals lives here.
// These names are not a public API and may change between HA releases:
// re-check this module after every HA update.
//
// Also relied upon elsewhere (stable for years, used by most custom cards):
//   <ha-icon icon="mdi:...">               – area and entity icons
//   hass.callService / hass.connection     – documented frontend API

/** Open/close the HA sidebar (what the stock `ha-menu-button` does). */
export function toggleSidebar(fromElement) {
  fromElement.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
}

/** Navigate inside HA without a reload (what HA's own `navigate()` helper does). */
export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState(history.state, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace } }));
}
