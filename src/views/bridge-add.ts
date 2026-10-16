// Settings → Bridges → Add a bridge, like the Hue app's. How the bridge is connected
// (Ethernet; or Wi-Fi, which only the Hue app can set up: it hands a Bridge Pro the
// network and its password over Bluetooth), the bridges found on the network, an address
// typed by hand; then the bridge's button. Home Assistant's own Hue integration links it
// (hue_studio/bridges/link drives its config flow), and Hue Studio, which uses every bridge
// of that integration, connects to it by itself.

import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import { haptic, navigate } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import type { BridgeDiscoverMessage, BridgeLinkEvent, FoundBridge } from "../types.ts";
import { icon } from "../ui.ts";
import { StudioView } from "./base.ts";

type Way = "ethernet" | "wifi";
const REASONS = ["cannot_connect", "timeout", "already_added", "unsupported", "not_found"];

/** The bridge being linked and how far it got. */
interface Linking {
  name: string;
  event: BridgeLinkEvent;
  /** When the bridge stops waiting for its button (ms since epoch). */
  until: number;
}

/** A Hue bridge seen from the front, its button lit while it waits for a press. */
const BRIDGE_ART = html`<svg class="bridge-art" viewBox="0 0 120 120" aria-hidden="true">
  <rect x="14" y="14" width="92" height="92" rx="24" class="body" />
  <circle cx="60" cy="60" r="27" class="ring" />
  <circle cx="60" cy="60" r="18" class="button" />
</svg>`;

@customElement("hue-studio-bridge-add-view")
export class BridgeAddView extends StudioView {
  @state() private accessor found: BridgeDiscoverMessage | null = null;
  @state() private accessor way: Way = "ethernet";
  @state() private accessor host = "";
  @state() private accessor linking: Linking | null = null;
  @state() private accessor now = Date.now();
  private stopDiscovery?: () => void;
  private stopLink?: () => void;
  private ticker?: ReturnType<typeof setInterval>;

