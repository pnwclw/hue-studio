// Room: header with toggle, brightness and Adaptive Lighting; the room's Hue scenes (plus
// "New scene": what the lights show now, saved as a scene of the room's Hue room/zone on
// the bridge, so the Hue app has it too); its lights.

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import { paletteArt, paletteColors } from "../color.ts";
import { groupSlider, lightTile, metaOf, surfaceOf, toggleGroup } from "../controls.ts";
import { galleryMatch, thumbUrl } from "../gallery-data.ts";
import { type AdaptiveSwitch, adaptiveFor, findGroup, friendlyName, type Group, groupState, type Scene } from "../model.ts";
import { type Mismatch, mismatchesIn } from "../rooms.ts";
import { boxesForGroup, currentInput, statusKey, syncingIn } from "../sync.ts";
import type { SceneInfo, SyncBoxInfo } from "../types.ts";
import { icon, toggle } from "../ui.ts";
import { StudioView } from "./base.ts";

const FALLBACK_DOT = "radial-gradient(circle at 30% 30%, #ffe7b8, #f2a65a)";

@customElement("hue-studio-room-view")
export class RoomView extends StudioView {
  @property() accessor key = "";

  /** The "New scene" sheet is open. */
  @state() private accessor adding = false;
  @state() private accessor newName = "";
  @state() private accessor busy = false;

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const g = findGroup(ctx.home, this.key);
    if (!g) {
      return html`<div class="page">
        <div class="topbar">
          <button class="round back" aria-label=${t("common.back")} @click=${() => ctx.go("")}>${icon("back")}</button>
        </div>
        <p class="empty">${t("room.not_found")}</p>
      </div>`;
    }
    const state = groupState(ctx.hass, g, ctx.lightInfo);
    const surface = surfaceOf(state);
    const room = encodeURIComponent(g.key);

