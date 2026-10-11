// Arrange lights (room → Arrange, or an entertainment area in Settings): a top view with the lights as draggable
// dots (a gradient strip as its two ends) and a height for the selected light. Lights of
// the room's entertainment area are saved to the bridge, so the Hue app and sync use the
// same places; the others are kept by Hue Studio. Spatial palettes use these positions.

import { html, nothing, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import { findGroup, friendlyName, lightColors, lightIcon } from "../model.ts";
import { fromView, isUpright, movePoints, newPoint, roundPoint, setHeight, toView } from "../space.ts";
import type { AreaPositions, EntertainmentArea, EntertainmentMessage, RoomPoint } from "../types.ts";
import { icon } from "../ui.ts";
import { StudioView } from "./base.ts";

@customElement("hue-studio-space-view")
export class SpaceView extends StudioView {
  @property() accessor key = "";
  /** Arrange an entertainment area (its id) instead of a room. */
  @property() accessor entertainment: string | null = null;
  @state() private accessor areas: EntertainmentMessage | null = null;
  private stop?: () => void;
  /** Moved lights, not saved yet (entity id -> points). */
  @state() private accessor draft: Record<string, RoomPoint[]> = {};
  @state() private accessor selected: string | null = null;
  @state() private accessor busy = false;

  private drag: { light: string; index: number; rect: DOMRect } | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.entertainment) this.stop = this.ctx.watch<EntertainmentMessage>("hue_studio/entertainment/subscribe", (m) => (this.areas = m));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop?.();
  }

  private get entArea(): EntertainmentArea | undefined {
    return Object.values(this.areas || {})
      .flatMap((b) => b.areas)
      .find((a) => a.id === this.entertainment);
  }

  /** The lights and their places: a room's (from its entertainment area or the Store), or an entertainment area's. */
  private get area(): AreaPositions | undefined {
    if (this.entertainment) {
      const e = this.entArea;
      if (!e) return undefined;
      const lights = Object.fromEntries(Object.entries(e.lights).map(([id, positions]) => [id, { positions, source: "bridge" as const }]));
      return { lights, configuration: { id: e.id, name: e.name, streaming: e.streaming } };
    }
    const key = this.key;
    return key.startsWith("area.") ? this.ctx.positions?.[key.slice("area.".length)] : undefined;
  }

  private points(light: string): RoomPoint[] {
    return this.draft[light] ?? this.area?.lights[light]?.positions ?? [];
  }

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const ent = this.entertainment;
    const group = ent ? null : findGroup(ctx.home, this.key);
    const name = ent ? this.entArea?.name : group?.name;
    const back = () => ctx.go(ent ? `/settings/entertainment/${encodeURIComponent(ent)}` : `/room/${encodeURIComponent(this.key)}`);
    const bar = this.subHead(name ? `${t("space.title")} · ${name}` : t("space.title"), back);
    const area = this.area;
    const loaded = ent ? this.areas : ctx.positions;
    if ((!group && !ent) || !area) {
      return this.screen(bar, html`<p class="empty">${t(loaded ? "space.no_area" : "rooms.loading")}</p>`);
    }
    const lights = ent ? Object.keys(area.lights) : group!.lights.filter((id) => area.lights[id]);
    const placed = lights.filter((id) => this.points(id).length);
    const loose = lights.filter((id) => !this.points(id).length);
    const streaming = !!area.configuration?.streaming;
    const changed = Object.keys(this.draft).length > 0;
    const sel = this.selected && placed.includes(this.selected) ? this.selected : null;
    return this.screen(
      bar,
      html`<p class="lead">${t("space.intro")}</p>
      ${ent
        ? nothing
        : area.configuration
          ? html`<p class="lead small">${t("space.from_area", { name: area.configuration.name })}</p>`
          : html`<p class="lead small">${t("space.no_entertainment")}</p>`}
      ${streaming ? html`<p class="sync-note">${icon("sync")}<span>${t("space.streaming", { name: area.configuration!.name })}</span></p>` : nothing}
      <div class="edge-label">${t("space.front")}</div>
      <div class=${classMap({ room: true, locked: streaming })} @pointermove=${this.onMove} @pointerup=${this.onUp} @pointercancel=${this.onUp}>
        <svg class="links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          ${placed
            .filter((id) => this.points(id).length > 1 && !isUpright(this.points(id)))
            .map((id) => {
              const [a, b] = this.points(id).map(toView);
              return svg`<line x1=${a.left} y1=${a.top} x2=${b.left} y2=${b.top}></line>`;
            })}
        </svg>
        ${placed.flatMap((id) =>
          // An upright lamp (ends one above the other) is one spot from above.
          (isUpright(this.points(id)) ? this.points(id).slice(0, 1) : this.points(id)).map((p, index) => {
            const view = toView(p);
            const color = lightColors(ctx.hass, id, ctx.lightInfo[id])[index] || "rgb(90,90,94)";
            return html`<button
              class=${classMap({ spot: true, on: id === sel })}
              style=${styleMap({ left: `${view.left}%`, top: `${view.top}%`, "--pin": color })}
              aria-label=${friendlyName(ctx.hass, id)}
              @pointerdown=${(e: PointerEvent) => this.onDown(e, id, index)}
            >
              <ha-icon icon=${lightIcon(ctx.hass, id, ctx.lightInfo[id])}></ha-icon>
            </button>`;
          }),
        )}
      </div>
      <div class="edge-label">${t("space.back")}</div>
      ${sel ? this.heightRow(sel, streaming) : html`<p class="lead small center-text">${t("space.select_hint")}</p>`}
      ${loose.length
        ? html`<h2 class="label">${t("space.not_placed")}</h2>
            <div class="rows">
              ${loose.map(
                (id) => html`<button class="item" ?disabled=${streaming} @click=${() => this.place(id, placed.length)}>
                  <ha-icon icon=${lightIcon(ctx.hass, id, ctx.lightInfo[id])}></ha-icon>
                  <div class="grow">${friendlyName(ctx.hass, id)}</div>
                  <span class="dim">${t("space.place")}</span>
                </button>`,
              )}
            </div>`
        : nothing}
      <div class="center stack">
        <button class="pill go" ?disabled=${!changed || this.busy || streaming} @click=${() => this.save()}>${t("space.save")}</button>
        ${changed ? html`<button class="pill" @click=${() => (this.draft = {})}>${t("space.discard")}</button>` : nothing}
      </div>`,
      "space-page",
    );
  }

  /** The selected light: its name, where its positions are saved, its height. */
  private heightRow(id: string, streaming: boolean) {
    const { ctx } = this;
    const { t } = ctx;
    const points = this.points(id);
    const z = points[0]?.[2] ?? 0;
    const source = this.area?.lights[id]?.source;
    const setZ = (value: number) => this.setPoints(id, setHeight(points, value));
    return html`<div class="rows height">
      <div class="item col">
        <div class="line"><span>${friendlyName(ctx.hass, id)}</span>
          <span class="dim">${t(source === "bridge" ? "space.saved_bridge" : "space.saved_studio")}</span></div>
        <div class="line height-line">
          <span class="dim">${t("space.floor")}</span>
          <input type="range" min="-1" max="1" step="0.05" .value=${String(z)} ?disabled=${streaming}
            aria-label=${t("space.height")} @input=${(e: Event) => setZ(Number((e.target as HTMLInputElement).value))} />
          <span class="dim">${t("space.ceiling")}</span>
        </div>
      </div>
    </div>`;
  }

  private setPoints(id: string, points: RoomPoint[]): void {
    this.draft = { ...this.draft, [id]: points.map(roundPoint) };
  }

  private place(id: string, placed: number): void {
    const info = this.ctx.lightInfo[id];
    const point = newPoint(placed);
    // A gradient strip gets two ends, like entertainment areas keep them.
    const points: RoomPoint[] = info?.gradient ? [point, [Math.min(1, point[0] + 0.4), point[1], point[2]]] : [point];
    this.setPoints(id, points);
    this.selected = id;
  }

  private onDown(e: PointerEvent, light: string, index: number): void {
    this.selected = light;
    if (this.area?.configuration?.streaming) return;
    const room = this.querySelector<HTMLElement>(".room");
    if (!room) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.drag = { light, index, rect: room.getBoundingClientRect() };
    e.preventDefault();
  }

  private onMove = (e: PointerEvent): void => {
    const drag = this.drag;
    if (!drag) return;
    const [x, y] = fromView((e.clientX - drag.rect.left) / drag.rect.width, (e.clientY - drag.rect.top) / drag.rect.height);
    this.setPoints(drag.light, movePoints(this.points(drag.light), drag.index, x, y));
  };

  private onUp = (): void => {
    this.drag = null;
  };

  private async save(): Promise<void> {
    this.busy = true;
    const ok = this.entertainment
      ? await this.ctx.ws({ type: "hue_studio/entertainment/positions", area_id: this.entertainment, positions: this.draft })
      : await this.ctx.ws({ type: "hue_studio/positions/set", area_id: this.key.slice("area.".length), positions: this.draft });
    this.busy = false;
    if (ok) {
      this.draft = {};
      this.ctx.toast(this.ctx.t("space.saved"));
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-space-view": SpaceView;
  }
}
