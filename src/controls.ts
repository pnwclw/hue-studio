// Room/zone controls shared by the home cards, the room header, the color view and the
// more-info dialog: the brightness slider, group state classes and throttled commands.

import { html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

import type { StudioContext } from "./context.ts";
import { colorsCss, type Group, groupState, type GroupState, needsDarkText } from "./model.ts";
import { LightElement, type Throttled, throttle } from "./ui.ts";

/**
 * Bridge limits: ~1 command/s for a Hue group, ~10/s for lights in total. A group command
 * is one command for the whole room; without a group, every light costs one.
 */
export const commandInterval = (group: Group): number =>
  group.target.length === 1 && group.group ? 1000 : Math.max(120, 100 * group.target.length);

/** Throttled brightness command for a group; one per group, kept across renders. */
export function brightnessSender(ctx: StudioContext, group: Group): Throttled<[number]> {
  return ctx.sender(`bri:${group.key}:${group.target.join(",")}`, commandInterval(group), (v: number) =>
    ctx.call("light", "turn_on", { entity_id: group.target, brightness_pct: v }),
  );
}

export function toggleGroup(ctx: StudioContext, group: Group): void {
  const on = groupState(ctx.hass, group).on;
  ctx.call("light", on ? "turn_off" : "turn_on", { entity_id: group.target });
}

/** Classes and the lit background of a surface (card, header) showing a group. */
export function surfaceOf(state: Pick<GroupState, "on" | "colors"> & { available?: boolean }) {
  return {
    classes: {
      surface: true,
      lit: state.on,
      off: !state.on,
      unavailable: state.available === false,
      "dark-text": state.on && needsDarkText(state.colors),
    },
    style: { "--lit-bg": colorsCss(state.colors, "var(--surface)") },
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

/** Brightness slider wired to a group: throttled while dragging, exact value on release. */
export const groupSlider = (ctx: StudioContext, group: Group, state: GroupState, label: string): TemplateResult => {
  const send = brightnessSender(ctx, group);
  return html`<hue-studio-slider
    .value=${state.brightness}
    .label=${label}
    @value-input=${(e: CustomEvent<number>) => send(e.detail)}
    @value-change=${(e: CustomEvent<number>) => {
      send(e.detail);
      send.flush();
    }}
  ></hue-studio-slider>`;
};

/**
 * Horizontal brightness slider (1-100). Fires `value-input` while dragging and
 * `value-change` on release; ignores `value` from outside while the user drags it.
 */
@customElement("hue-studio-slider")
export class StudioSlider extends LightElement {
  @property({ type: Number }) accessor value = 0;
  @property() accessor label = "";
  private dragging = false;
  private shown = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("slider");
    this.setAttribute("role", "slider");
    this.setAttribute("aria-valuemin", "1");
    this.setAttribute("aria-valuemax", "100");
    this.addEventListener("pointerdown", this.onDown);
    this.addEventListener("pointermove", this.onMove);
    this.addEventListener("pointerup", this.onEnd);
    this.addEventListener("pointercancel", this.onEnd);
    this.addEventListener("click", stop);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("pointerdown", this.onDown);
    this.removeEventListener("pointermove", this.onMove);
    this.removeEventListener("pointerup", this.onEnd);
    this.removeEventListener("pointercancel", this.onEnd);
    this.removeEventListener("click", stop);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("value") && !this.dragging) this.shown = this.value;
  }

  protected override render() {
    this.style.setProperty("--value", `${this.shown}%`);
    this.setAttribute("aria-label", this.label);
    this.setAttribute("aria-valuenow", String(this.shown));
    return html`<div class="fill"></div><div class="knob"></div>`;
  }

  private valueAt(e: PointerEvent): number {
    const r = this.getBoundingClientRect();
    return Math.max(1, Math.min(100, Math.round(((e.clientX - r.left) / r.width) * 100)));
  }

  private show(v: number, event: "value-input" | "value-change"): void {
    this.shown = v;
    this.requestUpdate();
    this.dispatchEvent(new CustomEvent(event, { detail: v, bubbles: true }));
  }

  private onDown = (e: PointerEvent): void => {
    e.stopPropagation();
    this.setPointerCapture(e.pointerId);
    this.dragging = true;
    this.classList.add("dragging");
    this.show(this.valueAt(e), "value-input");
  };

  private onMove = (e: PointerEvent): void => {
    if (this.dragging) this.show(this.valueAt(e), "value-input");
  };

  private onEnd = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.classList.remove("dragging");
    this.show(this.valueAt(e), "value-change");
  };
}

const stop = (e: Event): void => e.stopPropagation();

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-slider": StudioSlider;
  }
}