  override connectedCallback(): void {
    super.connectedCallback();
    this.stopDiscovery = this.ctx.watch<BridgeDiscoverMessage>("hue_studio/bridges/discover", (m) => (this.found = m));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopDiscovery?.();
    this.cancel();
  }

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const back = this.linking && this.linking.event.step !== "done" ? () => this.cancel() : () => ctx.go("/settings/bridges");
    return this.screen(this.subHead(t("bridge_add.title"), back), this.linking ? this.linkPage(this.linking) : this.pickPage(), "settings-page bridge-add");
  }

  private pickPage() {
    const { t } = this.ctx;
    const found = this.found;
    const steps = (this.way === "ethernet"
      ? ["bridge_add.eth_1", "bridge_add.eth_2", "bridge_add.eth_3"]
      : ["bridge_add.wifi_1", "bridge_add.wifi_2", "bridge_add.wifi_3"]) as StringKey[];
    const setWay = (way: Way) => {
      if (way === this.way) return;
      haptic("selection");
      this.way = way;
    };
    return html`<p class="lead">${t("bridge_add.intro")}</p>
      <h2 class="label">${t("bridge_add.connection")}</h2>
      <div class="seg two" role="tablist">
        ${(["ethernet", "wifi"] as Way[]).map(
          (way) => html`<button role="tab" class=${way === this.way ? "on" : ""} aria-selected=${way === this.way} @click=${() => setWay(way)}>
            ${t(`bridge_add.${way}` as StringKey)}
          </button>`,
        )}
      </div>
      <ol class="rows steps-list">
        ${steps.map((key, i) => html`<li class="item"><span class="step-no">${i + 1}</span><div class="grow">${t(key)}</div></li>`)}
      </ol>
      ${this.way === "wifi" ? html`<p class="lead small">${t("bridge_add.wifi_note")}</p>` : nothing}
      <div class="section-head">
        <h2 class="label">${t("bridge_add.found")}</h2>
        ${!found || found.searching ? html`<span class="scan-state"><span class="spinner"></span>${t("bridge_add.searching")}</span>` : nothing}
      </div>
      ${found?.bridges.length
        ? html`<div class="rows">${found.bridges.map((b) => this.bridgeRow(b))}</div>`
        : html`<div class="rows"><div class="item dim">${t(found && !found.searching ? "bridge_add.none" : "bridge_add.looking")}</div></div>`}
      <h2 class="label">${t("bridge_add.manual")}</h2>
      <form class="rows" @submit=${(e: Event) => {
        e.preventDefault();
        this.manual();
      }}>
        <div class="item col">
          <div class="line">
            <input class="field" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
              placeholder=${t("bridge_add.address")} aria-label=${t("bridge_add.address")} .value=${this.host}
              @input=${(e: InputEvent) => (this.host = (e.target as HTMLInputElement).value)} />
            <button class="pill" type="submit" ?disabled=${!this.host.trim()}>${t("bridge_add.connect")}</button>
          </div>
          <div class="dim small">${t("bridge_add.address_hint")}</div>
        </div>
      </form>`;
  }

  private bridgeRow(b: FoundBridge) {
    const { t } = this.ctx;
    const sub = b.supported ? [b.model !== b.name ? b.model : null, b.host].filter(Boolean).join(" · ") : t("bridge_add.too_old");
    return html`<div class="item">
      <ha-icon icon="mdi:router-wireless"></ha-icon>
      <div class="grow">${b.name}<div class="dim small">${sub}</div></div>
      ${b.supported
        ? html`<button class="pill" @click=${() => this.link(b.name, { host: b.host, bridge_id: b.id })}>${t("bridge_add.connect")}</button>`
        : nothing}
    </div>`;
  }

  private linkPage(l: Linking) {
    const { ctx } = this;
    const { t } = ctx;
    const e = l.event;
    if (e.step === "done") {
      return html`<div class="link-state">
        <div class="link-icon ok">${icon("check")}</div>
        <h2 class="link-title">${t("bridge_add.done", { name: e.name || l.name })}</h2>
        <p class="lead center-text">${t("bridge_add.done_sub")}</p>
        <div class="link-actions">
          <button class="pill go" @click=${() => ctx.go(`/settings/bridges/${encodeURIComponent(e.hue_entry_id)}`)}>${t("bridge_add.finish")}</button>
          <button class="pill" @click=${() => ctx.go("/rooms")}>${t("rooms.title")}</button>
        </div>
      </div>`;
    }
    if (e.step === "failed") {
      const reason = REASONS.includes(e.reason) ? e.reason : "unknown";
      return html`<div class="link-state">
        <div class="link-icon fail"><ha-icon icon="mdi:alert-circle-outline"></ha-icon></div>
        <h2 class="link-title">${t("bridge_add.failed")}</h2>
        <p class="lead center-text">${t(`bridge_add.failed_${reason}` as StringKey, { name: l.name })}</p>
        <div class="link-actions">
          <button class="pill go" @click=${() => (this.linking = null)}>${t("bridge_add.again")}</button>
          ${reason === "unknown"
            ? html`<button class="pill" @click=${() => navigate("/config/integrations/integration/hue")}>${t("bridge_add.open_ha")}</button>`
            : nothing}
        </div>
      </div>`;
    }
    const press = e.step === "press";
    const left = press ? Math.max(0, Math.ceil((l.until - this.now) / 1000)) : 0;
    return html`<div class="link-state">
      <div class="link-art ${press ? "press" : ""}">${BRIDGE_ART}</div>
      <h2 class="link-title">${t(press ? "bridge_add.press" : "bridge_add.connecting", { name: l.name })}</h2>
      <p class="lead center-text">${press ? t("bridge_add.press_sub") : t("bridge_add.connecting_sub")}</p>
      ${press
        ? html`<div class="countdown" role="progressbar" aria-valuemin="0" aria-valuemax=${e.timeout} aria-valuenow=${left}>
              <span style="transform: scaleX(${left / e.timeout})"></span>
            </div>
            <div class="dim small center-text">${t("bridge_add.left", { seconds: left })}</div>`
        : html`<div class="center"><span class="spinner big"></span></div>`}
      <div class="link-actions"><button class="pill" @click=${() => this.cancel()}>${t("bridge_add.cancel")}</button></div>
    </div>`;
  }

  private manual(): void {
    const host = this.host.trim();
    if (!host) return;
    this.link(host, { host });
  }

  private link(name: string, params: Record<string, unknown>): void {
    haptic("light");
    this.cancel();
    this.linking = { name, event: { step: "connecting" }, until: 0 };
    this.stopLink = this.ctx.watch<BridgeLinkEvent>(
      "hue_studio/bridges/link",
      (event) => {
        if (!this.linking) return;
        const until = event.step === "press" ? Date.now() + event.timeout * 1000 : this.linking.until;
        this.linking = { ...this.linking, event, until };
        if (event.step === "press") this.tick(true);
        if (event.step === "done" || event.step === "failed") {
          this.tick(false);
          this.stopLink?.();
          this.stopLink = undefined;
          haptic(event.step === "done" ? "success" : "failure");
        }
      },
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null)),
    );
  }

  /** Give up linking (the backend drops the flow it started). */
  private cancel(): void {
    this.tick(false);
    this.stopLink?.();
    this.stopLink = undefined;
    this.linking = null;
  }

  private tick(on: boolean): void {
    clearInterval(this.ticker);
    this.ticker = undefined;
    if (on) this.ticker = setInterval(() => (this.now = Date.now()), 500);
    this.now = Date.now();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-bridge-add-view": BridgeAddView;
  }
}
