// The more-info override's sheet for a Hue scene (roadmap G2): its picture in its colors
// and the room it belongs to, "Activate" (and, while it is on, dynamic play and shuffled
// colors, as on the panel's scene tile), "Edit scene" in the panel's scene editor and HA's
// own dialog behind "Details". Built and rendered synchronously from `hass`, so the
// override can still fall back to HA's dialog; the scene's palette and status arrive with
// the context's subscriptions.

import { css, html, LitElement, nothing, unsafeCSS } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import { SHEET_CSS } from "../../automations/views/automation-sheet.ts";
import { StudioContext } from "../../../core/context.ts";
import { sceneColors, sceneDot, sceneGlyph, surfaceOf } from "../../../ds/controls.ts";
import { currentHass, haptic, navigate, openPanelFrom, openStockMoreInfo, watchHass } from "../../../core/ha-internals.ts";
import { allGroups, friendlyName, type Group, type Home } from "../../../core/model.ts";
import { CSS } from "../../../ds/styles/index.ts";
import { boxesForGroup, syncingIn } from "../../sync/sync.ts";
import type { Hass } from "../../../core/types.ts";
import { icon, keepTouchInside } from "../../../ds/ui.ts";

/** How long "Active" shows without the bridge confirming it (CLAUDE.md: 5 s). */
const EXPECT_MS = 5000;

const SCENE_CSS = css`
  .ss-card { display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 10px 12px; border-radius: var(--r-m); }
  .ss-dot { width: 44px; height: 44px; flex: none; border-radius: 50%; background: var(--surface-raised) center / cover no-repeat;
            box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25); display: flex; align-items: center; justify-content: center; color: #fff; }
  .ss-dot ha-icon { --mdc-icon-size: 24px; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35)); }
  .ss-card .grow { flex: 1; min-width: 0; }
  .ss-room { opacity: 0.75; font-size: var(--fs-footnote); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ss-check { width: 28px; height: 28px; flex: none; border-radius: 50%; display: flex; align-items: center; justify-content: center;
              background: rgba(255, 255, 255, 0.25); --mdc-icon-size: 18px; }
  .dark-text .ss-check { background: rgba(0, 0, 0, 0.12); }
  .ss-note { margin: 12px 2px 0; color: var(--text-2); font-size: var(--fs-callout); }
  .as-actions .pill { display: flex; align-items: center; justify-content: center; gap: 6px; }
  .as-actions .pill svg { width: 16px; height: 16px; fill: currentColor; }
`;

/** Whether `hass-more-info` for this entity opens our sheet. */
export function opensSceneSheet(hass: Hass, entityId: string): boolean {
  // HA's own pages stay HA's.
  if (location.pathname === "/config" || location.pathname.startsWith("/config/")) return false;
  return entityId.startsWith("scene.") && hass.entities?.[entityId]?.platform === "hue";
}

/** The panel's room or zone that offers the scene. */
function roomOf(home: Home, entityId: string): Group | null {
  return allGroups(home).find((g) => g.scenes.some((s) => s.entity_id === entityId)) ?? null;
}

export class HueStudioSceneSheet extends LitElement {
  static override styles = [unsafeCSS(CSS), SHEET_CSS, SCENE_CSS];

  private ctx: StudioContext | null = null;
  private entityId = "";
  /** "Active" until the bridge confirms it (or it fails, or 5 s pass). */
  private expected = false;
  private expectTimer?: ReturnType<typeof setTimeout>;
  private stopWatch?: () => void;
  private untouch?: () => void;
  private closing = false;

  /** Build and render the sheet synchronously (the element must be connected); throws if anything is off. */
  open(entityId: string): void {
    const hass = currentHass();
    if (!hass?.states[entityId]) throw new Error("no scene");
    this.entityId = entityId;
    this.ctx = new StudioContext(() => this.requestUpdate());
    try {
      this.ctx.setHass(hass);
      this.performUpdate();
      if (!this.renderRoot.querySelector(".dlg")) throw new Error("not rendered");
    } catch (err) {
      this.ctx.dispose();
      this.ctx = null;
      throw err;
    }

    this.addEventListener("click", (e) => e.composedPath()[0] === this && this.close());
    this.untouch = keepTouchInside(this);
    window.addEventListener("keydown", this.onKey);
    this.stopWatch = watchHass((h) => {
      if (!this.ctx || this.closing) return;
      this.ctx.setHass(h);
      if (!h.states[entityId]) this.close();
      else this.requestUpdate();
    });
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.close();
  };

  /** The lights the scene sets, as a group (Sync Box). */
  private lightsGroup(ctx: StudioContext, room: Group | null): Group {
    const lights = (ctx.sceneInfo[this.entityId]?.lights ?? []).filter((id) => ctx.hass.states[id]);
    if (room && (!lights.length || lights.every((id) => room.lights.includes(id)))) return room;
    return {
      key: `scene:${this.entityId}`,
      kind: "hue",
      name: friendlyName(ctx.hass, this.entityId),
      icon: "",
      lights,
      target: lights,
      group: null,
      scenes: [],
      sensors: { motion: [], temperature: [], illuminance: [] },
    };
  }

