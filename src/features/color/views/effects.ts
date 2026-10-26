// Effects, like the Hue app's effects page: categories, a row of presets per effect plus
// "adjust" (own color, brightness, speed 1-12, applied live). Lives inside the color view;
// commands go to the given lights that can play the effect.

import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import { mirekToRgb, rgbToXy } from "../../../core/color.ts";
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
  speedToStep,
} from "../effects.ts";
import type { StringKey } from "../../../i18n/index.ts";
import type { XY } from "../../../core/types.ts";
import { icon } from "../../../ds/ui.ts";
import { StudioView } from "../../../ds/base.ts";

/** The "adjust" sheet's settings; the color view shows the sheet (outside its scrolling body). */
export interface Custom {
  effect: EffectId;
  xy: XY;
  /** Brightness 1-100. */
  brightness: number;
  /** Speed step 1-12. */
  step: number;
  wheel: boolean;
}

@customElement("hue-studio-effects")
export class EffectsView extends StudioView {
  /** Lights the effects apply to (the selected light or the whole group). */
  @property({ attribute: false }) accessor lights: string[] = [];

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
      const custom: Custom = { effect, xy, brightness: Math.max(1, brightness), step: speedToStep(running?.speed ?? 0.5), wheel: false };
      // Start it right away, like the Hue app: what you adjust is what you see.
      this.dispatchEvent(new CustomEvent("effect-adjust", { detail: { custom, start: !running }, bubbles: true }));
    };
    return html`<button class="fx create" @click=${open}>
      <span class="art plus">${icon("plus")}</span>
      <span class="name">${this.name(effect)}</span>
      <span class="sub">${this.ctx.t("effects.adjust")}</span>
    </button>`;
  }

}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-effects": EffectsView;
  }
}
