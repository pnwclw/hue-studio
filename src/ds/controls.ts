// Room/zone controls shared by the home cards, the room header, the color view and the
// more-info dialog: the brightness slider, group state classes and throttled commands.

import { html, nothing, type PropertyValues, type ReactiveController, type ReactiveControllerHost, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import { paletteArt, paletteColors } from "../core/color.ts";
import type { StudioContext } from "../core/context.ts";
import { SPEED_STEPS, speedWord } from "../features/color/effects.ts";
import { galleryMatch, thumbUrl } from "../features/scenes/gallery-data.ts";
import { colorsCss, friendlyName, type Group, groupState, type GroupState, lightColors, lightIcon, needsDarkText } from "../core/model.ts";
import { haptic } from "../core/ha-internals.ts";
import type { StringKey } from "../i18n/index.ts";
import { syncingIn } from "../features/sync/sync.ts";
import type { Gallery, SceneInfo, SyncBoxInfo } from "../core/types.ts";
import { icon, LightElement, lockedToggle, refuse, type Throttled, toggle } from "./ui.ts";

/**
 * Bridge limits: ~1 command/s for a Hue group, ~10/s for lights in total. A group command
 * is one command for the whole room; without a group, every light costs one.
 */
export const commandInterval = (group: Group): number =>
  group.target.length === 1 && group.group ? 1000 : Math.max(120, 100 * group.target.length);

/** Up to this many lights, brightness goes to each light (~10/s) instead of the group (~1/s). */
const DIRECT_LIGHTS = 4;
/** Short fade while dragging: the bridge's default 0.4 s makes the light trail the finger. */
const DRAG_TRANSITION = 0.15;

/**
 * Throttled brightness command for a group; one per group, kept across renders. A room
 * with a few lights is dimmed light by light: a Hue group takes one command per second,
 * single lights about ten in total, so the light follows the slider much more closely.
 */
export function brightnessSender(ctx: StudioContext, group: Group): Throttled<[number]> {
  const direct = group.lights.length <= DIRECT_LIGHTS;
  const target = direct ? group.lights : group.target;
  const interval = direct ? Math.max(100, 100 * target.length) : commandInterval(group);
  return ctx.sender(`bri:${group.key}:${target.join(",")}`, interval, (v: number) =>
    ctx.call("light", "turn_on", { entity_id: target, brightness_pct: v, transition: DRAG_TRANSITION }),
  );
}

/** What the brightness control shows and drives: a group of lights (the color screen), a Sync Box. */
export interface BrightnessSource {
  /** The value while nobody drags, 1–100. */
  value: number;
  /** Off or unavailable: the button can't be used. */
  inert: boolean;
  /** Above the button in place of its value (the Sync screen's "BRIGHTNESS"). */
  caption?: string;
  label: string;
  send(value: number): void;
  flush(): void;
}

/** Height (px) of the open slider (the whole range over it), and the finger travel that makes a press a drag, not a tap. */
const BRIGHT_TRACK = 240;
const BRIGHT_SLOP = 6;

/**
 * The Hue app's brightness button: its value above it; a press opens a slider growing up
 * from it over a dimmed screen. Dragging right away changes the brightness from where it
 * was and closes on release; a tap leaves it open to drag or tap. The host renders
 * `button()` where it sits and `layer()` outside any scrolling element (iOS clips them).
 */
export class BrightnessControl implements ReactiveController {
  /** The value being dragged to (shown instead of the source's). */
  drag: number | null = null;
  /** The open slider: the button's place on screen; `held` while the press that opened it lasts. */
  private open: { at: DOMRect; held: boolean } | null = null;
  /** A press on the button or the open slider: a swipe moves the brightness from `start`, by how far the finger went. */
  private press: { id: number; y: number; start: number; moved: boolean; from: "button" | "track" } | null = null;
  /** Mouse wheel turns: the last one is sent exactly after a pause. */
  private wheelTimer?: ReturnType<typeof setTimeout>;

  private readonly host: ReactiveControllerHost;

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  hostDisconnected(): void {
    clearTimeout(this.wheelTimer);
  }

  get isOpen(): boolean {
    return this.open !== null;
  }

  button(src: BrightnessSource): TemplateResult {
    const value = this.drag ?? src.value;
    const down = (e: PointerEvent) => {
      if (src.inert) return;
      this.capture(e);
      this.press = { id: e.pointerId, y: e.clientY, start: value, moved: false, from: "button" };
      haptic("light");
      this.open = { at: (e.currentTarget as HTMLElement).getBoundingClientRect(), held: true };
      this.host.requestUpdate();
    };
    const key = (e: KeyboardEvent) => {
      if (src.inert || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      this.open = { at: (e.currentTarget as HTMLElement).getBoundingClientRect(), held: false };
      this.host.requestUpdate();
    };
    return html`<div class=${classMap({ bri: true, off: src.inert, open: this.isOpen, captioned: !!src.caption })}>
      <div class="bri-value">${src.caption ?? (src.inert ? "" : `${value}%`)}</div>
      <button
        class="bri-pill"
        aria-label=${src.label}
        aria-haspopup="dialog"
        ?disabled=${src.inert}
        style=${styleMap({ "--level": `${src.inert ? 0 : value}%` })}
        @pointerdown=${down}
        @pointermove=${(e: PointerEvent) => this.move(e, src)}
        @pointerup=${(e: PointerEvent) => this.up(e, src)}
        @pointercancel=${(e: PointerEvent) => this.up(e, src)}
        @wheel=${{ handleEvent: (e: WheelEvent) => !src.inert && this.wheel(e, src, value), passive: false }}
        @keydown=${key}
      >${icon("sun")}</button>
    </div>`;
  }

  /** The open slider over a dimmed screen (nothing while closed). */
  layer(src: BrightnessSource): TemplateResult | typeof nothing {
    if (!this.open) return nothing;
    const { at } = this.open;
    const value = this.drag ?? src.value;
    const close = () => {
      src.flush();
      this.drag = null;
      this.open = null;
      this.host.requestUpdate();
    };
    const down = (e: PointerEvent) => {
      this.capture(e);
      this.press = { id: e.pointerId, y: e.clientY, start: value, moved: false, from: "track" };
    };
    const key = (e: KeyboardEvent) => {
      const step = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5 }[e.key];
      if (e.key === "Escape") close();
      if (!step) return;
      e.preventDefault();
      this.set(src, value + step);
    };
    const place = { left: `${at.left}px`, width: `${at.width}px`, top: `${at.bottom - BRIGHT_TRACK}px`, height: `${BRIGHT_TRACK}px` };
    return html`<div class="bri-layer" @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="bri-chip" style=${styleMap({ left: `${at.left + at.width / 2}px`, top: `${at.bottom - BRIGHT_TRACK - 40}px` })}>${value}%</div>
      <div
        class="bri-track"
        role="slider"
        tabindex="0"
        aria-label=${src.label}
        aria-valuemin="1"
        aria-valuemax="100"
        aria-valuenow=${value}
        style=${styleMap({ ...place, "--level": `${value}%` })}
        @pointerdown=${down}
        @pointermove=${(e: PointerEvent) => this.move(e, src)}
        @pointerup=${(e: PointerEvent) => this.up(e, src)}
        @pointercancel=${(e: PointerEvent) => this.up(e, src)}
        @wheel=${{ handleEvent: (e: WheelEvent) => this.wheel(e, src, value), passive: false }}
        @keydown=${key}
      >${icon("sun")}</div>
    </div>`;
  }

  private capture(e: PointerEvent): void {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone: the drag still works while over the element.
    }
  }

  private set(src: BrightnessSource, v: number): void {
    const next = Math.min(100, Math.max(1, Math.round(v)));
    const prev = this.drag;
    // A tick every 10 %, a firmer one at either end.
    if (prev !== null && prev !== next) {
      if (next === 1 || next === 100) haptic("light");
      else if (Math.floor(prev / 10) !== Math.floor(next / 10)) haptic("selection");
    }
    this.drag = next;
    src.send(next);
    this.host.requestUpdate();
  }

  private move(e: PointerEvent, src: BrightnessSource): void {
    const d = this.press;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.abs(e.clientY - d.y) < BRIGHT_SLOP) return;
    d.moved = true;
    // Up is brighter, by the distance travelled: never jumps to where the finger is.
    this.set(src, d.start + ((d.y - e.clientY) / BRIGHT_TRACK) * 100);
  }

  /**
   * Taps only open and close: a tap on the button opens the slider, a tap on the open
   * slider closes it. A swipe changes the brightness; started on the button it is the
   * press-and-drag gesture, so the slider closes with the release.
   */
  private up(e: PointerEvent, src: BrightnessSource): void {
    const d = this.press;
    if (!d || d.id !== e.pointerId) return;
    this.press = null;
    if (d.moved) {
      src.flush();
      this.drag = null;
    }
    if (d.from === "button" ? d.moved : !d.moved) {
      if (!d.moved) haptic("light");
      this.open = null;
    } else if (this.open) this.open = { ...this.open, held: false };
    this.host.requestUpdate();
  }

  /** The mouse wheel (desktop): up is brighter, about 4 % a notch; the value is sent exactly after a pause. */
  private wheel(e: WheelEvent, src: BrightnessSource, value: number): void {
    e.preventDefault();
    const lines = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 33 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 400 : 1;
    this.set(src, (this.drag ?? value) - e.deltaY * lines * 0.04);
    clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => {
      src.flush();
      this.drag = null;
      this.host.requestUpdate();
    }, 400);
  }
}

