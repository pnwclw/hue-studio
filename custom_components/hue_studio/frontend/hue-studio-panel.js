// The `/hue` panel: a Hue-app-like UI built on HA's own model (areas, entities, services).
// HA sets `hass`, `narrow`, `route` and `panel` on this element.
//
// Routes (below the panel's /hue prefix):
//   ""                         home: rooms and zones
//   /room/<key>                room: scenes and lights
//   /room/<key>/color?light=   color wheel
//   /gallery?room=<key>        scene gallery

import { loadGallery } from "./gallery-data.js";
import { navigate, toggleSidebar } from "./ha-internals.js";
import { localize } from "./i18n.js";
import { buildHome } from "./model.js";
import { CSS } from "./styles.js";
import { esc, svg, toast } from "./ui.js";
import { ColorView } from "./views/color.js";
import { GalleryView } from "./views/gallery.js";
import { HomeView } from "./views/home.js";
import { RoomView } from "./views/room.js";

const PREFIX = "/hue";

function parseRoute(path, search) {
  const params = new URLSearchParams(search);
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "room" && parts[1] && parts[2] === "color") return { name: "color", key: parts[1], light: params.get("light") };
  if (parts[0] === "room" && parts[1]) return { name: "room", key: parts[1] };
  if (parts[0] === "gallery") return { name: "gallery", room: params.get("room") };
  return { name: "home" };
}

/** Changes in what the views are built from (not in states) force a re-render. */
const structureOf = (home, t) =>
  JSON.stringify([t("home.title"), [...home.rooms, ...home.zones].map((g) => [g.key, g.name, g.lights, g.scenes.map((s) => s.entity_id)])]);

class HueStudioPanel extends HTMLElement {
  constructor() {
    super();
    this.lightInfo = {};
    this.gallery = null;
    this.galleryError = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._unsubLights) this._subscribeLights();
    this._schedule();
  }

  get hass() {
    return this._hass;
  }

  set narrow(narrow) {
    this.narrow_ = narrow;
    this._schedule();
  }

  get narrow() {
    return this.narrow_;
  }

  set route(route) {
    this._route = route;
    this._schedule();
  }

  connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" }).innerHTML = `<style>${CSS}</style><main></main><nav class="tabs"></nav>`;
    }
    loadGallery()
      .then((g) => {
        this.gallery = g;
        this._schedule();
      })
      .catch((err) => {
        console.error("hue_studio: gallery failed to load", err);
        this.galleryError = true;
        this._schedule();
      });
    this._schedule();
  }

  disconnectedCallback() {
    this._unsubLights?.then((unsub) => unsub()).catch(() => {});
    this._unsubLights = null;
  }

  /** Gamut and gradient info from our backend; the UI works without it (no clipping). */
  _subscribeLights() {
    const conn = this._hass?.connection;
    if (!conn) return;
    this._unsubLights = conn
      .subscribeMessage(
        (msg) => {
          Object.assign(this.lightInfo, msg.lights);
          this._schedule();
        },
        { type: "hue_studio/lights/subscribe" },
      )
      .catch((err) => {
        console.warn("hue_studio: light info unavailable", err);
        return () => {};
      });
  }

  _schedule() {
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      this._update();
    });
  }

  _update() {
    if (!this._hass || !this.shadowRoot) return;
    this.t = localize(this._hass);
    this.home = buildHome(this._hass);

    const path = this._route?.path ?? location.pathname.replace(PREFIX, "");
    const route = parseRoute(path, location.search);
    const key = JSON.stringify(route) + structureOf(this.home, this.t);
    if (key !== this._viewKey) {
      this._viewKey = key;
      this._mount(route);
    }
    this.view.update();
  }

  _mount(route) {
    const main = this.shadowRoot.querySelector("main");
    const sameRoute = this._routeName === JSON.stringify(route);
    const scroll = sameRoute ? main.scrollTop : 0;
    this._routeName = JSON.stringify(route);
    this.shadowRoot.querySelector(".sheet")?.remove();

    if (route.name === "room") this.view = new RoomView(this, route.key);
    else if (route.name === "color") this.view = new ColorView(this, route.key, route.light);
    else if (route.name === "gallery") this.view = new GalleryView(this, route.room);
    else this.view = new HomeView(this);
    main.className = route.name === "color" ? "colorview" : "";
    main.replaceChildren(this.view.el);
    main.scrollTop = scroll;

    const tab = route.name === "gallery" ? "gallery" : "home";
    const nav = this.shadowRoot.querySelector("nav");
    nav.hidden = route.name === "color";
    nav.innerHTML = [
      ["home", "", "home", this.t("nav.home")],
      ["gallery", "/gallery", "explore", this.t("nav.gallery")],
    ]
      .map(([id, to, icon, label]) => `<button class="${id === tab ? "on" : ""}" data-to="${to}">${svg(icon)}${esc(label)}</button>`)
      .join("");
    for (const b of nav.querySelectorAll("button")) b.addEventListener("click", () => this.go(b.dataset.to));
  }

  // ---- context used by the views ----

  go(path) {
    navigate(`${PREFIX}${path}`);
  }

  toggleSidebar() {
    toggleSidebar(this);
  }

  /** Call a service; on failure show the error. Resolves to true on success. */
  async call(domain, service, data) {
    try {
      await this._hass.callService(domain, service, data);
      return true;
    } catch (err) {
      this.toast(this.t("common.error", { error: err?.message || String(err) }));
      return false;
    }
  }

  toast(text) {
    toast(this.shadowRoot, text);
  }

  overlay(el) {
    this.shadowRoot.append(el);
  }
}

customElements.define("hue-studio-panel", HueStudioPanel);
