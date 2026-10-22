// Experimental: a "Liquid Glass" tab bar floating at the bottom of every Home Assistant
// page on phones, instead of the side menu (Settings → Experimental in the /hue panel).
// Its tabs are panels (dashboards, the Hue panel, …); the last one, More, opens HA's
// own side menu. Never shown on HA's settings pages or on wide screens.

import { css, html, LitElement, nothing } from "lit";
import { state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import { activeTab, FOOTER_SPACE, type FooterTab, footerTabs, footerVisible, tabTarget } from "./footer-model.ts";
import { navigate, openSidebar, reserveBottom, watchHass } from "./ha-internals.ts";
import { localize } from "./i18n.ts";
import type { Hass, StudioConfig } from "./types.ts";
import { focusedElement, keepTouchInside, opensKeyboard } from "./ui.ts";

class HueStudioFooter extends LitElement {
  static override styles = css`
    :host { position: fixed; z-index: 5; left: 12px; right: 12px; bottom: calc(env(safe-area-inset-bottom, 0px) + 8px);
            display: block; pointer-events: none; font-family: var(--ha-font-family-body, Roboto, sans-serif);
            -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
    :host([typing]) { display: none; }
    nav { pointer-events: auto; display: flex; gap: 2px; height: 62px; padding: 5px; box-sizing: border-box; border-radius: 31px;
          max-width: 520px; margin: 0 auto;
          background: color-mix(in srgb, var(--card-background-color, #1c1c1e) 68%, transparent);
          -webkit-backdrop-filter: blur(30px) saturate(190%); backdrop-filter: blur(30px) saturate(190%);
          border: 1px solid color-mix(in srgb, var(--primary-text-color, #fff) 16%, transparent);
          box-shadow: 0 10px 34px rgba(0, 0, 0, 0.34), inset 0 1px 0 color-mix(in srgb, #fff 28%, transparent),
            inset 0 -1px 1px color-mix(in srgb, #fff 6%, transparent); }
    button { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
             border: none; border-radius: 26px; background: transparent; cursor: pointer; padding: 0 2px;
             color: var(--secondary-text-color, #aaa); font: inherit; font-size: 10px; font-weight: 500; letter-spacing: 0.1px;
             transition: background 0.25s ease, color 0.25s ease, transform 0.2s ease; -webkit-tap-highlight-color: transparent; }
    button:active { transform: scale(0.94); }
    button.on { color: var(--primary-color, #03a9f4);
                background: color-mix(in srgb, var(--primary-text-color, #fff) 13%, transparent);
                box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 18%, transparent); }
    ha-icon { --mdc-icon-size: 22px; }
    span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `;

  @state() private accessor tabs: FooterTab[] = [];

  constructor() {
    super();
    // Dragging the footer must not pull the page under it.
    keepTouchInside(this);
  }
  @state() private accessor path = location.pathname;
  @state() private accessor strings: ReturnType<typeof localize> = localize(null);
  /** The page each tab showed last (tab path -> path and query), kept by `start`. */
  lastPaths: Record<string, string> = {};

  setTabs(tabs: FooterTab[], hass: Hass): void {
    this.tabs = tabs;
    this.strings = localize(hass);
  }

  setPath(path: string): void {
    this.path = path;
  }

  protected override render() {
    if (!this.tabs.length) return nothing;
    const active = activeTab(this.path, this.tabs);
    const t = this.strings;
    return html`<nav aria-label=${t("footer.label")}>
      ${this.tabs.map(
        (tab) => html`<button class=${classMap({ on: tab.path === active })} aria-current=${tab.path === active ? "page" : "false"}
          @click=${() => navigate(tabTarget(this.lastPaths, tab.path, active, `/${tab.path}`))}><ha-icon icon=${tab.icon}></ha-icon><span>${tab.label}</span></button>`,
      )}
      <button @click=${() => openSidebar()}><ha-icon icon="mdi:dots-horizontal"></ha-icon><span>${t("footer.more")}</span></button>
    </nav>`;
  }
}

if (!customElements.get("hue-studio-footer")) customElements.define("hue-studio-footer", HueStudioFooter);

/** Keeps the footer in line with the settings, the page and the screen width. */
function start(): void {
  let config: Pick<StudioConfig, "footer" | "footer_tabs"> | null = null;
  let hass: Hass | undefined;
  let footer: HueStudioFooter | null = null;
  let subscribed = false;
  // Kept while the footer comes and goes (settings pages, rotating the phone).
  const lastPaths: Record<string, string> = {};

  const update = () => {
    const show = !!config?.footer && !!hass && footerVisible(location.pathname, window.innerWidth);
    if (!show) {
      footer?.remove();
      footer = null;
      reserveBottom(null);
      return;
    }
    if (!footer) {
      footer = document.createElement("hue-studio-footer") as HueStudioFooter;
      document.body.append(footer);
      reserveBottom(FOOTER_SPACE);
    }
    const tabs = footerTabs(hass!.panels, config!.footer_tabs, hass!.localize);
    const active = activeTab(location.pathname, tabs);
    if (active) lastPaths[active] = location.pathname + location.search;
    footer.lastPaths = lastPaths;
    footer.setTabs(tabs, hass!);
    footer.setPath(location.pathname);
  };

  watchHass((h) => {
    hass = h;
    if (!subscribed && h.connection) {
      subscribed = true;
      h.connection
        .subscribeMessage<StudioConfig>(
          (msg) => {
            config = msg;
            update();
          },
          { type: "hue_studio/config/subscribe" },
        )
        .catch(() => (subscribed = false));
    }
    update();
  }, 500);
  window.addEventListener("location-changed", update);
  window.addEventListener("popstate", update);
  window.addEventListener("resize", update);
  // Hidden while a text field has focus: the keyboard covers the bottom of the screen and a
  // fixed footer would float above it. Focus settles after focusout, hence the timer.
  const typing = () => footer?.toggleAttribute("typing", opensKeyboard(focusedElement()));
  document.addEventListener("focusin", typing, true);
  document.addEventListener("focusout", () => setTimeout(typing), true);
}

const w = window as { __hueStudioFooter?: boolean } & Window;
if (!w.__hueStudioFooter) {
  w.__hueStudioFooter = true;
  start();
}
