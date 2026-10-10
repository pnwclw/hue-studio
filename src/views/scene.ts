// Scene editor, like the Hue app's "Edit scene": the scene is shown on its lights, which
// are adjusted live (brightness here, colors on the wheel); "Save" stores what they show
// now plus the name, dynamic speed and auto-play. "Colors" shuffles the palette over the
// lights, "Reset scene" rebuilds the scene from its palette.

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import { paletteArt } from "../color.ts";
import type { SceneDraft } from "../context.ts";
import { groupSlider, lightTile, surfaceOf } from "../controls.ts";
import { SPEED_STEPS, speedToStep, speedWord, stepToSpeed } from "../effects.ts";
import { galleryMatch, thumbUrl } from "../gallery-data.ts";
import type { StringKey } from "../i18n.ts";
import { findGroup, friendlyName, type Group, groupState } from "../model.ts";
import { icon, toggle } from "../ui.ts";
import { StudioView } from "./base.ts";
import { sceneArt, sceneColors } from "./room.ts";

const RESET_CONFIRM_MS = 3500;

@customElement("hue-studio-scene-view")
export class SceneView extends StudioView {
  /** Room key. */
  @property() accessor key = "";
  /** Scene entity id. */
  @property() accessor scene = "";

  @state() private accessor editingName = false;
  @state() private accessor confirmReset = false;
  private started = false;
  private resetTimer?: ReturnType<typeof setTimeout>;

  private get name(): string {
    const st = this.ctx.hass.states[this.scene];
    return st?.attributes.name || friendlyName(this.ctx.hass, this.scene);
  }

  /** Unsaved edits, kept in the context while the user visits the color wheel. */
  private get draft(): SceneDraft {
    const { ctx } = this;
    if (ctx.sceneDraft?.scene !== this.scene) ctx.sceneDraft = { scene: this.scene, name: null, speed: null, autoplay: null };
    return ctx.sceneDraft;
  }

  private edit(patch: Partial<SceneDraft>): void {
    Object.assign(this.draft, patch);
    this.requestUpdate();
  }

  protected override willUpdate(): void {
    // Show the scene on its lights first: editing works on what the lights show.
    if (this.started || !this.ctx.ready || !this.ctx.hass.states[this.scene]) return;
    this.started = true;
    const info = this.ctx.sceneInfo[this.scene];
    if (!info || info.active === "inactive") {
      const group = findGroup(this.ctx.home, this.key);
      this.ctx.call("scene", "turn_on", { entity_id: this.scene }).then((ok) => {
        if (ok && group) this.ctx.markManual(group);
      });
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.resetTimer);
  }

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const room = findGroup(ctx.home, this.key);
    const roomPath = `/room/${encodeURIComponent(this.key)}`;
    const close = () => {
      ctx.sceneDraft = null;
      ctx.go(roomPath);
    };
    if (!room || !ctx.hass.states[this.scene]) {
      return html`<div class="page">
        <div class="topbar"><button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button></div>
        <p class="empty">${t("scene.not_found")}</p>
      </div>`;
    }

    const info = ctx.sceneInfo[this.scene];
    const draft = this.draft;
    const lights = (info?.lights ?? []).filter((id) => ctx.hass.states[id]);
    const group: Group = lights.length
      ? { ...room, key: `scene:${this.scene}`, lights, target: sameSet(lights, room.lights) ? room.target : lights }
      : room;
    const state = groupState(ctx.hass, group, ctx.lightInfo);
    const match = galleryMatch(ctx.gallery, this.name);
    const dot = match ? `url("${thumbUrl(match.id)}") center / cover, ${paletteArt(match)}` : sceneArt(info);
    const surface = surfaceOf({ on: true, colors: sceneColors(info) });
    const here = `${roomPath}/scene/${encodeURIComponent(this.scene)}`;
    const name = draft.name ?? this.name;
    const speed = draft.speed ?? speedToStep(info?.speed ?? 0.5);
    const autoplay = draft.autoplay ?? !!info?.auto_dynamic;
    const word = t(`effects.speed_${speedWord(speed)}` as StringKey);

