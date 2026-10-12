// Everything that depends on Home Assistant frontend internals lives here.
// These names are not a public API and may change between HA releases:
// re-check this module after every HA update.
//
// Also relied upon elsewhere (stable for years, used by most custom cards):
//   <ha-icon icon="mdi:...">               – area and entity icons
//   hass.callService / hass.connection     – documented frontend API
//   "hass-more-info" event                 – how every card opens more-info
//   window.customIconsets / customIcons    – how custom icon sets plug into <ha-icon>
//   "haptic" event on window                – the companion app's haptic feedback

import type { Hass } from "./types.ts";
import { focusedElement, opensKeyboard } from "./ui.ts";

export type Haptic = "selection" | "light" | "medium" | "heavy" | "success" | "warning" | "failure";

/** Vibration on a tap, a drop, a step: what HA's own controls do in the companion app. */
const VIBRATE_MS: Record<Haptic, number | number[]> = {
  selection: 6, light: 10, medium: 16, heavy: 24, success: [10, 40, 10], warning: [16, 60, 16], failure: [24, 60, 24],
};

/**
 * Haptic feedback. HA's companion apps turn the window's "haptic" event into the phone's
 * own haptics (iOS has no `navigator.vibrate`); elsewhere a short vibration, where there is one.
 */
export function haptic(kind: Haptic): void {
  window.dispatchEvent(new CustomEvent("haptic", { detail: kind }));
  const w = window as Window & { externalApp?: unknown; webkit?: { messageHandlers?: { externalBus?: unknown } } };
  if (!w.externalApp && !w.webkit?.messageHandlers?.externalBus) navigator.vibrate?.(VIBRATE_MS[kind]);
}

/** An icon of a custom icon set: what `<ha-icon icon="prefix:name">` draws. */
export interface CustomIcon {
  path: string;
  viewBox?: string;
}

/**
 * Register an icon set for `<ha-icon icon="<prefix>:<name>">` and HA's icon pickers, the
 * way custom icon sets from HACS do (`window.customIconsets` / `window.customIcons`).
 * Another set already under the same prefix is left alone.
 */
export function registerIconset(prefix: string, getIcon: (name: string) => Promise<CustomIcon | undefined>, names: string[]): void {
  const w = window as Window & {
    customIconsets?: Record<string, (name: string) => Promise<CustomIcon | undefined>>;
    customIcons?: Record<string, { getIcon: typeof getIcon; getIconList: () => Promise<{ name: string }[]> }>;
  };
  w.customIconsets ??= {};
  w.customIconsets[prefix] ??= getIcon;
  w.customIcons ??= {};
  w.customIcons[prefix] ??= { getIcon, getIconList: async () => names.map((name) => ({ name })) };
}

/** Open/close the HA sidebar (what the stock `ha-menu-button` does). */
export function toggleSidebar(fromElement: EventTarget): void {
  fromElement.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
}

/** Navigate inside HA without a reload (what HA's own `navigate()` helper does). */
export function navigate(path: string, { replace = false, state = null as unknown } = {}): void {
  if (replace) history.replaceState(state ?? history.state, "", path);
  else history.pushState(state, "", path);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace } }));
}

/** History state of a panel page opened from elsewhere (the dialog's "Hue Studio" button). */
interface FromState {
  hueStudioFrom?: string;
}

/** Open a panel page from `from` (a page outside the panel) so that its "Done" leads back there. */
export function openPanelFrom(path: string, from: string): void {
  const url = new URL(path, location.origin);
  url.searchParams.set("from", from);
  navigate(url.pathname + url.search, { state: { hueStudioFrom: from } satisfies FromState });
}

/** A `from` value from the URL, only if it is a page of this HA outside the panel. */
export function outsidePath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value === "/hue" || value.startsWith("/hue/") || value.startsWith("/hue?") || value.startsWith("/hue#") ? null : value;
}

/** Leave the panel for the page it was opened from: back in history if we came straight from it. */
export function leavePanel(path: string): void {
  if ((history.state as FromState | null)?.hueStudioFrom === path) history.back();
  else navigate(path, { replace: true });
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

/** How much the visible height has to shrink to count as the on-screen keyboard (px). */
const KEYBOARD_MIN = 120;

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
  // The height with the keyboard down: phones shrink only the visual viewport (iOS, recent
  // Android) or the whole window (older Android) while it is up.
  let full = window.innerHeight;
  let typing: HTMLElement | null = null;
  const fit = () => {
    timer = undefined;
    const doc = document.scrollingElement;
    const field = focusedElement(host.shadowRoot);
    const vv = window.visualViewport;
    if (!opensKeyboard(field)) full = window.innerHeight;
    // The keyboard is up: fill only what stays visible above it, so the header, the field
    // and any dialog stay on screen (otherwise iOS pans the page and the panel goes blank).
    if (opensKeyboard(field) && vv && full - vv.height > KEYBOARD_MIN) {
      if (doc?.scrollTop) doc.scrollTop = 0;
      if (window.scrollY) window.scrollTo(0, 0);
      const top = Math.max(0, Math.round(host.getBoundingClientRect().top));
      host.style.height = `${Math.round(vv.height) - top}px`;
      host.toggleAttribute("keyboard", true);
      if (typing !== field) field.scrollIntoView({ block: "nearest" });
      typing = field;
      return;
    }
    typing = null;
    host.toggleAttribute("keyboard", false);
    const viewport = window.innerHeight;
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
  // The keyboard: focus moves first, the viewport shrinks (and iOS pans it) as it slides up.
  const events: [EventTarget | null | undefined, string][] = [
    [window, "resize"],
    [window.visualViewport, "resize"],
    [window.visualViewport, "scroll"],
    [host, "focusin"],
    [host, "focusout"],
  ];
  for (const [target, type] of events) target?.addEventListener(type, schedule);
  return () => {
    clearTimeout(timer);
    clearTimeout(late);
    for (const [target, type] of events) target?.removeEventListener(type, schedule);
  };
}

/**
 * Open HA's sidebar (a drawer on phones) from outside any panel: the event has to start
 * inside `home-assistant-main`, which listens for it.
 */
export function openSidebar(): void {
  const main = homeAssistantElement()?.shadowRoot?.querySelector("home-assistant-main");
  const inner = main?.shadowRoot?.firstElementChild ?? main;
  inner?.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
}

/**
 * Reserve room at the bottom of every page (the experimental footer). HA pads its pages
 * by `--safe-area-inset-bottom` (the phone's home indicator), so growing it by the
 * footer's height keeps the last content above the footer. `null` gives it back.
 */
export function reserveBottom(px: number | null): void {
  const style = document.documentElement.style;
  if (px === null) style.removeProperty("--safe-area-inset-bottom");
  else style.setProperty("--safe-area-inset-bottom", `calc(env(safe-area-inset-bottom, 0px) + ${px}px)`);
}
