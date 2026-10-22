// A scene's sheet, like the Hue app's for a gallery scene: its picture with its name (renamed
// with the pencil), its colors (shuffled with a button), the room or zone it goes to (a
// sheet of rooms and zones to pick from), "Save to my scenes" (a bridge scene there, with
// the gallery picture) and "Set once". The gallery opens it for a scene, a room's "Copy to…"
// for one of its scenes.

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import { paletteArt, paletteColors } from "../color.ts";
import type { StudioContext } from "../context.ts";
import { haptic } from "../ha-internals.ts";
import { allGroups, findGroup, type Group } from "../model.ts";
import { canSpread } from "../space.ts";
import type { XY } from "../types.ts";
import { icon, LightElement } from "../ui.ts";

/** What the sheet shows: a gallery scene, or a scene's palette (its gallery picture if it has one). */
export interface PickedScene {
  name: string;
  /** The gallery scene (its picture, its colors unless shuffled). */
  gallery: string | null;
  /** CSS background of the picture. */
  picture: string;
  points: XY[];
  /** A white scene. */
  mirek: number | null;
  gradient: boolean;
}

@customElement("hue-studio-scene-pick")
export class ScenePick extends LightElement {
  @property({ attribute: false }) accessor ctx!: StudioContext;
  @property({ attribute: false }) accessor rev = 0;
  @property({ attribute: false }) accessor scene!: PickedScene;
  /** The room or zone (group key) it goes to at first. */
  @property() accessor room = "";

  @state() private accessor name: string | null = null;
  @state() private accessor editing = false;
  /** The colors in a new order (shuffled), null: the scene's own. */
  @state() private accessor order: XY[] | null = null;
  @state() private accessor target: string | null = null;
  @state() private accessor picking = false;
  @state() private accessor busy = false;

  private close(): void {
    this.dispatchEvent(new CustomEvent("close"));
  }

  private get group(): Group | null {
    return findGroup(this.ctx.home, this.target ?? this.room);
  }

  /** The colors to send: the scene's own (or its gallery's), or those in their new order. */
  private colors(): Record<string, unknown> {
    const s = this.scene;
    if (this.order) return { points: this.order.slice(0, 5) };
    if (s.gallery) return { gallery_scene: s.gallery };
    return s.points.length ? { points: s.points.slice(0, 5) } : { mirek: s.mirek ?? 366 };
  }

  private async setOnce(): Promise<void> {
    const g = this.group;
    if (!g) return;
    haptic("success");
    const spatial = this.scene.gradient && canSpread(this.ctx.positions, g.lights);
    if (await this.ctx.call("hue_studio", "apply_palette", { entity_id: g.target, ...this.colors(), ...(spatial ? { layout: "spatial" } : {}) }, { optimistic: false }))
      this.ctx.markManual(g);
    this.close();
  }

  private async save(): Promise<void> {
    const { ctx } = this;
    const g = this.group;
    if (!g || this.busy) return;
    this.busy = true;
    const group = await ctx.hueGroupOf(g);
    const name = (this.name ?? this.scene.name).trim() || this.scene.name;
    // Shuffled: the colors in their order, the gallery picture kept.
    const colors = { ...this.colors(), ...(this.order && this.scene.gallery ? { gallery_scene: this.scene.gallery } : {}) };
    const ok = !!group && (await ctx.call("hue_studio", "create_scene", { entity_id: group, name, ...colors }, { optimistic: false }));
    this.busy = false;
    if (!ok) return;
    haptic("success");
    ctx.toast(ctx.t("gallery.saved", { name: g.name }));
    this.close();
  }

