// Effects, like the Hue app's effects page: categories, a row of presets per effect plus
// "adjust" (own color, brightness, speed 1-12, applied live). Lives inside the color view;
// commands go to the given lights that can play the effect.

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import { clipToGamut, mirekToRgb, rgbCss, rgbToXy, wheelToXy, WHEEL_CSS, xyToRgb, xyToWheel } from "../color.ts";
import {
  availableEffects,
  CATEGORIES,
  effectArt,
  effectColor,
  effectData,
  type EffectId,
  effectLights,
  type EffectPreset,
  matchesPreset,
  PRESETS,
  SPEED_STEPS,
  speedToStep,
  speedWord,
  stepToSpeed,
} from "../effects.ts";
import type { StringKey } from "../i18n.ts";
import type { XY } from "../types.ts";
import { icon } from "../ui.ts";
import { StudioView } from "./base.ts";

interface Custom {
  effect: EffectId;
  xy: XY;
  /** Brightness 1-100. */
  brightness: number;
  /** Speed step 1-12. */
  step: number;
  wheel: boolean;
}

const pct = (v: number) => `${((v + 1) / 2) * 100}%`;

@customElement("hue-studio-effects")
export class EffectsView extends StudioView {
  /** Lights the effects apply to (the selected light or the whole group). */
  @property({ attribute: false }) accessor lights: string[] = [];
  @state() private accessor custom: Custom | null = null;
  private pressing = false;

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const available = availableEffects(this.lights, ctx.lightInfo);
    this.className = "effects";
    if (!available.length) return html`<p class="empty">${t("effects.none")}</p>`;
    return html`
      ${CATEGORIES.map(({ id, effects }) => {
        const list = effects.filter((e) => available.includes(e));
        if (!list.length) return nothing;
        return html`<h2 class="label">${t(`effects.cat_${id}` as StringKey)}</h2>
          ${list.map((e) => html`<div class="fx-row">${PRESETS[e].map((p) => this.tile(p))}${this.adjustTile(e)}</div>`)}`;
      })}
      ${this.custom ? this.sheet(this.custom) : nothing}
    `;
  }

  private name(effect: EffectId): string {
    return this.ctx.t(`effects.${effect}` as StringKey);
  }

  /** Lights (of ours, lit) currently running the preset. */
  private runningPreset(p: EffectPreset): string[] {
    const { hass, lightInfo } = this.ctx;
    return this.lights.filter((id) => hass.states[id]?.state === "on" && matchesPreset(lightInfo[id]?.effect, p));
  }

  private tile(p: EffectPreset) {
    const { ctx } = this;
    const running = this.runningPreset(p);
    const click = () => {
      if (running.length) {
        ctx.call("hue_studio", "set_effect", { entity_id: running, effect: "no_effect" });
        return;
      }
      ctx.call("hue_studio", "set_effect", { entity_id: effectLights(this.lights, ctx.lightInfo, p.effect), ...effectData(p.effect, p) });
    };
    return html`<button class=${classMap({ fx: true, on: running.length > 0 })} @click=${click}>
      <span class="art" style=${styleMap({ background: effectArt(p.effect, p) })}></span>
      <span class="name">${this.name(p.effect)}</span>
      <span class="sub">${ctx.t(`effects.variant_${p.variant}` as StringKey)}</span>
    </button>`;
  }

  private adjustTile(effect: EffectId) {
    const open = () => {
      const { hass, lightInfo } = this.ctx;
      const lit = effectLights(this.lights, lightInfo, effect).filter((id) => hass.states[id]?.state === "on");
      const running = lit.map((id) => lightInfo[id]?.effect).find((r) => r?.effect === effect);
      const brightness = lit.length ? Math.round((hass.states[lit[0]].attributes.brightness ?? 255) / 2.55) : 100;
      const xy = running?.xy ?? (running?.mirek ? rgbToXy(...mirekToRgb(running.mirek)) : effectColor(effect));
      this.custom = { effect, xy, brightness: Math.max(1, brightness), step: speedToStep(running?.speed ?? 0.5), wheel: false };
      // Start it right away, like the Hue app: what you adjust is what you see.
      if (!running) this.apply(this.custom);
    };
    return html`<button class="fx create" @click=${open}>
      <span class="art plus">${icon("plus")}</span>
      <span class="name">${this.name(effect)}</span>
      <span class="sub">${this.ctx.t("effects.adjust")}</span>
    </button>`;
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
      this.custom = null;
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
    "hue-studio-effects": EffectsView;
  }
}
