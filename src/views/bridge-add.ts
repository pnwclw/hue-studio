// Settings → Bridges → Add a bridge, the Hue app's flow: how the bridge is connected (a
// network cable; or Wi-Fi, which only the Hue app can set up: it hands a Bridge Pro the
// network and its password over Bluetooth), getting it ready, the search on the network
// (or an address typed by hand: "More options"), then the bridge's button. Home Assistant's
// own Hue integration links it (hue_studio/bridges/link drives its config flow), and Hue
// Studio, which uses every bridge of that integration, connects to it by itself.

import { html, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";

import { haptic, navigate } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import type { BridgeDiscoverMessage, BridgeLinkEvent, FoundBridge } from "../types.ts";
import { type FlowStep, flowRing, StudioView } from "./base.ts";

type Step = "how" | "ethernet" | "wifi" | "search" | "address";
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
  @state() private accessor step: Step = "how";
  private trail: Step[] = [];
  @state() private accessor host = "";
  @state() private accessor linking: Linking | null = null;
  @state() private accessor now = Date.now();
  private stopDiscovery?: () => void;
  private stopLink?: () => void;
  private ticker?: ReturnType<typeof setInterval>;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopDiscovery?.();
    this.cancel();
  }

  private go(step: Step): void {
    if (step !== this.step) this.trail.push(this.step);
    this.step = step;
    if (step === "search") this.discover();
  }

  private back(): void {
    if (this.linking && this.linking.event.step !== "done") return this.cancel();
    const prev = this.trail.pop();
    if (prev) this.step = prev;
    else this.ctx.go("/settings/bridges");
  }

  /** Look for bridges on the network (again). */
  private discover(): void {
    this.stopDiscovery?.();
    this.found = null;
    this.stopDiscovery = this.ctx.watch<BridgeDiscoverMessage>("hue_studio/bridges/discover", (m) => (this.found = m));
  }

  protected override render() {
    const step = this.linking ? this.linkStep(this.linking) : this.stepOf(this.step);
    return this.flow(!this.trail.length && !this.linking, () => this.back(), step);
  }

  private stepOf(step: Step): FlowStep {
    const { t } = this.ctx;
    const bridge = (alarm = false, badge: "ok" | "fail" | null = null, progress: number | "spin" | null = null) =>
      flowRing(html`<span class="art-icon">${BRIDGE_ART}</span>`, progress, badge, alarm);
    const more = html`<button class="pill" @click=${() => this.go("address")}>${t("bridge_add.more")}</button>`;
    if (step === "how") {
      const way = (key: "ethernet" | "wifi", glyph: string) => html`<button class="item" @click=${() => this.go(key)}>
        <ha-icon icon=${glyph}></ha-icon><div class="grow">${t(`bridge_add.${key}` as StringKey)}<div class="dim small">${t(`bridge_add.${key}_sub` as StringKey)}</div></div>
      </button>`;
      return {
        panel: html`${this.flowTitle(t("bridge_add.how"))}
          <div class="rows inset">${way("ethernet", "mdi:ethernet-cable")}${way("wifi", "mdi:wifi")}</div>`,
      };
    }
    if (step === "ethernet" || step === "wifi") {
      const keys = (step === "ethernet" ? ["bridge_add.eth_1", "bridge_add.eth_2", "bridge_add.eth_3"] : ["bridge_add.wifi_1", "bridge_add.wifi_2", "bridge_add.wifi_3"]) as StringKey[];
      return {
        art: bridge(),
        panel: html`${this.flowTitle(t(step === "ethernet" ? "bridge_add.connect_title" : "bridge_add.wifi_title"), keys.map((k) => t(k)).join(" "))}
          <p class="lead flow-lead">${t(step === "wifi" ? "bridge_add.wifi_note" : "bridge_add.intro")}</p>`,
        foot: html`${more}<button class="pill apply" @click=${() => this.go("search")}>${t("bridge_add.search")}</button>`,
      };
    }
    if (step === "address") {
      return {
        panel: html`${this.flowTitle(t("bridge_add.manual"), t("bridge_add.address_hint"))}
          <form @submit=${(e: Event) => {
            e.preventDefault();
            this.manual();
          }}>
            <input class="field outlined" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
              placeholder=${t("bridge_add.address")} aria-label=${t("bridge_add.address")} .value=${this.host}
              @input=${(e: InputEvent) => (this.host = (e.target as HTMLInputElement).value)} />
          </form>`,
        foot: html`<button class="pill apply" ?disabled=${!this.host.trim()} @click=${() => this.manual()}>${t("bridge_add.connect")}</button>`,
      };
    }
    // The search: bridges show up as they are found; nothing once it is over.
    const found = this.found;
    const over = !!found && !found.searching;
    const none = over && !found.bridges.length;
    const title = none ? "bridge_add.none_title" : over ? "bridge_add.found_title" : "bridge_add.searching_title";
    const lead = none ? "bridge_add.none_lead" : over ? "bridge_add.found_lead" : "bridge_add.searching_lead";
    return {
      art: none ? bridge(true, "fail") : bridge(false, over ? "ok" : null, over ? null : "spin"),
      panel: html`${this.flowTitle(t(title), t(lead))}
        ${found?.bridges.length ? html`<div class="rows inset flow-rows">${found.bridges.map((b) => this.bridgeRow(b))}</div>` : nothing}`,
      foot: over ? html`${more}<button class="pill apply" @click=${() => this.discover()}>${t("bridge_add.again")}</button>` : nothing,
    };
  }

  private bridgeRow(b: FoundBridge): TemplateResult {
    const { t } = this.ctx;
    const sub = b.supported ? [b.model !== b.name ? b.model : null, b.host].filter(Boolean).join(" · ") : t("bridge_add.too_old");
    return html`<div class="item">
      <ha-icon icon="hue-studio:bridge"></ha-icon>
      <div class="grow">${b.name}<div class="dim small">${sub}</div></div>
      ${b.supported ? html`<button class="pill" @click=${() => this.link(b.name, { host: b.host, bridge_id: b.id })}>${t("bridge_add.connect")}</button>` : nothing}
    </div>`;
  }

  /** Linking: the button, then connected or not. */
  private linkStep(l: Linking): FlowStep {
    const { ctx } = this;
    const { t } = ctx;
    const e = l.event;
    const art = (badge: "ok" | "fail" | null, progress: number | "spin" | null, press = false) =>
      flowRing(html`<span class=${press ? "art-icon press" : "art-icon"}>${BRIDGE_ART}</span>`, progress, badge, badge === "fail");
    if (e.step === "done")
      return {
        art: art("ok", null),
        panel: this.flowTitle(t("bridge_add.done", { name: e.name || l.name }), t("bridge_add.done_sub")),
        foot: html`<button class="pill" @click=${() => ctx.go("/rooms")}>${t("rooms.title")}</button>
          <button class="pill apply" @click=${() => ctx.go(`/settings/bridges/${encodeURIComponent(e.hue_entry_id)}`)}>${t("bridge_add.finish")}</button>`,
      };
    if (e.step === "failed") {
      const reason = REASONS.includes(e.reason) ? e.reason : "unknown";
      return {
        art: art("fail", null),
        panel: this.flowTitle(t("bridge_add.failed"), t(`bridge_add.failed_${reason}` as StringKey, { name: l.name })),
        foot: html`${reason === "unknown"
            ? html`<button class="pill" @click=${() => navigate("/config/integrations/integration/hue")}>${t("bridge_add.open_ha")}</button>`
            : nothing}
          <button class="pill apply" @click=${() => (this.linking = null)}>${t("bridge_add.again")}</button>`,
      };
    }
    const press = e.step === "press";
    const left = press ? Math.max(0, Math.ceil((l.until - this.now) / 1000)) : 0;
    return {
      art: art(null, press ? left / e.timeout : "spin", press),
      panel: html`${this.flowTitle(t(press ? "bridge_add.press" : "bridge_add.connecting", { name: l.name }), press ? t("bridge_add.press_sub") : t("bridge_add.connecting_sub"))}
        ${press ? html`<p class="lead flow-lead small">${t("bridge_add.left", { seconds: left })}</p>` : nothing}`,
      foot: html`<button class="pill outline" @click=${() => this.cancel()}>${t("bridge_add.cancel")}</button>`,
    };
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
