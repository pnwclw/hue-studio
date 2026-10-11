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
import { brightnessSender, commandInterval, lightTile } from "../controls.ts";
import { availableEffects } from "../effects.ts";
import { leavePanel, openStockMoreInfo } from "../ha-internals.ts";
import { type Group, groupState, lightIcon } from "../model.ts";
import type { HassState, XY } from "../types.ts";
import type { StringKey } from "../i18n.ts";
import { syncedLights, syncingIn } from "../sync.ts";
import { icon, type IconName } from "../ui.ts";
import { StudioView } from "./base.ts";
import "./effect-sheet.ts";
import type { Custom } from "./effects.ts";
import "./effects.ts";
import "./new-scene.ts";

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
const LINK_ICON = svg`<svg viewBox="0 0 24 24"><path d="M10.59,13.41C11,13.8 11,14.44 10.59,14.83C10.2,15.22 9.56,15.22 9.17,14.83C7.22,12.88 7.22,9.71 9.17,7.76L12.71,4.22C14.66,2.27 17.83,2.27 19.78,4.22C21.73,6.17 21.73,9.34 19.78,11.29L18.29,12.78C18.3,11.96 18.17,11.14 17.89,10.36L18.36,9.88C19.54,8.71 19.54,6.81 18.36,5.64C17.19,4.46 15.29,4.46 14.12,5.64L10.59,9.17C9.41,10.34 9.41,12.24 10.59,13.41M13.41,9.17C13.8,8.78 14.44,8.78 14.83,9.17C16.78,11.12 16.78,14.29 14.83,16.24L11.29,19.78C9.34,21.73 6.17,21.73 4.22,19.78C2.27,17.83 2.27,14.66 4.22,12.71L5.71,11.22C5.7,12.04 5.83,12.86 6.11,13.65L5.64,14.12C4.46,15.29 4.46,17.19 5.64,18.36C6.81,19.54 8.71,19.54 9.88,18.36L13.41,14.83C14.59,13.66 14.59,11.76 13.41,10.59C13,10.2 13,9.56 13.41,9.17Z"/></svg>`;
/** Height (px) of the brightness slider the button opens: the whole range over it. */
const BRIGHT_TRACK = 240;
/** Finger travel (px) that makes a press on the brightness button a drag, not a tap. */
const BRIGHT_SLOP = 6;