export function toggleGroup(ctx: StudioContext, group: Group): void {
  const on = groupState(ctx.hass, group).on;
  ctx.call("light", on ? "turn_off" : "turn_on", { entity_id: group.target });
}

/** A group as the UI shows it; `syncing`: a Sync Box drives some of its lights. */
export interface ShownState extends GroupState {
  syncing: boolean;
}

/**
 * A group's state as shown. While a Sync Box drives its lights it counts as off (the Hue
 * app's): dark, brightness at the bottom, its switch and slider locked.
 */
export function shownState(ctx: StudioContext, group: Group): ShownState {
  const state = groupState(ctx.hass, group, ctx.lightInfo);
  return syncingIn(ctx.boxes, group).length
    ? { ...state, on: false, brightness: 0, colors: [], syncing: true }
    : { ...state, syncing: false };
}

/** A group's switch; locked (a tap refused) while a Sync Box drives its lights. */
export const groupToggle = (ctx: StudioContext, group: Group, state: ShownState): TemplateResult =>
  state.syncing ? lockedToggle(ctx.t("common.toggle")) : toggle(state.on, ctx.t("common.toggle"), () => toggleGroup(ctx, group));

/** A box that syncs: say so and offer to stop it (the Hue app's banner); a tap elsewhere opens the box. */
export function syncBanner(ctx: StudioContext, id: string, box: SyncBoxInfo): TemplateResult {
  const { t } = ctx;
  const stop = (e: Event) => {
    e.stopPropagation();
    haptic("light");
    ctx.setSync(id, { sync: false });
  };
  return html`<div class="sync-banner" role="button" tabindex="0" @click=${() => ctx.go(`/sync?box=${encodeURIComponent(id)}`)}>
    ${icon("sync")}
    <div class="grow">
      <div class="title">${t("home.sync_active", { name: box.name || "Sync Box" })}</div>
      <div class="sub">${t("home.sync_hint")}</div>
    </div>
    <button class="pill" @click=${stop}>${t("home.sync_stop")}</button>
  </div>`;
}

