// Scene editor, like the Hue app's "Edit scene": the scene is shown on its lights, which
// are adjusted live (brightness here, colors on the wheel); "Save" stores what they show
// now plus the name, dynamic speed and auto-play. "Colors" shuffles the palette over the
// lights, "Reset scene" rebuilds the scene from its palette, "Delete scene" removes it from
// the bridge (and so from the Hue app).
// A new scene ("Custom scene" of a room's "+", the scene `new`) is the Hue app's: a picker
// starting from what the lights show now, its name asked first; the lights are set the same
// way (brightness here, colors on the wheel) and "Save" at the bottom creates it.

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import type { SceneDraft } from "../../../core/context.ts";
import { groupSlider, lightTile, sceneColors, sceneDot, speedSheet } from "../../../ds/controls.ts";
import { speedToStep, speedWord, stepToSpeed } from "../../color/effects.ts";
import { leavePanel } from "../../../core/ha-internals.ts";
import type { StringKey } from "../../../i18n/index.ts";
import { colorsCss, findGroup, friendlyName, type Group, groupState } from "../../../core/model.ts";
import { syncingIn } from "../../sync/sync.ts";
import { icon, toggle } from "../../../ds/ui.ts";
import { StudioView } from "../../../ds/base.ts";
import { navRow } from "../../../ds/choice.ts";


/** The scene "id" of a new one (`/room/<key>/scene/new`). */
export const NEW_SCENE = "new";

@customElement("hue-studio-scene-view")
export class SceneView extends StudioView {
  /** Room key. */
  @property() accessor key = "";
  /** Scene entity id. */
  @property() accessor scene = "";
  /** A page outside the panel (the scene sheet's "Edit scene") that closing returns to. */
  @property() accessor exitPath: string | null = null;

  @state() private accessor editingName = false;
  /** The dynamic speed sheet's step (1-12) while it is open. */
  @state() private accessor speedStep: number | null = null;
  /** A new scene's name sheet: what is typed (null while it is closed). */
  @state() private accessor naming: string | null = null;
  @state() private accessor busy = false;
  private started = false;

  private get name(): string {
    const st = this.ctx.hass.states[this.scene];
    return st?.attributes.name || friendlyName(this.ctx.hass, this.scene);
  }

  private get isNew(): boolean {
    return this.scene === NEW_SCENE;
  }

  /** Unsaved edits, kept in the context while the user visits the color wheel. */
  private get draft(): SceneDraft {
    const { ctx } = this;
    const scene = this.isNew ? `${NEW_SCENE}:${this.key}` : this.scene;
    if (ctx.sceneDraft?.scene !== scene) ctx.sceneDraft = { scene, name: null, speed: null, autoplay: null, touched: false };
    return ctx.sceneDraft;
  }

  private edit(patch: Partial<SceneDraft>): void {
    Object.assign(this.draft, patch);
    this.requestUpdate();
  }

