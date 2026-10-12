// Loaded on every HA page (frontend.add_extra_js_url). Opens a Hue-style dialog instead of
// HA's more-info for Hue lights and Hue rooms/zones, and a Hue-style sheet for automations
// made with Hue Studio (automation-sheet.ts).
//
// Fallback rules (CLAUDE.md): the event is only stopped after our dialog was built and
// rendered successfully; anything that is not ours, any error, and the "Details" button go
// to HA's own more-info dialog untouched.

import { css, html, LitElement, nothing, unsafeCSS } from "lit";
import { classMap } from "lit/directives/class-map.js";

import { type HueStudioAutomationSheet, opensAutomationSheet, watchOurAutomations } from "./automation-sheet.ts";
import { loadSyncMemo, PANEL_PATH, StudioContext } from "./context.ts";
import { currentHass, navigate, openPanelFrom, watchHass } from "./ha-internals.ts";
import { allGroups, buildHome, friendlyName, type Group, groupOfEntity, type Home } from "./model.ts";
import { CSS } from "./styles.ts";
import type { Hass } from "./types.ts";
import { memoBoxFor, syncingIn } from "./sync.ts";
import { keepTouchInside } from "./ui.ts";
import "./views/color.ts";
import type { ColorView, MenuItem } from "./views/color.ts";

const DIALOG_CSS = css`
  /* Phones: the whole screen, sliding up (like the Hue app's color screen); wide screens: a centered card. */
  :host { position: fixed; inset: 0; z-index: 8; height: auto; flex-direction: row; align-items: flex-end; justify-content: center;
          background: rgba(0, 0, 0, 0.5); animation: scrim-in 0.35s ease; transition: background-color 0.3s ease; }
  :host(.closing) { background-color: rgba(0, 0, 0, 0); pointer-events: none; }
  .dlg { position: relative; display: flex; flex-direction: column; width: 100%; max-width: 440px; overflow: hidden;
         height: 100dvh; box-sizing: border-box; padding-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
         background: var(--bg);
         animation: sheet-in 0.45s cubic-bezier(0.32, 0.72, 0, 1); }
  :host(.closing) .dlg { transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.4, 0, 1, 1); }
  .colorbody .cv-bar { flex: none; position: relative; z-index: 3; padding: 4px 16px 0; }
  hue-studio-color-view.colorbody { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  /* The wheel sits in the middle of the free space, its glow spreading under the bar and the dock; effects scroll. */
  .cv-scroll { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: visible; padding: 0 16px; }
  .cv-scroll.fx-mode { overflow-y: auto; overscroll-behavior: contain; padding-bottom: 28px; }
  .cv-scroll > * { flex: none; }
  /* The wheel takes what the bar and the dock leave (container units), a little above the middle. */
  .cv-scroll > .wheel-wrap { flex: 1; min-height: 0; container-type: size; padding: 24px 0 40px; }
  .colorbody .cv-bar { transition: box-shadow 0.2s; }
  .colorbody .cv-bar.scrolled { box-shadow: 0 1px 0 rgba(255, 255, 255, 0.07); }
  .colorbody .wheel { width: min(100cqw, 100cqh, 440px); }
  .colorbody .effects { display: block; padding-bottom: 8px; }
  /* The dock floats over the end of the body: it fades in over what scrolls under it. */
  .colorbody .dock { flex: none; position: relative; z-index: 2; padding: 0 16px calc(10px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)));
                     pointer-events: none; }
  .colorbody .dock.over { margin-top: -28px; padding-top: 28px; background: linear-gradient(rgba(28, 28, 30, 0), var(--bg) 28px); }
  .colorbody .dock > * { pointer-events: auto; }
  .colorbody .controls { margin: 0 0 18px; }
  /* Sheets opened inside (effect settings, a new scene) cover the whole screen, above the dialog. */
  .sheet { position: fixed; z-index: 20; padding: max(16px, var(--safe-area-inset-top, env(safe-area-inset-top, 0px))) 16px
           max(16px, var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))); }
  @keyframes scrim-in { from { background-color: rgba(0, 0, 0, 0); } }
  @keyframes sheet-in { from { transform: translateY(100%); } }
  @keyframes pop-in { from { transform: translateY(16px) scale(0.96); opacity: 0; } }
  @media (max-height: 760px) {
    .cv-scroll > .wheel-wrap { padding: 12px 0 20px; }
    .colorbody .controls { margin-bottom: 12px; }
    .colorbody .cv-bar { min-height: 40px; }
  }
  @media (min-width: 600px) {
    :host { align-items: center; }
    .dlg { border-radius: 22px; height: min(880px, 92dvh); padding-top: 8px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
           animation: pop-in 0.3s cubic-bezier(0.2, 0.9, 0.3, 1); }
    :host(.closing) .dlg { transform: translateY(12px) scale(0.97); opacity: 0; transition: transform 0.2s ease, opacity 0.2s ease; }
    .colorbody .dock { padding-bottom: 14px; }
  }
`;

/** One light as a one-light group, as the controls expect it. */
function lightGroup(hass: Hass, id: string, key: string): Group {
  return {
    key,
    kind: "hue",
    name: friendlyName(hass, id),
    icon: "",
    lights: [id],
    target: [id],
    group: null,
    scenes: [],
    sensors: { motion: [], temperature: [], illuminance: [] },
  };
}