/** Classes and the lit background of a surface (card, header) showing a group. */
export function surfaceOf(state: Pick<GroupState, "on" | "colors"> & { available?: boolean; brightness?: number }) {
  // Dimmer light, darker and quieter colors (the Hue app's shade on its cards): 0 at full, ~1 at the bottom.
  const dim = state.on && state.brightness !== undefined ? Math.pow(1 - Math.min(100, Math.max(1, state.brightness)) / 100, 1.4) : 0;
  return {
    classes: {
      surface: true,
      lit: state.on,
      off: !state.on,
      unavailable: state.available === false,
      "dark-text": state.on && needsDarkText(state.colors),
    },
    style: { "--lit-bg": colorsCss(state.colors, "var(--surface)"), "--dim": dim.toFixed(3) },
  };
}

const FALLBACK_DOT = "radial-gradient(circle at 30% 30%, #ffe7b8, #f2a65a)";
const FALLBACK_COLORS = ["rgb(255,231,184)", "rgb(242,166,90)"];

/** Soft palette colors of a scene (or a warm fallback). */
export function sceneColors(info: SceneInfo | undefined): string[] {
  if (!info) return FALLBACK_COLORS;
  if (info.palette.length) return paletteColors({ kind: "gradient", points: info.palette });
  if (info.mirek.length) return info.mirek.flatMap((mirek) => paletteColors({ kind: "white", mirek }));
  return FALLBACK_COLORS;
}

