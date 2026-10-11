// The `/hue` panel: a Hue-app-like UI built on HA's own model (areas, entities, services).
// HA sets `hass`, `narrow`, `route` and `panel` on this element.
//
// Routes (below the panel's /hue prefix):
//   ""                         home: rooms and zones
//   /room/<key>                room: scenes and lights
//   /room/<key>/color?light=&back=   color wheel (effects too)
//   /room/<key>/scene/<scene>  scene editor
//   /room/<key>/space          arrange the room's lights (positions)
//   /gallery?room=<key>        scene gallery
//   /sync?box=<entry id>       Sync Box (tab shown only when one is set up)
//   /settings                  settings (tab): rooms and zones, alignment, integration options
//   /settings/auto/<area>      auto light of an area
//   /settings/experimental     experimental features (the Liquid Glass footer)
//   /rooms                     rooms and zones: alignment with HA areas, zone editor

import { html, LitElement, nothing, type PropertyValues, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { keyed } from "lit/directives/keyed.js";

import { PANEL_PATH, StudioContext } from "./context.ts";
import { fitToViewport, toggleSidebar } from "./ha-internals.ts";
import { findGroup } from "./model.ts";
import { CSS } from "./styles.ts";
import type { Hass } from "./types.ts";
import { icon, type IconName } from "./ui.ts";
import "./views/auto-light.ts";
import "./views/color.ts";
import "./views/experimental.ts";
import "./views/gallery.ts";
import "./views/home.ts";
import "./views/room.ts";
import "./views/rooms.ts";
import "./views/settings.ts";
import "./views/space.ts";
import "./views/scene.ts";
import "./views/sync.ts";

type Route =
  | { name: "home" }
  | { name: "room"; key: string }
  | { name: "color"; key: string; light: string | null; back: string | null }
  | { name: "scene"; key: string; scene: string }
  | { name: "space"; key: string }
  | { name: "gallery"; room: string | null }
  | { name: "sync"; box: string | null }
  | { name: "rooms" }
  | { name: "settings" }
  | { name: "experimental" }
  | { name: "auto"; area: string };

function parseRoute(path: string, search: string): Route {
  const params = new URLSearchParams(search);
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "room" && parts[1] && parts[2] === "color") {
    // Only paths inside the panel: `back` comes from the URL.
    const back = params.get("back");
    return { name: "color", key: parts[1], light: params.get("light"), back: back?.startsWith("/room/") ? back : null };
  }
  if (parts[0] === "room" && parts[1] && parts[2] === "scene" && parts[3]) return { name: "scene", key: parts[1], scene: parts[3] };
  if (parts[0] === "room" && parts[1] && parts[2] === "space") return { name: "space", key: parts[1] };
  if (parts[0] === "room" && parts[1]) return { name: "room", key: parts[1] };
  if (parts[0] === "gallery") return { name: "gallery", room: params.get("room") };
  if (parts[0] === "sync") return { name: "sync", box: params.get("box") };
  if (parts[0] === "rooms") return { name: "rooms" };
  if (parts[0] === "settings" && parts[1] === "auto" && parts[2]) return { name: "auto", area: parts[2] };
  if (parts[0] === "settings" && parts[1] === "experimental") return { name: "experimental" };
  if (parts[0] === "settings") return { name: "settings" };
  return { name: "home" };
}

@customElement("hue-studio-panel")
export class HueStudioPanel extends LitElement {
  static override styles = unsafeCSS(CSS);

  @property({ attribute: false }) accessor hass: Hass | undefined;
  @property({ type: Boolean }) accessor narrow = false;
  @property({ attribute: false }) accessor route: { prefix?: string; path: string } | undefined;
  /** Bumped whenever the context changed (WebSocket data, optimistic state, toasts). */
  @state() private accessor rev = 0;

