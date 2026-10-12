// Scene gallery: categories of tiles, search, a scene sheet that applies it to a room or
// saves it there as a scene (on the bridge, with the gallery picture, like the Hue app).

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { guard } from "lit/directives/guard.js";
import { styleMap } from "lit/directives/style-map.js";

import { paletteArt, paletteColors } from "../color.ts";
import { thumbUrl } from "../gallery-data.ts";
import { allGroups, findGroup, type Group } from "../model.ts";
import { gallerySeasons, shownCategories } from "../seasons.ts";
import { canSpread } from "../space.ts";
import type { Gallery, GalleryScene } from "../types.ts";
import { icon, normalize } from "../ui.ts";
import { StudioView } from "./base.ts";

@customElement("hue-studio-gallery-view")
export class GalleryView extends StudioView {
  /** Opened from a room or zone: apply there, no target picker. */
  @property() accessor room: string | null = null;

  @state() private accessor query = "";
  @state() private accessor searching = false;
  @state() private accessor targetKey: string | null = null;
  @state() private accessor open: GalleryScene | null = null;
  /** How "Set once" lays the colors out: in turn (classic) or by where lights stand. */
  @state() private accessor layout: "classic" | "spatial" = "spatial";

  private get target(): Group | null {
    const { home } = this.ctx;
    return findGroup(home, this.room ?? this.targetKey) || allGroups(home)[0] || null;
  }

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const groups = allGroups(ctx.home);
    const target = this.target;
    const back = () => ctx.go(`/room/${encodeURIComponent(this.room ?? "")}`);
    const toggleSearch = () => {
      this.searching = !this.searching;
      if (this.searching) this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".q")?.focus());
      else this.query = "";
    };
    const q = normalize(this.query);
    // Seasonal gallery (a setting): holiday and season categories only in their time.
    const shown = ctx.gallery ? shownCategories(ctx.gallery.categories, gallerySeasons(ctx.config), ctx.hass) : [];

    // The search field lives in the header: always there in the desktop Explore tab, else
    // in the bar instead of the title while the search button is on.
    const wide = !this.room && !ctx.narrow;
    const field = wide || this.searching
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
    const toggle = wide
      ? nothing
      : html`<button class="round search" aria-label=${t("gallery.search_button")} aria-pressed=${this.searching} @click=${toggleSearch}>
          ${icon(this.searching ? "close" : "search")}
        </button>`;
    const body = html`${groups.length > 1 && !this.room
        ? html`<h2 class="label">${t("gallery.target")}</h2>
            <div class="chips">
              ${groups.map(
                (g) => html`<button class=${classMap({ chip: true, on: g.key === target?.key })} @click=${() => (this.targetKey = g.key)}>
                  <ha-icon icon=${g.icon}></ha-icon>${g.name}
                </button>`,
              )}
            </div>`
        : nothing}
      ${ctx.gallery ? guard([ctx.gallery, q, shown.join()], () => this.body(ctx.gallery!, q, shown)) : nothing}
      ${ctx.galleryError ? html`<div class="note">${t("gallery.load_error")}</div>` : nothing}`;
    // Opened from a room: a screen of its own (the field replaces its title); else the Explore tab.
    const screen = this.room
      ? this.screen(this.subHead(t("gallery.title"), back, toggle, field), body)
      : this.tabScreen(t("gallery.title"), body, { center: field, end: toggle });
    return html`${screen}
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

  /** The scene sheet, like the Hue app's pop-up. */
  private sheet(scene: GalleryScene, target: Group | null) {
    const { ctx } = this;
    const { t } = ctx;
    const close = () => (this.open = null);
    // Spatial needs two placed lights and colors to spread.
    const spreadable = !!target && scene.kind === "gradient" && canSpread(ctx.positions, target.lights);
    const spatial = spreadable && this.layout === "spatial";
    const apply = async () => {
      close();
      if (!target) return;
      const data = { entity_id: target.target, gallery_scene: scene.id, ...(spatial ? { layout: "spatial" } : {}) };
      const ok = await ctx.call("hue_studio", "apply_palette", data);
      if (ok) ctx.toast(t("gallery.applied", { name: target.name }));
    };
    const save = async () => {
      close();
      if (!target?.group) return;
      const data = { entity_id: target.group, name: scene.name, gallery_scene: scene.id };
      if (await ctx.call("hue_studio", "create_scene", data, { optimistic: false })) {
        ctx.toast(t("gallery.saved", { name: target.name }));
      }
    };
    return html`<div class="sheet" @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="box" role="dialog" aria-label=${scene.name}>
        <div class="pic" style=${styleMap({ backgroundImage: `url('${thumbUrl(scene.id)}'), ${paletteArt(scene)}` })}>
          <h3>${scene.name}</h3>
          <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
        </div>
        <div class="dots">${paletteColors(scene).map((c) => html`<i style=${styleMap({ background: c })}></i>`)}</div>
        <div class="actions">
          ${spreadable
            ? html`<div class="seg two" role="radiogroup" aria-label=${t("gallery.layout")}>
                ${(["classic", "spatial"] as const).map(
                  (l) => html`<button role="radio" aria-checked=${this.layout === l} class=${classMap({ on: this.layout === l })} @click=${() => (this.layout = l)}>
                    ${t(`gallery.layout_${l}`)}
                  </button>`,
                )}
              </div>`
            : nothing}
          <button class="pill apply" ?disabled=${!target} @click=${apply}>${t("gallery.set_once")}</button>
          ${target?.group ? html`<button class="pill" @click=${save}>${t("gallery.save")}</button>` : nothing}
          ${target ? html`<div class="target">${t("gallery.target")}: ${target.name}</div>` : nothing}
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
