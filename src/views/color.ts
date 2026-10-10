// Color wheel. Every light gets as many pins as it currently shows colors: gradient lights
// one per gradient point (2..points_capable, from the bridge), others one. The points of a
// gradient light can be merged into one color or split again, and all lights of the group
// can be merged into one pin (like the Hue app's link button) and split back.
// Pins are clipped to each light's gamut; commands are throttled to the bridge limits.

import { html, nothing, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";

import {
  clipToGamut,
  mirekToRgb,
  mirekToWheelY,
  resample,
  rgbCss,
  WHEEL_CSS,
  WHITE_CSS,
  wheelToRgb,
  wheelToXy,
  wheelYToMirek,
  xyToWheel,
} from "../color.ts";
import { commandInterval, groupSlider } from "../controls.ts";
import { friendlyName, type Group, groupState, lightColors } from "../model.ts";
import type { HassState, XY } from "../types.ts";
import { icon } from "../ui.ts";
import { StudioView } from "./base.ts";

const COLOR_MODES = ["xy", "hs", "rgb", "rgbw", "rgbww"];
const supportsColor = (s?: HassState) => !!s?.attributes.supported_color_modes?.some((m: string) => COLOR_MODES.includes(m));
const supportsWhite = (s?: HassState) => !!s?.attributes.supported_color_modes?.includes("color_temp");
// ~10 commands/s per light at most; gradients carry more data, keep them slower.
const LIGHT_INTERVAL = 120;
const GRADIENT_INTERVAL = 250;
// After a local change, ignore HA/bridge state for a moment so pins don't jump back.
const HOLD_MS = 2500;
const ALL = "*";
const SENDER = "color:";

const pct = (v: number) => `${((v + 1) / 2) * 100}%`;
const LINK_ICON = svg`<svg viewBox="0 0 24 24"><circle cx="6" cy="10" r="3"/><circle cx="12" cy="10" r="3"/><circle cx="18" cy="10" r="3"/><rect x="4" y="16" width="16" height="2" rx="1"/></svg>`;

type Mode = "color" | "white";

/** A pin on the wheel; `id` is ALL for the merged pin, `index` a gradient point or -1. */
interface Pin {
  key: string;
  id: string;
  index: number;
  pos: XY;
}

interface Held {
  points?: XY[];
  mirek?: number;
  until: number;
}

@customElement("hue-studio-color-view")
export class ColorView extends StudioView {
  /** The room, zone, Hue group or single light (as a one-light group) to edit. */
  @property({ attribute: false }) accessor group: Group | null = null;
  /** Light to select first (opened from a light tile). */
  @property() accessor focusLight: string | null = null;
  /** Inside the more-info dialog: no top bar. */
  @property({ type: Boolean }) accessor embedded = false;

  @state() private accessor mode: Mode | null = null;
  @state() private accessor merged = false;
  @state() private accessor selected: string | null = null;
  /** Position of a pin while it is dragged (it follows the finger, not the state). */
  @state() private accessor dragging: { key: string; pos: XY } | null = null;
  /** Local edits per light, shown instead of HA state until `until`. */
  private local = new Map<string, Held>();

  @state() private accessor dragBrightness: number | null = null;

  protected override willUpdate(): void {
    // Picked once, like the Hue app: the mode stays while lights change under it.
    if (this.mode === null && this.group && this.ctx.ready) {
      this.mode = this.initialMode();
      this.selected = this.focusLight;
    }
  }

  private get colorLights(): string[] {
    return this.group?.lights.filter((id) => supportsColor(this.ctx.hass.states[id])) ?? [];
  }

  private get whiteLights(): string[] {
    return this.group?.lights.filter((id) => supportsWhite(this.ctx.hass.states[id])) ?? [];
  }

  private get currentMode(): Mode {
    return this.mode ?? this.initialMode();
  }

  /** What the focused (or first lit) light shows now. */
  private initialMode(): Mode {
    const { hass } = this.ctx;
    const ref = (this.focusLight && hass.states[this.focusLight]) || this.group?.lights.map((id) => hass.states[id]).find((s) => s?.state === "on");
    return !this.colorLights.length || ref?.attributes.color_mode === "color_temp" ? "white" : "color";
  }

  // ---------- what the pins should show ----------

  private held(id: string): Held | null {
    const local = this.local.get(id);
    return local && local.until > Date.now() ? local : null;
  }

  /** Current color points (xy) of a light: local edit, bridge gradient, or HA's xy. */
  private points(id: string): XY[] | null {
    const held = this.held(id);
    if (held?.points) return held.points;
    const gradient = this.ctx.lightInfo[id]?.gradient?.points;
    if (gradient && gradient.length > 1) return gradient;
    const xy = this.ctx.hass.states[id]?.attributes.xy_color as XY | undefined;
    return xy ? [xy] : null;
  }

  private mirek(id: string): number {
    const held = this.held(id);
    if (held?.mirek) return held.mirek;
    const k = this.ctx.hass.states[id]?.attributes.color_temp_kelvin;
    return k ? 1e6 / k : 300;
  }

  private lights(): string[] {
    return this.currentMode === "color" ? this.colorLights : this.whiteLights;
  }

  private pins(): Pin[] {
    const lights = this.lights();
    if (!lights.length) return [];
    if (this.merged) {
      const ref = lights.find((id) => this.ctx.hass.states[id]?.state === "on") || lights[0];
      return [{ key: ALL, id: ALL, index: -1, pos: this.posOf(ref, 0, 0) }];
    }
    return lights.flatMap((id, order) => {
      if (this.currentMode === "white") return [{ key: `${id}#0`, id, index: -1, pos: this.posOf(id, 0, order) }];
      const count = this.points(id)?.length || 1;
      return Array.from({ length: count }, (_, i) => ({ key: `${id}#${i}`, id, index: count > 1 ? i : -1, pos: this.posOf(id, i, order) }));
    });
  }

  private posOf(id: string, index: number, order: number): XY {
    const spreadX = (order - (this.lights().length - 1) / 2) * 0.2;
    if (this.currentMode === "white") return [Math.max(-0.6, Math.min(0.6, spreadX)), mirekToWheelY(this.mirek(id))];
    const p = this.points(id)?.[index];
    return p ? xyToWheel(...p) : [spreadX, -0.45];
  }

  // ---------- render ----------

  protected override render() {
    const { ctx, group } = this;
    const { t } = ctx;
    this.className = this.embedded ? "colorbody" : "page";
    if (!group) return html`<p class="empty">${t("room.not_found")}</p>`;

    const mode = this.currentMode;
    const several = group.lights.length > 1;
    const pins = this.pins();
    const state = groupState(ctx.hass, group, ctx.lightInfo);
    const back = () => ctx.go(`/room/${encodeURIComponent(group.key)}`);

    return html`
      ${this.embedded
        ? nothing
        : html`<div class="topbar">
            <button class="round back" aria-label=${t("common.back")} @click=${back}>${icon("back")}</button>
            <div class="grow" style="font-size:17px;font-weight:600">${group.name}</div>
            <button class="pill done" @click=${back}>${t("color.done")}</button>
          </div>`}
      <div class="wheel-wrap">
        <div class="wheel ${mode}" style="--wheel-color:${WHEEL_CSS};--wheel-white:${WHITE_CSS}">
          ${repeat(pins, (p) => p.key, (p) => this.pin(p, mode))}
          ${pins.length ? nothing : html`<p class="empty" style="text-align:center;padding:40% 12%">${t("color.no_color")}</p>`}
        </div>
      </div>
      <div class="controls">
        <div class="modes">
          ${this.colorLights.length ? this.modeButton("color", "m-color", t("color.mode_color")) : nothing}
          ${this.whiteLights.length ? this.modeButton("white", "m-white", t("color.mode_white")) : nothing}
        </div>
        ${several
          ? html`<button
              class=${classMap({ link: true, on: this.merged })}
              aria-label=${t("color.merge_lights")}
              title=${t("color.merge_lights")}
              @click=${() => (this.merged = !this.merged)}
            >${LINK_ICON}</button>`
          : nothing}
        <div
          class=${classMap({ bright: true, off: !state.on })}
          @value-input=${(e: CustomEvent<number>) => (this.dragBrightness = e.detail)}
          @value-change=${() => (this.dragBrightness = null)}
        >
          <div class="value">${this.dragBrightness !== null ? `${this.dragBrightness}%` : state.on ? `${state.brightness}%` : ""}</div>
          ${groupSlider(ctx, group, state, t("common.brightness"))}
        </div>
      </div>
      ${this.pointsSelector()}
      ${several
        ? html`<div class="chips">${group.lights.map((id) => {
            const colors = lightColors(ctx.hass, id, ctx.lightInfo[id]);
            return html`<button
              class=${classMap({ chip: true, on: id === this.selected })}
              @click=${() => (this.selected = this.selected === id ? null : id)}
            ><span class="swatch" style=${styleMap({ "--swatch": colors[0] || "#555" })}></span>${friendlyName(ctx.hass, id)}</button>`;
          })}</div>`
        : nothing}
    `;
  }

  private modeButton(mode: Mode, cls: string, label: string) {
    return html`<button class=${classMap({ [cls]: true, on: this.currentMode === mode })} aria-label=${label} @click=${() => (this.mode = mode)}></button>`;
  }

  private pin(p: Pin, mode: Mode) {
    const lights = p.id === ALL ? this.lights() : [p.id];
    const drag = this.dragging?.key === p.key ? this.dragging : null;
    const [x, y] = drag?.pos ?? p.pos;
    const rgb = mode === "white" ? mirekToRgb(wheelYToMirek(y)) : wheelToRgb(x, y);
    return html`<div
      class=${classMap({
        pin: true,
        merged: p.id === ALL,
        dragging: !!drag,
        selected: p.id === this.selected,
        off: !lights.some((id) => this.ctx.hass.states[id]?.state === "on"),
      })}
      style=${styleMap({ left: pct(x), top: pct(y), "--pin": rgbCss(rgb) })}
      @pointerdown=${(e: PointerEvent) => this.onPinDown(e, p)}
      @pointermove=${(e: PointerEvent) => this.dragging?.key === p.key && this.drag(p, this.wheelPos(e))}
      @pointerup=${(e: PointerEvent) => this.onPinUp(e, p)}
      @pointercancel=${(e: PointerEvent) => this.onPinUp(e, p)}
    ><span>${p.index >= 0 ? p.index + 1 : ""}</span></div>`;
  }

  // ---------- dragging ----------

  /** Pointer position on the wheel ([-1, 1] each, clamped to the disc). */
  private wheelPos(e: PointerEvent): XY {
    const r = this.querySelector(".wheel")!.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width) * 2 - 1;
    let y = ((e.clientY - r.top) / r.height) * 2 - 1;
    const len = Math.hypot(x, y);
    if (len > 1) [x, y] = [x / len, y / len];
    return [x, y];
  }

  private onPinDown(e: PointerEvent, p: Pin): void {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.dragging = { key: p.key, pos: p.pos };
    if (p.id !== ALL) this.selected = p.id;
  }

  private onPinUp(e: PointerEvent, p: Pin): void {
    if (this.dragging?.key !== p.key) return;
    this.drag(p, this.wheelPos(e));
    this.dragging = null;
    this.ctx.flushSenders(SENDER);
  }

  private hold(id: string, value: Omit<Held, "until">): void {
    this.local.set(id, { ...value, until: Date.now() + HOLD_MS });
  }

  private send<A extends unknown[]>(key: string, interval: number, fn: (...args: A) => void, ...args: A): void {
    this.ctx.sender(`${SENDER}${key}`, interval, fn)(...args);
  }

  private drag(p: Pin, raw: XY): void {
    const { ctx, group } = this;
    if (!group) return;
    const lights = p.id === ALL ? this.lights() : [p.id];
    const info = ctx.lightInfo[lights[0]];

    if (this.currentMode === "white") {
      const [lo, hi] = info?.mirek || [153, 500];
      const mirek = Math.min(hi, Math.max(lo, wheelYToMirek(raw[1])));
      this.dragging = { key: p.key, pos: [raw[0], mirekToWheelY(mirek)] };
      lights.forEach((id) => this.hold(id, { mirek }));
      const target = p.id === ALL ? group.target : [p.id];
      const interval = p.id === ALL ? commandInterval(group) : LIGHT_INTERVAL;
      this.send(`ct:${p.key}`, interval, (m: number) => ctx.call("light", "turn_on", { entity_id: target, color_temp_kelvin: Math.round(1e6 / m) }), mirek);
      return;
    }

    const xy = wheelToXy(...raw);
    const clipped = clipToGamut(xy, info?.gamut);
    this.dragging = { key: p.key, pos: clipped === xy ? raw : xyToWheel(...clipped) };

    if (p.id === ALL) {
      // One color for every light of the group: gradients collapse into it too.
      lights.forEach((id) => this.hold(id, { points: [clipped] }));
      this.send(`xy:${ALL}`, commandInterval(group), (c: XY) => ctx.call("light", "turn_on", { entity_id: group.target, xy_color: c }), clipped);
    } else if (p.index >= 0) {
      const points = [...(this.points(p.id) ?? [])];
      points[p.index] = clipped;
      this.hold(p.id, { points });
      this.send(`grad:${p.id}`, GRADIENT_INTERVAL, (pts: XY[]) => ctx.call("hue_studio", "set_gradient", { entity_id: p.id, points: pts }), points);
    } else {
      this.hold(p.id, { points: [clipped] });
      this.send(`xy:${p.id}`, LIGHT_INTERVAL, (c: XY) => ctx.call("light", "turn_on", { entity_id: p.id, xy_color: c }), clipped);
    }
  }

  // ---------- gradient point count (merge / split one light) ----------

  /** The gradient light whose point count the selector edits. */
  private pointsLight(): string | null {
    if (this.currentMode !== "color" || this.merged) return null;
    const capable = (id: string) => (this.ctx.lightInfo[id]?.gradient?.points_capable || 0) > 1;
    if (this.selected && capable(this.selected)) return this.selected;
    const gradients = this.colorLights.filter(capable);
    return gradients.length === 1 ? gradients[0] : null;
  }

  private pointsSelector() {
    const id = this.pointsLight();
    if (!id) return nothing;
    const capable = this.ctx.lightInfo[id].gradient!.points_capable;
    const count = this.points(id)?.length || 1;
    return html`<div class="points">
      <span>${this.ctx.t("color.points")}</span>
      ${Array.from({ length: capable }, (_, i) => html`<button class=${i + 1 === count ? "on" : ""} @click=${() => this.setPointCount(id, i + 1)}>${i + 1}</button>`)}
    </div>`;
  }

  private setPointCount(id: string, n: number): void {
    const current = this.points(id) || [[0.4573, 0.41]];
    const points = resample(current, n);
    this.hold(id, { points });
    if (n === 1) this.ctx.call("light", "turn_on", { entity_id: id, xy_color: points[0] });
    else this.ctx.call("hue_studio", "set_gradient", { entity_id: id, points });
    this.requestUpdate();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-color-view": ColorView;
  }
}
