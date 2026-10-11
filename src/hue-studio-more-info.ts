// Loaded on every HA page (frontend.add_extra_js_url). Opens a Hue-style dialog instead of
// HA's more-info for Hue lights and Hue rooms/zones.
//
// Fallback rules (CLAUDE.md): the event is only stopped after our dialog was built and
// rendered successfully; anything that is not a Hue light, any error, and the "Details"
// button go to HA's own more-info dialog untouched.

import { css, html, LitElement, nothing, unsafeCSS } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import { StudioContext } from "./context.ts";
import { groupSlider, surfaceOf, toggleGroup } from "./controls.ts";
import { currentHass, openPanelFrom, openStockMoreInfo, watchHass } from "./ha-internals.ts";
import { allGroups, friendlyName, type Group, groupOfEntity, groupState, type Home } from "./model.ts";
import { CSS } from "./styles.ts";
import type { Hass } from "./types.ts";
import { icon, keepTouchInside, toggle } from "./ui.ts";
import "./views/color.ts";
import type { ColorView } from "./views/color.ts";

const DIALOG_CSS = css`
  /* A bottom sheet like HA's more-info on phones (drag the head down to close), centered on wide screens. */
  :host { position: fixed; inset: 0; z-index: 8; height: auto; flex-direction: row; align-items: flex-end; justify-content: center;
          background: rgba(0, 0, 0, calc(0.5 * var(--scrim, 1))); animation: fade 0.2s ease; }
  :host(.closing) { animation: fade 0.18s ease reverse forwards; }
  .dlg { display: flex; flex-direction: column; width: 100%; max-width: 440px; overflow: hidden;
         max-height: calc(100dvh - max(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)), 12px) - 8px);
         border-radius: 22px 22px 0 0; background: var(--bg); box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5); animation: up 0.34s var(--spring); }
  :host(.closing) .dlg { animation: up 0.2s ease reverse forwards; }
  .dlg-head { flex: none; padding: 0 16px 14px; border-radius: 22px 22px 0 0; }
  .grip { touch-action: none; cursor: grab; }
  .handle { width: 36px; height: 5px; border-radius: 3px; background: rgba(255, 255, 255, 0.35); margin: 0 auto; }
  .grip.handle-zone { padding: 8px 0 2px; margin: 0 -16px; }
  .dlg-head .topbar { padding-top: 4px; }
  .dlg-head .title { flex: 1; min-width: 0; }
  .dlg-head .title b { display: block; font-size: 18px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dlg-head .title small { font-size: 12px; opacity: 0.7; }
  hue-studio-color-view.colorbody { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .cv-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding: 0 16px; }
  .colorbody .wheel { width: min(76vw, 320px, 40dvh); }
  /* Room for the pins above the disc: the scroller clips them. */
  .colorbody .wheel-wrap { padding-top: 44px; }
  .colorbody .effects { display: block; padding-bottom: 8px; }
  .colorbody .dock { flex: none; padding: 10px 16px calc(12px + env(safe-area-inset-bottom, 0px)); }
  .colorbody .controls { margin: 0; }
  .cv-actions { flex: 1; display: flex; justify-content: flex-end; gap: 8px; }
  .cv-actions .pill { margin: 0; }
  @keyframes up { from { transform: translateY(40px); opacity: 0; } }
  @media (min-width: 600px) {
    :host { align-items: center; }
    .dlg { border-radius: 22px; max-height: 90dvh; }
    .colorbody .dock { padding-bottom: 14px; }
    .handle-zone { visibility: hidden; }
  }
`;

/** Room-like object for one light or one Hue group, as the color view and controls expect it. */
function subjectOf(hass: Hass, home: Home, id: string): { group: Group; room: Group | null } {
  const attrs = hass.states[id]?.attributes || {};
  const single = (lights: string[], target: string[], key: string, group: string | null): Group => ({
    key,
    kind: "hue",
    name: friendlyName(hass, id),
    icon: "",
    lights,
    target,
    group,
    scenes: [],
    sensors: { motion: [], temperature: [], illuminance: [] },
  });
  if (attrs.is_hue_group) {
    const known = allGroups(home).find((g) => g.group === id);
    if (known) return { group: known, room: known };
    const lights = ((attrs.entity_id || []) as string[]).filter((l) => hass.states[l]);
    return { group: single(lights, [id], `hue.${id}`, id), room: null };
  }
  const room = groupOfEntity(home, id);
  return { group: single([id], [id], room?.key || "", null), room };
}