/** Background of a scene's round picture without a gallery match. */
export function sceneArt(info: SceneInfo | undefined): string {
  if (info?.palette.length) return paletteArt({ kind: "gradient", points: info.palette });
  if (info?.mirek.length) return paletteArt({ kind: "white", mirek: info.mirek[0] });
  return FALLBACK_DOT;
}

/** A scene's round picture: its gallery picture (bridge scenes usually come from the gallery), else its palette. */
export function sceneDot(gallery: Gallery | null, name: string, info: SceneInfo | undefined): string {
  const match = galleryMatch(gallery, name, info?.image);
  return match ? `url("${thumbUrl(match.id)}") center / cover, ${paletteArt(match)}` : sceneArt(info);
}

/**
 * A banner, like the Hue app's: a round icon and a spaced capital title in blue (amber for a
 * warning), the text under it, buttons of its own, and a round button on the right that
 * goes on (the whole banner does). A Sync Box's banner is a different one (syncBanner).
 */
export function banner(o: {
  title: string;
  text: TemplateResult | string;
  warn?: boolean;
  /** A pulsing dot instead of the icon: something is going on (a search). */
  live?: boolean;
  buttons?: TemplateResult;
  open?: { label: string; run: () => void };
}): TemplateResult {
  const mark = o.live
    ? html`<span class="dot-badge live" aria-hidden="true"></span>`
    : html`<span class="banner-mark" aria-hidden="true"><ha-icon icon=${o.warn ? "mdi:exclamation-thick" : "mdi:information-variant"}></ha-icon></span>`;
  return html`<div class=${classMap({ banner: true, warn: !!o.warn, link: !!o.open })} role="note" @click=${() => o.open?.run()}>
    <div class="grow">
      <div class="banner-head">${mark}<span>${o.title}</span></div>
      <div class="banner-text">${o.text}</div>
      ${o.buttons ? html`<div class="buttons" @click=${(e: Event) => e.stopPropagation()}>${o.buttons}</div>` : nothing}
    </div>
    ${o.open
      ? html`<button class="round banner-go" aria-label=${o.open.label} @click=${(e: Event) => {
          e.stopPropagation();
          o.open!.run();
        }}><ha-icon icon="mdi:chevron-right"></ha-icon></button>`
      : nothing}
  </div>`;
}

/** Temperature and motion of a group, or nothing. */
export function metaOf(state: GroupState): TemplateResult | typeof nothing {
  if (state.temperature === null && !state.motion) return nothing;
  return html`<div class="meta">
    ${state.temperature !== null ? html`<span>${state.temperature.toFixed(1)}°</span>` : nothing}
    ${state.motion ? html`<span class="motion" title="motion"></span>` : nothing}
  </div>`;
}

/**
 * An automation's card, like the Hue app's: its picture, "07:00 • Wake up" over "Weekdays"
 * (or what starts it), "start" (going to sleep: play) and its switch.
 */
