// Scene editor, like the Hue app's "Edit scene": the scene is shown on its lights, which
// are adjusted live (brightness here, colors on the wheel); "Save" stores what they show
// now plus the name, dynamic speed and auto-play. "Colors" shuffles the palette over the
// lights (two or more), "Reset scene" rebuilds a gallery scene from its palette (the Hue
// app has none for scenes of your own), "Delete scene" removes it from
// the bridge (and so from the Hue app). A scene of your own gets a picture of its own: a
// photo (uploaded to Home Assistant) or an icon over its colors (HA's entity settings).
// A new scene ("Custom scene" of a room's "+", the scene `new`) is the Hue app's: a picker
// starting from what the lights show now, its name open in place first; the lights are set the same
// way (brightness here, colors on the wheel), its picture picked the same way, and "Save" at the
// bottom creates it.

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import type { SceneDraft } from "../../../core/context.ts";
import { groupSlider, lightTile, sceneArt, sceneColors, sceneDot, sceneGlyph, sceneSpeedLabel, speedSheet } from "../../../ds/controls.ts";
import { sceneSpeedToStep, sceneStepToSpeed } from "../../color/effects.ts";
import { haptic, leavePanel } from "../../../core/ha-internals.ts";
import type { SceneInfo } from "../../../core/types.ts";
import { colorsCss, findGroup, friendlyName, type Group, groupState } from "../../../core/model.ts";
import { syncingIn } from "../../sync/sync.ts";
import { icon, toggle } from "../../../ds/ui.ts";
import { StudioView } from "../../../ds/base.ts";
import { navRow } from "../../../ds/choice.ts";
import { SCENE_ICONS } from "../icons.ts";


/** The scene "id" of a new one (`/room/<key>/scene/new`). */
export const NEW_SCENE = "new";