class HueStudioLightDialog extends LitElement {
  static override styles = [unsafeCSS(CSS), DIALOG_CSS];

  private ctx: StudioContext | null = null;
  private entityId = "";
  /** Bumped on every change, so the color view re-renders too. */
  private rev = 0;
  private stopWatch?: () => void;
  /** Dragging the sheet down by its head (phones), like HA's bottom sheet. */
  private drag: { id: number; y: number; t: number; dy: number; v: number } | null = null;

  /**
   * Build and render the dialog synchronously (the element must be connected); throws if
   * anything is off, so the caller can fall back to HA's own dialog.
   */
  open(entityId: string): void {
    const hass = currentHass();
    if (!hass) throw new Error("no hass");
    this.entityId = entityId;
    this.ctx = new StudioContext(() => this.changed());
    try {
      this.ctx.setHass(hass);
      this.performUpdate();
      this.renderRoot.querySelector<ColorView>("hue-studio-color-view")?.renderNow();
    } catch (err) {
      // Drop the WebSocket subscriptions; render nothing if a late update comes.
      this.ctx.dispose();
      this.ctx = null;
      throw err;
    }

    // Backdrop click: the host itself is the first element of the path (clicks inside are retargeted).
    this.addEventListener("click", (e) => e.composedPath()[0] === this && this.close());
    // Lives as long as the dialog element (removed on close).
    keepTouchInside(this);
    window.addEventListener("keydown", this.onKey);
    this.stopWatch = watchHass((h) => {
      if (!this.ctx) return;
      this.ctx.setHass(h);
      if (!h.states[entityId]) this.close();
      else this.changed();
    });
  }

  private changed(): void {
    this.rev++;
    this.requestUpdate();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.close();
  };

  protected override render() {
    const { ctx, entityId } = this;
    if (!ctx?.ready) return nothing;
    const { t } = ctx;
    const { group, room } = subjectOf(ctx.hass, ctx.home, entityId);
    const state = groupState(ctx.hass, group, ctx.lightInfo);
    const surface = surfaceOf(state);
    const details = () => {
      this.close();
      openStockMoreInfo(entityId);
    };
    const studio = () => {
      this.close();
      const light = group.group ? "" : `?light=${encodeURIComponent(entityId)}`;
      // "Done" in the panel brings the user back to this page, not to the panel's home.
      openPanelFrom(`/hue/room/${encodeURIComponent(room!.key)}/color${light}`, location.pathname + location.search + location.hash);
    };
    const actions = html`${room ? html`<button class="pill studio" @click=${studio}>${t("more.open_studio")}</button>` : nothing}
      <button class="pill details" @click=${details}>${t("more.settings")}</button>`;

    return html`<div class="dlg" role="dialog" aria-label=${group.name}>
        <div
          class=${classMap({ "dlg-head": true, ...surface.classes })}
          style=${styleMap(surface.style)}
          @pointerdown=${this.onDragStart}
          @pointermove=${this.onDragMove}
          @pointerup=${this.onDragEnd}
          @pointercancel=${this.onDragEnd}
        >
          <div class="grip handle-zone"><div class="handle"></div></div>
          <div class="topbar grip">
            <div class="title"><b>${group.name}</b>${room && room.name !== group.name ? html`<small>${room.name}</small>` : nothing}</div>
            ${toggle(state.on, t("common.toggle"), () => toggleGroup(ctx, group))}
            <button class="round close" aria-label=${t("common.close")} @click=${() => this.close()}>${icon("close")}</button>
          </div>
          ${groupSlider(ctx, group, state, t("common.brightness"))}
        </div>
        <hue-studio-color-view
          embedded
          .ctx=${ctx}
          .rev=${this.rev}
          .group=${group}
          .focusLight=${group.group ? null : entityId}
          .actions=${actions}
        ></hue-studio-color-view>
      </div>
      <div class=${classMap({ toast: true, on: ctx.toastOn })}>${ctx.toastText}</div>`;
  }