export function automationCard(
  glyph: string,
  title: string,
  sub: string,
  open: () => void,
  toggle: TemplateResult | typeof nothing = nothing,
  start: { label: string; run: () => void } | null = null,
): TemplateResult {
  return html`<div class="auto-card">
    <button class="row-open" @click=${open}>
      ${glyph ? html`<ha-icon icon=${glyph}></ha-icon>` : nothing}
      <span class="text"><span class="title">${title}</span>${sub ? html`<span class="sub">${sub}</span>` : nothing}</span>
    </button>
    ${start
      ? html`<button class="round start" aria-label=${start.label} @click=${() => {
          haptic("success");
          start.run();
        }}>${icon("play")}</button>`
      : nothing}
    ${toggle}
  </div>`;
}

/** What a card shows; everything but the picture and the name is optional. */
export interface TileCard {
  /** The picture on top: an icon or a round picture (`.dot`). */
  art: TemplateResult;
  name: string;
  /** Lines under the name (room, status, readings); empty ones are left out. */
  sub?: string[];
  /** The card's switch, in a zone of its own at the bottom. */
  toggle?: TemplateResult;
  /** The switch is shown but out of reach. */
  inert?: boolean;
  /** Absolutely placed extras (action buttons, the sync glow). */
  overlay?: TemplateResult | typeof nothing;
  classes?: Record<string, boolean>;
  style?: Record<string, string | undefined>;
  click?: (e: Event) => void;
}

/**
 * Every card of the panel (scenes, lights, sensors) has the same layout, like the Hue app's:
 * the picture at a fixed distance from the top, a text block of fixed height with the name
 * (and lines under it) centered in it, and an optional switch zone at the bottom.
 */
export function tileCard(card: TileCard): TemplateResult {
  const sub = (card.sub || []).filter(Boolean);
  return html`<div
    class=${classMap({ "tile-card": true, switchable: !!card.toggle, ...card.classes })}
    style=${styleMap(card.style || {})}
    role="button"
    tabindex="0"
    @click=${card.click}
  >
    ${card.overlay ?? nothing}
    <div class="art">${card.art}</div>
    <div class=${classMap({ text: true, [`subs-${Math.min(sub.length, 2)}`]: true })}>
      <div class="name">${card.name}</div>
      ${sub.slice(0, 2).map((line) => html`<div class="sub">${line}</div>`)}
    </div>
    ${card.toggle ? html`<div class=${classMap({ "switch-zone": true, inert: !!card.inert })}>${card.toggle}</div>` : nothing}
  </div>`;
}

/**
 * A scene's dynamic speed on a sheet, the Hue app's 1-12 with its word ("9 - Fast"): the
 * room's "⋯" and the scene editor's "Dynamic speed" row open it; "Done" keeps the step.
 */