/**
 * What the dialog shows for an entity: the group on the wheel (a light's whole room, like
 * the Hue app, with that light picked), the room it belongs to (for "Hue Studio") and the
 * light to pick first.
 */
function subjectOf(hass: Hass, home: Home, id: string): { group: Group; room: Group | null; focus: string | null } {
  const attrs = hass.states[id]?.attributes || {};
  if (attrs.is_hue_group) {
    const known = allGroups(home).find((g) => g.group === id);
    if (known) return { group: known, room: known, focus: null };
    const lights = ((attrs.entity_id || []) as string[]).filter((l) => hass.states[l]);
    return { group: { ...lightGroup(hass, id, `hue.${id}`), lights, target: [id], group: id }, room: null, focus: null };
  }
  const room = groupOfEntity(home, id);
  if (room && room.lights.includes(id)) return { group: room, room, focus: id };
  return { group: lightGroup(hass, id, room?.key || ""), room, focus: null };
}

class HueStudioLightDialog extends LitElement {
  static override styles = [unsafeCSS(CSS), DIALOG_CSS];

  private ctx: StudioContext | null = null;
  private entityId = "";
  /** Bumped on every change, so the color view re-renders too. */
  private rev = 0;
  private stopWatch?: () => void;

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
    const ctx = this.ctx;
    if (ctx?.ready) {
      // A Sync Box drives what was opened: its room instead of a color picker that can't act.
      const { group, room, focus } = subjectOf(ctx.hass, ctx.home, this.entityId);
      const synced = focus ? syncingIn(ctx.boxes, { lights: [focus] }) : syncingIn(ctx.boxes, group);
      if (room && synced.length) {
        this.close();
        openRoom(room);
        return;
      }
    }
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
    const { group, room, focus } = subjectOf(ctx.hass, ctx.home, entityId);
    const studio: MenuItem = {
      icon: "open",
      label: t("more.open_studio"),
      run: (light) => {
        this.close();
        const pick = light ? `?light=${encodeURIComponent(light)}` : "";
        // "Done" in the panel brings the user back to this page, not to the panel's home.
        openPanelFrom(`/hue/room/${encodeURIComponent(room!.key)}/color${pick}`, location.pathname + location.search + location.hash);
      },
    };

    return html`<div class="dlg" role="dialog" aria-modal="true" aria-label=${group.name}>
        <hue-studio-color-view
          embedded
          .ctx=${ctx}
          .rev=${this.rev}
          .group=${group}
          .focusLight=${focus}
          .done=${() => this.close()}
          .extraMenu=${room && !location.pathname.startsWith("/hue") ? [studio] : []}
        ></hue-studio-color-view>
      </div>
      <div class=${classMap({ toast: true, on: ctx.toastOn })}>${ctx.toastText}</div>`;
  }

  close(): void {
    if (!this.ctx) return;
    this.stopWatch?.();
    window.removeEventListener("keydown", this.onKey);
    this.ctx.dispose();
    this.ctx = null;
    this.classList.add("closing");
    setTimeout(() => this.remove(), 320);
  }
}

if (!customElements.get("hue-studio-light-dialog")) customElements.define("hue-studio-light-dialog", HueStudioLightDialog);

/** The panel's page of a room or zone (HA's back button returns to where more-info was opened). */
function openRoom(room: Group): void {
  navigate(`${PANEL_PATH}/room/${encodeURIComponent(room.key)}`);
}

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
  if (!hass) return;
  if (id.startsWith("automation.")) {
    openAutomation(ev, hass, id);
    return;
  }
  if (!isHueLight(hass, id)) return;
  // A light (or a Hue room/zone with a light) a Sync Box drives now, known from an earlier
  // visit: straight to its room, which shows the sync and its lights as busy.
  try {
    const memo = loadSyncMemo();
    const lights = hass.states[id]?.attributes.is_hue_group ? ((hass.states[id].attributes.entity_id || []) as string[]) : [id];
    if (lights.some((light) => memoBoxFor(memo, hass.states, light))) {
      const { room } = subjectOf(hass, buildHome(hass), id);
      if (room) {
        ev.stopImmediatePropagation();
        openRoom(room);
        return;
      }
    }
  } catch (err) {
    console.error("hue_studio: sync check failed", err);
  }
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

/** An automation made with Hue Studio: our sheet; anything else, or an error: HA's dialog. */
function openAutomation(ev: Event, hass: Hass, id: string): void {
  let sheet: HueStudioAutomationSheet | undefined;
  try {
    if (!opensAutomationSheet(hass, id)) return;
    sheet = document.createElement("hue-studio-automation-sheet") as HueStudioAutomationSheet;
    document.body.append(sheet);
    sheet.open(id);
  } catch (err) {
    console.error("hue_studio: falling back to the stock more-info dialog", err);
    sheet?.remove();
    return;
  }
  ev.stopImmediatePropagation();
}

// Capture phase on window runs before HA's own listener on <home-assistant>.
const w = window as { __hueStudioMoreInfo?: boolean } & Window;
if (!w.__hueStudioMoreInfo) {
  w.__hueStudioMoreInfo = true;
  window.addEventListener("hass-more-info", onMoreInfo, true);
  watchOurAutomations();
}
