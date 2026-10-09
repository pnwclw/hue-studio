// Home: rooms (HA areas) and zones (other Hue groups) as cards with toggle and brightness.

import { colorsCss, groupState, needsDarkText } from "../model.js";
import { attachSlider, esc, setSlider, setToggle, sliderHtml, svg, throttle, toggleHtml } from "../ui.js";

/** Bridge limits: ~1 command/s for a Hue group, ~10/s for a single light. */
export const brightnessInterval = (group) => (group.group ? 1000 : 300);

/** Wire a room card / room header: toggle and brightness slider of a group. */
export function bindGroupControls(ctx, el, group) {
  el.querySelector(".toggle").addEventListener("click", (e) => {
    e.stopPropagation();
    const on = groupState(ctx.hass, group).on;
    ctx.call("light", on ? "turn_off" : "turn_on", { entity_id: group.target });
  });
  const send = throttle((v) => ctx.call("light", "turn_on", { entity_id: group.target, brightness_pct: v }), brightnessInterval(group));
  attachSlider(el.querySelector(".slider"), {
    onInput: send,
    onChange: (v) => {
      send(v);
      send.flush();
    },
  });
}

/** Reflect group state on a card / header element with `.toggle` and `.slider`. */
export function paintGroup(ctx, el, group) {
  const state = groupState(ctx.hass, group, ctx.lightInfo);
  el.classList.toggle("lit", state.on);
  el.classList.toggle("off", !state.on);
  el.classList.toggle("unavailable", !state.available);
  el.classList.toggle("dark-text", state.on && needsDarkText(state.colors));
  el.style.setProperty("--lit-bg", colorsCss(state.colors, "var(--surface)"));
  setToggle(el.querySelector(".toggle"), state.on);
  setSlider(el.querySelector(".slider"), state.brightness);
}

export class HomeView {
  constructor(ctx) {
    this.ctx = ctx;
    const { t, home } = ctx;
    this.el = document.createElement("div");
    this.el.className = "page";
    const card = (g) => `<div class="card" data-key="${esc(g.key)}">
        <div class="row"><ha-icon icon="${esc(g.icon)}"></ha-icon><div class="name">${esc(g.name)}</div>${toggleHtml(false, t("common.toggle"))}</div>
        ${sliderHtml(0, t("common.brightness"))}</div>`;
    const section = (title, groups) =>
      groups.length ? `<h2 class="label">${esc(title)}</h2><div class="cards">${groups.map(card).join("")}</div>` : "";
    const any = home.rooms.length + home.zones.length > 0;

    this.el.innerHTML = `
      <div class="topbar">
        <button class="round menu" aria-label="${esc(t("panel.menu"))}">${svg("menu")}</button>
        <div class="grow"></div>
        ${any ? toggleHtml(false, t("home.all_lights"), 'data-all="1"') : ""}
      </div>
      <h1 class="big">${esc(ctx.hass.config?.location_name || t("home.title"))}</h1>
      ${section(t("home.rooms"), home.rooms)}
      ${section(t("home.zones"), home.zones)}
      ${any ? "" : `<p class="empty">${esc(t("home.empty"))}</p>`}`;

    this.el.querySelector(".menu").addEventListener("click", () => ctx.toggleSidebar());
    this.el.querySelector("[data-all]")?.addEventListener("click", () => this._toggleAll());
    for (const el of this.el.querySelectorAll(".card")) {
      const group = this._group(el.dataset.key);
      bindGroupControls(ctx, el, group);
      el.addEventListener("click", () => ctx.go(`/room/${encodeURIComponent(group.key)}`));
    }
  }

  _group(key) {
    const { rooms, zones } = this.ctx.home;
    return [...rooms, ...zones].find((g) => g.key === key);
  }

  _all() {
    const { rooms, zones } = this.ctx.home;
    return [...rooms, ...zones];
  }

  _toggleAll() {
    const groups = this._all();
    const anyOn = groups.some((g) => groupState(this.ctx.hass, g).on);
    // Rooms cover every Hue light in an area; zones add lights outside areas.
    const targets = [...new Set(groups.flatMap((g) => g.target))];
    this.ctx.call("light", anyOn ? "turn_off" : "turn_on", { entity_id: targets });
  }

  update() {
    this.el.querySelector(".menu").hidden = !this.ctx.narrow;
    for (const el of this.el.querySelectorAll(".card")) paintGroup(this.ctx, el, this._group(el.dataset.key));
    const all = this.el.querySelector("[data-all]");
    if (all) setToggle(all, this._all().some((g) => groupState(this.ctx.hass, g).on));
  }
}