export function speedSheet(ctx: StudioContext, o: { step: number; set: (step: number) => void; close: () => void; done: () => void }): TemplateResult {
  const { t } = ctx;
  const word = t(`effects.speed_${speedWord(o.step)}` as StringKey);
  return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && o.close()}>
    <div class="box form sensor-sheet fade-sheet" role="dialog" aria-label=${t("scene.speed")}>
      <div class="sheet-bar">
        <button class="round close" aria-label=${t("common.close")} @click=${o.close}>${icon("close")}</button>
        <div class="grow">${t("scene.speed")}</div>
        <button class="pill save" @click=${() => {
          haptic("success");
          o.done();
        }}>${t("color.done")}</button>
      </div>
      <div class="fade-body">
        <div class="fade-values"><div><div class="caps">${t("scene.speed")}</div><div class="big-value">${o.step} - ${word}</div></div></div>
        <hue-studio-slider class="fade-slider" .min=${1} .max=${SPEED_STEPS} .value=${o.step} .label=${t("scene.speed")}
          @value-input=${(e: CustomEvent<number>) => o.set(Math.round(e.detail))}
          @value-change=${(e: CustomEvent<number>) => o.set(Math.round(e.detail))}></hue-studio-slider>
        <div class="fade-ticks">${Array.from({ length: SPEED_STEPS }, (_, i) => html`<span>${i + 1}</span>`)}</div>
      </div>
    </div>
  </div>`;
}

/** Seconds of one drift of a dynamic light's colors: slow at speed 0, quick at 1. */
export const dynamicPeriod = (speed: number): number => Math.round((24 - 20 * Math.min(1, Math.max(0, speed))) * 10) / 10;

/** A light card (room, scene editor, color view): icon, name, toggle; colored like the light. */
export function lightTile(ctx: StudioContext, id: string, open: () => void, { selected = false, busy = false, sub = "" } = {}): TemplateResult {
  const state = ctx.hass.states[id];
  const colors = busy ? [] : lightColors(ctx.hass, id, ctx.lightInfo[id]);
  const unreachable = !state || state.state === "unavailable";
  const brightness = state?.state === "on" ? Math.round(((state.attributes.brightness as number | undefined) ?? 255) / 2.55) : undefined;
  const surface = surfaceOf({ on: colors.length > 0, colors, available: !unreachable, brightness });
  // Busy: a Sync Box drives it (the Hue app's "Sync active": white pulsing around the icon,
  // the switch off, a tap refused); unreachable: the bridge lost it. Either is said
  // in place of the room line, and the switch rests.
  const status = busy ? ctx.t("light.sync_active") : unreachable ? ctx.t("light.unreachable") : "";
  // A dynamic scene playing on it: said under its name, its colors drifting at its speed.
  const dynamics = ctx.lightInfo[id]?.dynamics;
  const dynamic = !busy && !unreachable && state?.state === "on" && dynamics?.status === "dynamic_palette";
  return tileCard({
    art: html`<ha-icon icon=${lightIcon(ctx.hass, id, ctx.lightInfo[id])}></ha-icon>`,
    name: friendlyName(ctx.hass, id),
    sub: [status || (dynamic ? ctx.t("light.dynamics") : sub)],
    toggle: toggle(!busy && state?.state === "on", ctx.t("common.toggle"), () => ctx.call("light", "toggle", { entity_id: id })),
    inert: busy || unreachable,
    overlay: busy ? html`<div class="sync-glow" aria-hidden="true"></div>` : nothing,
    classes: { light: true, ...surface.classes, off: false, selected, busy, dynamic },
    style: {
      ...surface.style,
      "--ring": colors[0] || "rgba(255, 255, 255, 0.85)",
      ...(dynamic ? { "--lit-bg": colorsCss([...colors, colors[0]], "var(--surface)"), "--dyn-dur": `${dynamicPeriod(dynamics!.speed)}s` } : {}),
    },
    click: busy ? (e: Event) => refuse(e.currentTarget) : open,
  });
}

/**
 * Brightness slider wired to a group: throttled while dragging, exact value on release.
 * Inert while the group is off or unavailable (the toggle turns it on), so a stray touch
 * never switches a room on.
 */
export const groupSlider = (ctx: StudioContext, group: Group, state: GroupState, label: string): TemplateResult => {
  const send = brightnessSender(ctx, group);
  return html`<hue-studio-slider
    .value=${state.brightness}
    .label=${label}
    .disabled=${!state.on || !state.available}
    @value-input=${(e: CustomEvent<number>) => send(e.detail)}
    @value-change=${(e: CustomEvent<number>) => {
      send(e.detail);
      send.flush();
    }}
  ></hue-studio-slider>`;
};

/** Finger travel (px) that tells a horizontal drag from a vertical scroll. */
const SLOP = 8;
/** A touch shorter than this without travel is a tap that sets the value. */
const TAP_MS = 350;

/**
 * Horizontal slider (brightness 1-100 by default, or any integer range). Fires
 * `value-input` while dragging and `value-change` on release (`value-cancel` when a drag
 * is dropped); ignores `value` from outside while the user drags it.
 *
 * Touch: the page keeps vertical scrolling (`touch-action: pan-y`) and the slider waits
 * for the finger to move sideways before it takes over, so scrolling across a card never
 * changes a value. A short tap still sets the value. `disabled` makes it inert: events
 * pass through to the card below.
 */
@customElement("hue-studio-slider")
export class StudioSlider extends LightElement {
  @property({ type: Number }) accessor value = 0;
  @property({ type: Number }) accessor min = 1;
  @property({ type: Number }) accessor max = 100;
  @property() accessor label = "";
  @property({ type: Boolean, reflect: true }) accessor disabled = false;
  private dragging = false;
  private shown = 0;
  /** A touch that has not yet shown whether it is a drag, a tap or a scroll. */
  private pending: { id: number; x: number; y: number; t: number } | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("slider");
    this.setAttribute("role", "slider");
    this.addEventListener("pointerdown", this.onDown);
    this.addEventListener("pointermove", this.onMove);
    this.addEventListener("pointerup", this.onUp);
    this.addEventListener("pointercancel", this.onCancel);
    this.addEventListener("click", this.onClick);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("pointerdown", this.onDown);
    this.removeEventListener("pointermove", this.onMove);
    this.removeEventListener("pointerup", this.onUp);
    this.removeEventListener("pointercancel", this.onCancel);
    this.removeEventListener("click", this.onClick);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("disabled") && this.disabled) this.reset();
    if (changed.has("value") && !this.dragging) this.shown = this.value;
  }

  protected override render() {
    this.style.setProperty("--value", `${((this.shown - this.min) / (this.max - this.min)) * 100}%`);
    this.setAttribute("aria-valuemin", String(this.min));
    this.setAttribute("aria-valuemax", String(this.max));
    this.setAttribute("aria-label", this.label);
    this.setAttribute("aria-valuenow", String(this.shown));
    this.setAttribute("aria-disabled", String(this.disabled));
    return html`<div class="fill"></div><div class="knob"></div>`;
  }

  private valueAt(e: PointerEvent): number {
    const r = this.getBoundingClientRect();
    const v = this.min + ((e.clientX - r.left) / r.width) * (this.max - this.min);
    return Math.max(this.min, Math.min(this.max, Math.round(v)));
  }

  private show(v: number, event: "value-input" | "value-change"): void {
    this.shown = v;
    this.requestUpdate();
    this.dispatchEvent(new CustomEvent(event, { detail: v, bubbles: true }));
  }

  private startDrag(e: PointerEvent): void {
    this.pending = null;
    try {
      this.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone (released between events): drag without capture.
    }
    this.dragging = true;
    this.classList.add("dragging");
    this.show(this.valueAt(e), "value-input");
  }

  private reset(): void {
    this.pending = null;
    if (!this.dragging) return;
    this.dragging = false;
    this.classList.remove("dragging");
    this.shown = this.value;
    this.requestUpdate();
    this.dispatchEvent(new CustomEvent("value-cancel", { bubbles: true }));
  }

  private onDown = (e: PointerEvent): void => {
    if (this.disabled || !e.isPrimary) return;
    e.stopPropagation();
    if (e.pointerType === "mouse") this.startDrag(e);
    else this.pending = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
  };

  private onMove = (e: PointerEvent): void => {
    if (this.dragging) {
      this.show(this.valueAt(e), "value-input");
      return;
    }
    const p = this.pending;
    if (!p || p.id !== e.pointerId) return;
    const dx = Math.abs(e.clientX - p.x);
    const dy = Math.abs(e.clientY - p.y);
    if (dx > SLOP && dx > dy) this.startDrag(e);
    else if (dy > SLOP) this.pending = null; // a scroll: the browser takes it
  };

  private onUp = (e: PointerEvent): void => {
    const p = this.pending;
    if (p?.id === e.pointerId) {
      this.pending = null;
      if (e.timeStamp - p.t < TAP_MS) this.show(this.valueAt(e), "value-change");
      return;
    }
    if (!this.dragging) return;
    this.dragging = false;
    this.classList.remove("dragging");
    this.show(this.valueAt(e), "value-change");
  };

  /** The browser took the touch over (it scrolls): drop it, restore the real value. */
  private onCancel = (): void => this.reset();

  /** Taps on the slider are ours, not the card's; an inert slider lets them through. */
  private onClick = (e: Event): void => {
    if (!this.disabled) e.stopPropagation();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-slider": StudioSlider;
  }
}
