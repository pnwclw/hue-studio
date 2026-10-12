// Color wheel, like the Hue app. Every light has a fixed number of pins: a gradient light
// one per color point it can show (`points_capable` from the bridge), joined by the path
// its gradient blends along; any other light one. Pins showing the same color are drawn
// as one pin with a count (a uniform gradient, or lights merged by dropping one pin on
// another); dragging it moves them all, a tap spreads them around a disc to pull one out.
// Gradient lights also pick a style (linear, mirrored, scattered, segmented; reversed) in
// a sheet of its own. A third mode lists light effects.
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
  smoothPath,
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
import { haptic, leavePanel, openStockMoreInfo } from "../ha-internals.ts";
import { type Group, groupOfEntity, groupState, lightIcon } from "../model.ts";
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
/** Gradient layouts in the order they are offered (CLIP v2 `gradient.mode`). */
const GRADIENT_MODES = ["interpolated_palette", "interpolated_palette_mirrored", "random_pixelated", "segmented_palette"];
const SENDER = "color:";

const pct = (v: number) => `${((v + 1) / 2) * 100}%`;
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

/** The point, pulled onto the disc if it is outside. */
const onDisc = ([x, y]: XY): XY => {
  const len = Math.hypot(x, y);
  return len > 1 ? [x / len, y / len] : [x, y];
};

/** A little pin (the Hue app's style pictures): pointing down to (x, y + 4). */
const pinGlyph = (x: number, y: number) => svg`<path d="M${x} ${y + 4}L${x - 2.6} ${y + 0.9}A3.3 3.3 0 1 1 ${x + 2.6} ${y + 0.9}Z"/>`;
const rule = (x1: number, x2: number) => svg`<rect x=${x1} y="15.5" width=${x2 - x1} height="1.6" rx="0.8"/>`;
/** Pictures of the gradient styles, like the Hue app's: pins over the strip of light. */
function modeArt(mode: string) {
  const art: Record<string, unknown> = {
    interpolated_palette: svg`${pinGlyph(6, 8)}${pinGlyph(12, 8)}${pinGlyph(18, 8)}${rule(3, 21)}`,
    interpolated_palette_mirrored: svg`${pinGlyph(7.5, 8)}${pinGlyph(16.5, 8)}${rule(3, 21)}<rect x="11.2" y="4" width="1.6" height="16" rx="0.8"/>`,
    random_pixelated: svg`${pinGlyph(5.5, 10)}${pinGlyph(12, 6.5)}${pinGlyph(18.5, 11)}`,
    segmented_palette: svg`${pinGlyph(6, 8)}${pinGlyph(12, 8)}${pinGlyph(18, 8)}${rule(3, 9)}${rule(9.8, 14.2)}${rule(15, 21)}`,
  };
  return html`<svg class="mode-art" viewBox="0 0 24 24" aria-hidden="true">${art[mode] ?? art.interpolated_palette}</svg>`;
}

/** Pins closer than this (wheel radii) show the same color: one pin with a count. */
const STACK_EPS = 0.035;
/** A pin dropped this close (px) to another one joins it (takes its exact color). */
const SNAP_PX = 28;
/** Radius of the disc a tapped stack spreads its pins around. */
const SPREAD_R = 0.5;
/** Finger travel (px) that makes a press on a pin a drag, not a tap. */
const PIN_SLOP = 6;

/** A light's color point on the wheel; `index` is a gradient point, or -1 for a one-color light. */
interface Pin {
  key: string;
  id: string;
  index: number;
  pos: XY;
}

/** Pins showing one color, drawn (and dragged) as one. */
interface Stack {
  key: string;
  pos: XY;
  pins: Pin[];
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
  /** Inside the more-info dialog: the body scrolls between the bar and a fixed dock. */
  @property({ type: Boolean }) accessor embedded = false;
  /** What "Done" does instead of going back (the dialog closes). */
  @property({ attribute: false }) accessor done: (() => void) | null = null;
  /** Entries of the "..." menu before "Details" (the dialog: open in Hue Studio). */
  @property({ attribute: false }) accessor extraMenu: MenuItem[] = [];