/** Where Home Assistant serves an uploaded picture (covers.py on the backend). */
const coverUrl = (image: string): string => `/api/image/serve/${image}/512x512`;

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
  @state() private accessor busy = false;
  /** The picture sheet of a scene of your own is open. */
  @state() private accessor picturing = false;
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
      // Its name is edited in place, the field open and selected (never a dialog).
      if (!this.started && this.ctx.ready && this.draft.name === null) {
        this.edit({ name: this.ctx.t("room.new_scene") });
        this.editingName = true;
        void this.updateComplete.then(() => {
          const field = this.querySelector<HTMLInputElement>(".scene-new .name-input");
          field?.focus();
          field?.select();
        });
      }
      this.started = true;
      return;
    }
    // Show the scene on its lights first: editing works on what the lights show.
    if (this.started || !this.ctx.ready || !this.ctx.hass.states[this.scene]) return;
    this.started = true;
    const info = this.ctx.sceneInfo[this.scene];
    if (!info || info.active === "inactive") {
      void this.ctx.call("scene", "turn_on", { entity_id: this.scene });
    }
  }

  protected override render() {
    if (this.isNew) return this.renderNew();
    const { ctx } = this;
    const { t } = ctx;
    const room = findGroup(ctx.home, this.key);
    const roomPath = `/room/${encodeURIComponent(this.key)}`;
    const leave = () => {
      // Pictures uploaded here and not saved are not kept.
      for (const id of this.draft.uploads ?? []) ctx.deleteImage(id);
      ctx.sceneDraft = null;
      this.leave();
    };
    // Unsaved: its name, speed, auto-play or picture, or the lights it shows changed here (the Hue app asks).
    const d0 = this.draft;
    const dirty = d0.touched || d0.name !== null || d0.speed !== null || d0.autoplay !== null || d0.cover !== undefined || d0.icon !== undefined;
    const close = () => this.confirmLeave(dirty, leave);
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
    // Its picture as it will be saved: a photo or an icon picked here, else as it is.
    const shown = info && draft.cover !== undefined ? { ...info, cover: draft.cover ? coverUrl(draft.cover) : null } : info;
    const dot = sceneDot(ctx.gallery, this.name, shown);
    const glyph =
      draft.icon !== undefined
        ? !shown?.cover && draft.icon
        : sceneGlyph(ctx.hass, ctx.gallery, this.scene, this.name, shown);
    const own = !!info?.custom && !!ctx.hass.user?.is_admin;
    const here = `${roomPath}/scene/${encodeURIComponent(this.scene)}${this.exitPath ? `?from=${encodeURIComponent(this.exitPath)}` : ""}`;
    const syncing = syncingIn(ctx.boxes, group);
    const name = draft.name ?? this.name;
    const speed = draft.speed ?? sceneSpeedToStep(info?.speed ?? sceneStepToSpeed(7));
    const autoplay = draft.autoplay ?? !!info?.auto_dynamic;

    const head = html`<div class="bar sub">
      <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
      <div class="title">${t("scene.edit")}</div>
      <button class="pill save" @click=${() => this.save()}>${t("scene.save")}</button>
    </div>`;
    // Like the Hue app's: the top (header, name, brightness) tinted with the scene's colors.
    const tint = sceneColors(info).map((c) => `color-mix(in srgb, ${c} 44%, #141416)`);
    const tintStyle = { "--scene-tint": `linear-gradient(115deg, ${(tint.length > 1 ? tint : [tint[0], tint[0]]).join(", ")})` };
    return html`<div class="scene-tint" style=${styleMap(tintStyle)}></div>
      <div class="screen-head scene-head">${head}</div><div class="screen-body"><div class="page scene-edit">
      <div class="scene-top">
        ${own
          ? html`<button class=${classMap({ dot: true, big: true, glyph: !!glyph })} style=${styleMap({ background: dot })}
              aria-label=${t("scene.picture")} @click=${() => (this.picturing = true)}>${glyph ? html`<ha-icon icon=${glyph}></ha-icon>` : nothing}</button>`
          : html`<div class=${classMap({ dot: true, big: true, glyph: !!glyph })} style=${styleMap({ background: dot })}>${glyph ? html`<ha-icon icon=${glyph}></ha-icon>` : nothing}</div>`}
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
            <div class="rows list">
              ${navRow({ title: t("scene.speed"), value: sceneSpeedLabel(t, speed), bare: true }, () => (this.speedStep = speed))}
              <div class="item">
                <div class="grow"><div>${t("scene.autoplay")}</div><div class="dim small">${t("scene.autoplay_sub")}</div></div>
                ${toggle(autoplay, t("scene.autoplay"), () => this.edit({ autoplay: !autoplay }))}
              </div>
            </div>`
        : nothing}

      <div class="rows lights-card scene-lights">
        <div class="item lights-head">
          <div class="grow">${t("room.lights")}</div>
          ${info && info.palette.length > 1 && lights.length > 1
            ? html`<button class="pill shuffle" @click=${() => this.shuffle(lights, info.palette)}>${icon("shuffle")}${t("scene.shuffle")}</button>`
            : nothing}
        </div>
        <div class="light-row">
          ${group.lights.map((id) =>
            lightTile(ctx, id, () => this.toWheel(`${roomPath}/color?light=${encodeURIComponent(id)}&back=${encodeURIComponent(here)}`), {
              busy: syncing.includes(id),
              dynamicsLine: false,
            }),
          )}
        </div>
      </div>

      ${info?.resettable && !info.custom
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
    ${this.picturing && info
      ? this.pictureSheet({ colors: sceneArt(info), cover: shown?.cover ?? null, had: !!info.cover, glyph: glyph || null })
      : nothing}
    ${this.askSheet()}`;
  }

  /**
   * A scene of your own's picture: its colors, a photo from this device, or an icon over its
   * colors. Picked here, kept with "Save" (a new scene's with it). `colors`: its colors as a
   * background; `cover`: the photo it shows now; `had`: it had a photo saved.
   */
  private pictureSheet(o: { colors: string; cover: string | null; had: boolean; glyph: string | null }) {
    const { ctx } = this;
    const { t } = ctx;
    const close = () => (this.picturing = false);
    const { cover, glyph } = o;
    const pick = (patch: Partial<SceneDraft>) => {
      haptic("selection");
      this.edit(patch);
    };
    const upload = async (e: Event) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      this.busy = true;
      const id = await ctx.uploadImage(file);
      this.busy = false;
      if (!id) return;
      haptic("success");
      this.edit({ cover: id, icon: null, uploads: [...(this.draft.uploads ?? []), id] });
    };
    const tick = (on: boolean) => (on ? html`<span class="tick">${icon("check")}</span>` : nothing);
    // Back to its colors: a photo it had is dropped with "Save"; one picked here only.
    const noCover = o.had ? null : undefined;
    return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow, tall: ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="box form sensor-sheet picture-sheet" role="dialog" aria-label=${t("scene.picture")}>
        <div class="sheet-bar">
          <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
          <div class="grow">${t("scene.picture")}</div>
          <button class="pill save" @click=${close}>${t("common.done")}</button>
        </div>
        <div class="form-body">
          <p class="hint">${t("scene.picture_hint")}</p>
          <div class="rows" role="radiogroup">
            <button class=${classMap({ item: true, on: !cover && !glyph })} role="radio" aria-checked=${!cover && !glyph}
              @click=${() => pick({ cover: noCover, icon: null })}>
              <span class="row-art pic" style=${styleMap({ background: o.colors })}></span>
              <div class="grow">${t("scene.picture_colors")}<div class="dim small">${t("scene.picture_colors_sub")}</div></div>
              ${tick(!cover && !glyph)}
            </button>
            <label class=${classMap({ item: true, on: !!cover, busy: this.busy })} role="radio" aria-checked=${!!cover}>
              ${cover
                ? html`<span class="row-art pic" style=${styleMap({ background: `url("${cover}") center / cover` })}></span>`
                : html`<span class="row-art pic"><ha-icon icon="mdi:image-plus-outline"></ha-icon></span>`}
              <div class="grow">${t("scene.picture_photo")}<div class="dim small">${t(cover ? "scene.picture_photo_change" : "scene.picture_photo_sub")}</div></div>
              ${tick(!!cover)}
              <input class="file" type="file" accept="image/jpeg,image/png,image/gif" ?disabled=${this.busy} @change=${upload} />
            </label>
          </div>
          <h2 class="label">${t("scene.picture_icon")}</h2>
          <div class="icon-grid" role="radiogroup" aria-label=${t("scene.picture_icon")}>
            ${SCENE_ICONS.map(([glyphName, label]) => {
              const on = !cover && glyph === glyphName;
              return html`<button class=${classMap({ "icon-opt": true, on })} role="radio" aria-checked=${on}
                @click=${() => pick({ icon: glyphName, cover: noCover })}>
                <span class="disc"><ha-icon icon=${glyphName}></ha-icon></span>
                <span>${t(label)}</span>
              </button>`;
            })}
          </div>
        </div>
      </div>
    </div>`;
  }

  /** A new scene: what the room's lights show now, set here and on the wheel, then "Save". */
  private renderNew() {
    const { ctx } = this;
    const { t } = ctx;
    const room = findGroup(ctx.home, this.key);
    const roomPath = `/room/${encodeURIComponent(this.key)}`;
    const leave = () => {
      for (const id of this.draft.uploads ?? []) ctx.deleteImage(id);
      ctx.sceneDraft = null;
      ctx.go(roomPath);
    };
    const head = html`<div class="bar"><button class="round back" aria-label=${t("common.back")} @click=${() => this.confirmLeave(true, leave)}>${icon("back")}</button></div>`;
    if (!room) return this.screen(head, html`<p class="empty">${t("room.not_found")}</p>`);
    const state = groupState(ctx.hass, room, ctx.lightInfo);
    const name = this.draft.name ?? t("room.new_scene");
    const here = `${roomPath}/scene/${NEW_SCENE}`;
    const syncing = syncingIn(ctx.boxes, room);
    // Its picture as it will be made: what the lights show, a photo or an icon picked here.
    const draft = this.draft;
    const colors = colorsCss(state.colors, "var(--surface-raised)");
    const cover = draft.cover ? coverUrl(draft.cover) : null;
    const glyph = (!cover && draft.icon) || null;
    const dotStyle = { background: cover ? `url("${cover}") center / cover, ${colors}` : colors };
    const dot = html`<ha-icon icon=${glyph}></ha-icon>`;
    const body = html`<div class="scene-top">
        ${ctx.hass.user?.is_admin
          ? html`<button class=${classMap({ dot: true, big: true, glyph: !!glyph })} style=${styleMap(dotStyle)}
              aria-label=${t("scene.picture")} @click=${() => (this.picturing = true)}>${glyph ? dot : nothing}</button>`
          : html`<div class="dot big" style=${styleMap(dotStyle)}></div>`}
        <div class="name-row">
          ${this.editingName
            ? html`<input
                class="name-input"
                .value=${name}
                maxlength="32"
                aria-label=${t("room.new_scene_name")}
                @input=${(e: InputEvent) => this.edit({ name: (e.target as HTMLInputElement).value })}
                @keydown=${(e: KeyboardEvent) => e.key === "Enter" && name.trim() && (this.editingName = false)}
              />`
            : html`<h1 class="big">${name}</h1>`}
          <button class="round rename" aria-label=${t("scene.rename")} @click=${() => {
            if (this.editingName && !name.trim()) this.edit({ name: t("room.new_scene") });
            this.editingName = !this.editingName;
            if (this.editingName) void this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".name-input")?.focus());
          }}>${icon("pencil")}</button>
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
        <button class="pill apply" ?disabled=${!room.group || !name.trim() || this.busy} @click=${() => this.create(room, name.trim())}>${t("scene.save")}</button>
      </div>
      ${this.picturing ? this.pictureSheet({ colors, cover, had: false, glyph }) : nothing}
      ${this.askSheet()}`;
  }

  private async create(room: Group, name: string): Promise<void> {
    const { ctx } = this;
    if (!room.group || this.busy) return;
    const draft = this.draft;
    const data: Record<string, unknown> = { entity_id: room.group, name };
    // Its picture with it: an icon (HA's entity settings) or a photo.
    if (draft.cover) data.image = draft.cover;
    else if (draft.icon) data.icon = draft.icon;
    this.busy = true;
    const ok = await ctx.call("hue_studio", "create_scene", data, { optimistic: false });
    this.busy = false;
    if (!ok) return;
    for (const id of draft.uploads ?? []) if (id !== draft.cover) ctx.deleteImage(id);
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
    if (info && draft.speed !== null && draft.speed !== sceneSpeedToStep(info.speed)) data.speed = sceneStepToSpeed(draft.speed) * 100;
    if (info && draft.autoplay !== null && draft.autoplay !== info.auto_dynamic) data.auto_dynamic = draft.autoplay;
    if (!(await ctx.call("hue_studio", "save_scene", data, { optimistic: false }))) return;
    // Its picture: a photo (the one it had is deleted), and the icon in HA's entity settings.
    let kept: string | null = null;
    if (draft.cover !== undefined) {
      const result = await ctx.query<{ replaced: string | null }>({ type: "hue_studio/scenes/cover", entity_id: this.scene, image: draft.cover });
      if (result) kept = draft.cover;
      if (result?.replaced) ctx.deleteImage(result.replaced);
    }
    if (draft.icon !== undefined && (draft.icon ?? null) !== (ctx.hass.entities?.[this.scene]?.icon ?? null)) {
      await ctx.query({ type: "config/entity_registry/update", entity_id: this.scene, icon: draft.icon });
    }
    for (const id of draft.uploads ?? []) if (id !== kept) ctx.deleteImage(id);
    ctx.sceneDraft = null;
    ctx.toast(ctx.t("scene.saved"));
    this.leave();
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