  private get sheet(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(".dlg");
  }

  private onDragStart = (e: PointerEvent): void => {
    const target = e.target as Element;
    // Only the handle and the title row; buttons, the toggle and the slider keep their own gestures.
    if (e.button !== 0 || !target.closest(".grip") || target.closest("button, input, hue-studio-slider, .slider")) return;
    const sheet = this.sheet;
    if (!sheet || matchMedia("(min-width: 600px)").matches) return;
    this.drag = { id: e.pointerId, y: e.clientY, t: e.timeStamp, dy: 0, v: 0 };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone: the move/up handlers simply never match.
    }
    sheet.style.animation = "none";
    sheet.style.transition = "none";
  };

  private onDragMove = (e: PointerEvent): void => {
    const { drag, sheet } = this;
    if (!drag || drag.id !== e.pointerId || !sheet) return;
    const dy = e.clientY - drag.y;
    const dt = e.timeStamp - drag.t;
    if (dt > 0) drag.v = (dy - drag.dy) / dt;
    drag.dy = dy;
    drag.t = e.timeStamp;
    // Down follows the finger; up only gives a little.
    const shift = dy > 0 ? dy : -Math.min(24, Math.sqrt(-dy) * 2);
    sheet.style.transform = `translateY(${shift}px)`;
    this.style.setProperty("--scrim", String(Math.max(0, 1 - Math.max(0, dy) / sheet.offsetHeight)));
  };

  private onDragEnd = (e: PointerEvent): void => {
    const { drag, sheet } = this;
    if (!drag || drag.id !== e.pointerId || !sheet) return;
    this.drag = null;
    const dismiss = e.type === "pointerup" && (drag.dy > Math.min(140, sheet.offsetHeight * 0.3) || (drag.dy > 20 && drag.v > 0.5));
    sheet.style.transition = "transform 0.25s cubic-bezier(0.2, 0.9, 0.3, 1)";
    if (dismiss) {
      sheet.style.transform = "translateY(100%)";
      this.close();
      return;
    }
    sheet.style.transform = "";
    this.style.removeProperty("--scrim");
  };

  close(): void {
    if (!this.ctx) return;
    this.stopWatch?.();
    window.removeEventListener("keydown", this.onKey);
    this.ctx.dispose();
    this.ctx = null;
    this.classList.add("closing");
    setTimeout(() => this.remove(), 200);
  }
}

if (!customElements.get("hue-studio-light-dialog")) customElements.define("hue-studio-light-dialog", HueStudioLightDialog);

function isHueLight(hass: Hass | undefined, id: unknown): id is string {
  return typeof id === "string" && id.startsWith("light.") && hass?.entities?.[id]?.platform === "hue";
}

function onMoreInfo(ev: Event): void {
  const detail = (ev as CustomEvent<{ entityId?: string; view?: string; hueStudioBypass?: boolean }>).detail || {};
  const id = detail.entityId;
  // Closing (no id), our own "Details" button, or a specific HA view (settings, history…).
  if (!id || detail.hueStudioBypass || detail.view) return;
  let hass: Hass | undefined;
  try {
    hass = currentHass();
  } catch {
    return;
  }
  if (!isHueLight(hass, id)) return;
  let dialog: HueStudioLightDialog | undefined;
  try {
    dialog = document.createElement("hue-studio-light-dialog") as HueStudioLightDialog;
    document.body.append(dialog);
    dialog.open(id);
  } catch (err) {
    console.error("hue_studio: falling back to the stock more-info dialog", err);
    dialog?.remove();
    return;
  }
  ev.stopImmediatePropagation();
}

// Capture phase on window runs before HA's own listener on <home-assistant>.
const w = window as { __hueStudioMoreInfo?: boolean } & Window;
if (!w.__hueStudioMoreInfo) {
  w.__hueStudioMoreInfo = true;
  window.addEventListener("hass-more-info", onMoreInfo, true);
}