  private async activate(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    haptic("light");
    this.expected = true;
    clearTimeout(this.expectTimer);
    this.expectTimer = setTimeout(() => {
      this.expected = false;
      this.requestUpdate();
    }, EXPECT_MS);
    this.requestUpdate();
    if (!(await ctx.call("scene", "turn_on", { entity_id: this.entityId }))) {
      this.expected = false;
      this.requestUpdate();
    }
  }

  private async recall(data: Record<string, unknown>, service: "recall_scene" | "reset_scene"): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    haptic("light");
    await ctx.call("hue_studio", service, { entity_id: this.entityId, ...data }, { optimistic: false });
  }

  /** The panel's scene editor; outside the panel, closing it returns to this page. */
  private edit(room: Group): void {
    const path = `/hue/room/${encodeURIComponent(room.key)}/scene/${encodeURIComponent(this.entityId)}`;
    this.close();
    if (location.pathname === "/hue" || location.pathname.startsWith("/hue/")) navigate(path);
    else openPanelFrom(path, location.pathname + location.search + location.hash);
  }

  private details(): void {
    this.close();
    openStockMoreInfo(this.entityId);
  }

  protected override render() {
    const { ctx, entityId } = this;
    if (!ctx?.ready) return nothing;
    const { hass, t } = ctx;
    const state = hass.states[entityId];
    const name = String(state?.attributes.name || friendlyName(hass, entityId));
    const info = ctx.sceneInfo[entityId];
    const room = roomOf(ctx.home, entityId);
    const where = room?.name || String(state?.attributes.group_name || "");
    const group = this.lightsGroup(ctx, room);
    if (this.expected && info && info.active !== "inactive") {
      this.expected = false;
      clearTimeout(this.expectTimer);
    }
    const active = this.expected || (!!info && info.active !== "inactive");
    const playing = info?.active === "dynamic_palette";
    const surface = surfaceOf({ on: true, colors: sceneColors(info) });
    const glyph = sceneGlyph(hass, ctx.gallery, entityId, name, info);
    const synced = syncingIn(ctx.boxes, group);
    const box = synced.length ? boxesForGroup(ctx.boxes, { lights: synced })[0]?.[1].name || "" : "";

    return html`<div class="dlg" role="dialog" aria-modal="true" aria-label=${name}>
        <div class="grabber"></div>
        <div class=${classMap({ "ss-card": true, ...surface.classes })} style=${styleMap(surface.style)}>
          <div class="ss-dot" style=${styleMap({ background: sceneDot(ctx.gallery, name, info) })}>
            ${glyph ? html`<ha-icon icon=${glyph}></ha-icon>` : nothing}
          </div>
          <div class="grow">
            <div class="as-title">${name}</div>
            ${where ? html`<div class="ss-room">${where}</div>` : nothing}
          </div>
          ${active ? html`<span class="ss-check" aria-label=${t("scene.active")}><ha-icon icon="mdi:check"></ha-icon></span>` : nothing}
        </div>
        ${synced.length ? html`<p class="ss-note">${t("color.sync_all", { name: box })}</p>` : nothing}
        <div class="as-actions">
          <button class="pill primary" ?disabled=${synced.length > 0} @click=${() => this.activate()}>
            ${t("scene.activate")}
          </button>
          ${active && info?.dynamic
            ? html`<button class="pill" ?disabled=${synced.length > 0} @click=${() => this.recall({ dynamic: !playing }, "recall_scene")}>
                ${icon(playing ? "pause" : "play")}${playing ? t("scene.pause") : t("scene.play")}
              </button>`
            : nothing}
          ${active && info?.resettable && (info.palette.length > 1 || info.mirek.length > 1)
            ? html`<button class="pill" ?disabled=${synced.length > 0} @click=${() => this.recall({ shuffle: true, recall: true }, "reset_scene")}>
                ${icon("shuffle")}${t("scene.shuffle_colors")}
              </button>`
            : nothing}
          ${room && info
            ? html`<button class="pill" @click=${() => this.edit(room)}>${t("scene.edit")}</button>`
            : nothing /* a smart scene (natural light) has no palette to edit here */}
        </div>
        <button class="as-details" @click=${() => this.details()}>${t("more.settings")}</button>
      </div>
      <div class=${classMap({ toast: true, on: ctx.toastOn })}>${ctx.toastText}</div>`;
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    this.stopWatch?.();
    this.untouch?.();
    clearTimeout(this.expectTimer);
    window.removeEventListener("keydown", this.onKey);
    this.ctx?.dispose();
    this.classList.add("closing");
    setTimeout(() => this.remove(), 320);
  }
}

if (!customElements.get("hue-studio-scene-sheet")) customElements.define("hue-studio-scene-sheet", HueStudioSceneSheet);
