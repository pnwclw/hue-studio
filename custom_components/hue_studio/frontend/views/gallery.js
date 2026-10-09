// Scene gallery: categories of tiles, search, a scene sheet that applies it to a room.

import { paletteArt, paletteColors } from "../color.js";
import { thumbUrl } from "../gallery-data.js";
import { findGroup } from "../model.js";
import { esc, normalize, svg } from "../ui.js";

export class GalleryView {
  constructor(ctx, roomKey) {
    this.ctx = ctx;
    const { t, home } = ctx;
    const groups = [...home.rooms, ...home.zones];
    this.target = findGroup(home, roomKey) || groups[0] || null;
    this.el = document.createElement("div");
    this.el.className = "page";
    this.el.innerHTML = `
      <div class="topbar">
        ${roomKey ? `<button class="round back" aria-label="${esc(t("common.back"))}">${svg("back")}</button>` : ""}
        <div class="grow"></div>
        <button class="round search" aria-label="${esc(t("gallery.search_button"))}">${svg("search")}</button>
      </div>
      <h1 class="big">${esc(t("gallery.title"))}</h1>
      <input class="q" type="search" placeholder="${esc(t("gallery.search"))}" autocomplete="off">
      ${groups.length > 1 ? `<h2 class="label">${esc(t("gallery.target"))}</h2><div class="chips">${groups
        .map((g) => `<button class="chip" data-key="${esc(g.key)}"><ha-icon icon="${esc(g.icon)}"></ha-icon>${esc(g.name)}</button>`)
        .join("")}</div>` : ""}
      <div class="body"></div>
      <div class="note" hidden></div>`;

    this.el.querySelector(".back")?.addEventListener("click", () => ctx.go(`/room/${encodeURIComponent(roomKey)}`));
    const q = this.el.querySelector(".q");
    this.el.querySelector(".search").addEventListener("click", () => {
      q.classList.toggle("on");
      if (q.classList.contains("on")) q.focus();
      else {
        q.value = "";
        this._filter("");
      }
    });
    q.addEventListener("input", () => this._filter(q.value));
    for (const c of this.el.querySelectorAll(".chip")) {
      c.addEventListener("click", () => {
        this.target = findGroup(ctx.home, c.dataset.key);
        this.update();
      });
    }
    this.el.querySelector(".body").addEventListener("click", (e) => {
      const tile = e.target.closest(".tile");
      if (tile) this._open(tile.dataset.id);
    });
  }

  update() {
    for (const c of this.el.querySelectorAll(".chip")) c.classList.toggle("on", c.dataset.key === this.target?.key);
    if (this.rendered) return;
    if (this.ctx.galleryError) this._note(this.ctx.t("gallery.load_error"));
    if (!this.ctx.gallery) return;
    this.rendered = true;
    const { categories, scenes } = this.ctx.gallery;
    this.el.querySelector(".body").innerHTML = categories
      .map((c) => [c, scenes.filter((s) => s.category === c.id)])
      .filter(([, items]) => items.length)
      .map(([c, items]) => {
        const tiles = items
          .map(
            (s) => `<div class="tile" data-id="${esc(s.id)}" data-name="${esc(normalize(s.name))}" style="background:${esc(paletteArt(s))}">
              <img src="${esc(thumbUrl(s.id))}" loading="lazy" alt="" onerror="this.remove()"><span>${esc(s.name)}</span></div>`,
          )
          .join("");
        return `<section><h2 class="label">${esc(c.name)}</h2><div class="tiles" style="--rows:${items.length > 3 ? 2 : 1}">${tiles}</div></section>`;
      })
      .join("");
  }

  _filter(query) {
    const n = normalize(query);
    let any = false;
    for (const section of this.el.querySelectorAll("section")) {
      let shown = 0;
      for (const tile of section.querySelectorAll(".tile")) {
        const match = !n || tile.dataset.name.includes(n);
        tile.hidden = !match;
        if (match) shown++;
      }
      section.hidden = !shown;
      section.querySelector(".tiles").style.setProperty("--rows", shown > 3 ? 2 : 1);
      any ||= shown > 0;
    }
    this.el.querySelector(".body").classList.toggle("searching", !!n);
    this._note(any ? "" : this.ctx.t("gallery.empty"));
  }

  _note(text) {
    const note = this.el.querySelector(".note");
    note.textContent = text;
    note.hidden = !text;
  }

  /** The scene sheet, like the Hue app's pop-up. */
  _open(id) {
    const { ctx } = this;
    const { t } = ctx;
    const scene = ctx.gallery.scenes.find((s) => s.id === id);
    if (!scene) return;
    this.el.getRootNode().querySelector(".sheet")?.remove();
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    const target = this.target;
    sheet.innerHTML = `<div class="box" role="dialog" aria-label="${esc(scene.name)}">
        <div class="pic" style="background-image:url('${esc(thumbUrl(scene.id))}'), ${esc(paletteArt(scene))}">
          <h3>${esc(scene.name)}</h3>
          <button class="round close" aria-label="${esc(t("common.close"))}">${svg("close")}</button>
        </div>
        <div class="dots">${paletteColors(scene).map((c) => `<i style="background:${c}"></i>`).join("")}</div>
        <div class="actions">
          <button class="pill apply"${target ? "" : " disabled"}>${esc(t("gallery.set_once"))}</button>
          ${target ? `<div class="target">${esc(t("gallery.target"))}: ${esc(target.name)}</div>` : ""}
        </div>
      </div>`;
    const close = () => sheet.remove();
    sheet.addEventListener("click", (e) => e.target === sheet && close());
    sheet.querySelector(".close").addEventListener("click", close);
    sheet.querySelector(".apply").addEventListener("click", async () => {
      close();
      const ok = await ctx.call("hue_studio", "apply_palette", { entity_id: target.target, gallery_scene: scene.id });
      if (ok) ctx.toast(t("gallery.applied", { name: target.name }));
    });
    ctx.overlay(sheet);
  }
}
