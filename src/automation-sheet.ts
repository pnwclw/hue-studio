// The more-info override's sheet for an automation made with Hue Studio (roadmap G2): its
// switch, what it does in Hue words, "Edit" (the panel's editor) and "Open in Home
// Assistant". Built and rendered synchronously, so the override can still fall back to
// HA's own dialog if anything throws; the config is read afterwards, as the panel does.

import { css, html, LitElement, nothing, unsafeCSS } from "lit";

import { fromConfig, isOurAutomation, summaryRows, TYPE_ICONS, type AutomationDraft } from "./automations.ts";
import { currentHass, navigate, openPanelFrom, openStockMoreInfo, watchHass } from "./ha-internals.ts";
import { localize, type StringKey } from "./i18n.ts";
import { CSS } from "./styles.ts";
import type { AutomationConfig, AutomationsMessage, Hass } from "./types.ts";
import { keepTouchInside, toggle } from "./ui.ts";

/** How long the switch shows its new position without HA confirming it (CLAUDE.md: 5 s). */
const EXPECT_MS = 5000;

/** The sheet itself (shared with the scene sheet). */
export const SHEET_CSS = css`
  /* Phones: a sheet from the bottom; wide screens: a centered card. */
  :host { position: fixed; inset: 0; z-index: 8; height: auto; flex-direction: row; align-items: flex-end; justify-content: center;
          background: rgba(0, 0, 0, 0.5); animation: scrim-in 0.35s ease; transition: background-color 0.3s ease; }
  :host(.closing) { background-color: rgba(0, 0, 0, 0); pointer-events: none; }
  .dlg { position: relative; width: 100%; max-width: 440px; max-height: 92dvh; box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain;
         padding: 6px 16px calc(16px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)));
         border-radius: 14px 14px 0 0; background: var(--bg); animation: sheet-in 0.45s cubic-bezier(0.32, 0.72, 0, 1); }
  :host(.closing) .dlg { transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.4, 0, 1, 1); }
  .grabber { width: 36px; height: 5px; margin: 0 auto 8px; border-radius: 3px; background: rgba(235, 235, 245, 0.3); }
  .as-head { display: flex; align-items: center; gap: 12px; min-height: 52px; margin-bottom: 12px; }
  .as-icon { width: 40px; height: 40px; flex: none; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--surface); }
  .as-head .grow { flex: 1; min-width: 0; }
  .as-title { font-size: 16px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .as-rows .item { min-height: 40px; font-size: 14px; }
  .as-rows .label { flex: none; color: var(--text-2); }
  .as-rows .value { flex: 1; min-width: 0; text-align: right; overflow-wrap: anywhere; }
  .as-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
  .as-actions .pill { width: 100%; }
  .as-actions .pill.primary { background: var(--accent); }
  .as-details { display: block; margin: 10px auto 0; padding: 8px 12px; border: none; background: none; cursor: pointer; color: var(--text-2); font-size: 13px; }
  @keyframes scrim-in { from { background-color: rgba(0, 0, 0, 0); } }
  @keyframes sheet-in { from { transform: translateY(100%); } }
  @keyframes pop-in { from { transform: translateY(16px) scale(0.96); opacity: 0; } }
  @media (min-width: 600px) {
    :host { align-items: center; }
    .dlg { padding: 16px 20px 12px; border-radius: 22px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5); animation: pop-in 0.3s cubic-bezier(0.2, 0.9, 0.3, 1); }
    .grabber { display: none; }
    :host(.closing) .dlg { transform: translateY(12px) scale(0.97); opacity: 0; transition: transform 0.2s ease, opacity 0.2s ease; }
  }
`;

type Known = AutomationsMessage["automations"];

/** Our automations as HA reports them (hue_studio/automations/subscribe), for recognizing them. */
let known: Known | null = null;

/**
 * Keep up with which automations are ours, so one made from our blueprints in HA's editor
 * (no id prefix) is recognized too. Started once, for administrators only.
 */
export function watchOurAutomations(): void {
  const timer = setInterval(() => {
    const hass = currentHass();
    if (!hass) return;
    clearInterval(timer);
    if (!hass.user?.is_admin || !hass.connection) return;
    hass.connection
      .subscribeMessage<AutomationsMessage>((msg) => (known = msg.automations), { type: "hue_studio/automations/subscribe" })
      .catch((err: unknown) => console.error("hue_studio: automations failed to load", err));
  }, 500);
}

/** Whether `hass-more-info` for this entity opens our sheet. */
export function opensAutomationSheet(hass: Hass, entityId: string): boolean {
  // HA's own pages stay HA's; reading and editing automations is for administrators.
  if (location.pathname === "/config" || location.pathname.startsWith("/config/")) return false;
  if (!hass.user?.is_admin) return false;
  return isOurAutomation(entityId, hass.states[entityId]?.attributes.id, known);
}

export class HueStudioAutomationSheet extends LitElement {
  static override styles = [unsafeCSS(CSS), SHEET_CSS];

  private hass: Hass | null = null;
  private entityId = "";
  /** The stored config: undefined while it is read, null if it can't be. */
  private config: AutomationConfig | null | undefined = undefined;
  /** The switch's position until HA confirms it. */
  private expected: boolean | null = null;
  private expectTimer?: ReturnType<typeof setTimeout>;
  private stopWatch?: () => void;
  private untouch?: () => void;
  private closing = false;

