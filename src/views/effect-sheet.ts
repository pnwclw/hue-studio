// The "adjust" sheet of an effect (own color, brightness, speed 1-12, applied live). Shown
// by the color view outside its scrolling body, so it always covers the whole screen.
// Fires `close`.

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";

import { clipToGamut, rgbCss, wheelToXy, WHEEL_CSS, xyToRgb, xyToWheel } from "../color.ts";
import { effectArt, effectData, type EffectId, effectLights, SPEED_STEPS, speedWord, stepToSpeed } from "../effects.ts";
import type { StringKey } from "../i18n.ts";
import { icon } from "../ui.ts";
import { StudioView } from "./base.ts";
import type { Custom } from "./effects.ts";

const pct = (v: number) => `${((v + 1) / 2) * 100}%`;

@customElement("hue-studio-effect-sheet")
export class EffectSheet extends StudioView {
  /** Lights the effect applies to. */
  @property({ attribute: false }) accessor lights: string[] = [];
  @property({ attribute: false }) accessor initial: Custom | null = null;
  /** Start the effect when the sheet opens (it was not running). */
  @property({ type: Boolean }) accessor start = false;

  @state() private accessor custom: Custom | null = null;
  private pressing = false;

  override willUpdate(): void {
    if (!this.custom && this.initial) {
      this.custom = this.initial;
      if (this.start) this.apply(this.custom);
    }
  }

  private name(effect: EffectId): string {
    return this.ctx.t(`effects.${effect}` as StringKey);
  }

  protected override render() {
    return this.custom ? this.sheet(this.custom) : nothing;
  }

  /** Send the custom effect (throttled: it follows sliders and the wheel). */
  private apply(c: Custom): void {
    const { ctx } = this;
    const lights = effectLights(this.lights, ctx.lightInfo, c.effect);
    if (!lights.length) return;
    const send = ctx.sender(`fx:${lights.join(",")}`, Math.max(250, 120 * lights.length), (data: Record<string, unknown>) =>
      ctx.call("hue_studio", "set_effect", { entity_id: lights, ...data }),
    );
    send(effectData(c.effect, { xy: c.xy, speed: stepToSpeed(c.step), brightness: c.brightness }));
  }

  private change(patch: Partial<Custom>, send = true): void {
    if (!this.custom) return;
    this.custom = { ...this.custom, ...patch };
    if (send) this.apply(this.custom);
  }

  private sheet(c: Custom) {
    const { t } = this.ctx;
    const close = () => {
      this.ctx.flushSenders("fx:");
      this.dispatchEvent(new Event("close"));
    };
    const word = t(`effects.speed_${speedWord(c.step)}` as StringKey);
    return html`<div class="sheet" @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="box fx-sheet" role="dialog" aria-label=${this.name(c.effect)}>
        <div class="sheet-bar">
          <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
          <div class="grow">${this.name(c.effect)}</div>
          <button class="pill done" @click=${close}>${t("color.done")}</button>
        </div>
        <div class="fx-head">
          <span class="art" style=${styleMap({ background: effectArt(c.effect, { xy: c.xy }) })}></span>
          <h3>${this.name(c.effect)}</h3>
        </div>
        <h2 class="label">${t("effects.behavior")}</h2>
        <div class="rows">
          <div class="item">
            <span>${t("effects.color")}</span>
            <button
              class="swatch-btn"
              aria-label=${t("effects.color")}
              style=${styleMap({ background: rgbCss(xyToRgb(...c.xy)) })}
              @click=${() => this.change({ wheel: !c.wheel }, false)}
            ></button>
          </div>
          ${c.wheel ? this.miniWheel(c) : nothing}
          <div class="item col">
            <div class="line"><span>${t("common.brightness")}</span><span class="dim">${c.brightness}%</span></div>
            <hue-studio-slider
              .value=${c.brightness}
              .label=${t("common.brightness")}
              @value-input=${(e: CustomEvent<number>) => this.change({ brightness: e.detail })}
              @value-change=${(e: CustomEvent<number>) => this.change({ brightness: e.detail })}
            ></hue-studio-slider>
          </div>
          <div class="item col">
            <div class="line"><span>${t("effects.speed")}</span><span class="dim">${c.step} - ${word}</span></div>
            <hue-studio-slider
              class="steps"
              .min=${1}
              .max=${SPEED_STEPS}
              .value=${c.step}
              .label=${t("effects.speed")}
              @value-input=${(e: CustomEvent<number>) => e.detail !== c.step && this.change({ step: e.detail })}
              @value-change=${(e: CustomEvent<number>) => this.change({ step: e.detail })}
            ></hue-studio-slider>
            <div class="ticks">${Array.from({ length: SPEED_STEPS }, (_, i) => html`<span class=${i + 1 === c.step ? "on" : ""}>${i + 1}</span>`)}</div>
          </div>
        </div>
      </div>
    </div>`;
  }

  /** A small color wheel: tap or drag to pick the effect's color (clipped to the gamut). */
  private miniWheel(c: Custom) {
    const gamut = this.ctx.lightInfo[effectLights(this.lights, this.ctx.lightInfo, c.effect)[0]]?.gamut;
    const pick = (e: PointerEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      let x = ((e.clientX - r.left) / r.width) * 2 - 1;
      let y = ((e.clientY - r.top) / r.height) * 2 - 1;
      const len = Math.hypot(x, y);
      if (len > 1) [x, y] = [x / len, y / len];
      this.change({ xy: clipToGamut(wheelToXy(x, y), gamut) });
    };
    const [px, py] = xyToWheel(...c.xy);
    return html`<div class="item wheel-item">
      <div
        class="wheel mini color"
        style="--wheel-color:${WHEEL_CSS}"
        @pointerdown=${(e: PointerEvent) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          this.pressing = true;
          pick(e);
        }}
        @pointermove=${(e: PointerEvent) => this.pressing && pick(e)}
        @pointerup=${() => {
          this.pressing = false;
          this.ctx.flushSenders("fx:");
        }}
        @pointercancel=${() => (this.pressing = false)}
      >
        <div class="dot" style=${styleMap({ left: pct(px), top: pct(py), background: rgbCss(xyToRgb(...c.xy)) })}></div>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-effect-sheet": EffectSheet;
  }
}
