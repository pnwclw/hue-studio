// Scene gallery of a room or zone (the "+" in its header), like the Hue app's: a full-screen
// page with a large title, search and categories of tiles; a scene's card (scene-pick.ts,
// the shown scenes beside it to swipe to) sets it once or saves it as a scene of the room it
// was opened from (on the bridge, with the gallery picture).

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { guard } from "lit/directives/guard.js";
import { styleMap } from "lit/directives/style-map.js";

import { paletteArt } from "../../../core/color.ts";
import { thumbUrl } from "../gallery-data.ts";
import { findGroup } from "../../../core/model.ts";
import { gallerySeasons, shownCategories } from "../seasons.ts";

import type { Gallery, GalleryScene } from "../../../core/types.ts";
import { icon, normalize } from "../../../ds/ui.ts";
import { StudioView } from "../../../ds/base.ts";
import { galleryPick } from "./scene-pick.ts";

@customElement("hue-studio-gallery-view")
export class GalleryView extends StudioView {
  /** The room or zone (its key) the gallery was opened from. */
  @property() accessor room: string | null = null;

  @state() private accessor query = "";
  @state() private accessor searching = false;
  /** The scenes shown (in the gallery's order: by category, down each column) and the one
   *  tapped, for the cards; null: none open. */
  @state() private accessor open: { scenes: GalleryScene[]; index: number } | null = null;
  private shownScenes: GalleryScene[] = [];

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
      ${this.open
        ? html`<hue-studio-scene-pick .ctx=${ctx} .rev=${this.rev} .room=${target.key} .index=${this.open.index} preview
            .scenes=${guard([this.open.scenes], () => this.open!.scenes.map((s) => galleryPick(s, `url("${thumbUrl(s.id)}") center / cover, ${paletteArt(s)}`, paletteArt(s))))}
            @close=${() => (this.open = null)}></hue-studio-scene-pick>`
        : nothing}`;
  }

  private body(gallery: Gallery, q: string, shown: string[]) {
    const sections = gallery.categories
      .filter((c) => shown.includes(c.id))
      .map((c) => ({ c, items: gallery.scenes.filter((s) => s.category === c.id && (!q || normalize(s.name).includes(q))) }))
      .filter(({ items }) => items.length);
    this.shownScenes = sections.flatMap(({ items }) => items);
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
    const scenes = this.shownScenes;
    const index = scenes.findIndex((s) => s.id === id);
    this.open = index < 0 ? null : { scenes, index };
  };

}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-gallery-view": GalleryView;
  }
}