  /** Build and render the sheet synchronously (the element must be connected); throws if anything is off. */
  open(entityId: string): void {
    const hass = currentHass();
    if (!hass?.states[entityId]) throw new Error("no automation");
    this.hass = hass;
    this.entityId = entityId;
    this.performUpdate();
    if (!this.renderRoot.querySelector(".dlg")) throw new Error("not rendered");

    this.addEventListener("click", (e) => e.composedPath()[0] === this && this.close());
    this.untouch = keepTouchInside(this);
    window.addEventListener("keydown", this.onKey);
    this.stopWatch = watchHass((h) => {
      if (this.closing) return;
      this.hass = h;
      if (!h.states[entityId]) return this.close();
      if (this.expected !== null && (h.states[entityId].state === "on") === this.expected) this.expected = null;
      this.requestUpdate();
    });
    this.readConfig(hass);
  }

  /** The stored config, through HA's automation config API (what its editor and the panel read). */
  private async readConfig(hass: Hass): Promise<void> {
    const id = this.configId;
    try {
      if (!id || !hass.callApi) throw new Error("no config id");
      this.config = await hass.callApi<AutomationConfig>("GET", `config/automation/config/${encodeURIComponent(id)}`);
    } catch (err) {
      // Not in automations.yaml (or gone): the sheet still has its switch and HA's links.
      console.warn("hue_studio: automation config not readable", err);
      this.config = null;
    }
    this.requestUpdate();
  }

  private get configId(): string {
    return String(this.hass?.states[this.entityId]?.attributes.id || "");
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.close();
  };

  private setOn(on: boolean): void {
    const hass = this.hass;
    if (!hass) return;
    this.expected = on;
    clearTimeout(this.expectTimer);
    this.expectTimer = setTimeout(() => {
      this.expected = null;
      this.requestUpdate();
    }, EXPECT_MS);
    this.requestUpdate();
    hass.callService("automation", on ? "turn_on" : "turn_off", { entity_id: this.entityId }).catch((err: unknown) => {
      console.error("hue_studio: automation switch failed", err);
      this.expected = null;
      this.requestUpdate();
    });
  }

  /** The panel's editor; outside the panel, its "back" returns to this page. */
  private edit(): void {
    const path = `/hue/automations/${encodeURIComponent(this.configId)}`;
    this.close();
    if (location.pathname === "/hue" || location.pathname.startsWith("/hue/")) navigate(path);
    else openPanelFrom(path, location.pathname + location.search + location.hash);
  }

  private openHa(): void {
    this.close();
    navigate(`/config/automation/edit/${encodeURIComponent(this.configId)}`);
  }

  private details(): void {
    this.close();
    openStockMoreInfo(this.entityId);
  }

  protected override render() {
    const { hass, entityId, config } = this;
    if (!hass) return nothing;
    const t = localize(hass);
    const state = hass.states[entityId];
    const draft: AutomationDraft | null = config ? fromConfig(config) : null;
    const name = draft?.alias || String(state?.attributes.friendly_name || entityId);
    const on = this.expected ?? state?.state === "on";
    // Taken over in HA's editor (no blueprint of ours any more): HA's editor is the place.
    const custom = config !== undefined && !draft && !!config;
    const type = draft?.type ?? known?.[entityId]?.type ?? null;
    const glyph = type && type in TYPE_ICONS ? TYPE_ICONS[type as keyof typeof TYPE_ICONS] : "mdi:robot-outline";
    const sub = custom ? t("automations.custom_sub") : type ? t(`automations.type_${type}` as StringKey) : "";

    const rows = draft
      ? summaryRows(hass, draft, t).map((r) => html`<div class="item"><span class="label">${r.label}</span><span class="value">${r.value}</span></div>`)
      : config === undefined
        ? html`<div class="item"><span class="dim">${t("more.loading")}</span></div>`
        : nothing;

    return html`<div class="dlg" role="dialog" aria-modal="true" aria-label=${name}>
      <div class="grabber"></div>
      <div class="as-head">
        <span class="as-icon"><ha-icon icon=${glyph}></ha-icon></span>
        <div class="grow">
          <div class="as-title">${name}</div>
          ${sub ? html`<div class="dim small">${sub}</div>` : nothing}
        </div>
        ${toggle(on, name, () => this.setOn(!on))}
      </div>
      ${rows === nothing ? nothing : html`<div class="rows as-rows">${rows}</div>`}
      <div class="as-actions">
        ${draft ? html`<button class="pill primary" @click=${() => this.edit()}>${t("more.edit")}</button>` : nothing}
        <button class="pill" @click=${() => this.openHa()}>${t("automations.open_ha")}</button>
      </div>
      <button class="as-details" @click=${() => this.details()}>${t("more.settings")}</button>
    </div>`;
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    this.stopWatch?.();
    this.untouch?.();
    clearTimeout(this.expectTimer);
    window.removeEventListener("keydown", this.onKey);
    this.classList.add("closing");
    setTimeout(() => this.remove(), 320);
  }
}

if (!customElements.get("hue-studio-automation-sheet")) customElements.define("hue-studio-automation-sheet", HueStudioAutomationSheet);