    return html`<div class="page">
      <div class=${classMap({ hero: true, ...surface.classes })} style=${styleMap(surface.style)}>
        <div class="inner">
          <div class="topbar">
            <button class="round back" aria-label=${t("common.back")} @click=${() => ctx.go("")}>${icon("back")}</button>
            <div class="title">${g.name}</div>
            <button class="round add" aria-label=${t("room.gallery")} @click=${() => ctx.go(`/gallery?room=${room}`)}>
              ${icon("plus")}
            </button>
            <button class="round colors" aria-label=${t("room.colors")} @click=${() => ctx.go(`/room/${room}/color`)}>
              ${icon("palette")}
            </button>
            ${toggle(state.on, t("common.toggle"), () => toggleGroup(ctx, g))}
          </div>
          ${metaOf(state)} ${groupSlider(ctx, g, state, t("common.brightness"))}
          <div class="badges">${adaptiveFor(ctx.hass, g).map((al) => this.adaptiveBadge(al))}</div>
        </div>
      </div>
      ${this.syncCards(g)}
      <h2 class="label">${t("room.scenes")}</h2>
      ${this.syncNote(g)}
      <div class=${classMap({ grid: true, locked: syncingIn(ctx.boxes, g).length > 0 })}>
        ${g.scenes.map((s) => this.scene(g, s))}
        <button class="scene add-scene" @click=${() => this.openNew()}>
          <div class="dot">${icon("plus")}</div>
          <div class="name">${t("room.new_scene")}</div>
        </button>
      </div>
      <h2 class="label">${t("room.lights")}</h2>
      ${mismatchesIn(ctx.rooms, g).map((m) => this.mismatch(m))}
      <div class="grid">${g.lights.map((id) => this.light(g, id))}</div>
    </div>
    ${this.adding ? this.newSheet(g) : nothing}`;
  }

  private openNew(): void {
    this.newName = "";
    this.adding = true;
    this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".sheet input")?.focus());
  }

  /**
   * "New scene": a name, saved from what the lights show now. Scenes live in a Hue room or
   * zone; a room (HA area) without one is offered a zone of its lights on the bridge.
   */
  private newSheet(g: Group) {
    const { ctx } = this;
    const { t } = ctx;
    const close = () => (this.adding = false);
    const name = this.newName.trim();
    const save = async () => {
      if (!g.group || !name || this.busy) return;
      this.busy = true;
      const ok = await ctx.call("hue_studio", "create_scene", { entity_id: g.group, name }, { optimistic: false });
      this.busy = false;
      if (ok) {
        close();
        ctx.toast(t("room.scene_created", { name }));
      }
    };
    const createZone = async () => {
      if (this.busy) return;
      this.busy = true;
      const ok = await ctx.call("hue_studio", "create_zone", { entity_id: g.lights, name: g.name }, { optimistic: false });
      this.busy = false;
      if (ok) ctx.toast(t("room.zone_created", { name: g.name }));
    };
    return html`<div class="sheet" @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="box form" role="dialog" aria-label=${t("room.new_scene")}>
        <div class="sheet-bar"><div class="grow">${t("room.new_scene")}</div>
          <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
        </div>
        ${g.group
          ? html`<div class="form-body">
                <input
                  class="field"
                  maxlength="32"
                  placeholder=${t("room.new_scene_name")}
                  aria-label=${t("room.new_scene_name")}
                  .value=${this.newName}
                  @input=${(e: InputEvent) => (this.newName = (e.target as HTMLInputElement).value)}
                  @keydown=${(e: KeyboardEvent) => e.key === "Enter" && save()}
                />
                <p class="hint">${t("room.new_scene_hint", { room: friendlyName(ctx.hass, g.group) })}</p>
              </div>
              <div class="actions"><button class="pill apply" ?disabled=${!name || this.busy} @click=${save}>${t("scene.save")}</button></div>`
          : html`<div class="form-body"><p class="hint">${t("room.no_group", { room: g.name })}</p></div>
              <div class="actions">
                <button class="pill apply" ?disabled=${this.busy} @click=${createZone}>${t("room.create_zone")}</button>
                <button class="pill" @click=${() => ctx.openSettings()}>${t("room.mapping")}</button>
              </div>`}
      </div>
    </div>`;
  }

  /** Sync Boxes whose entertainment area has lights of this room: status, start/stop. */
  private syncCards(g: Group) {
    const boxes = boxesForGroup(this.ctx.boxes, g);
    if (!boxes.length) return nothing;
    return html`<div class="sync-cards">${boxes.map(([id, box]) => this.syncCard(id, box))}</div>`;
  }

  private syncCard(id: string, box: SyncBoxInfo) {
    const { ctx } = this;
    const { t } = ctx;
    const input = currentInput(box);
    const line = [t(statusKey(box)), box.power && box.mode ? t(`sync.mode_${box.mode}`) : "", box.power ? input?.name : ""].filter(Boolean).join(" · ");
    return html`<div
      class=${classMap({ "sync-card": true, syncing: !!box.syncing, [`m-${box.mode}`]: true })}
      role="button"
      tabindex="0"
      aria-label=${t("sync.open")}
      @click=${() => ctx.go(`/sync?box=${encodeURIComponent(id)}`)}
    >
      <div class="glow"></div>
      <div class="tv">${icon("sync")}</div>
      <div class="text"><div class="name">${box.name || "Sync Box"}</div><div class="status">${line}</div></div>
      ${toggle(!!box.syncing, box.syncing ? t("sync.stop") : t("sync.start"), () => ctx.setSync(id, { sync: !box.syncing }))}
    </div>`;
  }

  /** While a box drives the room's lights, scenes would be overwritten at once. */
  private syncNote(g: Group) {
    const { ctx } = this;
    if (!syncingIn(ctx.boxes, g).length) return nothing;
    const name = boxesForGroup(ctx.boxes, g).find(([, b]) => b.syncing)?.[1].name || "Sync Box";
    return html`<p class="sync-note">${icon("sync")}<span>${ctx.t("sync.room_note", { name })}</span></p>`;
  }

  /** Adaptive Lighting badge: toggle the switch, or hand manual lights back to it. */
  private adaptiveBadge(al: AdaptiveSwitch) {
    const { ctx } = this;
    const { t } = ctx;
    const label = !al.on ? t("adaptive.off") : al.manual.length ? t("adaptive.resume") : t("adaptive.on");
    const click = () => {
      if (al.on && al.manual.length) {
        ctx.call(
          "adaptive_lighting",
          "set_manual_control",
          { entity_id: al.switch, lights: al.manual, manual_control: false },
          { optimistic: false },
        );
      } else {
        ctx.call("switch", al.on ? "turn_off" : "turn_on", { entity_id: al.switch }, { optimistic: false });
      }
    };
    return html`<button class=${classMap({ badge: true, on: al.on && !al.manual.length })} @click=${click}>
      ${icon("sun")}${label}
    </button>`;
  }

  /**
   * A scene tile; its dot shows the matching gallery picture (bridge scenes usually come
   * from the gallery), else its palette. The active scene is lit in its colors and gets
   * edit and dynamic play/stop buttons, like in the Hue app.
   */
  private scene(g: Group, s: Scene) {
    const { ctx } = this;
    const { t } = ctx;
    const info = ctx.sceneInfo[s.entity_id];
    const match = galleryMatch(ctx.gallery, s.name, info?.image);
    const dot = match ? `url("${thumbUrl(match.id)}") center / cover, ${paletteArt(match)}` : sceneArt(info);
    const active = !!info && info.active !== "inactive";
    const playing = info?.active === "dynamic_palette";
    const colors = info ? sceneColors(info) : [];
    const surface = surfaceOf({ on: active, colors });
    const room = encodeURIComponent(g.key);
    const apply = async () => {
      // The Sync Box would overwrite the scene right away.
      if (syncingIn(ctx.boxes, g).length) return;
      if (await ctx.call("scene", "turn_on", { entity_id: s.entity_id })) ctx.markManual(g);
    };
    const play = async (e: Event) => {
      e.stopPropagation();
      if (await ctx.call("hue_studio", "recall_scene", { entity_id: s.entity_id, dynamic: !playing }, { optimistic: false })) ctx.markManual(g);
    };
    const edit = (e: Event) => {
      e.stopPropagation();
      ctx.go(`/room/${room}/scene/${encodeURIComponent(s.entity_id)}`);
    };
    // Like the Hue app's "Shuffle colors": the palette spread over the lights anew, kept.
    const shuffle = async (e: Event) => {
      e.stopPropagation();
      const data = { entity_id: s.entity_id, shuffle: true, recall: true };
      if (await ctx.call("hue_studio", "reset_scene", data, { optimistic: false })) ctx.markManual(g);
    };
    return html`<div class=${classMap({ scene: true, ...surface.classes, active })} style=${styleMap(surface.style)} role="button" tabindex="0" @click=${apply}>
      <div class="dot" style=${styleMap({ background: ctx.gallery || info ? dot : null })}></div>
      <div class="name">${s.name}</div>
      ${s.group !== g.group ? html`<div class="sub">${friendlyName(ctx.hass, s.group)}</div>` : nothing}
      ${active
        ? html`<div class="scene-actions">
            ${info.dynamic
              ? html`<button class="round mini play" aria-label=${playing ? t("scene.pause") : t("scene.play")} @click=${play}>
                  ${icon(playing ? "pause" : "play")}
                </button>`
              : nothing}
            ${info.resettable && (info.palette.length > 1 || info.mirek.length > 1)
              ? html`<button class="round mini shuffle" aria-label=${t("scene.shuffle_colors")} @click=${shuffle}>${icon("shuffle")}</button>`
              : nothing}
            <button class="round mini edit" aria-label=${t("scene.edit")} @click=${edit}>${icon("pencil")}</button>
          </div>`
        : nothing}
    </div>`;
  }

  /**
   * A light that sits in another area's Hue room (moved in the Hue app): accept that in
   * HA (the light's area changes) or move it back on the bridge.
   */
  private mismatch(m: Mismatch) {
    const { ctx } = this;
    const { t } = ctx;
    const area = ctx.hass.areas?.[m.hueArea]?.name || m.hueArea;
    const accept = () => ctx.setArea(m.light, m.hueArea);
    const restore = () => ctx.call("hue_studio", "align_rooms", { entity_id: m.light }, { optimistic: false });
    return html`<div class="mismatch">
      <p>${t("mismatch.note", { light: friendlyName(ctx.hass, m.light), room: m.hueRoom })}</p>
      <div class="buttons">
        <button class="pill" @click=${accept}>${t("mismatch.accept", { area })}</button>
        <button class="pill" @click=${restore}>${t("mismatch.restore")}</button>
      </div>
    </div>`;
  }

  private light(g: Group, id: string) {
    const room = encodeURIComponent(g.key);
    return lightTile(this.ctx, id, () => this.ctx.go(`/room/${room}/color?light=${encodeURIComponent(id)}`));
  }
}

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

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-room-view": RoomView;
  }
}
