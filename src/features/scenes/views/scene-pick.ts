// A scene's card, like the Hue app's for a gallery scene: its picture with its name, its
// colors with shuffle and the pencil (rename), "Save to my scenes" (a bridge scene in the
// room, with the gallery picture) and "Set once". The gallery opens it on the scene tapped,
// the gallery's other scenes beside it to swipe to; a room's "Copy to…" for one of its
// scenes, with the room or zone it goes to as a row (a sheet of rooms and zones to pick from),
// which is ours. It comes up from the bottom over a fading dim and goes back down.

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";

import { paletteArt, paletteColors } from "../../../core/color.ts";
import type { StudioContext } from "../../../core/context.ts";
import { haptic } from "../../../core/ha-internals.ts";
import { allGroups, findGroup, type Group } from "../../../core/model.ts";
import { canSpread } from "../../rooms/space.ts";
import type { XY } from "../../../core/types.ts";
import { icon, LightElement } from "../../../ds/ui.ts";

/** What the sheet shows: a gallery scene, or a scene's palette (its gallery picture if it has one). */
export interface PickedScene {
  name: string;
  /** The gallery scene (its picture, its colors unless shuffled). */
  gallery: string | null;
  /** CSS background of the picture. */
  picture: string;
  /** The picture drawn from its colors, while the card is far from the middle. */
  art: string;
  points: XY[];
  /** A white scene. */
  mirek: number | null;
  gradient: boolean;
}

@customElement("hue-studio-scene-pick")
export class ScenePick extends LightElement {
  @property({ attribute: false }) accessor ctx!: StudioContext;
  @property({ attribute: false }) accessor rev = 0;
  /** The scene ("Copy to…"), or with `scenes` the one shown first is `scenes[index]`. */
  @property({ attribute: false }) accessor scene: PickedScene | null = null;
  /** The gallery's scenes in its order: the cards swipe from one to the next (the Hue app's). */
  @property({ attribute: false }) accessor scenes: PickedScene[] = [];
  @property({ type: Number }) accessor index = 0;
  /** The room or zone (group key) it goes to at first. */
  @property() accessor room = "";
  /** Show the room or zone as a row to change it ("Copy to…"); the gallery's is fixed. */
  @property({ type: Boolean }) accessor pickRoom = false;
  /** Show the card in the middle on the room's lights (the gallery's, the Hue app's): put
   *  back as they were when it closes, unless saved or set once (scenes/preview.py). */
  @property({ type: Boolean }) accessor preview = false;

  /** The card in the middle. */
  @state() private accessor current = 0;
  /** Names given with the pencil, by card. */
  @state() private accessor names: Record<number, string> = {};
  @state() private accessor editing: number | null = null;
  /** The colors in a new order (shuffled), by card; none: the scene's own. */
  @state() private accessor orders: Record<number, XY[]> = {};
  @state() private accessor target: string | null = null;
  @state() private accessor picking = false;
  @state() private accessor busy = false;
  /** Going away: the card slides down, the dim fades, then "close". */
  @state() private accessor closing = false;
  private frame = 0;
  private closeTimer?: ReturnType<typeof setTimeout>;
  /** The preview on the lights: its token, whether it started, the card shown on them. */
  private token = "";
  private started: Promise<boolean> | null = null;
  private shownOn: string | null = null;
  private showTimer?: ReturnType<typeof setTimeout>;

  private get list(): PickedScene[] {
    return this.scenes.length ? this.scenes : this.scene ? [this.scene] : [];
  }

  private get track(): HTMLElement | null {
    return this.querySelector<HTMLElement>(".track");
  }

  protected override firstUpdated(): void {
    this.current = Math.min(this.index, this.list.length - 1);
    // Straight to the card tapped, before it comes up.
    const track = this.track;
    if (track && this.current) track.scrollLeft = this.current * this.step(track);
    track?.focus({ preventScroll: true });
    if (this.preview) this.startPreview();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    cancelAnimationFrame(this.frame);
    clearTimeout(this.closeTimer);
    void this.endPreview(false);
  }

  /** Remember what the room's lights show, then show the card in the middle on them. */
  private startPreview(): void {
    const g = this.group;
    if (!g) return;
    this.token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    this.started = this.ctx
      .query({ type: "hue_studio/preview/start", token: this.token, entity_id: g.target }, { quiet: true })
      .then((r) => r !== null);
    this.showSoon(0);
  }