    return html`<div class="page scene-edit">
      <div class=${classMap({ topbar: true, ...surface.classes })} style=${styleMap(surface.style)}>
        <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
        <div class="title">${t("scene.edit")}</div>
        <button class="pill save" @click=${() => this.save()}>${t("scene.save")}</button>
      </div>
      <div class=${classMap({ hero: true, ...surface.classes })} style=${styleMap(surface.style)}>
        <div class="inner">
          <div class="dot big" style=${styleMap({ background: dot })}></div>
          <div class="name-row">
            ${this.editingName
              ? html`<input
                  class="name-input"
                  .value=${name}
                  maxlength="32"
                  aria-label=${t("scene.rename")}
                  @input=${(e: InputEvent) => this.edit({ name: (e.target as HTMLInputElement).value })}
                  @keydown=${(e: KeyboardEvent) => e.key === "Enter" && (this.editingName = false)}
                />`
              : html`<h1 class="big">${name}</h1>`}
            <button
              class="round rename"
              aria-label=${t("scene.rename")}
              @click=${() => {
                this.editingName = !this.editingName;
                if (this.editingName) this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".name-input")?.focus());
              }}
            >${icon("pencil")}</button>
          </div>
          <div class="line"><span>${t("scene.brightness")}</span><span class="dim">${state.on ? `${state.brightness}%` : ""}</span></div>
          ${groupSlider(ctx, group, state, t("scene.brightness"))}
        </div>
      </div>

      ${info?.dynamic
        ? html`<h2 class="label">${t("scene.dynamic")}</h2>
            <div class="rows">
              <div class="item col">
                <div class="line"><span>${t("scene.speed")}</span><span class="dim">${speed} - ${word}</span></div>
                <hue-studio-slider
                  class="steps"
                  .min=${1}
                  .max=${SPEED_STEPS}
                  .value=${speed}
                  .label=${t("scene.speed")}
                  @value-input=${(e: CustomEvent<number>) => this.edit({ speed: e.detail })}
                  @value-change=${(e: CustomEvent<number>) => this.edit({ speed: e.detail })}
                ></hue-studio-slider>
                <div class="ticks">${Array.from({ length: SPEED_STEPS }, (_, i) => html`<span class=${i + 1 === speed ? "on" : ""}>${i + 1}</span>`)}</div>
              </div>
              <div class="item">
                <div class="grow"><div>${t("scene.autoplay")}</div><div class="dim small">${t("scene.autoplay_sub")}</div></div>
                ${toggle(autoplay, t("scene.autoplay"), () => this.edit({ autoplay: !autoplay }))}
              </div>
            </div>`
        : nothing}

      <div class="section-head">
        <h2 class="label">${t("room.lights")}</h2>
        ${info && info.palette.length > 1
          ? html`<button class="pill shuffle" @click=${() => this.shuffle(lights, info.palette)}>${icon("shuffle")}${t("scene.shuffle")}</button>`
          : nothing}
      </div>
      <div class="grid">
        ${group.lights.map((id) =>
          lightTile(ctx, id, () => ctx.go(`${roomPath}/color?light=${encodeURIComponent(id)}&back=${encodeURIComponent(here)}`)),
        )}
      </div>

      ${info?.resettable
        ? html`<div class="center">
            <button class=${classMap({ pill: true, reset: true, confirm: this.confirmReset })} @click=${() => this.reset()}>
              ${this.confirmReset ? t("scene.reset_confirm") : t("scene.reset")}
            </button>
          </div>`
        : nothing}
    </div>`;
  }

  /** Spread the palette over the lights in a new order (live; "Save" keeps it). */
  private shuffle(lights: string[], palette: [number, number][]): void {
    const points = [...palette];
    for (let i = points.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [points[i], points[j]] = [points[j], points[i]];
    }
    this.ctx.call("hue_studio", "apply_palette", { entity_id: lights, points });
  }

  private async reset(): Promise<void> {
    if (!this.confirmReset) {
      this.confirmReset = true;
      clearTimeout(this.resetTimer);
      this.resetTimer = setTimeout(() => (this.confirmReset = false), RESET_CONFIRM_MS);
      return;
    }
    this.confirmReset = false;
    clearTimeout(this.resetTimer);
    if (await this.ctx.call("hue_studio", "reset_scene", { entity_id: this.scene }, { optimistic: false })) {
      this.ctx.toast(this.ctx.t("scene.reset_done"));
    }
  }

  private async save(): Promise<void> {
    const { ctx } = this;
    const draft = this.draft;
    const info = ctx.sceneInfo[this.scene];
    const data: Record<string, unknown> = { entity_id: this.scene };
    const name = draft.name?.trim();
    if (name && name !== this.name) data.name = name;
    if (info && draft.speed !== null && draft.speed !== speedToStep(info.speed)) data.speed = Math.round(stepToSpeed(draft.speed) * 100);
    if (info && draft.autoplay !== null && draft.autoplay !== info.auto_dynamic) data.auto_dynamic = draft.autoplay;
    if (await ctx.call("hue_studio", "save_scene", data, { optimistic: false })) {
      ctx.sceneDraft = null;
      ctx.toast(ctx.t("scene.saved"));
      ctx.go(`/room/${encodeURIComponent(this.key)}`);
    }
  }
}

const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-scene-view": SceneView;
  }
}