/** An entry of the "..." menu; `run` gets the picked light (or null: the whole group). */
export interface MenuItem {
  icon: IconName;
  label: string;
  run: (light: string | null) => void;
}

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
  /** Inside the more-info dialog: the body scrolls between the bar and a fixed dock, the bar drags the sheet. */
  @property({ type: Boolean }) accessor embedded = false;
  /** What "Done" does instead of going back (the dialog closes). */
  @property({ attribute: false }) accessor done: (() => void) | null = null;
  /** Entries of the "..." menu before "Details" (the dialog: open in Hue Studio). */
  @property({ attribute: false }) accessor extraMenu: MenuItem[] = [];

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
  @state() private accessor menuOpen = false;
  /** The "Save" sheet (a new scene from what the lights show now) is open. */
  @state() private accessor saving = false;
  /**
   * The brightness slider the button opens (the Hue app's): `at` is the button's place on
   * screen, the slider grows up from it. Opened by a press: dragging right away changes the
   * brightness from where it was and closes on release; a tap leaves it open to drag or tap.
   */
  @state() private accessor bri: { at: DOMRect; held: boolean } | null = null;
  private briDrag: { id: number; y: number; start: number; moved: boolean; relative: boolean } | null = null;
  /** The body scrolled down (the effects title moves into the bar). */
  @state() private accessor scrolled = false;
  @state() private accessor adjust: { custom: Custom; start: boolean } | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    // Scroll events don't bubble: catch the scrolling body's on the way down.
    this.addEventListener("scroll", this.onScroll, true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("scroll", this.onScroll, true);
  }

  private onScroll = (e: Event): void => {
    const scrolled = (e.target as Element).scrollTop > 40;
    if (scrolled !== this.scrolled) this.scrolled = scrolled;
  };

  /** Lights a Sync Box drives right now: shown, but not controllable. */
  private get syncing(): string[] {
    return this.group ? syncingIn(this.ctx.boxes, this.group) : [];
  }

  /** The group without the syncing lights (no group command then: it would reach them too). */
  private get live(): Group | null {
    const { group } = this;
    const busy = this.syncing;
    if (!group || !busy.length) return group;
    const lights = group.lights.filter((id) => !busy.includes(id));
    return { ...group, lights, target: lights, group: null };
  }

  protected override willUpdate(): void {
    // Picked once, like the Hue app: the mode stays while lights change under it.
    if (this.mode === null && this.group && this.ctx.ready) {
      this.mode = this.initialMode();
      this.selected = this.focusLight;
    }
  }

  private get colorLights(): string[] {
    return this.live?.lights.filter((id) => supportsColor(this.ctx.hass.states[id])) ?? [];
  }

  private get whiteLights(): string[] {
    return this.live?.lights.filter((id) => supportsWhite(this.ctx.hass.states[id])) ?? [];
  }

  private get currentMode(): Mode {
    return this.mode ?? this.initialMode();
  }

  /** What the focused (or first lit) light shows now. */
  private initialMode(): Mode {
    const { hass, lightInfo } = this.ctx;
    const ids = this.focusLight ? [this.focusLight] : (this.live?.lights ?? []);
    if (ids.some((id) => hass.states[id]?.state === "on" && lightInfo[id]?.effect)) return "effects";
    const ref = (this.focusLight && hass.states[this.focusLight]) || this.live?.lights.map((id) => hass.states[id]).find((s) => s?.state === "on");
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
    const live = this.live!;
    const busy = this.syncing;
    const idle = live.lights.length > 0;

    const mode = this.currentMode;
    const done = this.done ?? (() => (this.exitPath ? leavePanel(this.exitPath) : ctx.go(this.backPath ?? `/room/${encodeURIComponent(group.key)}`)));
    const effects = idle && availableEffects(live.lights, ctx.lightInfo).length > 0;
    // Brightness (and "Details") act on the picked light, else on the whole group.
    const picked = this.selected && live.lights.includes(this.selected) ? this.selected : null;
    const target = picked ? { ...live, key: `${live.key}:${picked}`, lights: [picked], target: [picked], group: null } : live;

    const fx = idle && mode === "effects";
    const bar = html`<div class=${classMap({ "cv-bar": true, grip: this.embedded, scrolled: fx && this.scrolled })}>
      <button class="round more" aria-label=${t("more.menu")} aria-haspopup="menu" aria-expanded=${this.menuOpen} @click=${() => (this.menuOpen = !this.menuOpen)}>
        ${icon("dots")}
      </button>
      <button class="pill save" ?disabled=${!idle} @click=${() => (this.saving = true)}>${t("color.save")}</button>
      <div class="grow bar-title">${fx ? t("color.mode_effects") : ""}</div>
      <button class="pill done" @click=${done}>${t("color.done")}</button>
      ${this.menuOpen ? this.menu(picked) : nothing}
    </div>`;

    // Effects: a large title, like the Hue app's; it moves into the bar once scrolled past.
    const main = !idle
      ? this.syncNote(busy, true)
      : fx
        ? html`<h1 class="fx-title">${t("color.mode_effects")}</h1>${this.effectsBody(live)}`
        : this.wheel(mode);
    const content = html`
      ${this.embedded ? html`<div class=${classMap({ "cv-scroll": true, fx })}>${main}</div>` : main}
      <div class=${classMap({ dock: true, over: fx })}>
        ${idle && mode === "color" ? this.gradientModes() : nothing}
        ${idle
          ? html`<div class="controls">
              <div class="modes">
                ${this.colorLights.length ? this.modeButton("color", "m-color", t("color.mode_color")) : nothing}
                ${this.whiteLights.length ? this.modeButton("white", "m-white", t("color.mode_white")) : nothing}
                ${effects
                  ? html`<span class="sep"></span>${this.modeButton("effects", "m-effects", t("color.mode_effects"), icon("effects"))}`
                  : nothing}
              </div>
              ${live.lights.length > 1 && mode !== "effects"
                ? html`<button
                    class=${classMap({ link: true, on: this.merged })}
                    aria-label=${t("color.merge_lights")}
                    title=${t("color.merge_lights")}
                    @click=${() => (this.merged = !this.merged)}
                  >${LINK_ICON}</button>`
                : nothing}
              ${this.brightness(target)}
            </div>`
          : nothing}
        ${idle && busy.length ? this.syncNote(busy, false) : nothing}
        <div class="light-row">${group.lights.map((id) =>
          lightTile(ctx, id, () => (this.selected = this.selected === id ? null : id), { selected: id === this.selected, busy: busy.includes(id) }),
        )}</div>
      </div>
    `;
    // Sheets and the brightness slider sit outside the scrolling body: a scroller (iOS) would clip them.
    const layers = html`
      ${this.bri ? this.briLayer(target) : nothing}
      ${this.adjust
        ? html`<hue-studio-effect-sheet
            .ctx=${ctx}
            .rev=${this.rev}
            .lights=${picked ? [picked] : live.lights}
            .initial=${this.adjust.custom}
            ?start=${this.adjust.start}
            @close=${() => (this.adjust = null)}
          ></hue-studio-effect-sheet>`
        : nothing}
      ${this.saving
        ? html`<hue-studio-new-scene .ctx=${ctx} .rev=${this.rev} .group=${group} @close=${() => (this.saving = false)}></hue-studio-new-scene>`
        : nothing}
    `;
    if (this.embedded) return html`${bar}${content}${layers}`;
    return html`${this.screen(bar, content)}${layers}`;
  }

  /** The "..." menu: the owner's entries, then HA's own dialog of the picked light or the group. */
  private menu(picked: string | null) {
    const { ctx, group } = this;
    const close = () => (this.menuOpen = false);
    const details: MenuItem = {
      icon: "cog",
      label: ctx.t("more.settings"),
      run: (light) => {
        // The dialog closes first: HA's own one opens in its place.
        if (this.embedded) this.done?.();
        openStockMoreInfo(light ?? group?.group ?? group?.lights[0] ?? "");
      },
    };
    return html`<div class="menu-scrim" @click=${close}></div>
      <div class="menu" role="menu">
        ${[...this.extraMenu, details].map(
          (item) => html`<button role="menuitem" @click=${() => {
            close();
            item.run(picked);
          }}>${icon(item.icon)}${item.label}</button>`,
        )}
      </div>`;
  }

  /** Lights a Sync Box drives: why they can't be changed here, and a way to stop it. */
  private syncNote(busy: string[], all: boolean) {
    const { ctx } = this;
    const { t } = ctx;
    const box = Object.entries(ctx.boxes).find(([, b]) => syncedLights(b).some((id) => busy.includes(id)));
    const name = box?.[1].name || t("sync.title");
    const stop = () => box && ctx.setSync(box[0], { sync: false });
    return html`<div class=${classMap({ "sync-note": true, all })}>
      ${icon("sync")}
      <p>${all ? t("color.sync_all", { name }) : t("color.sync_some", { count: busy.length, name })}</p>
      ${box ? html`<button class="pill" @click=${stop}>${t("sync.stop")}</button>` : nothing}
    </div>`;
  }

  /** The Hue app's brightness button: its value above it; a press opens the slider. */
  private brightness(target: Group) {
    const { ctx } = this;
    const state = groupState(ctx.hass, target, ctx.lightInfo);
    const value = this.dragBrightness ?? state.brightness;
    const inert = !state.on || !state.available;
    const down = (e: PointerEvent) => {
      if (inert) return;
      const at = (e.currentTarget as HTMLElement).getBoundingClientRect();
      this.capture(e);
      this.briDrag = { id: e.pointerId, y: e.clientY, start: value, moved: false, relative: true };
      this.bri = { at, held: true };
    };
    const key = (e: KeyboardEvent) => {
      if (inert || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      this.bri = { at: (e.currentTarget as HTMLElement).getBoundingClientRect(), held: false };
    };
    return html`<div class=${classMap({ bri: true, off: inert, open: !!this.bri })}>
      <div class="bri-value">${state.on ? `${value}%` : ""}</div>
      <button
        class="bri-pill"
        aria-label=${ctx.t("common.brightness")}
        aria-haspopup="dialog"
        ?disabled=${inert}
        style=${styleMap({ "--level": `${state.on ? value : 0}%` })}
        @pointerdown=${down}
        @pointermove=${(e: PointerEvent) => this.briMove(e, target)}
        @pointerup=${(e: PointerEvent) => this.briUp(e, target)}
        @pointercancel=${(e: PointerEvent) => this.briUp(e, target)}
        @keydown=${key}
      >${icon("sun")}</button>
    </div>`;
  }

  private capture(e: PointerEvent): void {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone: the drag still works while over the element.
    }
  }

  private briSet(target: Group, v: number): void {
    this.dragBrightness = Math.min(100, Math.max(1, Math.round(v)));
    brightnessSender(this.ctx, target)(this.dragBrightness);
  }

  private briMove(e: PointerEvent, target: Group): void {
    const d = this.briDrag;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.abs(e.clientY - d.y) < BRIGHT_SLOP) return;
    d.moved = true;
    if (d.relative) this.briSet(target, d.start + ((d.y - e.clientY) / BRIGHT_TRACK) * 100);
    else this.briSet(target, this.briAt(e));
  }

  private briUp(e: PointerEvent, target: Group): void {
    const d = this.briDrag;
    if (!d || d.id !== e.pointerId) return;
    this.briDrag = null;
    if (d.moved || !d.relative) {
      brightnessSender(this.ctx, target).flush();
      this.dragBrightness = null;
    }
    // A press that dragged closes with the release; a tap leaves the slider open.
    if (d.relative && d.moved) this.bri = null;
    else if (this.bri) this.bri = { ...this.bri, held: false };
  }

  /** Brightness at the finger on the open slider (bottom 1 %, top 100 %). */
  private briAt(e: PointerEvent): number {
    const track = this.querySelector(".bri-track")!.getBoundingClientRect();
    return ((track.bottom - e.clientY) / track.height) * 100;
  }

  /** The open brightness slider over a dimmed screen. */
  private briLayer(target: Group) {
    const { ctx } = this;
    const { at } = this.bri!;
    const state = groupState(ctx.hass, target, ctx.lightInfo);
    const value = this.dragBrightness ?? state.brightness;
    const close = () => {
      brightnessSender(ctx, target).flush();
      this.dragBrightness = null;
      this.bri = null;
    };
    const down = (e: PointerEvent) => {
      this.capture(e);
      this.briDrag = { id: e.pointerId, y: e.clientY, start: value, moved: true, relative: false };
      this.briSet(target, this.briAt(e));
    };
    const key = (e: KeyboardEvent) => {
      const step = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5 }[e.key];
      if (e.key === "Escape") close();
      if (!step) return;
      e.preventDefault();
      this.briSet(target, value + step);
    };
    const place = { left: `${at.left}px`, width: `${at.width}px`, top: `${at.bottom - BRIGHT_TRACK}px`, height: `${BRIGHT_TRACK}px` };
    return html`<div class="bri-layer" @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="bri-chip" style=${styleMap({ left: `${at.left + at.width / 2}px`, top: `${at.bottom - BRIGHT_TRACK - 40}px` })}>${value}%</div>
      <div
        class="bri-track"
        role="slider"
        tabindex="0"
        aria-label=${ctx.t("common.brightness")}
        aria-valuemin="1"
        aria-valuemax="100"
        aria-valuenow=${value}
        style=${styleMap({ ...place, "--level": `${value}%` })}
        @pointerdown=${down}
        @pointermove=${(e: PointerEvent) => this.briMove(e, target)}
        @pointerup=${(e: PointerEvent) => this.briUp(e, target)}
        @pointercancel=${(e: PointerEvent) => this.briUp(e, target)}
        @keydown=${key}
      >${icon("sun")}</div>
    </div>`;
  }

  private wheel(mode: Mode) {
    const pins = this.pins();
    // The wrap carries the wheel's colors: they also glow, blurred, behind it (like the Hue app).
    return html`<div class="wheel-wrap ${mode}" style="--wheel-color:${WHEEL_CSS};--wheel-white:${WHITE_CSS}">
      <div class="wheel ${mode}">
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
    return html`<hue-studio-effects
      .ctx=${ctx}
      .rev=${this.rev}
      .lights=${lights}
      @effect-adjust=${(e: CustomEvent<{ custom: Custom; start: boolean }>) => (this.adjust = e.detail)}
    ></hue-studio-effects>`;
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
    const { ctx } = this;
    const group = this.live;
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
