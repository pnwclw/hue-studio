// Scene gallery of a room or zone (the "+" in its header), like the Hue app's: a full-screen
// page with a large title, search and categories of tiles; a scene's sheet sets it once or
// saves it as a scene of the room (on the bridge, with the gallery picture). The room is
// implied: nothing to pick.

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { guard } from "lit/directives/guard.js";
import { styleMap } from "lit/directives/style-map.js";

import { paletteArt, paletteColors } from "../color.ts";
import { thumbUrl } from "../gallery-data.ts";
import { findGroup, type Group } from "../model.ts";
import { gallerySeasons, shownCategories } from "../seasons.ts";
import { canSpread } from "../space.ts";
import type { Gallery, GalleryScene } from "../types.ts";
import { icon, normalize } from "../ui.ts";
import { StudioView } from "./base.ts";

@customElement("hue-studio-gallery-view")
export class GalleryView extends StudioView {
  /** The room or zone (its key) the gallery was opened from. */
  @property() accessor room: string | null = null;

  @state() private accessor query = "";
  @state() private accessor searching = false;
  @state() private accessor open: GalleryScene | null = null;
  @state() private accessor saving = false;

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const target = findGroup(ctx.home, this.room);
    const back = () => ctx.go(this.room ? `/room/${encodeURIComponent(this.room)}` : "");
    if (!target) return this.screen(this.subHead("", back), html`<p class="empty">${t("room.not_found")}</p>`);
    const toggleSearch = () => {
      this.searching = !this.searching;
      if (this.searching) this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".q")?.focus());
      else this.query = "";
    };
    const q = normalize(this.query);
    // Seasonal gallery (a setting): categories only in their time.
    const shown = ctx.gallery ? shownCategories(ctx.gallery.categories, gallerySeasons(ctx.config), ctx.hass) : [];

    // Search: always a field on desktop; on phones a button that puts the field in the bar.
    const wide = !ctx.narrow;
    const field =
      wide || this.searching
        ? html`<label class="search-field">
            ${icon("search")}
            <input
              class="q"
              type="search"
              placeholder=${t("gallery.search")}
              autocomplete="off"
              .value=${this.query}
              @input=${(e: InputEvent) => (this.query = (e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => e.key === "Escape" && (wide ? (this.query = "") : this.searching && toggleSearch())}
            />
          </label>`
        : nothing;
    const search = wide
      ? nothing
      : html`<button class="round search" aria-label=${t("gallery.search_button")} aria-pressed=${this.searching} @click=${toggleSearch}>
          ${icon(this.searching ? "close" : "search")}
        </button>`;
    const close = html`<button class="round close" aria-label=${t("common.close")} @click=${back}>${icon("close")}</button>`;
    const body = html`${ctx.gallery ? guard([ctx.gallery, q, shown.join()], () => this.body(ctx.gallery!, q, shown)) : nothing}
      ${ctx.galleryError ? html`<div class="note">${t("gallery.load_error")}</div>` : nothing}`;
    return html`${this.tabScreen(t("gallery.title"), body, { lead: close, center: field, end: search })}
      ${this.open ? this.sheet(this.open, target) : nothing}`;
  }

  private body(gallery: Gallery, q: string, shown: string[]) {
    const sections = gallery.categories
      .filter((c) => shown.includes(c.id))
      .map((c) => ({ c, items: gallery.scenes.filter((s) => s.category === c.id && (!q || normalize(s.name).includes(q))) }))
      .filter(({ items }) => items.length);
    return html`<div class=${classMap({ body: true, searching: !!q })} @click=${this.onTileClick}>
        ${sections.map(
          ({ c, items }) => html`<section>
            <h2 class="label">${c.name}</h2>
            <div class="tiles" style=${styleMap({ "--rows": items.length > 3 ? "2" : "1" })}>
              ${items.map(
                (s) => html`<div class="tile" data-id=${s.id} style=${styleMap({ background: paletteArt(s) })}>
                  <img src=${thumbUrl(s.id)} loading="lazy" alt="" @error=${(e: Event) => ((e.target as HTMLElement).hidden = true)} /><span>${s.name}</span>
                </div>`,
              )}
            </div>
          </section>`,
        )}
      </div>
      ${sections.length ? nothing : html`<div class="note">${this.ctx.t("gallery.empty")}</div>`}`;
  }

  private onTileClick = (e: Event): void => {
    const id = (e.target as HTMLElement).closest<HTMLElement>(".tile")?.dataset.id;
    this.open = this.ctx.gallery?.scenes.find((s) => s.id === id) ?? null;
  };

  /**
   * The scene sheet, like the Hue app's pop-up: set it once (colors by where the lights
   * stand when they are placed) or save it as a scene of the room. A room without a Hue
   * room or zone gets a zone of its lights first: scenes live there.
   */
  private sheet(scene: GalleryScene, target: Group) {
    const { ctx } = this;
    const { t } = ctx;
    const close = () => (this.open = null);
    const spatial = scene.kind === "gradient" && canSpread(ctx.positions, target.lights);
    const apply = async () => {
      close();
      const data = { entity_id: target.target, gallery_scene: scene.id, ...(spatial ? { layout: "spatial" } : {}) };
      await ctx.call("hue_studio", "apply_palette", data);
    };
    const save = async () => {
      if (this.saving) return;
      this.saving = true;
      const group = await ctx.hueGroupOf(target);
      const ok = !!group && (await ctx.call("hue_studio", "create_scene", { entity_id: group, name: scene.name, gallery_scene: scene.id }, { optimistic: false }));
      this.saving = false;
      if (!ok) return;
      close();
      ctx.toast(t("gallery.saved", { name: target.name }));
    };
    return html`<div class="sheet" @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="box" role="dialog" aria-label=${scene.name}>
        <div class="pic" style=${styleMap({ backgroundImage: `url('${thumbUrl(scene.id)}'), ${paletteArt(scene)}` })}>
          <h3>${scene.name}</h3>
          <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
        </div>
        <div class="dots">${paletteColors(scene).map((c) => html`<i style=${styleMap({ background: c })}></i>`)}</div>
        <div class="actions">
          <button class="pill apply" @click=${apply}>${t("gallery.set_once")}</button>
          <button class="pill" ?disabled=${this.saving} @click=${save}>${t("gallery.save")}</button>
        </div>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-gallery-view": GalleryView;
  }
}
