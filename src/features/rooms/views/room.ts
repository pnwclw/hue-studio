// Room: header with toggle, brightness and "+" (add a scene, an automation
// or a device: add-sheet.ts); the room's readings (temperature, light level, motion of
// sensors that are not Hue's); its Hue scenes, the scene gallery and a suggested scene of
// it; its lights; its Hue sensors ("Controls", a card each, opening the sensor's
// settings); its automations, like the Hue app.

import { html, nothing } from "lit";
import type { PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";

import { paletteArt, paletteColors } from "../../../core/color.ts";
import { banner, groupSlider, groupToggle, lightTile, sceneColors, sceneDot, sceneGlyph, scenePalette, shownState, speedSheet, surfaceOf, syncBanner, tileCard } from "../../../ds/controls.ts";
import { speedToStep, stepToSpeed } from "../../color/effects.ts";
import { galleryMatch, thumbUrl } from "../../scenes/gallery-data.ts";

import { haptic, openStockMoreInfo } from "../../../core/ha-internals.ts";
import {
  findGroup,
  friendlyName,
  type Group,
  type HueSensor,
  type Scene,
  sensorReadings,
  splitSensors,
} from "../../../core/model.ts";
import { bridgeName, lightsByBridge, type Mismatch, mismatchesIn } from "../rooms.ts";
import { readyScenesNow } from "../../automations/daylight.ts";
import { gallerySeasons, shownCategories } from "../../scenes/seasons.ts";
import { canSpread } from "../space.ts";
import { boxesForGroup, currentInput, statusKey, syncingIn } from "../../sync/sync.ts";
import type { GalleryScene, RoomSensors, SyncBoxInfo } from "../../../core/types.ts";
import { icon, refuse, toggle } from "../../../ds/ui.ts";
import "./add-sheet.ts";
import { roomAutomations } from "../../automations/views/automations.ts";
import { StudioView } from "../../../ds/base.ts";
import { otherRoom, type PickedScene, pickPicture, sharedPick } from "../../scenes/views/scene-pick.ts";
import { paletteShare, sendLink, type SharedScene, shareLink } from "../../scenes/share.ts";

@customElement("hue-studio-room-view")
export class RoomView extends StudioView {
  @property() accessor key = "";

  /** The "+" sheet (what to add) is open. */
  @state() private accessor adding = false;
  /** Brightness while the header's slider is dragged: the header shows just the percentage. */
  @state() private accessor dragging: number | null = null;
  /** The scene whose "⋯" menu is open, and whether "Delete" was tapped once. */
  @state() private accessor menu: { scene: string } | null = null;
  /** The dynamic speed sheet of a scene: the step on its slider (1-12). */
  @state() private accessor speed: { scene: string; step: number } | null = null;
  /** "Copy to…": the scene's sheet, going to another room or zone. */
  @state() private accessor copying: { scene: PickedScene; room: string } | null = null;
  /** The suggested gallery scene, per room (a new one on "shuffle"). */
  @state() private accessor suggested: { room: string; id: string } | null = null;

  protected override renderPage() {
    const { ctx } = this;
    const { t } = ctx;
    const g = findGroup(ctx.home, this.key);
    if (!g) {
      return this.screen(this.subHead("", () => ctx.go("")), html`<p class="empty">${t("room.not_found")}</p>`);
    }
    const state = shownState(ctx, g);
    const surface = surfaceOf(state);
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
        </div>
      </div>
    </div>
    <div class="screen-body"><div class="page">
      ${this.readings(g.sensors, sensors.rest)}
      ${this.syncCards(g)}
      <h2 class="label">${t("room.scenes")}</h2>
      ${this.sceneColumns(g, syncing.length > 0)}
      <h2 class="label">${t("room.lights")}</h2>
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
      ? html`<hue-studio-add-sheet .ctx=${this.ctx} .rev=${this.rev} .group=${g} @close=${() => (this.adding = false)}
          @shared=${(e: CustomEvent<SharedScene>) => {
            // A scene from a link: its card, for this room (another one can be picked).
            this.copying = { scene: sharedPick(ctx.t("share.scene_name"), ctx.gallery, e.detail), room: g.key };
          }}></hue-studio-add-sheet>`
      : nothing}
    ${this.menu ? this.menuSheet(g, this.menu.scene) : nothing}
    ${this.speed ? this.speedSheet(g, this.speed.scene) : nothing}
    ${this.copying
      ? html`<hue-studio-scene-pick .ctx=${ctx} .rev=${this.rev} .scene=${this.copying.scene} .room=${this.copying.room} pickRoom
          @close=${() => (this.copying = null)}></hue-studio-scene-pick>`
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

  /**
   * The scenes like the Hue app's: two rows that scroll sideways, the active one's edit and
   * "⋯" buttons beside it (the cards after it in its row move along to make room), then the
   * gallery over a suggested scene, with a button for another suggestion.
   */
  private sceneColumns(g: Group, locked: boolean) {
    const { ctx } = this;
    // Two rows, the scenes in columns of two as they come (the first row takes the first of
    // each pair). The active scene's buttons go in after it in its own row only, so only
    // the cards after it move; the gallery and the suggestion end the rows, one over the other.
    const rows: { key: string; tpl: unknown }[][] = [[], []];
    g.scenes.forEach((s, i) => {
      const row = rows[i % 2];
      row.push({ key: s.entity_id, tpl: this.scene(g, s) });
      if ((ctx.sceneInfo[s.entity_id]?.active ?? "inactive") !== "inactive")
        row.push({ key: `side-${s.entity_id}`, tpl: this.sceneButtons(g, s) });
    });
    const suggestion = this.suggestion(g);
    const shuffle = html`<div class="scene-side"><button class="round" aria-label=${ctx.t("room.another")} @click=${() => this.shuffleSuggestion(g)}>${icon("shuffle")}</button></div>`;
    // No scenes yet, like the Hue app's: what scenes are, a suggestion and the gallery.
    if (!g.scenes.length)
      return html`<div class="first-scene">
        <h3>${ctx.t("room.first_scene")}</h3>
        <p>${ctx.t("room.first_scene_text")}</p>
        <div class="first-scene-cards">
          ${suggestion ? html`${this.suggestedCard(g, suggestion)}${shuffle}` : nothing}
          ${this.galleryCard(g)}
        </div>
      </div>`;
    // Keyed cells: a card keeps its element when others come in, so it can slide.
    const line = (cells: { key: string; tpl: unknown }[]) =>
      repeat(cells, (c) => c.key, (c) => html`<div class="scene-cell" data-k=${c.key}>${c.tpl}</div>`);
    const tail = (cells: { key: string; tpl: unknown }[]) => html`<div class="scene-line scene-tail">${line(cells)}</div>`;
    return html`<div class=${classMap({ "scene-cols": true, locked })}>
      <div class="scene-grid">
        <div class="scene-line">${line(rows[0])}</div>
        ${tail([{ key: "gallery", tpl: this.galleryCard(g) }])}
        <div class="scene-line">${line(rows[1])}</div>
        ${tail(
          suggestion
            ? [
                { key: `suggested-${suggestion.id}`, tpl: this.suggestedCard(g, suggestion) },
                { key: "shuffle", tpl: shuffle },
              ]
            : [],
        )}
      </div>
    </div>`;
  }

  /** Where the scene cards were before an update, to slide them to where they are after it. */
  private cellsAt = new Map<string, number>();

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    this.cellsAt.clear();
    this.querySelectorAll<HTMLElement>(".scene-cols .scene-cell").forEach((el) => this.cellsAt.set(el.dataset.k!, el.getBoundingClientRect().left));
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    this.querySelectorAll<HTMLElement>(".scene-cols .scene-cell").forEach((el) => {
      const was = this.cellsAt.get(el.dataset.k!);
      const dx = was === undefined ? 0 : was - el.getBoundingClientRect().left;
      if (Math.abs(dx) > 1) el.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], { duration: 360, easing: "cubic-bezier(0.25, 0.8, 0.25, 1)" });
    });
  }

  /**
   * A scene tile; its dot shows the matching gallery picture (bridge scenes usually come
   * from the gallery), else its palette. The active scene is lit in its colors; a dynamic
   * one shows play/stop in place of its picture, like in the Hue app.
   */
  private scene(g: Group, s: Scene) {
    const { ctx } = this;
    const { t } = ctx;
    const info = ctx.sceneInfo[s.entity_id];
    const dot = sceneDot(ctx.gallery, s.name, info);
    const glyph = sceneGlyph(ctx.hass, ctx.gallery, s.entity_id, s.name, info);
    const active = !!info && info.active !== "inactive";
    const playing = info?.active === "dynamic_palette";
    const colors = info ? sceneColors(info) : [];
    const surface = surfaceOf({ on: active, colors });
    const apply = async (e: Event) => {
      // The Sync Box would overwrite the scene right away.
      if (syncingIn(ctx.boxes, g).length) return refuse(e.currentTarget);
      await ctx.call("scene", "turn_on", { entity_id: s.entity_id });
    };
    const play = async (e: Event) => {
      e.stopPropagation();
      await ctx.call("hue_studio", "recall_scene", { entity_id: s.entity_id, dynamic: !playing }, { optimistic: false });
    };
    return tileCard({
      art:
        active && info.dynamic
          ? html`<button class="scene-play" aria-label=${playing ? t("scene.pause") : t("scene.play")} @click=${play}>${icon(playing ? "stop" : "play")}</button>`
          : html`<div class=${classMap({ dot: true, glyph: !!glyph })} style=${styleMap({ background: ctx.gallery || info ? dot : null })}>
              ${glyph ? html`<ha-icon icon=${glyph}></ha-icon>` : nothing}
            </div>`,
      name: s.name,
      sub: [s.group !== g.group ? friendlyName(ctx.hass, s.group) : ""],
      classes: { scene: true, ...surface.classes, active },
      style: surface.style,
      click: apply,
    });
  }

  /** Beside the active scene: edit it, and "⋯" for the rest. */
  private sceneButtons(g: Group, s: Scene) {
    const { ctx } = this;
    const { t } = ctx;
    const edit = () => ctx.go(`/room/${encodeURIComponent(g.key)}/scene/${encodeURIComponent(s.entity_id)}`);
    return html`<div class="scene-side">
      <button class="round" aria-label=${t("scene.edit")} @click=${edit}>${icon("pencil")}</button>
      <button class="round" aria-label=${t("scene.more")} @click=${() => (this.menu = { scene: s.entity_id })}>${icon("dots")}</button>
    </div>`;
  }

  /** The "⋯" of a scene, an action sheet like the Hue app's: copy, speed, shuffle, delete. */
  private menuSheet(g: Group, entityId: string) {
    const { ctx } = this;
    const { t } = ctx;
    const s = g.scenes.find((x) => x.entity_id === entityId);
    const info = ctx.sceneInfo[entityId];
    const close = () => (this.menu = null);
    if (!s) return nothing;
    const act = (run: () => void) => () => {
      haptic("selection");
      close();
      run();
    };
    // "Copy to…": the scene's sheet, another room or zone picked, saved there or set once.
    const copy = () => {
      const match = galleryMatch(ctx.gallery, s.name, info?.image);
      const { points, mirek } = scenePalette(info);
      this.copying = {
        scene: {
          name: s.name,
          gallery: match?.id ?? null,
          picture: match ? `url("${thumbUrl(match.id)}") center / cover, ${paletteArt(match)}` : pickPicture(points, mirek),
          art: match ? paletteArt(match) : pickPicture(points, mirek),
          points,
          mirek,
          gradient: points.length > 1,
        },
        room: otherRoom(ctx, g.key),
      };
    };
    // "Share": the scene as a Hue app link (its colors, its gallery picture, its speed).
    const share = async () => {
      const { points, mirek } = scenePalette(info);
      const image = info?.image ?? galleryMatch(ctx.gallery, s.name, info?.image)?.public_image ?? null;
      // Its whites too: a Hue palette has colors for color lights and whites for white ones.
      const whites = info?.mirek.length ? info.mirek : (info?.whites ?? []);
      const link = await shareLink(paletteShare({ points, whites, mirek, image, speed: info?.speed }));
      const sent = await sendLink(link, s.name);
      if (sent === "copied") ctx.toast(t("share.copied"));
      else if (sent === null) ctx.toast(t("share.failed"));
    };
    const shuffle = async () => {
      const data = { entity_id: entityId, shuffle: true, recall: true };
      await ctx.call("hue_studio", "reset_scene", data, { optimistic: false });
    };
    // Deleting asks on its own action sheet (the Hue app's).
    const remove = () => {
      close();
      this.askDelete(t("scene.delete_note"), t("scene.delete"), async () => {
        if (await ctx.call("hue_studio", "delete_scene", { entity_id: entityId }, { optimistic: false })) ctx.toast(t("scene.deleted", { name: s.name }));
      });
    };
    return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow, menu: true })} @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="box action-sheet" role="dialog" aria-label=${s.name}>
        <button @click=${act(copy)}>${t("scene.copy_to")}</button>
        <button @click=${act(() => void share())}>${t("share.share")}</button>
        ${info?.dynamic ? html`<button @click=${act(() => (this.speed = { scene: entityId, step: speedToStep(info.speed) }))}>${t("scene.change_speed")}</button>` : nothing}
        ${info?.resettable && (info.palette.length > 1 || info.mirek.length > 1) ? html`<button @click=${act(shuffle)}>${t("scene.shuffle_colors")}</button>` : nothing}
        ${ctx.hass.user?.is_admin ? html`<button class="danger" @click=${remove}>${t("scene.delete")}</button>` : nothing}
        <button class="cancel" @click=${close}>${t("common.cancel")}</button>
      </div>
    </div>`;
  }

  /** The dynamic speed of a scene; kept on "Done" (only the speed: a playing scene's lights are mid-way). */
  private speedSheet(g: Group, entityId: string) {
    const { ctx } = this;
    const sheet = this.speed!;
    return speedSheet(ctx, {
      step: sheet.step,
      set: (step) => (this.speed = { ...sheet, step }),
      close: () => (this.speed = null),
      done: async () => {
        this.speed = null;
        const data = { entity_id: entityId, speed: Math.round(stepToSpeed(sheet.step) * 100), capture: false };
        await ctx.call("hue_studio", "save_scene", data, { optimistic: false });
      },
    });
  }

  /** Gallery scenes shown now (seasonal categories in their time), none the room has already. */
  private galleryScenes(g: Group): GalleryScene[] {
    const { ctx } = this;
    const gallery = ctx.gallery;
    if (!gallery) return [];
    const shown = shownCategories(gallery.categories, gallerySeasons(ctx.config), ctx.hass);
    const own = new Set(g.scenes.map((s) => s.name.toLowerCase()));
    return gallery.scenes.filter((s) => shown.includes(s.category) && !own.has(s.name.toLowerCase()));
  }

  /**
   * What a suggestion comes from: the scenes of the day now by Hue Studio's ready-made tags
   * (none of the user's on top), else the gallery as it is shown.
   */
  private suggestible(g: Group): GalleryScene[] {
    const scenes = this.galleryScenes(g);
    const day = this.ctx.daylight;
    if (!day) return scenes;
    const ids = new Set(readyScenesNow(day.defaults, day.now, scenes.map((s) => s.id)));
    const ofDay = scenes.filter((s) => ids.has(s.id));
    return ofDay.length ? ofDay : scenes;
  }

  /** The suggested scene of the room: kept until "shuffle", a random scene of the day first. */
  private suggestion(g: Group): GalleryScene | null {
    const scenes = this.suggestible(g);
    const kept = this.suggested?.room === g.key ? scenes.find((s) => s.id === this.suggested!.id) : undefined;
    if (kept) return kept;
    const pick = scenes[Math.floor(Math.random() * scenes.length)];
    if (pick) queueMicrotask(() => (this.suggested = { room: g.key, id: pick.id }));
    return pick ?? null;
  }

  private shuffleSuggestion(g: Group): void {
    const scenes = this.suggestible(g).filter((s) => s.id !== this.suggested?.id);
    const pick = scenes[Math.floor(Math.random() * scenes.length)];
    if (!pick) return;
    haptic("selection");
    this.suggested = { room: g.key, id: pick.id };
  }

  /** "Scene gallery": three of its pictures, a tap opens it for the room. */
  private galleryCard(g: Group) {
    const { ctx } = this;
    const scenes = this.galleryScenes(g);
    const step = Math.max(1, Math.floor(scenes.length / 3));
    const three = [0, 1, 2].map((i) => scenes[i * step]).filter(Boolean);
    return tileCard({
      art: html`<div class="dots-three">${three.map((s) => html`<span style=${styleMap({ background: `url("${thumbUrl(s.id)}") center / cover, ${paletteArt(s)}` })}></span>`)}</div>`,
      name: ctx.t("room.gallery"),
      classes: { scene: true, "gallery-card": true },
      click: () => ctx.go(`/gallery?room=${encodeURIComponent(g.key)}`),
    });
  }

  /** A suggested scene of the day, the top of a stack of cards: a tap sets it in the room once. */
  private suggestedCard(g: Group, scene: GalleryScene) {
    const { ctx } = this;
    const colors = paletteColors(scene);
    const apply = async (e: Event) => {
      if (syncingIn(ctx.boxes, g).length) return refuse(e.currentTarget);
      const spatial = scene.kind === "gradient" && canSpread(ctx.positions, g.lights);
      const data = { entity_id: g.target, gallery_scene: scene.id, ...(spatial ? { layout: "spatial" } : {}) };
      await ctx.call("hue_studio", "apply_palette", data, { optimistic: false });
    };
    return tileCard({
      art: html`<div class="dot" style=${styleMap({ background: `url("${thumbUrl(scene.id)}") center / cover, ${paletteArt(scene)}` })}></div>`,
      name: scene.name,
      sub: [ctx.t("room.suggested")],
      classes: { scene: true, suggested: true },
      // A touch of the scene's colors, on the card and the cards stacked under it.
      style: { "--tint-a": colors[0], "--tint-b": colors[colors.length - 1] },
      click: apply,
    });
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
    return banner({
      title: t("room.split_title"),
      warn: true,
      text: html`${others.map(
        ([bridge, lights]) =>
          html`<p>${t("room.split_note", {
            lights: lights.map((l) => friendlyName(ctx.hass, l)).join(", "),
            bridge: bridgeName(plan, bridge) ?? "",
            main: bridgeName(plan, main[0]) ?? "",
          })}</p>`,
      )}`,
      open: { label: t("rooms.title"), run: () => ctx.go("/rooms") },
    });
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
    return banner({
      title: t("mismatch.title"),
      warn: true,
      text: t("mismatch.note", { light: friendlyName(ctx.hass, m.light), room: m.hueRoom }),
      buttons: html`<button class="pill" @click=${accept}>${t("mismatch.accept", { area })}</button>
        ${ctx.hass.user?.is_admin ? html`<button class="pill" @click=${restore}>${t("mismatch.restore")}</button>` : nothing}`,
    });
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

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-room-view": RoomView;
  }
}