  private shuffle(): void {
    haptic("selection");
    const points = [...(this.order ?? this.scene.points)];
    for (let i = points.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [points[i], points[j]] = [points[j], points[i]];
    }
    this.order = points;
  }

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const s = this.scene;
    const g = this.group;
    const name = this.name ?? s.name;
    const dots = this.order
      ? paletteColors({ kind: "gradient", points: this.order })
      : s.points.length
        ? paletteColors({ kind: "gradient", points: s.points })
        : paletteColors({ kind: "white", mirek: s.mirek ?? 366 });
    const done = (e: Event) => {
      this.editing = false;
      this.name = (e.target as HTMLInputElement).value;
    };
    return html`<div class=${classMap({ sheet: true, "scene-pick": true })} @click=${(e: Event) => e.target === e.currentTarget && this.close()}>
        <div class="box" role="dialog" aria-label=${name}>
          <div class="pic" style=${styleMap({ background: s.picture })}>
            ${this.editing
              ? html`<input class="name-input" .value=${name} aria-label=${t("scene.rename")}
                  @keydown=${(e: KeyboardEvent) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} @blur=${done} />`
              : html`<h3>${name}</h3>`}
            <button class="round close" aria-label=${t("common.close")} @click=${() => this.close()}>${icon("close")}</button>
            <button class="round rename" aria-label=${t("scene.rename")} @click=${() => {
              this.editing = true;
              void this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".name-input")?.focus());
            }}>${icon("pencil")}</button>
          </div>
          <div class="dots">
            ${dots.map((c) => html`<i style=${styleMap({ background: c })}></i>`)}
            ${s.points.length > 1 ? html`<button class="round shuffle" aria-label=${t("scene.shuffle_colors")} @click=${() => this.shuffle()}>${icon("shuffle")}</button>` : nothing}
          </div>
          <h2 class="label">${t("gallery.room_or_zone")}</h2>
          <button class="target-row" @click=${() => {
            haptic("selection");
            this.picking = true;
          }}>
            <ha-icon icon=${g?.icon || "mdi:sofa-outline"}></ha-icon><span>${g?.name ?? t("gallery.pick_room")}</span>
          </button>
          <div class="actions">
            <button class="pill outline" ?disabled=${!g || this.busy} @click=${() => this.save()}>${t("gallery.save_mine")}</button>
            <button class="pill" ?disabled=${!g} @click=${() => this.setOnce()}>${t("gallery.set_once")}</button>
          </div>
        </div>
      </div>
      ${this.picking ? this.picker() : nothing}`;
  }

  /** "Select a room or zone": rooms, then zones, the chosen one ticked. */
  private picker() {
    const { ctx } = this;
    const { t } = ctx;
    const current = this.target ?? this.room;
    const close = () => (this.picking = false);
    const row = (g: Group) => {
      const on = g.key === current;
      return html`<button class=${classMap({ item: true, on })} role="radio" aria-checked=${on} @click=${() => {
        haptic("selection");
        this.target = g.key;
        close();
      }}>
        <ha-icon icon=${g.icon}></ha-icon><div class="grow">${g.name}</div>
        ${on ? html`<span class="tick">${icon("check")}</span>` : nothing}
      </button>`;
    };
    return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="box form sensor-sheet lights-sheet" role="dialog" aria-label=${t("gallery.pick_room")}>
        <div class="sheet-bar">
          <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
          <div class="grow">${t("gallery.pick_room")}</div>
        </div>
        <div class="lights-body">
          <h2 class="label">${t("automations.rooms")}</h2>
          <div class="rows pick-rows choice-list">${ctx.home.rooms.map(row)}</div>
          ${ctx.home.zones.length
            ? html`<h2 class="label">${t("automations.zones")}</h2><div class="rows pick-rows choice-list">${ctx.home.zones.map(row)}</div>`
            : nothing}
        </div>
      </div>
    </div>`;
  }
}

/** A gallery scene for the sheet. */
export const galleryPick = (scene: { id: string; name: string; kind: string; points?: XY[]; mirek?: number }, picture: string): PickedScene => ({
  name: scene.name,
  gallery: scene.id,
  picture,
  points: scene.points ?? [],
  mirek: scene.mirek ?? null,
  gradient: scene.kind === "gradient",
});

/** Every room and zone, for "Copy to…" (the first one other than `except`). */
export const otherRoom = (ctx: StudioContext, except: string): string => allGroups(ctx.home).find((g) => g.key !== except)?.key ?? except;

/** Background of a palette's picture without a gallery picture. */
export const pickPicture = (points: XY[], mirek: number | null): string =>
  points.length ? paletteArt({ kind: "gradient", points }) : paletteArt({ kind: "white", mirek: mirek ?? 366 });

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-scene-pick": ScenePick;
  }
}