  protected override willUpdate(): void {
    // A new scene asks for its name first (once: a visit to the wheel keeps it).
    if (this.isNew) {
      if (!this.started && this.ctx.ready && this.draft.name === null) this.naming = this.ctx.t("room.new_scene");
      this.started = true;
      return;
    }
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

  protected override render() {
    if (this.isNew) return this.renderNew();
    const { ctx } = this;
    const { t } = ctx;
    const room = findGroup(ctx.home, this.key);
    const roomPath = `/room/${encodeURIComponent(this.key)}`;
    const leave = () => {
      ctx.sceneDraft = null;
      this.leave();
    };
    // Unsaved: its name, speed or auto-play, or the lights it shows changed here (the Hue app asks).
    const d0 = this.draft;
    const close = () => this.confirmLeave(d0.touched || d0.name !== null || d0.speed !== null || d0.autoplay !== null, leave);
    if (!room || !ctx.hass.states[this.scene]) {
      return this.screen(this.subHead("", close), html`<p class="empty">${t("scene.not_found")}</p>`);
    }

    const info = ctx.sceneInfo[this.scene];
    const draft = this.draft;
    const lights = (info?.lights ?? []).filter((id) => ctx.hass.states[id]);
    const group: Group = lights.length
      ? { ...room, key: `scene:${this.scene}`, lights, target: sameSet(lights, room.lights) ? room.target : lights }
      : room;
    const state = groupState(ctx.hass, group, ctx.lightInfo);
    const dot = sceneDot(ctx.gallery, this.name, info);
    const here = `${roomPath}/scene/${encodeURIComponent(this.scene)}${this.exitPath ? `?from=${encodeURIComponent(this.exitPath)}` : ""}`;
    const syncing = syncingIn(ctx.boxes, group);
    const name = draft.name ?? this.name;
    const speed = draft.speed ?? speedToStep(info?.speed ?? 0.5);
    const autoplay = draft.autoplay ?? !!info?.auto_dynamic;
    const word = t(`effects.speed_${speedWord(speed)}` as StringKey);

    const head = html`<div class="bar sub">
      <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
      <div class="title">${t("scene.edit")}</div>
      <button class="pill save" @click=${() => this.save()}>${t("scene.save")}</button>
    </div>`;
    // Like the Hue app's: the top (header, name, brightness) tinted with the scene's colors.
    const tint = sceneColors(info).map((c) => `color-mix(in srgb, ${c} 58%, #141416)`);
    const tintStyle = { "--scene-tint": `linear-gradient(115deg, ${(tint.length > 1 ? tint : [tint[0], tint[0]]).join(", ")})` };
    return html`<div class="scene-tint" style=${styleMap(tintStyle)}></div>
      <div class="screen-head scene-head">${head}</div><div class="screen-body"><div class="page scene-edit">
      <div class="scene-top">
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
      </div>
      <div class="rows scene-brightness" @value-change=${() => this.edit({ touched: true })}>
        <div class="item col">
          <div class="line"><span>${t("scene.brightness")}</span><span class="dim">${state.on ? `${state.brightness}%` : ""}</span></div>
          ${groupSlider(ctx, group, state, t("scene.brightness"))}
        </div>
      </div>

      ${info?.dynamic
        ? html`<h2 class="label">${t("scene.dynamic")}</h2>
            <div class="rows">
              ${navRow({ title: t("scene.speed"), value: `${speed} - ${word}` }, () => (this.speedStep = speed))}
              <div class="item">
                <div class="grow"><div>${t("scene.autoplay")}</div><div class="dim small">${t("scene.autoplay_sub")}</div></div>
                ${toggle(autoplay, t("scene.autoplay"), () => this.edit({ autoplay: !autoplay }))}
              </div>
            </div>`
        : nothing}

      <div class="rows lights-card scene-lights">
        <div class="item lights-head">
          <div class="grow">${t("room.lights")}</div>
          ${info && info.palette.length > 1
            ? html`<button class="pill shuffle" @click=${() => this.shuffle(lights, info.palette)}>${icon("shuffle")}${t("scene.shuffle")}</button>`
            : nothing}
        </div>
        <div class="light-row">
          ${group.lights.map((id) =>
            lightTile(ctx, id, () => this.toWheel(`${roomPath}/color?light=${encodeURIComponent(id)}&back=${encodeURIComponent(here)}`), {
              busy: syncing.includes(id),
            }),
          )}
        </div>
      </div>

      ${info?.resettable
        ? html`<div class="center"><button class="pill reset" @click=${() => this.reset()}>
            ${t("scene.reset")}
          </button></div>`
        : nothing}
      ${this.ctx.hass.user?.is_admin
        ? html`<div class="delete-area">
            <button class="delete-btn" @click=${() => this.askDelete(t("scene.delete_note"), t("scene.delete"), () => void this.deleteScene())}>
              ${t("scene.delete")}
            </button>
          </div>`
        : nothing}
    </div></div>
    ${this.speedStep !== null
      ? speedSheet(ctx, {
          step: this.speedStep,
          set: (step) => (this.speedStep = step),
          close: () => (this.speedStep = null),
          done: () => {
            this.edit({ speed: this.speedStep });
            this.speedStep = null;
          },
        })
      : nothing}
    ${this.askSheet()}`;
  }

  /** A new scene: what the room's lights show now, set here and on the wheel, then "Save". */
  private renderNew() {
    const { ctx } = this;
    const { t } = ctx;
    const room = findGroup(ctx.home, this.key);
    const roomPath = `/room/${encodeURIComponent(this.key)}`;
    const leave = () => {
      ctx.sceneDraft = null;
      ctx.go(roomPath);
    };
    const head = html`<div class="bar"><button class="round back" aria-label=${t("common.back")} @click=${() => this.confirmLeave(true, leave)}>${icon("back")}</button></div>`;
    if (!room) return this.screen(head, html`<p class="empty">${t("room.not_found")}</p>`);
    const state = groupState(ctx.hass, room, ctx.lightInfo);
    const name = this.draft.name ?? t("room.new_scene");
    const here = `${roomPath}/scene/${NEW_SCENE}`;
    const syncing = syncingIn(ctx.boxes, room);
    const body = html`<div class="scene-top">
        <div class="dot big" style=${styleMap({ background: colorsCss(state.colors, "var(--surface-raised)") })}></div>
        <div class="name-row">
          <h1 class="big">${name}</h1>
          <button class="round rename" aria-label=${t("scene.rename")} @click=${() => (this.naming = name)}>${icon("pencil")}</button>
        </div>
      </div>
      <div class="rows scene-brightness" @value-change=${() => this.edit({ touched: true })}>
        <div class="item col">
          <div class="line"><span>${t("scene.brightness")}</span><span class="dim">${state.on ? `${state.brightness}%` : ""}</span></div>
          ${groupSlider(ctx, room, state, t("scene.brightness"))}
        </div>
      </div>
      <div class="rows lights-card scene-lights">
        <div class="item lights-head"><div class="grow">${t("room.lights")}</div></div>
        <div class="light-row">
          ${room.lights.map((id) =>
            lightTile(ctx, id, () => this.toWheel(`${roomPath}/color?light=${encodeURIComponent(id)}&back=${encodeURIComponent(here)}`), { busy: syncing.includes(id) }),
          )}
        </div>
      </div>
      ${room.group ? nothing : html`<p class="hint">${t("room.no_group", { room: room.name })}</p>`}`;
    return html`${this.screen(head, body, "scene-edit scene-new")}
      <div class="screen-foot">
        <button class="pill apply" ?disabled=${!room.group || this.busy} @click=${() => this.create(room, name)}>${t("scene.save")}</button>
      </div>
      ${this.naming !== null ? this.nameSheet() : nothing}
      ${this.askSheet()}`;
  }

  /** The Hue app's "Scene name" sheet: the name in a field with a clear button, "Done". */
  private nameSheet() {
    const { ctx } = this;
    const { t } = ctx;
    const done = () => {
      const name = this.naming?.trim();
      this.edit({ name: name || this.draft.name || t("room.new_scene") });
      this.naming = null;
    };
    const cancel = () => {
      if (this.draft.name === null) this.edit({ name: t("room.new_scene") });
      this.naming = null;
    };
    return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && cancel()}>
      <div class="box form name-sheet" role="dialog" aria-label=${t("room.new_scene_name")}>
        <div class="sheet-bar">
          <button class="round close" aria-label=${t("common.close")} @click=${cancel}>${icon("close")}</button>
          <div class="grow">${t("room.new_scene_name")}</div>
          <button class="pill" @click=${done}>${t("common.done")}</button>
        </div>
        <div class="form-body">
          <label class="name-field">
            <input
              class="field outlined"
              maxlength="32"
              aria-label=${t("room.new_scene_name")}
              .value=${this.naming ?? ""}
              @input=${(e: InputEvent) => (this.naming = (e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => e.key === "Enter" && done()}
            />
            ${this.naming
              ? html`<button class="round mini" aria-label=${t("common.clear")} @click=${(e: Event) => {
                  e.preventDefault();
                  this.naming = "";
                  this.querySelector<HTMLInputElement>(".name-field input")?.focus();
                }}>${icon("close")}</button>`
              : nothing}
          </label>
        </div>
      </div>
    </div>`;
  }

  override updated(changed: Map<PropertyKey, unknown>): void {
    super.updated(changed);
    // The name sheet comes up ready to type.
    const field = this.querySelector<HTMLInputElement>(".name-sheet input");
    if (field && !this.#focused) {
      this.#focused = true;
      field.focus();
      field.select();
    }
    if (!field) this.#focused = false;
  }

  #focused = false;

  private async create(room: Group, name: string): Promise<void> {
    const { ctx } = this;
    if (!room.group || this.busy) return;
    this.busy = true;
    const ok = await ctx.call("hue_studio", "create_scene", { entity_id: room.group, name }, { optimistic: false });
    this.busy = false;
    if (!ok) return;
    ctx.sceneDraft = null;
    ctx.toast(ctx.t("room.scene_created", { name }));
    ctx.go(`/room/${encodeURIComponent(this.key)}`);
  }

  /** To the wheel to set a light (what it shows is then unsaved here). */
  private toWheel(path: string): void {
    this.edit({ touched: true });
    this.ctx.go(path);
  }

  /** Spread the palette over the lights in a new order (live; "Save" keeps it). */
  private shuffle(lights: string[], palette: [number, number][]): void {
    this.edit({ touched: true });
    const points = [...palette];
    for (let i = points.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [points[i], points[j]] = [points[j], points[i]];
    }
    this.ctx.call("hue_studio", "apply_palette", { entity_id: lights, points });
  }

  /** Rebuild the scene from its palette at once, the Hue app's (no question). */
  private async reset(): Promise<void> {
    if (await this.ctx.call("hue_studio", "reset_scene", { entity_id: this.scene }, { optimistic: false })) {
      this.ctx.toast(this.ctx.t("scene.reset_done"));
    }
  }

  private async deleteScene(): Promise<void> {
    const { ctx } = this;
    const name = this.name;
    if (await ctx.call("hue_studio", "delete_scene", { entity_id: this.scene }, { optimistic: false })) {
      ctx.sceneDraft = null;
      ctx.toast(ctx.t("scene.deleted", { name }));
      this.leave();
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
      this.leave();
    }
  }

  /** Back to the room, or to the page outside the panel the editor was opened from. */
  private leave(): void {
    if (this.exitPath) leavePanel(this.exitPath);
    else this.ctx.go(`/room/${encodeURIComponent(this.key)}`);
  }
}

const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-scene-view": SceneView;
  }
}
