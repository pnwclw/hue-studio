// Color wheel, like the Hue app. Every light has a fixed number of pins: a gradient light
// one per color point it can show (`points_capable` from the bridge), joined by the path
// its gradient blends along; any other light one. A uniform gradient light has its pins
// stacked until they are dragged apart. All lights of the group can be merged into one
// pin (the Hue app's link button) and split back. Gradient lights also pick how their
// colors are laid out (smooth, mirrored, scattered, segments). A third mode lists light
// effects.
// Pins are clipped to each light's gamut; commands are throttled to the bridge limits.

import { html, nothing, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";

import {
  clipToGamut,
  gradientPath,
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
import { availableEffects } from "../effects.ts";
import { leavePanel } from "../ha-internals.ts";
import { friendlyName, type Group, groupState, lightColors, lightIcon } from "../model.ts";
import type { HassState, XY } from "../types.ts";
import type { StringKey } from "../i18n.ts";
import { icon } from "../ui.ts";
import { StudioView } from "./base.ts";
import "./effects.ts";

const COLOR_MODES = ["xy", "hs", "rgb", "rgbw", "rgbww"];
const supportsColor = (s?: HassState) => !!s?.attributes.supported_color_modes?.some((m: string) => COLOR_MODES.includes(m));
const supportsWhite = (s?: HassState) => !!s?.attributes.supported_color_modes?.includes("color_temp");
// ~10 commands/s per light at most; gradients carry more data, keep them slower.
const LIGHT_INTERVAL = 120;
const GRADIENT_INTERVAL = 250;
// After a local change, ignore HA/bridge state for a moment so pins don't jump back.
const HOLD_MS = 2500;
const ALL = "*";
/** Gradient layouts in the order they are offered (CLIP v2 `gradient.mode`). */
const GRADIENT_MODES = ["interpolated_palette", "interpolated_palette_mirrored", "random_pixelated", "segmented_palette"];
const SENDER = "color:";

const pct = (v: number) => `${((v + 1) / 2) * 100}%`;
const LINK_ICON = svg`<svg viewBox="0 0 24 24"><circle cx="6" cy="10" r="3"/><circle cx="12" cy="10" r="3"/><circle cx="18" cy="10" r="3"/><rect x="4" y="16" width="16" height="2" rx="1"/></svg>`;

type Mode = "color" | "white" | "effects";

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
  mode?: string;
  until: number;
}

@customElement("hue-studio-color-view")
export class ColorView extends StudioView {
  /** The room, zone, Hue group or single light (as a one-light group) to edit. */
  @property({ attribute: false }) accessor group: Group | null = null;
  /** Light to select first (opened from a light tile). */
  @property() accessor focusLight: string | null = null;
  /** Where "Done" goes (default: the room). */
  @property() accessor backPath: string | null = null;
  /** Where "Done" leaves the panel for (a page outside it, e.g. the dashboard the dialog was on). */
  @property() accessor exitPath: string | null = null;
  /** Inside the more-info dialog: no top bar, the body scrolls above a fixed dock. */
  @property({ type: Boolean }) accessor embedded = false;
  /** Inside the dialog: buttons shown in the dock in place of the brightness slider (the dialog head has one). */
  @property({ attribute: false }) accessor actions: unknown = null;

  @state() private accessor mode: Mode | null = null;
  @state() private accessor merged = false;
  @state() private accessor selected: string | null = null;
  /** Position of a pin while it is dragged (it follows the finger, not the state). */
  @state() private accessor dragging: { key: string; pos: XY } | null = null;
  /** Local edits per light, shown instead of HA state until `until`. */
  private local = new Map<string, Held>();
  /** White pins only use their height; where they were dropped sideways (pin key -> x). */
  private whiteX = new Map<string, number>();

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
    const { hass, lightInfo } = this.ctx;
    const ids = this.focusLight ? [this.focusLight] : (this.group?.lights ?? []);
    if (ids.some((id) => hass.states[id]?.state === "on" && lightInfo[id]?.effect)) return "effects";
    const ref = (this.focusLight && hass.states[this.focusLight]) || this.group?.lights.map((id) => hass.states[id]).find((s) => s?.state === "on");
    return !this.colorLights.length || ref?.attributes.color_mode === "color_temp" ? "white" : "color";
  }

  // ---------- what the pins should show ----------

  private held(id: string): Held | null {
    const local = this.local.get(id);
    return local && local.until > Date.now() ? local : null;
  }

  /** Number of color pins of a light: its gradient points, else one. */
  private capable(id: string): number {
    const n = this.ctx.lightInfo[id]?.gradient?.points_capable || 0;
    return n >= 2 ? n : 1;
  }

  /** Current colors (xy) of a light, always `capable(id)` of them. */
  private points(id: string): XY[] | null {
    const held = this.held(id);
    if (held?.points) return held.points;
    const state = this.ctx.hass.states[id];
    const gradient = this.ctx.lightInfo[id]?.gradient?.points;
    const xy = state?.attributes.xy_color as XY | undefined;
    const current = gradient && gradient.length > 1 && state?.attributes.color_mode !== "color_temp" ? gradient : xy ? [xy] : null;
    return current && resample(current, this.capable(id));
  }

  private mirek(id: string): number {
    const held = this.held(id);
    if (held?.mirek) return held.mirek;
    const k = this.ctx.hass.states[id]?.attributes.color_temp_kelvin;
    return k ? 1e6 / k : 300;
  }

  private lights(): string[] {
    return this.currentMode === "white" ? this.whiteLights : this.colorLights;
  }

  private pins(): Pin[] {
    const lights = this.lights();
    if (!lights.length) return [];
    if (this.merged) {
      const ref = lights.find((id) => this.ctx.hass.states[id]?.state === "on") || lights[0];
      return [{ key: ALL, id: ALL, index: -1, pos: this.posOf(ref, 0, 0, ALL) }];
    }
    return lights.flatMap((id, order) => {
      if (this.currentMode === "white") return [{ key: `${id}#0`, id, index: -1, pos: this.posOf(id, 0, order) }];
      const count = this.capable(id);
      return Array.from({ length: count }, (_, i) => ({ key: `${id}#${i}`, id, index: count > 1 ? i : -1, pos: this.posOf(id, i, order) }));
    });
  }

  private posOf(id: string, index: number, order: number, key = `${id}#0`): XY {
    const spreadX = (order - (this.lights().length - 1) / 2) * 0.2;
    if (this.currentMode === "white") {
      const y = mirekToWheelY(this.mirek(id));
      const x = this.whiteX.get(key) ?? Math.max(-0.6, Math.min(0.6, spreadX));
      // Keep the pin on the disc when its height changes.
      const edge = Math.sqrt(Math.max(0, 1 - y * y)) * 0.92;
      return [Math.max(-edge, Math.min(edge, x)), y];
    }
    const p = this.points(id)?.[index];
    return p ? xyToWheel(...p) : [spreadX, -0.45];
  }

  // ---------- render ----------

  protected override render() {
    const { ctx, group } = this;
    const { t } = ctx;
    this.className = this.embedded ? "colorbody" : "";
    if (!group) return html`<p class="empty">${t("room.not_found")}</p>`;

    const mode = this.currentMode;
    const several = group.lights.length > 1;
    const state = groupState(ctx.hass, group, ctx.lightInfo);
    const back = () => (this.exitPath ? leavePanel(this.exitPath) : ctx.go(this.backPath ?? `/room/${encodeURIComponent(group.key)}`));
    const effects = availableEffects(group.lights, ctx.lightInfo).length > 0;

    const main = mode === "effects" ? this.effectsBody(group) : this.wheel(mode);
    const content = html`
      ${this.embedded ? html`<div class="cv-scroll">${main}</div>` : main}
      <div class="dock">
        ${mode === "color" ? this.gradientModes() : nothing}
        <div class="controls">
          <div class="modes">
            ${this.colorLights.length ? this.modeButton("color", "m-color", t("color.mode_color")) : nothing}
            ${this.whiteLights.length ? this.modeButton("white", "m-white", t("color.mode_white")) : nothing}
            ${effects
              ? html`<span class="sep"></span>${this.modeButton("effects", "m-effects", t("color.mode_effects"), icon("effects"))}`
              : nothing}
          </div>
          ${several && mode !== "effects"
            ? html`<button
                class=${classMap({ link: true, on: this.merged })}
                aria-label=${t("color.merge_lights")}
                title=${t("color.merge_lights")}
                @click=${() => (this.merged = !this.merged)}
              >${LINK_ICON}</button>`
            : nothing}
          ${this.embedded
            ? html`<div class="cv-actions">${this.actions}</div>`
            : html`<div
            class=${classMap({ bright: true, off: !state.on })}
            @value-input=${(e: CustomEvent<number>) => (this.dragBrightness = e.detail)}
            @value-change=${() => (this.dragBrightness = null)}
          >
            <div class="value">${this.dragBrightness !== null ? `${this.dragBrightness}%` : state.on ? `${state.brightness}%` : ""}</div>
            ${groupSlider(ctx, group, state, t("common.brightness"))}
          </div>`}
        </div>
        ${several
          ? html`<div class="chips">${group.lights.map((id) => {
              const colors = lightColors(ctx.hass, id, ctx.lightInfo[id]);
              return html`<button
                class=${classMap({ chip: true, on: id === this.selected })}
                @click=${() => (this.selected = this.selected === id ? null : id)}
              ><span class="swatch" style=${styleMap({ "--swatch": colors[0] || "#555" })}></span>${friendlyName(ctx.hass, id)}</button>`;
            })}</div>`
          : nothing}
      </div>
    `;
    if (this.embedded) return content;
    return this.screen(this.subHead(group.name, back, html`<button class="pill done" @click=${back}>${t("color.done")}</button>`), content);
  }

  private wheel(mode: Mode) {
    const pins = this.pins();
    return html`<div class="wheel-wrap">
      <div class="wheel ${mode}" style="--wheel-color:${WHEEL_CSS};--wheel-white:${WHITE_CSS}">
        ${mode === "color" && !this.merged ? this.paths() : nothing}
        ${repeat(pins, (p) => p.key, (p) => this.pin(p, mode))}
        ${pins.length ? nothing : html`<p class="empty" style="text-align:center;padding:40% 12%">${this.ctx.t("color.no_color")}</p>`}
      </div>
    </div>`;
  }

  /** Lines joining the pins of each gradient light. */
  private paths() {
    const gradients = this.colorLights.filter((id) => this.capable(id) > 1);
    return svg`<svg class="paths" viewBox="-1 -1 2 2" aria-hidden="true">${gradients.map((id) => {
      const points = this.points(id);
      return points ? svg`<path class=${id === this.selected ? "selected" : ""} d=${gradientPath(points)}></path>` : nothing;
    })}</svg>`;
  }

  /** Gradient lights to lay out: the selected one, else all of them (not while merged). */
  private gradientTargets(): string[] {
    if (this.merged) return [];
    const layable = (id: string) => this.capable(id) > 1 && (this.ctx.lightInfo[id]?.gradient?.modes?.length ?? 0) > 1;
    if (this.selected && this.colorLights.includes(this.selected)) return layable(this.selected) ? [this.selected] : [];
    return this.colorLights.filter(layable);
  }

  private gradientMode(id: string): string | null {
    return this.held(id)?.mode ?? this.ctx.lightInfo[id]?.gradient?.mode ?? null;
  }

  /** How the colors of gradient lights are laid out, like the Hue app's gradient styles. */
  private gradientModes() {
    const { t } = this.ctx;
    const targets = this.gradientTargets();
    if (!targets.length) return nothing;
    const modes = GRADIENT_MODES.filter((m) => targets.every((id) => this.ctx.lightInfo[id]?.gradient?.modes?.includes(m)));
    if (modes.length < 2) return nothing;
    const current = new Set(targets.map((id) => this.gradientMode(id)));
    const active = current.size === 1 ? [...current][0] : null;
    return html`<div class="gmodes" role="radiogroup" aria-label=${t("color.gradient_style")}>
      ${modes.map(
        (m) => html`<button role="radio" aria-checked=${m === active ? "true" : "false"} class=${classMap({ on: m === active })} @click=${() => this.setGradientMode(targets, m)}>
          <span class="gm-art gm-${m}" aria-hidden="true"></span>${t(`color.gradient_${m}` as StringKey)}
        </button>`,
      )}
    </div>`;
  }

  private setGradientMode(lights: string[], mode: string): void {
    const { ctx } = this;
    this.stopEffects(lights);
    for (const id of lights) {
      const points = this.points(id);
      if (!points || points.length < 2) continue;
      this.local.set(id, { ...this.held(id), points, mode, until: Date.now() + HOLD_MS });
      ctx.call("hue_studio", "set_gradient", { entity_id: id, points, mode }, { optimistic: false });
    }
    this.requestUpdate();
  }

  private effectsBody(group: Group) {
    const { ctx } = this;
    const lights = this.selected && group.lights.includes(this.selected) ? [this.selected] : group.lights;
    return html`<hue-studio-effects .ctx=${ctx} .rev=${this.rev} .lights=${lights}></hue-studio-effects>`;
  }

  private modeButton(mode: Mode, cls: string, label: string, content: unknown = nothing) {
    return html`<button class=${classMap({ [cls]: true, on: this.currentMode === mode })} aria-label=${label} title=${label} @click=${() => (this.mode = mode)}>${content}</button>`;
  }

  private pin(p: Pin, mode: Mode) {
    const { ctx } = this;
    const lights = p.id === ALL ? this.lights() : [p.id];
    const drag = this.dragging?.key === p.key ? this.dragging : null;
    const [x, y] = drag?.pos ?? p.pos;
    const rgb = mode === "white" ? mirekToRgb(wheelYToMirek(y)) : wheelToRgb(x, y);
    const glyph = p.id === ALL ? "mdi:lightbulb-group" : lightIcon(ctx.hass, p.id, ctx.lightInfo[p.id]);
    return html`<div
      class=${classMap({
        pin: true,
        merged: p.id === ALL,
        dragging: !!drag,
        selected: p.id === this.selected,
        off: !lights.some((id) => ctx.hass.states[id]?.state === "on"),
      })}
      style=${styleMap({ left: pct(x), top: pct(y), "--pin": rgbCss(rgb) })}
      @pointerdown=${(e: PointerEvent) => this.onPinDown(e, p)}
      @pointermove=${(e: PointerEvent) => this.dragging?.key === p.key && this.drag(p, this.wheelPos(e))}
      @pointerup=${(e: PointerEvent) => this.onPinUp(e, p)}
      @pointercancel=${(e: PointerEvent) => this.onPinUp(e, p)}
    ><ha-icon icon=${glyph}></ha-icon></div>`;
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
    this.stopEffects(p.id === ALL ? this.lights() : [p.id]);
  }

  /** A color or white from the wheel replaces a running effect. */
  private stopEffects(lights: string[]): void {
    const running = lights.filter((id) => this.ctx.lightInfo[id]?.effect);
    if (running.length) this.ctx.call("hue_studio", "set_effect", { entity_id: running, effect: "no_effect" }, { optimistic: false });
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
      this.whiteX.set(p.key, raw[0]);
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
      // One color for every light of the group: gradient points all stack on it.
      lights.forEach((id) => this.hold(id, { points: Array.from({ length: this.capable(id) }, () => clipped) }));
      this.send(`xy:${ALL}`, commandInterval(group), (c: XY) => ctx.call("light", "turn_on", { entity_id: group.target, xy_color: c }), clipped);
    } else if (p.index >= 0) {
      const points = [...(this.points(p.id) ?? Array.from({ length: this.capable(p.id) }, () => clipped))];
      points[p.index] = clipped;
      this.hold(p.id, { points });
      this.send(`grad:${p.id}`, GRADIENT_INTERVAL, (pts: XY[]) => ctx.call("hue_studio", "set_gradient", { entity_id: p.id, points: pts }), points);
    } else {
      this.hold(p.id, { points: [clipped] });
      this.send(`xy:${p.id}`, LIGHT_INTERVAL, (c: XY) => ctx.call("light", "turn_on", { entity_id: p.id, xy_color: c }), clipped);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-color-view": ColorView;
  }
}
