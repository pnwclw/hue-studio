// The `/hue` panel: a Hue-app-like UI built on HA's own model (areas, entities, services).
// HA sets `hass`, `narrow`, `route` and `panel` on this element.
//
// Routes (below the panel's /hue prefix):
//   ""                         home: rooms and zones
//   /room/<key>                room: scenes and lights
//   /room/<key>/color?light=&back=   color wheel (effects too)
//   /room/<key>/scene/<scene>  scene editor
//   /room/<key>/space          arrange the room's lights (positions)
//   /room/<key>/sensor/<device>   a Hue sensor's settings (its HA device id)
//   /gallery?room=<key>        scene gallery of a room or zone (its "+"), full screen
//   /automations               automations (tab): ours, and the other HA ones touching Hue lights
//   /automations/new[?room=]   the types of the Hue app (+ a custom one in HA's editor)
//   /automations/new/<type>[?room=<area>][&preset=all_day][&sensor=&lux=]   a new automation (all_day: a room's
//                              all-day scene; sensor/lux: a motion one started from a sensor's "Add lights")
//   /automations/<id>[?from=]  an automation (its config id; `from`: the page its more-info sheet was on)
//   /sync?box=<entry id>       Sync Box (tab shown only when one is set up)
//   /settings                  settings (tab): rooms and zones, alignment, integration options
//   /settings/experimental     experimental features (the Liquid Glass footer)
//   /settings/gallery          scene gallery: all scenes, or everyday plus seasonal
//   /settings/daylight         light of the day: mood, phase times, sources, scene pool
//   /settings/devices          Hue devices by kind (lights, switches, sensors, other); new ones
//   /settings/devices/<kind>   one kind (lights|switches|sensors|other) by room: search, filters
//                              (?bridge=<hue entry id>: that bridge's, from its page)
//   /settings/devices/device/<id>     a device's settings (its bridge id): name, room, function, power on, delete
//   /settings/devices/sensor/<device> a Hue sensor's settings, opened from the sensors (its HA device id)
//   /settings/devices/add?room=<key>  adding devices: what, getting it ready, search, name and room
//   /settings/devices/lost     devices a move let go that no bridge took: look for them again, forget
//   /settings/bridges[/<entry id>]    bridges and Sync Boxes; one bridge (hue entry) or box (its entry)
//   /settings/bridges/add      add a bridge (Ethernet or Wi-Fi; found, or by address; the link button)
//   /settings/bridges/move     move to another bridge: ?bridge=<hue entry id> (all of it), ?area=<id> (a room)
//                              or ?lights=<ids>&to_area=<id>,
//                              optionally &to=<hue entry id>; without them the move in progress
//   /settings/motionaware[?bridge=<hue entry id>]  MotionAware areas (Hue Bridge Pro)
//   /settings/motionaware/new[?bridge=]      a new area: room or zone, lights, calibration
//   /settings/motionaware/<id>                an area: on/off, what happens on motion, lights, sensitivity
//   /settings/entertainment[/new|/<id>[/arrange]]  entertainment areas
//   /settings/integration      the integration's options
//   /rooms                     rooms and zones: alignment with HA areas, zone editor

