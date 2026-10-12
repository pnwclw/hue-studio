// Room: header with toggle, brightness and Adaptive Lighting; the room's sensors (motion,
// temperature, light level); auto light (or natural light) when the area has it; the
// room's Hue scenes (plus
// "New scene": what the lights show now, saved as a scene of the room's Hue room/zone on
// the bridge, so the Hue app has it too); its lights.

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import { paletteArt, paletteColors } from "../color.ts";
import { groupSlider, lightTile, surfaceOf, toggleGroup } from "../controls.ts";
import { galleryMatch, thumbUrl } from "../gallery-data.ts";
import { openStockMoreInfo } from "../ha-internals.ts";
import { type AdaptiveSwitch, adaptiveFor, findGroup, friendlyName, type Group, type GroupState, groupState, type Scene } from "../model.ts";
import { type Mismatch, mismatchesIn } from "../rooms.ts";
import { boxesForGroup, currentInput, statusKey, syncingIn } from "../sync.ts";
import type { SceneInfo, SyncBoxInfo } from "../types.ts";
import { icon, toggle } from "../ui.ts";
import { whiteArt } from "./auto-light.ts";
import { StudioView } from "./base.ts";
import "./new-scene.ts";

const FALLBACK_DOT = "radial-gradient(circle at 30% 30%, #ffe7b8, #f2a65a)";

@customElement("hue-studio-room-view")
export class RoomView extends StudioView {
  @property() accessor key = "";

  /** The "New scene" sheet is open. */
  @state() private accessor adding = false;

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const g = findGroup(ctx.home, this.key);
    if (!g) {
      return this.screen(this.subHead("", () => ctx.go("")), html`<p class="empty">${t("room.not_found")}</p>`);
    }
    const state = groupState(ctx.hass, g, ctx.lightInfo);
    const surface = surfaceOf(state);
    const room = encodeURIComponent(g.key);

    // The room's colored header stays; scenes and lights scroll below it.
    return html`<div class="screen-head hero-head">
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
          ${groupSlider(ctx, g, state, t("common.brightness"))}
          <div class="badges">${adaptiveFor(ctx.hass, g).map((al) => this.adaptiveBadge(al))}</div>
        </div>
      </div>
    </div>
    <div class="screen-body"><div class="page">
      ${this.sensors(g, state)}
      ${this.syncCards(g)}
      <h2 class="label">${t("room.scenes")}</h2>
      ${this.syncNote(g)}
      <div class=${classMap({ grid: true, "scene-row": true, locked: syncingIn(ctx.boxes, g).length > 0 })}>
        ${this.autoTile(g)} ${g.scenes.map((s) => this.scene(g, s))}
        <button class="scene add-scene" @click=${() => this.openNew()}>
          <div class="dot">${icon("plus")}</div>
          <div class="name">${t("room.new_scene")}</div>
        </button>
      </div>
      <div class="section-head">
        <h2 class="label">${t("room.lights")}</h2>
        ${g.kind === "area" && g.lights.length > 1
          ? html`<button class="pill shuffle" @click=${() => ctx.go(`/room/${room}/space`)}>${icon("rooms")}${t("space.arrange")}</button>`
          : nothing}
      </div>
      ${mismatchesIn(ctx.rooms, g).map((m) => this.mismatch(m))}
      <div class="light-row">${g.lights.map((id) => this.light(id))}</div>
    </div></div>
    ${this.adding
      ? html`<hue-studio-new-scene .ctx=${this.ctx} .rev=${this.rev} .group=${g} @close=${() => (this.adding = false)}></hue-studio-new-scene>`
      : nothing}`;
  }

  private openNew(): void {
    this.adding = true;
  }

  /** Motion, temperature and light level of the room; a tap opens the sensor in HA. */
  private sensors(g: Group, state: GroupState) {
    const { ctx } = this;
    const { t } = ctx;
    const lang = ctx.hass.locale?.language || ctx.hass.language || "en";
    const number = (v: number, digits: number) => new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(v);
    const chip = (ids: string[], glyph: string, text: string, on = false) =>
      html`<button class=${classMap({ "sensor-chip": true, on })} @click=${() => openStockMoreInfo(ids[0])}>
        <ha-icon icon=${glyph}></ha-icon><span>${text}</span>
      </button>`;
    const { motion, temperature, illuminance } = g.sensors;
    const chips = [
      motion.length
        ? chip(
            motion,
            state.motion ? "mdi:motion-sensor" : "mdi:motion-sensor-off",
            state.motion ? t("sensors.motion") : state.lastMotion ? t("sensors.motion_ago", { time: since(state.lastMotion, lang) }) : t("sensors.no_motion"),
            state.motion,
          )
        : nothing,
      state.temperature !== null ? chip(temperature, "mdi:thermometer", `${number(state.temperature, 1)} °C`) : nothing,
      state.illuminance !== null ? chip(illuminance, "mdi:brightness-5", `${number(state.illuminance, 0)} lx`) : nothing,
    ].filter((c) => c !== nothing);
    return chips.length ? html`<div class="sensor-row">${chips}</div>` : nothing;
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
   * Auto light of the area as a scene tile (natural light like the Hue app's): shows what
   * auto light picks now and hands the lights back to it.
   */
  private autoTile(g: Group) {
    const { ctx } = this;
    const { t } = ctx;
    const area = g.kind === "area" ? g.key.slice("area.".length) : null;
    const now = area ? ctx.autoLight?.state[area] : undefined;
    if (!area || !now || now.control === "off" || (!now.kelvin && !now.scene)) return nothing;
    const dot = now.kelvin ? whiteArt(now.kelvin) : `url("${thumbUrl(now.scene!)}") center / cover`;
    const apply = () => {
      if (syncingIn(ctx.boxes, g).length) return;
      ctx.call("hue_studio", "apply_auto_light", { area, resume: true, transition: 1 }, { optimistic: false });
    };
    const settings = (e: Event) => {
      e.stopPropagation();
      ctx.go(`/settings/auto/${encodeURIComponent(area)}`);
    };
    return html`<div class=${classMap({ scene: true, "auto-scene": true, surface: true, off: true })} role="button" tabindex="0" @click=${apply}>
      <div class="dot" style=${styleMap({ background: dot })}></div>
      <div class="name">${t(now.kelvin ? "auto.style_natural" : "room.auto_light")}</div>
      <div class="sub">${now.kelvin ? `${now.kelvin} K` : now.scene_name || ""}${now.control === "manual" ? ` · ${t("auto.control_manual")}` : ""}</div>
      <div class="scene-actions">
        <button class="round mini edit" aria-label=${t("auto.settings")} @click=${settings}>${icon("cog")}</button>
      </div>
    </div>`;
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

  /** A light card, the same as in the color screen; a tap opens the light's dialog (the color screen). */
  private light(id: string) {
    const open = () => this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: id }, bubbles: true, composed: true }));
    return lightTile(this.ctx, id, open);
  }
}

/** "5 min ago", "2 hr ago", "yesterday" in the user's language. */
export function since(iso: string, lang: string, now = Date.now()): string {
  const minutes = Math.round((Date.parse(iso) - now) / 60000);
  const format = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" });
  if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  return Math.abs(hours) < 24 ? format.format(hours, "hour") : format.format(Math.round(hours / 24), "day");
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
