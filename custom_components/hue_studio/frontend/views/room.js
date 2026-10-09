// Room: header with toggle and brightness, the room's Hue scenes, its lights.

import { paletteArt } from "../color.js";
import { galleryMatch, thumbUrl } from "../gallery-data.js";
import { colorsCss, findGroup, friendlyName, lightColors, needsDarkText } from "../model.js";
import { esc, setToggle, sliderHtml, svg, toggleHtml } from "../ui.js";
import { bindGroupControls, paintGroup } from "./home.js";

const FALLBACK_DOT = "radial-gradient(circle at 30% 30%, #ffe7b8, #f2a65a)";

export class RoomView {
  constructor(ctx, key) {
    this.ctx = ctx;
    const { t } = ctx;
    this.group = findGroup(ctx.home, key);
    this.el = document.createElement("div");
    this.el.className = "page";
    if (!this.group) {
      this.el.innerHTML = `<div class="topbar"><button class="round back" aria-label="${esc(t("common.back"))}">${svg("back")}</button></div>
        <p class="empty">${esc(t("room.not_found"))}</p>`;
      this.el.querySelector(".back").addEventListener("click", () => ctx.go(""));
      return;
    }
    const g = this.group;
    const scene = (s) => {
      const sub = s.group !== g.group ? `<div class="sub">${esc(friendlyName(ctx.hass, s.group))}</div>` : "";
      return `<button class="scene" data-scene="${esc(s.entity_id)}"><div class="dot"></div><div class="name">${esc(s.name)}</div>${sub}</button>`;
    };
    const light = (id) => `<div class="light" data-light="${esc(id)}">
        <ha-icon icon="${esc(ctx.hass.entities?.[id]?.icon || "mdi:lightbulb")}"></ha-icon>
        <div class="name">${esc(friendlyName(ctx.hass, id))}</div>${toggleHtml(false, t("common.toggle"))}</div>`;

    this.el.innerHTML = `
      <div class="hero"><div class="inner">
        <div class="topbar">
          <button class="round back" aria-label="${esc(t("common.back"))}">${svg("back")}</button>
          <div class="title">${esc(g.name)}</div>
          <button class="round add" aria-label="${esc(t("room.gallery"))}">${svg("plus")}</button>
          <button class="round colors" aria-label="${esc(t("room.colors"))}">${svg("palette")}</button>
          ${toggleHtml(false, t("common.toggle"))}
        </div>
        ${sliderHtml(0, t("common.brightness"))}
      </div></div>
      ${g.scenes.length ? `<h2 class="label">${esc(t("room.scenes"))}</h2><div class="grid">${g.scenes.map(scene).join("")}</div>` : ""}
      <h2 class="label">${esc(t("room.lights"))}</h2>
      <div class="grid">${g.lights.map(light).join("")}</div>`;

    const hero = this.el.querySelector(".hero");
    bindGroupControls(ctx, hero, g);
    const room = encodeURIComponent(g.key);
    hero.querySelector(".back").addEventListener("click", () => ctx.go(""));
    hero.querySelector(".add").addEventListener("click", () => ctx.go(`/gallery?room=${room}`));
    hero.querySelector(".colors").addEventListener("click", () => ctx.go(`/room/${room}/color`));
    for (const el of this.el.querySelectorAll(".scene")) {
      el.addEventListener("click", () => ctx.call("scene", "turn_on", { entity_id: el.dataset.scene }));
    }
    for (const el of this.el.querySelectorAll(".light")) {
      const id = el.dataset.light;
      el.querySelector(".toggle").addEventListener("click", (e) => {
        e.stopPropagation();
        ctx.call("light", "toggle", { entity_id: id });
      });
      el.addEventListener("click", () => ctx.go(`/room/${room}/color?light=${encodeURIComponent(id)}`));
    }
  }

  update() {
    if (!this.group) return;
    const { ctx, group } = this;
    paintGroup(ctx, this.el.querySelector(".hero"), group);

    // Scene dots: the matching gallery picture (bridge scenes usually come from the gallery).
    for (const el of this.el.querySelectorAll(".scene")) {
      if (el.dataset.painted || !ctx.gallery) continue;
      const name = group.scenes.find((s) => s.entity_id === el.dataset.scene)?.name;
      const match = galleryMatch(ctx.gallery, name);
      el.querySelector(".dot").style.background = match
        ? `url("${thumbUrl(match.id)}") center / cover, ${paletteArt(match)}`
        : FALLBACK_DOT;
      el.dataset.painted = "1";
    }

    for (const el of this.el.querySelectorAll(".light")) {
      const id = el.dataset.light;
      const state = ctx.hass.states[id];
      const colors = lightColors(ctx.hass, id, ctx.lightInfo[id]);
      el.classList.toggle("lit", colors.length > 0);
      el.classList.toggle("unavailable", !state || state.state === "unavailable");
      el.classList.toggle("dark-text", colors.length > 0 && needsDarkText(colors));
      el.style.setProperty("--lit-bg", colorsCss(colors, "var(--surface)"));
      setToggle(el.querySelector(".toggle"), state?.state === "on");
    }
  }
}