import { html, LitElement, nothing, type PropertyValues, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import { keyed } from "lit/directives/keyed.js";

import { PANEL_PATH, StudioContext } from "./context.ts";
import { fitToViewport, outsidePath, toggleSidebar } from "./ha-internals.ts";
import { tabTarget } from "./footer-model.ts";
import { type DeviceGroup, isDeviceGroup } from "./devices.ts";
import { findGroup, glowColor, lightColors } from "./model.ts";
import { CSS } from "./styles.ts";
import type { Hass } from "./types.ts";
import { icon, type IconName, keepTouchInside } from "./ui.ts";
import "./views/automation-edit.ts";
import "./views/automations.ts";
import "./views/daylight-settings.ts";
import "./views/bridge-add.ts";
import "./views/bridge-move.ts";
import "./views/bridges.ts";
import "./views/color.ts";
import "./views/entertainment.ts";
import "./views/integration.ts";
import "./views/device-add.ts";
import "./views/device.ts";
import "./views/devices.ts";
import "./views/experimental.ts";
import "./views/gallery.ts";
import "./views/gallery-settings.ts";
import "./views/home.ts";
import "./views/lost.ts";
import "./views/motion-area.ts";
import "./views/room.ts";
import "./views/rooms.ts";
import "./views/settings.ts";
import "./views/space.ts";
import { NEW_SCENE } from "./views/scene.ts";
import "./views/sensor.ts";
import "./views/sync.ts";
import { registerHueIcons } from "./hue-icons.ts";

// Also registered by the extra JS on every page; the panel may load first.
registerHueIcons();

/** The page each tab showed last (path below the panel, with its query): a tab goes back there. */
const lastPaths: Record<string, string> = {};

type Route =
  | { name: "home" }
  | { name: "room"; key: string }
  | { name: "color"; key: string; light: string | null; back: string | null; exit: string | null }
  | { name: "scene"; key: string; scene: string; exit: string | null }
  | { name: "space"; key: string }
  | { name: "sensor"; key: string; device: string }
  | { name: "gallery"; room: string | null }
  | { name: "sync"; box: string | null }
  | { name: "rooms" }
  | { name: "settings" }
  | { name: "experimental" }
  | { name: "gallerySettings" }
  | { name: "daylight" }
  | { name: "devices"; list: DeviceGroup | null; bridge: string | null }
  | { name: "device"; device: string }
  | { name: "deviceSensor"; device: string }
  | { name: "deviceAdd"; room: string | null }
  | { name: "lost" }
  | { name: "bridges"; mode: "bridges" | "motion"; item: string | null }
  | { name: "motionArea"; area: string; bridge: string | null }
  | { name: "bridgeAdd" }
  | { name: "bridgeMove"; bridge: string | null; area: string | null; lights: string[] | null; toArea: string | null; to: string | null }
  | { name: "entertainment"; area: string | null; arrange: boolean }
  | { name: "integration" }
  | { name: "automations" }
  | { name: "automationNew"; room: string | null }
  | {
      name: "automation";
      id: string | null;
      type: string | null;
      room: string | null;
      preset: string | null;
      sensor: string | null;
      lux: string | null;
      exit: string | null;
    };

function parseRoute(path: string, search: string): Route {
  const params = new URLSearchParams(search);
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "room" && parts[1] && parts[2] === "color") {
    // Only paths inside the panel: `back` comes from the URL.
    const back = params.get("back");
    // `from`: a page outside the panel (the dialog's "Hue Studio" button) that "Done" returns to.
    return { name: "color", key: parts[1], light: params.get("light"), back: back?.startsWith("/room/") ? back : null, exit: outsidePath(params.get("from")) };
  }
  if (parts[0] === "room" && parts[1] && parts[2] === "scene" && parts[3])
    return { name: "scene", key: parts[1], scene: parts[3], exit: outsidePath(params.get("from")) };
  if (parts[0] === "room" && parts[1] && parts[2] === "space") return { name: "space", key: parts[1] };
  if (parts[0] === "room" && parts[1] && parts[2] === "sensor" && parts[3]) return { name: "sensor", key: parts[1], device: parts[3] };
  if (parts[0] === "room" && parts[1]) return { name: "room", key: parts[1] };
  if (parts[0] === "gallery") return { name: "gallery", room: params.get("room") };
  if (parts[0] === "sync") return { name: "sync", box: params.get("box") };
  if (parts[0] === "rooms") return { name: "rooms" };
  if (parts[0] === "automations" && parts[1] === "new" && parts[2]) return {
      name: "automation",
      id: null,
      type: parts[2],
      room: params.get("room"),
      preset: params.get("preset"),
      sensor: params.get("sensor"),
      lux: params.get("lux"),
      exit: null,
    };
  if (parts[0] === "automations" && parts[1] === "new") return { name: "automationNew", room: params.get("room") };
  if (parts[0] === "automations" && parts[1]) return { name: "automation", id: parts[1], type: null, room: params.get("room"), preset: null, sensor: null, lux: null, exit: outsidePath(params.get("from")) };
  if (parts[0] === "automations") return { name: "automations" };
  if (parts[0] === "settings" && parts[1] === "experimental") return { name: "experimental" };
  if (parts[0] === "settings" && parts[1] === "gallery") return { name: "gallerySettings" };
  if (parts[0] === "settings" && parts[1] === "devices" && parts[2] === "add") return { name: "deviceAdd", room: params.get("room") };
  if (parts[0] === "settings" && parts[1] === "devices" && parts[2] === "lost") return { name: "lost" };
  if (parts[0] === "settings" && parts[1] === "daylight") return { name: "daylight" };
  if (parts[0] === "settings" && parts[1] === "devices" && parts[2] === "device" && parts[3]) return { name: "device", device: parts[3] };
  if (parts[0] === "settings" && parts[1] === "devices" && parts[2] === "sensor" && parts[3]) return { name: "deviceSensor", device: parts[3] };
  if (parts[0] === "settings" && parts[1] === "devices") return { name: "devices", list: isDeviceGroup(parts[2]) ? parts[2] : null, bridge: params.get("bridge") };
  if (parts[0] === "settings" && parts[1] === "bridges" && parts[2] === "add") return { name: "bridgeAdd" };
  if (parts[0] === "settings" && parts[1] === "bridges" && parts[2] === "move") {
    const lights = params.get("lights");
    return { name: "bridgeMove", bridge: params.get("bridge"), area: params.get("area"), lights: lights ? lights.split(",") : null, toArea: params.get("to_area"), to: params.get("to") };
  }
  if (parts[0] === "settings" && parts[1] === "bridges") return { name: "bridges", mode: "bridges", item: parts[2] || null };
  if (parts[0] === "settings" && parts[1] === "motionaware" && parts[2]) return { name: "motionArea", area: parts[2], bridge: params.get("bridge") };
  if (parts[0] === "settings" && parts[1] === "motionaware") return { name: "bridges", mode: "motion", item: params.get("bridge") };
  if (parts[0] === "settings" && parts[1] === "entertainment") return { name: "entertainment", area: parts[2] || null, arrange: parts[3] === "arrange" };
  if (parts[0] === "settings" && parts[1] === "integration") return { name: "integration" };
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
  private untouch?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.ctx ??= new StudioContext(() => this.rev++);
    this.ctx.toggleSidebar = () => toggleSidebar(this);
    this.unfit = fitToViewport(this);
    this.untouch = keepTouchInside(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unfit?.();
    this.untouch?.();
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
    const path = this.route?.path ?? location.pathname.replace(PANEL_PATH, "");
    const route = parseRoute(path, location.search);
    const tab =
      route.name === "sync"
        ? "sync"
        : route.name === "automations" || route.name === "automationNew" || route.name === "automation"
          ? "automations"
          : route.name === "settings" || route.name === "rooms" || route.name === "experimental" || route.name === "gallerySettings" ||
              route.name === "daylight" ||
              route.name === "devices" ||
              route.name === "device" ||
              route.name === "deviceSensor" ||
              route.name === "deviceAdd" ||
              route.name === "lost" ||
              route.name === "bridges" ||
              route.name === "motionArea" ||
              route.name === "bridgeAdd" ||
              route.name === "bridgeMove" ||
              route.name === "entertainment" ||
              route.name === "integration"
            ? "settings"
            : "home";
    lastPaths[tab] = path + location.search;
    const tabs: [string, string, IconName, string][] = [
      ["home", "", "home", ctx.t("nav.home")],
      ["automations", "/automations", "bolt", ctx.t("nav.automations")],
    ];
    if (Object.keys(ctx.boxes).length || route.name === "sync") tabs.push(["sync", "/sync", "sync", ctx.t("nav.sync")]);
    tabs.push(["settings", "/settings", "cog", ctx.t("nav.settings")]);
    const full =
      route.name === "color" ||
      route.name === "scene" ||
      route.name === "sensor" ||
      route.name === "deviceSensor" ||
      route.name === "device" ||
      route.name === "automation" ||
      route.name === "automationNew" ||
      route.name === "gallery";
    // Editors come up as a sheet over the screen on phones (the Hue app's: its top corners
    // rounded under the status bar).
    const newScene = route.name === "scene" && route.scene === NEW_SCENE;
    const sheet = ctx.narrow && ((route.name === "scene" && !newScene) || route.name === "sensor" || route.name === "deviceSensor" || route.name === "device" || route.name === "automation");
    // Pickers (the gallery, a new automation's types) are the Hue app's: a deep blue top with the
    // page as a rounded panel over it.
    const picker = route.name === "automationNew" || route.name === "gallery" || newScene;
    const glow = this.glow(ctx, route);
    // With the experimental footer at the bottom of the screen, the panel's tabs go on top.
    const top = !!ctx.config.footer && ctx.narrow;
    return html`
      <main
        class=${classMap({ colorview: route.name === "color", "under-footer": top, wide: !ctx.narrow, "as-sheet": sheet, picker, [`glow-${glow.kind}`]: !!glow.kind })}
        style=${styleMap({ "--glow": glow.color })}
      >${keyed(JSON.stringify(route), this.view(ctx, route))}</main>
      <nav class=${classMap({ tabs: true, top })} ?hidden=${full}>
        ${tabs.map(
          ([id, to, name, label]) =>
            html`<button class=${classMap({ on: id === tab })} @click=${() => ctx.go(tabTarget(lastPaths, id, tab, to))}>${icon(name)}${label}</button>`,
        )}
      </nav>
      <div class=${classMap({ toast: true, on: ctx.toastOn })}>${ctx.toastText}</div>
    `;
  }

  /** The page's glow, the Hue app's: Home and a room in their lit lights' colors, the
   *  Automations and Sync tabs in their own; Settings and sub screens have none. */
  private glow(ctx: StudioContext, route: Route): { kind: "light" | "blue" | "violet" | null; color?: string } {
    if (route.name === "automations") return { kind: "blue" };
    if (route.name === "sync") return { kind: "violet" };
    const lights =
      route.name === "home"
        ? [...new Set([...ctx.home.rooms, ...ctx.home.zones].flatMap((g) => g.lights))]
        : route.name === "room"
          ? (findGroup(ctx.home, route.key)?.lights ?? [])
          : [];
    const color = glowColor(lights.flatMap((id) => lightColors(ctx.hass, id, ctx.lightInfo[id])));
    return color ? { kind: "light", color } : { kind: null };
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
          .exitPath=${route.exit}
        ></hue-studio-color-view>`;
      case "space":
        return html`<hue-studio-space-view .ctx=${ctx} .rev=${rev} .key=${route.key}></hue-studio-space-view>`;
      case "sensor":
        return html`<hue-studio-sensor-view .ctx=${ctx} .rev=${rev} .key=${route.key} .device=${route.device}></hue-studio-sensor-view>`;
      case "scene":
        return html`<hue-studio-scene-view .ctx=${ctx} .rev=${rev} .key=${route.key} .scene=${route.scene} .exitPath=${route.exit}></hue-studio-scene-view>`;
      case "sync":
        return html`<hue-studio-sync-view .ctx=${ctx} .rev=${rev} .box=${route.box}></hue-studio-sync-view>`;
      case "automations":
        return html`<hue-studio-automations-view .ctx=${ctx} .rev=${rev}></hue-studio-automations-view>`;
      case "automationNew":
        return html`<hue-studio-automation-new-view .ctx=${ctx} .rev=${rev} .room=${route.room}></hue-studio-automation-new-view>`;
      case "automation":
        return html`<hue-studio-automation-edit-view
          .ctx=${ctx}
          .rev=${rev}
          .automationId=${route.id}
          .newType=${route.type}
          .room=${route.room}
          .preset=${route.preset}
          .sensor=${route.sensor}
          .lux=${route.lux}
          .exitPath=${route.exit}
        ></hue-studio-automation-edit-view>`;
      case "settings":
        return html`<hue-studio-settings-view .ctx=${ctx} .rev=${rev}></hue-studio-settings-view>`;
      case "bridgeAdd":
        return html`<hue-studio-bridge-add-view .ctx=${ctx} .rev=${rev}></hue-studio-bridge-add-view>`;
      case "bridgeMove":
        return html`<hue-studio-bridge-move-view .ctx=${ctx} .rev=${rev} .bridge=${route.bridge} .area=${route.area} .lights=${route.lights} .toArea=${route.toArea} .to=${route.to}></hue-studio-bridge-move-view>`;
      case "bridges":
        return html`<hue-studio-bridges-view .ctx=${ctx} .rev=${rev} .mode=${route.mode} .item=${route.item}></hue-studio-bridges-view>`;
      case "motionArea":
        return html`<hue-studio-motion-area-view .ctx=${ctx} .rev=${rev} .area=${route.area} .bridge=${route.bridge}></hue-studio-motion-area-view>`;
      case "entertainment":
        return route.arrange && route.area
          ? html`<hue-studio-space-view .ctx=${ctx} .rev=${rev} .entertainment=${route.area}></hue-studio-space-view>`
          : html`<hue-studio-entertainment-view .ctx=${ctx} .rev=${rev} .area=${route.area}></hue-studio-entertainment-view>`;
      case "integration":
        return html`<hue-studio-integration-view .ctx=${ctx} .rev=${rev}></hue-studio-integration-view>`;
      case "devices":
        return html`<hue-studio-devices-view .ctx=${ctx} .rev=${rev} .list=${route.list} .bridge=${route.bridge}></hue-studio-devices-view>`;
      case "device":
        return html`<hue-studio-device-view .ctx=${ctx} .rev=${rev} .device=${route.device}></hue-studio-device-view>`;
      case "deviceSensor":
        return html`<hue-studio-sensor-view .ctx=${ctx} .rev=${rev} .device=${route.device} .back=${"/settings/devices/sensors"}></hue-studio-sensor-view>`;
      case "lost":
        return html`<hue-studio-lost-view .ctx=${ctx} .rev=${rev}></hue-studio-lost-view>`;
      case "deviceAdd":
        return html`<hue-studio-device-add-view .ctx=${ctx} .rev=${rev} .room=${route.room}></hue-studio-device-add-view>`;
      case "experimental":
        return html`<hue-studio-experimental-view .ctx=${ctx} .rev=${rev}></hue-studio-experimental-view>`;
      case "gallerySettings":
        return html`<hue-studio-gallery-settings-view .ctx=${ctx} .rev=${rev}></hue-studio-gallery-settings-view>`;
      case "daylight":
        return html`<hue-studio-daylight-settings-view .ctx=${ctx} .rev=${rev}></hue-studio-daylight-settings-view>`;
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
      const body = this.renderRoot.querySelector(".screen-body");
      if (body) body.scrollTop = 0;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-panel": HueStudioPanel;
  }
}