  /** Show the card in the middle once it has settled (a swipe through several shows only
   *  the last; the Hue app's lights follow as a card stops). */
  private showSoon(delay = 350): void {
    if (!this.started) return;
    clearTimeout(this.showTimer);
    this.showTimer = setTimeout(async () => {
      const i = this.current;
      const colors = this.palette(i);
      const key = `${i}:${JSON.stringify(colors)}`;
      if (key === this.shownOn || !(await this.started)) return;
      this.shownOn = key;
      await this.ctx.query({ type: "hue_studio/preview/show", token: this.token, colors }, { quiet: true });
    }, delay);
  }

  /** The card closes: keep what the lights show (saved, set once) or put them back. */
  private async endPreview(keep: boolean): Promise<void> {
    const started = this.started;
    if (!started) return;
    this.started = null;
    clearTimeout(this.showTimer);
    if (await started) await this.ctx.query({ type: "hue_studio/preview/end", token: this.token, keep }, { quiet: true });
  }

  /** From one card to the next: its width and the gap. */
  private step(track: HTMLElement): number {
    const cards = track.querySelectorAll<HTMLElement>(":scope > .box");
    return cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft : track.clientWidth;
  }

  private onScroll = (): void => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      const track = this.track;
      if (!track) return;
      const i = Math.max(0, Math.min(this.list.length - 1, Math.round(track.scrollLeft / this.step(track))));
      if (i === this.current) return;
      this.current = i;
      this.editing = null;
      haptic("selection");
      this.showSoon();
    });
  };

  private go(i: number): void {
    const track = this.track;
    if (track && i >= 0 && i < this.list.length) track.scrollTo({ left: i * this.step(track), behavior: "smooth" });
  }

  private onKey = (e: KeyboardEvent): void => {
    if (this.editing !== null || this.picking) return;
    if (e.key === "ArrowRight") this.go(this.current + 1);
    else if (e.key === "ArrowLeft") this.go(this.current - 1);
    else if (e.key === "Escape") this.close();
    else return;
    e.preventDefault();
  };

  private close(): void {
    if (this.closing) return;
    this.closing = true;
    // Not saved or set once (those keep it first): the lights go back as they were.
    void this.endPreview(false);
    // Gone once the card is down; a timer too, should no animationend come (reduced motion,
    // a page in the background).
    this.closeTimer = setTimeout(() => this.closed(), 400);
  }

  private closed(): void {
    clearTimeout(this.closeTimer);
    if (this.isConnected) this.dispatchEvent(new CustomEvent("close"));
  }

  private onAnimationEnd = (e: AnimationEvent): void => {
    if (this.closing && e.target === this.track) this.closed();
  };

  private get group(): Group | null {
    return findGroup(this.ctx.home, this.target ?? this.room);
  }

  /** The colors to send: the scene's own (or its gallery's), or those in their new order. */
  private colors(i: number): Record<string, unknown> {
    const s = this.list[i];
    const order = this.orders[i];
    if (order) return { points: order.slice(0, 5) };
    if (s.gallery) return { gallery_scene: s.gallery };
    return s.points.length ? { points: s.points.slice(0, 5) } : { mirek: s.mirek ?? 366 };
  }

  /** What apply_palette takes for a card: its colors, laid out by position for a gradient
   *  where the room's lights have places. */
  private palette(i: number): Record<string, unknown> {
    const g = this.group;
    const spatial = !!g && this.list[i].gradient && canSpread(this.ctx.positions, g.lights);
    return { ...this.colors(i), ...(spatial ? { layout: "spatial" } : {}) };
  }

  private async setOnce(): Promise<void> {
    const g = this.group;
    const i = this.current;
    if (!g) return;
    haptic("success");
    if (await this.ctx.call("hue_studio", "apply_palette", { entity_id: g.target, ...this.palette(i) }, { optimistic: false }))
      this.ctx.markManual(g);
    await this.endPreview(true);
    this.close();
  }

  private async save(): Promise<void> {
    const { ctx } = this;
    const g = this.group;
    const i = this.current;
    const s = this.list[i];
    if (!g || this.busy) return;
    this.busy = true;
    const group = await ctx.hueGroupOf(g);
    const name = (this.names[i] ?? s.name).trim() || s.name;
    // Shuffled: the colors in their order, the gallery picture kept.
    const colors = { ...this.colors(i), ...(this.orders[i] && s.gallery ? { gallery_scene: s.gallery } : {}) };
    const ok = !!group && (await ctx.call("hue_studio", "create_scene", { entity_id: group, name, ...colors }, { optimistic: false }));
    this.busy = false;
    if (!ok) return;
    haptic("success");
    ctx.toast(ctx.t("gallery.saved", { name: g.name }));
    await this.endPreview(true);
    this.close();
  }

  private shuffle(i: number): void {
    haptic("selection");
    const points = [...(this.orders[i] ?? this.list[i].points)];
    for (let j = points.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [points[j], points[k]] = [points[k], points[j]];
    }
    this.orders = { ...this.orders, [i]: points };
    this.showSoon(0);
  }

  protected override render() {
    const list = this.list;
    const scrim = (e: Event) => e.target === e.currentTarget && this.close();
    return html`<div class=${classMap({ sheet: true, "scene-pick": true, closing: this.closing })} @click=${scrim}>
        <div class="track" tabindex="-1" @scroll=${this.onScroll} @keydown=${this.onKey} @click=${scrim} @animationend=${this.onAnimationEnd}>
          ${repeat(list, (_, i) => i, (s, i) => this.card(s, i))}
        </div>
      </div>
      ${this.picking ? this.picker() : nothing}`;
  }

  /** One scene's card; a card beside the middle one only brings itself to the middle. */
  private card(s: PickedScene, i: number) {
    const { ctx } = this;
    const { t } = ctx;
    const g = this.group;
    const name = this.names[i] ?? s.name;
    const order = this.orders[i];
    const near = Math.abs(i - this.current) <= 2;
    const dots = order
      ? paletteColors({ kind: "gradient", points: order })
      : s.points.length
        ? paletteColors({ kind: "gradient", points: s.points })
        : paletteColors({ kind: "white", mirek: s.mirek ?? 366 });
    const done = (e: Event) => {
      this.editing = null;
      this.names = { ...this.names, [i]: (e.target as HTMLInputElement).value };
    };
    const side = i !== this.current;
    return html`<div class=${classMap({ box: true, side })} role="dialog" aria-label=${name} aria-hidden=${side ? "true" : "false"}
        @click=${(e: Event) => {
          if (!side) return;
          e.stopPropagation();
          this.go(i);
        }}>
        <div class="pic" style=${styleMap({ background: near ? s.picture : s.art })}>
          ${this.editing === i
            ? html`<input class="name-input" .value=${name} aria-label=${t("scene.rename")}
                @keydown=${(e: KeyboardEvent) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} @blur=${done} />`
            : html`<h3>${name}</h3>`}
          <button class="round close" aria-label=${t("common.close")} @click=${() => this.close()}>${icon("close")}</button>
        </div>
        <div class="dots">
          ${dots.map((c) => html`<i style=${styleMap({ background: c })}></i>`)}
          ${s.points.length > 1 ? html`<button class="round shuffle" aria-label=${t("scene.shuffle_colors")} @click=${() => this.shuffle(i)}>${icon("shuffle")}</button>` : nothing}
          <button class="round rename" aria-label=${t("scene.rename")} @click=${() => {
            this.editing = i;
            void this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".box:not(.side) .name-input")?.focus());
          }}>${icon("pencil")}</button>
        </div>
        ${this.pickRoom
          ? html`<h2 class="label">${t("gallery.room_or_zone")}</h2>
              <button class="target-row" @click=${() => {
                haptic("selection");
                this.picking = true;
              }}>
                <ha-icon icon=${g?.icon || "mdi:sofa-outline"}></ha-icon><span>${g?.name ?? t("gallery.pick_room")}</span>
              </button>`
          : nothing}
        <div class="actions">
          <button class="pill outline" ?disabled=${!g || this.busy} @click=${() => this.save()}>${t("gallery.save_mine")}</button>
          <button class="pill" ?disabled=${!g} @click=${() => this.setOnce()}>${t("gallery.set_once")}</button>
        </div>
      </div>`;
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
export const galleryPick = (scene: { id: string; name: string; kind: string; points?: XY[]; mirek?: number }, picture: string, art: string): PickedScene => ({
  name: scene.name,
  gallery: scene.id,
  picture,
  art,
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
