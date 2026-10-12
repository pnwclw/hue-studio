// Room/zone controls shared by the home cards, the room header, the color view and the
// more-info dialog: the brightness slider, group state classes and throttled commands.

import { html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import type { StudioContext } from "./context.ts";
import { colorsCss, friendlyName, type Group, groupState, type GroupState, lightColors, lightIcon, needsDarkText } from "./model.ts";
import { LightElement, refuse, type Throttled, throttle, toggle } from "./ui.ts";

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

export function toggleGroup(ctx: StudioContext, group: Group): void {
  const on = groupState(ctx.hass, group).on;
  ctx.call("light", on ? "turn_off" : "turn_on", { entity_id: group.target });
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

/** Temperature and motion of a group, or nothing. */
export function metaOf(state: GroupState): TemplateResult | typeof nothing {
  if (state.temperature === null && !state.motion) return nothing;
  return html`<div class="meta">
    ${state.temperature !== null ? html`<span>${state.temperature.toFixed(1)}°</span>` : nothing}
    ${state.motion ? html`<span class="motion" title="motion"></span>` : nothing}
  </div>`;
}

/** A light tile (room, scene editor, color view): icon, name, toggle; colored like the light. */
export function lightTile(ctx: StudioContext, id: string, open: () => void, { selected = false, busy = false, sub = "" } = {}): TemplateResult {
  const state = ctx.hass.states[id];
  const colors = busy ? [] : lightColors(ctx.hass, id, ctx.lightInfo[id]);
  const unreachable = !state || state.state === "unavailable";
  const brightness = state?.state === "on" ? Math.round(((state.attributes.brightness as number | undefined) ?? 255) / 2.55) : undefined;
  const surface = surfaceOf({ on: colors.length > 0, colors, available: !unreachable, brightness });
  const style = { ...surface.style, "--ring": colors[0] || "rgba(255, 255, 255, 0.85)" };
  // Busy: a Sync Box drives it (the Hue app's "Sync active": a moving glow, the switch off, a
  // tap refused); unreachable: the bridge lost it. Either is said, and the switch rests.
  const status = busy
    ? html`<div class="status">${ctx.t("light.sync_active")}</div>`
    : unreachable
      ? html`<div class="status">${ctx.t("light.unreachable")}</div>`
      : nothing;
  return html`<div
    class=${classMap({ light: true, ...surface.classes, off: false, selected, busy })}
    style=${styleMap(style)}
    @click=${busy ? (e: Event) => refuse(e.currentTarget) : open}
  >
    ${busy ? html`<div class="sync-glow" aria-hidden="true"></div>` : nothing}
    <ha-icon icon=${lightIcon(ctx.hass, id, ctx.lightInfo[id])}></ha-icon>
    <div class="name">${friendlyName(ctx.hass, id)}</div>
    ${sub ? html`<div class="sub">${sub}</div>` : nothing}
    ${status}
    <div class=${classMap({ "switch-zone": true, inert: busy || unreachable })}>
      ${toggle(!busy && state?.state === "on", ctx.t("common.toggle"), () => ctx.call("light", "toggle", { entity_id: id }))}
    </div>
  </div>`;
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
