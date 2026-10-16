// Room: header with toggle, brightness, Adaptive Lighting and "+" (add a scene, an automation
// or a device: add-sheet.ts); the room's readings (temperature, light level, motion of
// sensors that are not Hue's); its Hue scenes; its lights; its Hue sensors ("Controls", a
// card each, opening the sensor's settings); its automations, like the Hue app.

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import { paletteArt, paletteColors } from "../color.ts";
import { groupSlider, groupToggle, lightTile, shownState, surfaceOf, syncBanner, tileCard } from "../controls.ts";
import { galleryMatch, thumbUrl } from "../gallery-data.ts";
import { openStockMoreInfo } from "../ha-internals.ts";
import {
  type AdaptiveSwitch,
  adaptiveFor,
  findGroup,
  friendlyName,
  type Group,
  type HueSensor,
  type Scene,
  sensorReadings,
  splitSensors,
} from "../model.ts";
import { bridgeName, groupBridge, lightsByBridge, type Mismatch, mismatchesIn, severalBridges } from "../rooms.ts";
import { boxesForGroup, currentInput, statusKey, syncingIn } from "../sync.ts";
import type { RoomSensors, SceneInfo, SyncBoxInfo } from "../types.ts";
import { icon, refuse, toggle } from "../ui.ts";
import "./add-sheet.ts";
import { roomAutomations } from "./automations.ts";
import { StudioView } from "./base.ts";

const FALLBACK_DOT = "radial-gradient(circle at 30% 30%, #ffe7b8, #f2a65a)";

@customElement("hue-studio-room-view")
export class RoomView extends StudioView {
  @property() accessor key = "";

  /** The "+" sheet (what to add) is open. */
  @state() private accessor adding = false;
  /** Brightness while the header's slider is dragged: the header shows just the percentage. */
  @state() private accessor dragging: number | null = null;

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const g = findGroup(ctx.home, this.key);
    if (!g) {
      return this.screen(this.subHead("", () => ctx.go("")), html`<p class="empty">${t("room.not_found")}</p>`);
    }
    const state = shownState(ctx, g);
    const surface = surfaceOf(state);
    const room = encodeURIComponent(g.key);
    const syncing = syncingIn(ctx.boxes, g);
    const sensors = splitSensors(ctx.hass, g.sensors);