  private ctx: StudioContext | null = null;
  private lastRoute = "";
  private unfit?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.ctx ??= new StudioContext(() => this.rev++);
    this.ctx.toggleSidebar = () => toggleSidebar(this);
    this.unfit = fitToViewport(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unfit?.();
    this.ctx?.dispose();
    this.ctx = null;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!this.ctx) return;
    if (this.hass && (changed.has("hass") || !this.ctx.ready)) {
      this.ctx.setHass(this.hass);
      // Views only see `ctx` (same object) and `rev`: a new `hass` is a new revision.
      this.rev++;
    }
    this.ctx.narrow = this.narrow;
  }

  protected override render() {
    const ctx = this.ctx;
    if (!ctx?.ready) return nothing;
    const route = parseRoute(this.route?.path ?? location.pathname.replace(PANEL_PATH, ""), location.search);
    const tab =
      route.name === "gallery" && !route.room
        ? "gallery"
        : route.name === "sync"
          ? "sync"
          : route.name === "settings" || route.name === "rooms" || route.name === "auto" || route.name === "experimental"
            ? "settings"
            : "home";
    const tabs: [string, string, IconName, string][] = [
      ["home", "", "home", ctx.t("nav.home")],
      ["gallery", "/gallery", "explore", ctx.t("nav.gallery")],
    ];
    if (Object.keys(ctx.boxes).length || route.name === "sync") tabs.push(["sync", "/sync", "sync", ctx.t("nav.sync")]);
    tabs.push(["settings", "/settings", "cog", ctx.t("nav.settings")]);
    const full = route.name === "color" || route.name === "scene";
    // With the experimental footer at the bottom of the screen, the panel's tabs go on top.
    const top = !!ctx.config.footer && ctx.narrow;
    return html`
      <main class=${classMap({ colorview: route.name === "color", "under-footer": top })}>${keyed(JSON.stringify(route), this.view(ctx, route))}</main>
      <nav class=${classMap({ tabs: true, top })} ?hidden=${full}>
        ${tabs.map(
          ([id, to, name, label]) => html`<button class=${classMap({ on: id === tab })} @click=${() => ctx.go(to)}>${icon(name)}${label}</button>`,
        )}
      </nav>
      <div class=${classMap({ toast: true, on: ctx.toastOn })}>${ctx.toastText}</div>
    `;
  }

  /** A fresh element per route (keyed), so no screen state leaks into the next one. */
  private view(ctx: StudioContext, route: Route) {
    const rev = this.rev;
    switch (route.name) {
      case "room":
        return html`<hue-studio-room-view .ctx=${ctx} .rev=${rev} .key=${route.key}></hue-studio-room-view>`;
      case "color":
        return html`<hue-studio-color-view
          .ctx=${ctx}
          .rev=${rev}
          .group=${findGroup(ctx.home, route.key)}
          .focusLight=${route.light}
          .backPath=${route.back}
        ></hue-studio-color-view>`;
      case "space":
        return html`<hue-studio-space-view .ctx=${ctx} .rev=${rev} .key=${route.key}></hue-studio-space-view>`;
      case "scene":
        return html`<hue-studio-scene-view .ctx=${ctx} .rev=${rev} .key=${route.key} .scene=${route.scene}></hue-studio-scene-view>`;
      case "sync":
        return html`<hue-studio-sync-view .ctx=${ctx} .rev=${rev} .box=${route.box}></hue-studio-sync-view>`;
      case "auto":
        return html`<hue-studio-auto-light-view .ctx=${ctx} .rev=${rev} .area=${route.area}></hue-studio-auto-light-view>`;
      case "settings":
        return html`<hue-studio-settings-view .ctx=${ctx} .rev=${rev}></hue-studio-settings-view>`;
      case "experimental":
        return html`<hue-studio-experimental-view .ctx=${ctx} .rev=${rev}></hue-studio-experimental-view>`;
      case "rooms":
        return html`<hue-studio-rooms-view .ctx=${ctx} .rev=${rev}></hue-studio-rooms-view>`;
      case "gallery":
        return html`<hue-studio-gallery-view .ctx=${ctx} .rev=${rev} .room=${route.room}></hue-studio-gallery-view>`;
      default:
        return html`<hue-studio-home-view .ctx=${ctx} .rev=${rev}></hue-studio-home-view>`;
    }
  }

  protected override updated(): void {
    // A new screen starts at the top; updates of the same screen keep the scroll position.
    const key = `${this.route?.path ?? ""}${location.search}`;
    if (key !== this.lastRoute) {
      this.lastRoute = key;
      const main = this.renderRoot.querySelector("main");
      if (main) main.scrollTop = 0;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-panel": HueStudioPanel;
  }
}
