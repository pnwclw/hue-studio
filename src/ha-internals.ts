// Everything that depends on Home Assistant frontend internals lives here.
// These names are not a public API and may change between HA releases:
// re-check this module after every HA update.
//
// Also relied upon elsewhere (stable for years, used by most custom cards):
//   <ha-icon icon="mdi:...">               – area and entity icons
//   hass.callService / hass.connection     – documented frontend API
//   "hass-more-info" event                 – how every card opens more-info

import type { Hass } from "./types.ts";

/** Open/close the HA sidebar (what the stock `ha-menu-button` does). */
export function toggleSidebar(fromElement: EventTarget): void {
  fromElement.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
}

/** Navigate inside HA without a reload (what HA's own `navigate()` helper does). */
export function navigate(path: string, { replace = false } = {}): void {
  if (replace) history.replaceState(history.state, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace } }));
}

/** The root <home-assistant> element; it holds the current `hass`. */
export const homeAssistantElement = (): (HTMLElement & { hass?: Hass }) | null => document.querySelector("home-assistant");

/** Current `hass` outside a panel/card (for the more-info override). */
export const currentHass = (): Hass | undefined => homeAssistantElement()?.hass;

/**
 * Call `cb(hass)` whenever HA replaces its `hass` object. HA has no public event for
 * that, so poll the reference (cheap). Returns a stop function.
 */
export function watchHass(cb: (hass: Hass) => void, intervalMs = 150): () => void {
  let last: Hass | null = null;
  const tick = () => {
    const hass = currentHass();
    if (hass && hass !== last) {
      last = hass;
      cb(hass);
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}

/** Open HA's own more-info dialog (the override lets it through once). */
export function openStockMoreInfo(entityId: string): void {
  homeAssistantElement()?.dispatchEvent(
    new CustomEvent("hass-more-info", { detail: { entityId, hueStudioBypass: true }, bubbles: true, composed: true }),
  );
}
