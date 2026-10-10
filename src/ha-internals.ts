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

/**
 * Size a custom panel to the space HA leaves it. HA gives custom panels no height
 * (`partial-panel-resolver` is `height: auto`). The panel is registered with
 * `handle_safe_area`, so `ha-panel-custom` should not pad it by the safe areas; should
 * HA pad it anyway (older/newer releases, other app versions), a `100dvh` panel would
 * overflow the screen and the whole page would scroll. So measure where HA placed us and
 * what it adds below, fill exactly the rest, and expose both as `--hue-top`/`--hue-bottom`
 * so the panel pads only the part of the safe areas HA did not. Only layout measurements,
 * no element names. Returns a stop function.
 */
export function fitToViewport(host: HTMLElement): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fit = () => {
    timer = undefined;
    const viewport = window.innerHeight;
    const doc = document.scrollingElement;
    if (doc?.scrollTop) doc.scrollTop = 0;
    const top = Math.max(0, Math.round(host.getBoundingClientRect().top));
    host.style.height = `${viewport - top}px`;
    // Whatever still overflows is HA's padding below us (if shrinking us helps at all).
    const overflow = doc ? doc.scrollHeight - viewport : 0;
    let bottom = 0;
    if (overflow > 0) {
      host.style.height = `${viewport - top - overflow}px`;
      if (doc!.scrollHeight - viewport < overflow) bottom = overflow;
      else host.style.height = `${viewport - top}px`;
    }
    host.style.setProperty("--hue-top", `${top}px`);
    host.style.setProperty("--hue-bottom", `${bottom}px`);
  };
  // A timer, not requestAnimationFrame: frames don't run in a hidden tab or app.
  const schedule = () => {
    timer ??= setTimeout(fit, 0);
  };
  schedule();
  // HA may still be laying out (sidebar, app chrome) right after the panel appears.
  const late = setTimeout(schedule, 400);
  window.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  return () => {
    clearTimeout(timer);
    clearTimeout(late);
    window.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("resize", schedule);
  };
}