  @state() private accessor mode: Mode | null = null;
  /** A tapped stack, its pins spread around a disc to pull one out; `pos` is their shared color. */
  @state() private accessor spread: { pins: Pin[]; pos: XY; angle: number } | null = null;
  /** A pin pulled out of the spread disc. */
  @state() private accessor pulling: { key: string; pos: XY; out: boolean } | null = null;
  @state() private accessor styleOpen = false;
  @state() private accessor selected: string | null = null;
  /**
   * The stack being dragged: it follows the finger (keeping where it was grabbed: `off`)
   * anywhere on the disc, not the state; `near` is the pin it would join if dropped now.
   */
  @state() private accessor dragging: {
    key: string;
    pins: Pin[];
    pos: XY;
    off: XY;
    x: number;
    y: number;
    moved: boolean;
    near: string | null;
  } | null = null;
  /**
   * Where pins were dropped, with what was sent: a color outside a light's gamut (or a
   * white beyond its range) is clipped, but the pin stays where it was put while the light
   * shows what was sent.
   */
  private dropped = new Map<string, { mode: Mode; raw: XY; xy?: XY; mirek?: number }>();
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
  /** A press on the button or the open slider: a swipe moves the brightness from `start`, by how far the finger went. */
  private briDrag: { id: number; y: number; start: number; moved: boolean; from: "button" | "track" } | null = null;
  /** Mouse wheel turns: the last one is sent exactly after a pause. */
  private wheelTimer?: ReturnType<typeof setTimeout>;
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
    return lights.flatMap((id, order) => {
      if (this.currentMode === "white") return [{ key: `${id}#0`, id, index: -1, pos: this.posOf(id, 0, order) }];
      const count = this.capable(id);
      return Array.from({ length: count }, (_, i) => ({ key: `${id}#${i}`, id, index: count > 1 ? i : -1, pos: this.posOf(id, i, order) }));
    });
  }

  /** Pins grouped by color; the dragged stack stays together where the finger is. */
  private stacks(pins: Pin[]): Stack[] {
    const drag = this.dragging;
    const moving = new Set(drag?.pins.map((p) => p.key));
    const out: Stack[] = [];
    for (const p of pins) {
      if (moving.has(p.key)) continue;
      const near = out.find((st) => Math.hypot(st.pos[0] - p.pos[0], st.pos[1] - p.pos[1]) < STACK_EPS);
      if (near) near.pins.push(p);
      else out.push({ key: p.key, pos: p.pos, pins: [p] });
    }
    if (drag) out.push({ key: drag.key, pos: drag.pos, pins: drag.pins });
    return out;
  }

  private posOf(id: string, index: number, order: number, key = `${id}#0`): XY {
    const put = this.dropped.get(`${id}#${index}`);
    if (put?.mode === this.currentMode) {
      if (put.mirek !== undefined && Math.abs(this.mirek(id) - put.mirek) < 3) return put.raw;
      const xy = this.points(id)?.[index];
      if (put.xy && xy && Math.hypot(xy[0] - put.xy[0], xy[1] - put.xy[1]) < 0.004) return put.raw;
    }
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
    const bar = html`<div class=${classMap({ "cv-bar": true, scrolled: fx && this.scrolled })}>
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
      ${this.embedded ? html`<div class=${classMap({ "cv-scroll": true, "fx-mode": fx })}>${main}</div>` : main}
      <div class=${classMap({ dock: true, over: fx })}>
        ${idle
          ? html`<div class="controls">
              <div class="modes">
                ${this.colorLights.length ? this.modeButton("color", "m-color", t("color.mode_color")) : nothing}
                ${this.whiteLights.length ? this.modeButton("white", "m-white", t("color.mode_white")) : nothing}
                ${effects
                  ? html`<span class="sep"></span>${this.modeButton("effects", "m-effects", t("color.mode_effects"), icon("effects"))}`
                  : nothing}
              </div>
              <div class="grow"></div>
              ${mode === "color" ? this.styleButton() : nothing}
              ${this.brightness(target)}
            </div>`
          : nothing}
        ${idle && busy.length ? this.syncNote(busy, false) : nothing}
        <div class="light-row">${group.lights.map((id) =>
          lightTile(ctx, id, () => {
            haptic("selection");
            this.selected = this.selected === id ? null : id;
          }, {
            selected: id === this.selected,
            busy: busy.includes(id),
            // The light's room, like the Hue app's cards (a zone's lights come from several).
            sub: groupOfEntity(ctx.home, id)?.name ?? "",
          }),
        )}</div>
      </div>
    `;
    // Sheets and the brightness slider sit outside the scrolling body: a scroller (iOS) would clip them.
    const layers = html`
      ${this.bri ? this.briLayer(target) : nothing}
      ${this.styleOpen ? this.styleSheet() : nothing}
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
      this.briDrag = { id: e.pointerId, y: e.clientY, start: value, moved: false, from: "button" };
      haptic("light");
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
        @wheel=${{ handleEvent: (e: WheelEvent) => !inert && this.briWheel(e, target, value), passive: false }}
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
    const next = Math.min(100, Math.max(1, Math.round(v)));
    const prev = this.dragBrightness;
    // A tick every 10 %, a firmer one at either end.
    if (prev !== null && prev !== next) {
      if (next === 1 || next === 100) haptic("light");
      else if (Math.floor(prev / 10) !== Math.floor(next / 10)) haptic("selection");
    }
    this.dragBrightness = next;
    brightnessSender(this.ctx, target)(this.dragBrightness);
  }

  private briMove(e: PointerEvent, target: Group): void {
    const d = this.briDrag;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.abs(e.clientY - d.y) < BRIGHT_SLOP) return;
    d.moved = true;
    // Up is brighter, by the distance travelled: never jumps to where the finger is.
    this.briSet(target, d.start + ((d.y - e.clientY) / BRIGHT_TRACK) * 100);
  }

  /**
   * Taps only open and close: a tap on the button opens the slider, a tap on the open
   * slider closes it. A swipe changes the brightness; started on the button it is the
   * press-and-drag gesture, so the slider closes with the release.
   */
  private briUp(e: PointerEvent, target: Group): void {
    const d = this.briDrag;
    if (!d || d.id !== e.pointerId) return;
    this.briDrag = null;
    if (d.moved) {
      brightnessSender(this.ctx, target).flush();
      this.dragBrightness = null;
    }
    if (d.from === "button" ? d.moved : !d.moved) {
      if (!d.moved) haptic("light");
      this.bri = null;
    } else if (this.bri) this.bri = { ...this.bri, held: false };
  }

  /** The mouse wheel (desktop): up is brighter, about 4 % a notch; the value is sent exactly after a pause. */
  private briWheel(e: WheelEvent, target: Group, value: number): void {
    e.preventDefault();
    const lines = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 33 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 400 : 1;
    this.briSet(target, (this.dragBrightness ?? value) - e.deltaY * lines * 0.04);
    clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => {
      brightnessSender(this.ctx, target).flush();
      this.dragBrightness = null;
    }, 400);
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
      this.briDrag = { id: e.pointerId, y: e.clientY, start: value, moved: false, from: "track" };
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
        @wheel=${{ handleEvent: (e: WheelEvent) => this.briWheel(e, target, value), passive: false }}
        @keydown=${key}
      >${icon("sun")}</div>
    </div>`;
  }

  private wheel(mode: Mode) {
    const spread = new Set(this.spread?.pins.map((p) => p.key));
    const stacks = this.stacks(this.pins()).filter((st) => !st.pins.some((p) => spread.has(p.key)));
    // The wrap carries the wheel's colors: they also glow, blurred, behind it (like the Hue app).
    return html`<div class="wheel-wrap ${mode}" style="--wheel-color:${WHEEL_CSS};--wheel-white:${WHITE_CSS}">
      <div class="wheel ${mode}">
        ${mode === "color" ? this.paths() : nothing}
        ${repeat(stacks, (st) => st.key, (st) => this.pin(st, mode))}
        ${this.spread ? this.spreadLayer(mode) : nothing}
        ${stacks.length || this.spread ? nothing : html`<p class="empty" style="text-align:center;padding:40% 12%">${this.ctx.t("color.no_color")}</p>`}
      </div>
    </div>`;
  }

  /** Lines joining the pins of each gradient light. */
  private paths() {
    const gradients = this.colorLights.filter((id) => this.capable(id) > 1);
    const drag = this.dragging;
    const pins = this.pins();
    return svg`<svg class="paths" viewBox="-1 -1 2 2" aria-hidden="true">${gradients.map((id) => {
      // Through the pins where they are drawn (the dragged ones under the finger).
      const at = pins.filter((p) => p.id === id).map((p) => (drag?.pins.some((q) => q.key === p.key) ? drag.pos : p.pos));
      const d = smoothPath(at);
      return d ? svg`<path class=${id === this.selected ? "selected" : ""} d=${d}></path>` : nothing;
    })}</svg>`;
  }

  /** Gradient lights to style: the selected one, else all of them. */
  private gradientTargets(): string[] {
    const layable = (id: string) => this.capable(id) > 1 && (this.ctx.lightInfo[id]?.gradient?.modes?.length ?? 0) > 1;
    if (this.selected && this.colorLights.includes(this.selected)) return layable(this.selected) ? [this.selected] : [];
    return this.colorLights.filter(layable);
  }

  private gradientMode(id: string): string | null {
    return this.held(id)?.mode ?? this.ctx.lightInfo[id]?.gradient?.mode ?? null;
  }

  /** Modes every styled light supports (the Hue app offers the style for two or more). */
  private styleModes(targets: string[]): string[] {
    return GRADIENT_MODES.filter((m) => targets.every((id) => this.ctx.lightInfo[id]?.gradient?.modes?.includes(m)));
  }

  /** The gradient style button (next to brightness): the current mode's picture; opens the sheet. */
  private styleButton() {
    const targets = this.gradientTargets();
    if (!targets.length || this.styleModes(targets).length < 2) return nothing;
    const current = new Set(targets.map((id) => this.gradientMode(id)));
    const active = current.size === 1 ? [...current][0]! : GRADIENT_MODES[0]!;
    const label = this.ctx.t("color.gradient_style");
    return html`<button class="round style-btn" aria-label=${label} title=${label} aria-haspopup="dialog" @click=${() => (this.styleOpen = true)}>
      ${modeArt(active)}
    </button>`;
  }

  /** The gradient style sheet, like the Hue app's: mode, and the direction the colors run. */
  private styleSheet() {
    const { t } = this.ctx;
    const targets = this.gradientTargets();
    const close = () => (this.styleOpen = false);
    if (!targets.length) return nothing;
    const current = new Set(targets.map((id) => this.gradientMode(id)));
    const active = current.size === 1 ? [...current][0] : null;
    return html`<div class="sheet" @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="box style-sheet" role="dialog" aria-label=${t("color.gradient_style")}>
        <div class="sheet-bar"><div class="grow">${t("color.gradient_style")}</div>
          <button class="pill done" @click=${close}>${t("color.done")}</button>
        </div>
        <h2 class="label">${t("color.style_mode")}</h2>
        <div class="style-modes" role="radiogroup" aria-label=${t("color.style_mode")}>
          ${this.styleModes(targets).map(
            (m) => html`<button role="radio" aria-checked=${m === active ? "true" : "false"} class=${classMap({ on: m === active })} @click=${() => this.setGradientMode(targets, m)}>
              ${modeArt(m)}<span>${t(`color.gradient_${m}` as StringKey)}</span>
            </button>`,
          )}
        </div>
        <h2 class="label sep">${t("color.style_orientation")}</h2>
        <div class="style-flip">
          <button class="round" aria-label=${t("color.style_reverse")} title=${t("color.style_reverse")} @click=${() => this.reverse(targets)}>${icon("swap")}</button>
        </div>
      </div>
    </div>`;
  }

  /** Run the gradient the other way: its points in reverse order. */
  private reverse(lights: string[]): void {
    const { ctx } = this;
    haptic("light");
    this.stopEffects(lights);
    for (const id of lights) {
      const points = this.points(id);
      if (!points || points.length < 2) continue;
      const reversed = [...points].reverse();
      const mode = this.gradientMode(id);
      this.local.set(id, { ...this.held(id), points: reversed, until: Date.now() + HOLD_MS });
      ctx.call("hue_studio", "set_gradient", { entity_id: id, points: reversed, ...(mode ? { mode } : {}) }, { optimistic: false });
    }
    this.requestUpdate();
  }

  private setGradientMode(lights: string[], mode: string): void {
    const { ctx } = this;
    haptic("selection");
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
    const pick = () => {
      if (this.currentMode !== mode) haptic("selection");
      this.mode = mode;
    };
    return html`<button class=${classMap({ [cls]: true, on: this.currentMode === mode })} aria-label=${label} title=${label} @click=${pick}>${content}</button>`;
  }

  private pin(st: Stack, mode: Mode) {
    const { ctx } = this;
    const lights = [...new Set(st.pins.map((p) => p.id))];
    const [x, y] = st.pos;
    const rgb = mode === "white" ? mirekToRgb(wheelYToMirek(y)) : wheelToRgb(x, y);
    const many = st.pins.length > 1;
    // Once a light is picked, the others shrink to dots (still a tap or a drag away).
    const dot = !!this.selected && !lights.includes(this.selected) && this.dragging?.key !== st.key;
    return html`<div
      class=${classMap({
        pin: true,
        dot,
        stack: many && !dot,
        dragging: this.dragging?.key === st.key,
        selected: !!this.selected && lights.includes(this.selected),
        off: !lights.some((id) => ctx.hass.states[id]?.state === "on"),
      })}
      style=${styleMap({ left: pct(x), top: pct(y), "--pin": rgbCss(rgb) })}
      @pointerdown=${(e: PointerEvent) => this.onPinDown(e, st)}
      @pointermove=${(e: PointerEvent) => this.onPinMove(e)}
      @pointerup=${(e: PointerEvent) => this.onPinUp(e)}
      @pointercancel=${(e: PointerEvent) => this.onPinUp(e)}
    >${many ? html`<span class="count">${st.pins.length}</span>` : html`<ha-icon icon=${lightIcon(ctx.hass, lights[0]!, ctx.lightInfo[lights[0]!])}></ha-icon>`}</div>`;
  }

  /** A tapped stack: a disc in the middle, its pins around it; pull one past the edge to part it. */
  private spreadLayer(mode: Mode) {
    const { ctx } = this;
    const spread = this.spread!;
    const n = spread.pins.length;
    const step = Math.min(Math.PI / 5, (2 * Math.PI) / n);
    const close = () => {
      this.spread = null;
      this.pulling = null;
    };
    return html`<div class="spread-layer" @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="spread-disc" @click=${close}></div>
      ${spread.pins.map((p, i) => {
        const a = spread.angle + (i - (n - 1) / 2) * step;
        const pulled = this.pulling?.key === p.key ? this.pulling : null;
        const [x, y] = pulled?.pos ?? [Math.cos(a) * SPREAD_R, Math.sin(a) * SPREAD_R];
        const rgb = mode === "white" ? mirekToRgb(wheelYToMirek(pulled?.out ? y : spread.pos[1])) : pulled?.out ? wheelToRgb(x, y) : wheelToRgb(...spread.pos);
        return html`<div
          class=${classMap({ pin: true, round: true, dragging: !!pulled })}
          style=${styleMap({ left: pct(x), top: pct(y), "--pin": rgbCss(rgb) })}
          @pointerdown=${(e: PointerEvent) => {
            e.preventDefault();
            this.capture(e);
            this.selected = p.id;
            this.pulling = { key: p.key, pos: [x, y], out: false };
          }}
          @pointermove=${(e: PointerEvent) => {
            if (this.pulling?.key !== p.key) return;
            const pos = this.wheelPos(e);
            const out = Math.hypot(...pos) > SPREAD_R;
            if (out && !this.pulling.out) haptic("light");
            this.pulling = { key: p.key, pos, out: out || this.pulling.out };
            if (out) this.drag([p], pos);
          }}
          @pointerup=${(e: PointerEvent) => this.onPullUp(e, p)}
          @pointercancel=${(e: PointerEvent) => this.onPullUp(e, p)}
        ><ha-icon icon=${lightIcon(ctx.hass, p.id, ctx.lightInfo[p.id])}></ha-icon></div>`;
      })}
    </div>`;
  }

  /** Released past the disc's edge: the pin parts with its color there; inside: it goes back. */
  private onPullUp(e: PointerEvent, p: Pin): void {
    const pull = this.pulling;
    const spread = this.spread;
    if (pull?.key !== p.key || !spread) return;
    this.pulling = null;
    const pos = this.wheelPos(e);
    if (Math.hypot(...pos) > SPREAD_R) {
      this.drag([p], pos);
      this.ctx.flushSenders(SENDER);
      const rest = spread.pins.filter((q) => q.key !== p.key);
      this.spread = rest.length > 1 ? { ...spread, pins: rest } : null;
    } else if (pull.out) {
      // Pulled out and brought back: it rejoins the others' color.
      this.drag([p], spread.pos);
      this.ctx.flushSenders(SENDER);
    }
  }

  // ---------- dragging ----------

  /** Pointer position on the wheel ([-1, 1] across the disc; not clamped). */
  private wheelPoint(e: PointerEvent): XY {
    const r = this.querySelector(".wheel")!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1];
  }

  /** Pointer position on the wheel, clamped to the disc. */
  private wheelPos(e: PointerEvent): XY {
    return onDisc(this.wheelPoint(e));
  }

  /** The other pin a dragged one at `pos` would join, if it is close enough. */
  private nearPin(pins: Pin[], pos: XY): Stack | null {
    const unit = this.querySelector(".wheel")!.getBoundingClientRect().width / 2;
    const others = this.stacks(this.pins()).filter((st) => !st.pins.some((p) => pins.some((q) => q.key === p.key)));
    const near = others.map((st) => ({ st, dist: Math.hypot(st.pos[0] - pos[0], st.pos[1] - pos[1]) })).sort((a, b) => a.dist - b.dist)[0];
    return near && near.dist * unit < SNAP_PX ? near.st : null;
  }

  private onPinDown(e: PointerEvent, st: Stack): void {
    e.preventDefault();
    this.capture(e);
    // Where the pin was grabbed relative to its tip: it moves with the finger, never jumps under it.
    const at = this.wheelPoint(e);
    const off: XY = [st.pos[0] - at[0], st.pos[1] - at[1]];
    this.dragging = { key: st.key, pins: st.pins, pos: st.pos, off, x: e.clientX, y: e.clientY, moved: false, near: null };
    const lights = [...new Set(st.pins.map((p) => p.id))];
    if (lights.length === 1) this.selected = lights[0]!;
    this.stopEffects(lights);
  }

  private onPinMove(e: PointerEvent): void {
    const d = this.dragging;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < PIN_SLOP) return;
    if (!d.moved) haptic("selection");
    const at = this.wheelPoint(e);
    const pos = onDisc([at[0] + d.off[0], at[1] + d.off[1]]);
    this.drag(d.pins, pos);
    // A light tick when it comes close enough to join another pin.
    const near = this.nearPin(d.pins, pos)?.key ?? null;
    if (near && near !== d.near) haptic("selection");
    this.dragging = { ...d, moved: true, pos, near };
  }

  /** A drag ends (dropped near another pin: it joins it); a tap on a stack spreads it. */
  private onPinUp(e: PointerEvent): void {
    const d = this.dragging;
    if (!d) return;
    this.dragging = null;
    if (!d.moved) {
      if (d.pins.length > 1) {
        haptic("selection");
        this.spread = { pins: d.pins, pos: d.pos, angle: Math.hypot(...d.pos) > 0.15 ? Math.atan2(d.pos[1], d.pos[0]) : -Math.PI / 2 };
      }
      return;
    }
    const at = this.wheelPoint(e);
    let pos = onDisc([at[0] + d.off[0], at[1] + d.off[1]]);
    const near = this.nearPin(d.pins, pos);
    if (near) {
      pos = near.pos;
      haptic("medium");
    }
    this.drag(d.pins, pos);
    this.ctx.flushSenders(SENDER);
  }

  /** A color or white from the wheel replaces a running effect. */
  private stopEffects(lights: string[]): void {
    const running = lights.filter((id) => this.ctx.lightInfo[id]?.effect);
    if (running.length) this.ctx.call("hue_studio", "set_effect", { entity_id: running, effect: "no_effect" }, { optimistic: false });
  }

  private hold(id: string, value: Omit<Held, "until">): void {
    this.local.set(id, { ...value, until: Date.now() + HOLD_MS });
  }

  private send<A extends unknown[]>(key: string, interval: number, fn: (...args: A) => void, ...args: A): void {
    this.ctx.sender(`${SENDER}${key}`, interval, fn)(...args);
  }

  /**
   * Set the pins' lights to the color (or white) at `raw`; returns where the pins show it
   * (clipped to the first light's gamut). The whole group at once goes as one group
   * command; otherwise each light gets its own, spaced so all of them stay within the
   * bridge's ~10 commands per second.
   */
  private drag(pins: Pin[], raw: XY): XY {
    const { ctx } = this;
    const group = this.live;
    if (!group || !pins.length) return raw;
    const ids = [...new Set(pins.map((p) => p.id))];
    const white = this.currentMode === "white";
    const whole = ids.length > 1 && ids.length === group.lights.length && ids.every((id) => pins.filter((p) => p.id === id).length === (white ? 1 : this.capable(id)));
    const spacing = Math.max(1, ids.length);
    const info = ctx.lightInfo[ids[0]!];

    if (white) {
      const [lo, hi] = info?.mirek || [153, 500];
      const mirek = Math.min(hi, Math.max(lo, wheelYToMirek(raw[1])));
      pins.forEach((p) => {
        this.whiteX.set(p.key, raw[0]);
        this.dropped.set(p.key, { mode: "white", raw, mirek });
      });
      ids.forEach((id) => this.hold(id, { mirek }));
      const target = whole ? group.target : ids;
      const interval = whole ? commandInterval(group) : LIGHT_INTERVAL * spacing;
      this.send(`ct:${ids.join(",")}`, interval, (m: number) => ctx.call("light", "turn_on", { entity_id: target, color_temp_kelvin: Math.round(1e6 / m) }), mirek);
      return [raw[0], mirekToWheelY(mirek)];
    }

    const xy = wheelToXy(...raw);
    const first = clipToGamut(xy, info?.gamut);
    const shown: XY = first === xy ? raw : xyToWheel(...first);
    for (const p of pins) this.dropped.set(p.key, { mode: "color", raw, xy: clipToGamut(xy, ctx.lightInfo[p.id]?.gamut) });
    if (whole) {
      // Every light of the group, every point: one color, one group command.
      ids.forEach((id) => this.hold(id, { points: Array.from({ length: this.capable(id) }, () => first) }));
      this.send(`xy:${ids.join(",")}`, commandInterval(group), (c: XY) => ctx.call("light", "turn_on", { entity_id: group.target, xy_color: c }), first);
      return shown;
    }
    for (const id of ids) {
      const clipped = clipToGamut(xy, ctx.lightInfo[id]?.gamut);
      const count = this.capable(id);
      if (count > 1) {
        const points = [...(this.points(id) ?? Array.from({ length: count }, () => clipped))];
        for (const p of pins) if (p.id === id && p.index >= 0) points[p.index] = clipped;
        this.hold(id, { points });
        this.send(`grad:${id}`, GRADIENT_INTERVAL * spacing, (pts: XY[]) => ctx.call("hue_studio", "set_gradient", { entity_id: id, points: pts }), points);
      } else {
        this.hold(id, { points: [clipped] });
        this.send(`xy:${id}`, LIGHT_INTERVAL * spacing, (c: XY) => ctx.call("light", "turn_on", { entity_id: id, xy_color: c }), clipped);
      }
    }
    return shown;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-color-view": ColorView;
  }
}