    // The room's colored header stays; scenes and lights scroll below it.
    return html`<div class="screen-head hero-head">
      <div class=${classMap({ hero: true, ...surface.classes })} style=${styleMap(surface.style)}>
        <div
          class="inner"
          @value-input=${(e: CustomEvent<number>) => (this.dragging = e.detail)}
          @value-change=${() => (this.dragging = null)}
          @value-cancel=${() => (this.dragging = null)}
        >
          <div class=${classMap({ topbar: true, adjusting: this.dragging !== null })}>
            <button class="round back" aria-label=${t("common.back")} @click=${() => ctx.go("")}>${icon("back")}</button>
            <div class="title">${this.dragging !== null ? `${this.dragging}%` : g.name}</div>
            <button class="round add" aria-label=${t("add.title")} @click=${() => (this.adding = true)}>${icon("plus")}</button>
            ${groupToggle(ctx, g, state)}
          </div>
          ${groupSlider(ctx, g, state, t("common.brightness"))}
          <div class="badges">${adaptiveFor(ctx.hass, g).map((al) => this.adaptiveBadge(al))}</div>
        </div>
      </div>
    </div>
    <div class="screen-body"><div class="page">
      ${this.readings(g.sensors, sensors.rest)}
      ${this.syncCards(g)}
      ${g.scenes.length
        ? html`<h2 class="label">${t("room.scenes")}</h2>
            <div class=${classMap({ grid: true, "scene-row": true, locked: syncing.length > 0 })}>${g.scenes.map((s) => this.scene(g, s))}</div>`
        : nothing}
      <div class="section-head">
        <h2 class="label">${t("room.lights")}</h2>
        ${this.bridgeTag(g)}
        ${g.kind === "area" && g.lights.length > 1
          ? html`<button class="pill shuffle" @click=${() => ctx.go(`/room/${room}/space`)}>${icon("rooms")}${t("space.arrange")}</button>`
          : nothing}
      </div>
      ${this.splitNote(g)}
      ${mismatchesIn(ctx.rooms, g).map((m) => this.mismatch(m))}
      <div class="light-row">${g.lights.map((id) => this.light(id, syncing.includes(id)))}</div>
      ${sensors.devices.length
        ? html`<h2 class="label">${t("room.controls")}</h2>
            <div class="control-row">${sensors.devices.map((d) => this.sensor(g, d))}</div>`
        : nothing}
      ${roomAutomations(ctx, g)}
    </div></div>
    ${this.adding
      ? html`<hue-studio-add-sheet .ctx=${this.ctx} .rev=${this.rev} .group=${g} @close=${() => (this.adding = false)}></hue-studio-add-sheet>`
      : nothing}`;
  }

  /**
   * The room's temperature and light level, and motion of sensors that are not Hue's (a Hue
   * sensor has its card); a tap opens the sensor in HA.
   */
  private readings(all: RoomSensors, rest: RoomSensors) {
    const { ctx } = this;
    const { t } = ctx;
    const lang = this.userLang();
    const state = sensorReadings(ctx.hass, { ...all, motion: rest.motion });
    const chip = (ids: string[], glyph: string, text: string, on = false) =>
      html`<button class=${classMap({ "sensor-chip": true, on })} @click=${() => openStockMoreInfo(ids[0])}>
        <ha-icon icon=${glyph}></ha-icon><span>${text}</span>
      </button>`;
    const chips = [
      rest.motion.length
        ? chip(
            rest.motion,
            state.motion ? "mdi:motion-sensor" : "mdi:motion-sensor-off",
            state.motion ? t("sensors.motion") : state.lastMotion ? t("sensors.motion_ago", { time: since(state.lastMotion, lang) }) : t("sensors.no_motion"),
            state.motion,
          )
        : nothing,
      state.temperature !== null ? chip(all.temperature, "mdi:thermometer", `${this.number(state.temperature, 1)} °C`) : nothing,
      state.illuminance !== null ? chip(all.illuminance, "mdi:brightness-5", `${this.number(state.illuminance, 0)} lx`) : nothing,
    ].filter((c) => c !== nothing);
    return chips.length ? html`<div class="sensor-row">${chips}</div>` : nothing;
  }

  /**
   * A Hue sensor's card, the Hue app's "Controls" tile: its picture and switch (the sensor
   * on/off) on top, the name and when it last saw motion below; a tap opens its settings.
   */
  private sensor(g: Group, d: HueSensor) {
    const { ctx } = this;
    const { t } = ctx;
    const state = sensorReadings(ctx.hass, d.sensors);
    const enabled = d.enabled ? ctx.hass.states[d.enabled] : undefined;
    const off = enabled?.state === "off";
    const status = off
      ? t("sensors.off")
      : state.motion
        ? t("sensors.motion")
        : state.lastMotion
          ? lastSeen(state.lastMotion, ctx.hass.locale, this.userLang())
          : d.sensors.motion.length
            ? t("sensors.no_motion")
            : "";
    const open = () => ctx.go(`/room/${encodeURIComponent(g.key)}/sensor/${encodeURIComponent(d.device)}`);
    return html`<div class=${classMap({ "control-card": true, motion: state.motion && !off, off })} role="button" tabindex="0" @click=${open}>
      <div class="top">
        <ha-icon icon=${d.icon}></ha-icon>
        ${enabled
          ? html`<div class=${classMap({ inert: enabled.state === "unavailable" })}>
              ${toggle(enabled.state === "on", t("common.toggle"), () =>
                ctx.call("switch", enabled.state === "on" ? "turn_off" : "turn_on", { entity_id: d.enabled! }),
              )}
            </div>`
          : nothing}
      </div>
      <div class="name">${d.name}</div>
      ${status ? html`<div class="sub">${status}</div>` : nothing}
    </div>`;
  }

  private userLang(): string {
    return this.ctx.hass.locale?.language || this.ctx.hass.language || "en";
  }

  private number(v: number, digits: number): string {
    return new Intl.NumberFormat(this.userLang(), { maximumFractionDigits: digits }).format(v);
  }

  /**
   * Sync Boxes whose entertainment area has lights of this room: while one syncs, the Hue
   * app's banner (stop it right there); else a card with status and start.
   */
  private syncCards(g: Group) {
    const { ctx } = this;
    const boxes = boxesForGroup(ctx.boxes, g);
    if (!boxes.length) return nothing;
    const syncing = boxes.filter(([, box]) => box.syncing);
    if (syncing.length) return html`<div class="sync-cards">${syncing.map(([id, box]) => syncBanner(ctx, id, box))}</div>`;
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
    const apply = async (e: Event) => {
      // The Sync Box would overwrite the scene right away.
      if (syncingIn(ctx.boxes, g).length) return refuse(e.currentTarget);
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
    return tileCard({
      art: html`<div class="dot" style=${styleMap({ background: ctx.gallery || info ? dot : null })}></div>`,
      name: s.name,
      sub: [s.group !== g.group ? friendlyName(ctx.hass, s.group) : ""],
      overlay: active
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
        : nothing,
      classes: { scene: true, ...surface.classes, active },
      style: surface.style,
      click: apply,
    });
  }

  /** With several bridges: the bridge the room is on; an admin moves the room from there. */
  private bridgeTag(g: Group) {
    const { ctx } = this;
    const plan = ctx.rooms;
    const name = severalBridges(plan) ? bridgeName(plan, groupBridge(plan, g)) : null;
    if (!name) return nothing;
    const content = html`<ha-icon icon="mdi:router-wireless"></ha-icon>${name}`;
    if (g.kind !== "area" || !ctx.hass.user?.is_admin) return html`<span class="bridge-tag">${content}</span>`;
    const area = g.key.slice("area.".length);
    return html`<button class="bridge-tag" aria-label=${ctx.t("move.title")} @click=${() => ctx.go(`/settings/bridges/move?area=${encodeURIComponent(area)}`)}>
      ${content}<ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
    </button>`;
  }

  /**
   * A room whose lights are on several bridges. An area belongs to one bridge (each bridge
   * is its own Hue system: rooms, scenes and entertainment areas never span two), so the
   * lights away from the room's bridge are named.
   */
  private splitNote(g: Group) {
    const { ctx } = this;
    const { t } = ctx;
    const plan = ctx.rooms;
    if (g.kind !== "area" || !plan?.split_areas?.[g.key.slice("area.".length)]) return nothing;
    const [main, ...others] = lightsByBridge(plan, g.lights);
    if (!main || !others.length) return nothing;
    return html`<div class="mismatch">
      ${others.map(
        ([bridge, lights]) =>
          html`<p>${t("room.split_note", {
            lights: lights.map((l) => friendlyName(ctx.hass, l)).join(", "),
            bridge: bridgeName(plan, bridge) ?? "",
            main: bridgeName(plan, main[0]) ?? "",
          })}</p>`,
      )}
      <div class="buttons">
        ${ctx.hass.user?.is_admin
          ? others.map(([, lights]) => {
              const query = `lights=${lights.map(encodeURIComponent).join(",")}&to_area=${encodeURIComponent(g.key.slice("area.".length))}&to=${encodeURIComponent(main[0])}`;
              return html`<button class="pill" @click=${() => ctx.go(`/settings/bridges/move?${query}`)}>${t("move.to_bridge", { bridge: bridgeName(plan, main[0]) ?? "" })}</button>`;
            })
          : nothing}
        <button class="pill" @click=${() => ctx.go("/rooms")}>${t("rooms.title")}</button>
      </div>
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

  /**
   * A light card, the same as in the color screen; a tap opens the light's dialog (the color
   * screen). A light a Sync Box drives is not opened: the tap is refused.
   */
  private light(id: string, busy: boolean) {
    const open = () => this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: id }, bubbles: true, composed: true }));
    return lightTile(this.ctx, id, open, { busy });
  }
}

/** When something happened, like the Hue app: "Oct 12, 23:42" (HA's 12/24-hour setting). */
export function lastSeen(iso: string, locale: { time_format?: string } | undefined, lang: string): string {
  const cycle = locale?.time_format === "24" ? { hourCycle: "h23" as const } : locale?.time_format === "12" ? { hourCycle: "h12" as const } : {};
  return new Intl.DateTimeFormat(lang, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", ...cycle }).format(new Date(iso));
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
