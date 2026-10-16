// A bridge's page → "Move everything to <Bridge Pro>": the Hue app's migration
// (Settings → Bridges → the bridge → Migrate) moves every device, room and zone of a
// bridge to a Bridge Pro; Hue Studio keeps Home Assistant as it was
// (custom_components/hue_studio/transfer.py). First Hue Studio remembers the bridge,
// then this screen shows what has arrived on the Bridge Pro while the Hue app works,
// and "Finish" removes the old bridge from Home Assistant and lets everything on the
// Bridge Pro take over its entity ids, names and areas. Rooms and single lights move
// with views/bridge-move.ts instead.

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import { haptic } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import type { BridgesMessage, TransferState } from "../types.ts";
import { icon } from "../ui.ts";
import { StudioView } from "./base.ts";

@customElement("hue-studio-bridge-transfer-view")
export class BridgeTransferView extends StudioView {
  /** The bridge that moves (its native hue entry id). */
  @property() accessor from: string | null = null;

  @state() private accessor bridges: BridgesMessage | null = null;
  @state() private accessor transfer: TransferState | null | undefined = undefined;
  @state() private accessor target: string | null = null;
  @state() private accessor confirm = false;
  @state() private accessor busy = false;
  private stops: (() => void)[] = [];

  override connectedCallback(): void {
    super.connectedCallback();
    this.stops = [
      this.ctx.watch<BridgesMessage>("hue_studio/bridges/subscribe", (m) => (this.bridges = m)),
      this.ctx.watch<TransferState | null>("hue_studio/bridges/transfer/subscribe", (m) => {
        const was = this.transfer?.step;
        this.transfer = m;
        if (m && was && was !== m.step) haptic(m.step === "done" ? "success" : m.step === "failed" ? "failure" : "light");
      }),
    ];
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stops.forEach((stop) => stop());
  }

  /** Bridge Pros it can move to (the Hue app migrates to a Bridge Pro only). */
  private get targets(): [string, string][] {
    return Object.entries(this.bridges || {})
      .filter(([id, b]) => id !== this.from && b.pro && b.connected !== false)
      .map(([id, b]) => [id, b.name]);
  }

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const t0 = this.transfer;
    const body =
      t0 === undefined || !this.bridges
        ? html`<p class="empty">${t("rooms.loading")}</p>`
        : t0
          ? this.progress(t0)
          : this.intro();
    const back = t0?.source ?? this.from;
    return this.screen(
      this.subHead(t("transfer.title"), () => ctx.go(back ? `/settings/bridges/${encodeURIComponent(back)}` : "/settings/bridges")),
      body,
      "settings-page bridge-move",
    );
  }

  private steps(keys: StringKey[], params: Record<string, string>, done = 0): TemplateResult {
    const { t } = this.ctx;
    return html`<ol class="rows steps-list move-steps">
      ${keys.map(
        (key, i) => html`<li class="item"><span class="step-no">${i < done ? icon("check") : i + 1}</span><div class="grow">${t(key, params)}</div></li>`,
      )}
    </ol>`;
  }

  private intro(): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const source = this.from ? this.bridges?.[this.from] : undefined;
    if (!source) return html`<p class="empty">${t("bridges.not_found")}</p>`;
    const targets = this.targets;
    if (!targets.length) return html`<p class="lead">${t("transfer.no_pro", { from: source.name })}</p>`;
    const target = this.target && targets.some(([id]) => id === this.target) ? this.target : targets[0][0];
    const to = targets.find(([id]) => id === target)![1];
    const params = { from: source.name, to };
    return html`<p class="lead">${t("transfer.intro", params)}</p>
      ${targets.length > 1
        ? html`<h2 class="label">${t("move.to")}</h2>
            <div class="chips wrap">
              ${targets.map(
                ([id, name]) => html`<button class=${classMap({ chip: true, on: id === target })} @click=${() => (this.target = id)}>
                  <ha-icon icon="mdi:router-wireless"></ha-icon>${name}
                </button>`,
              )}
            </div>`
        : nothing}
      <h2 class="label">${t("move.how")}</h2>
      ${this.steps(["transfer.step_1", "transfer.step_2", "transfer.step_3"], params)}
      <div class="rows conflicts">
        <div class="item"><ha-icon icon="mdi:alert-outline"></ha-icon><div class="grow">${t("transfer.note")}</div></div>
      </div>
      <div class="center">
        <button class="pill go" ?disabled=${this.busy} @click=${() => this.call({ type: "hue_studio/bridges/transfer/start", source: this.from, target })}>
          ${t("transfer.start")}
        </button>
      </div>`;
  }

  private progress(s: TransferState): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const params = { from: s.source_name, to: s.target_name };
    if (s.step === "done") {
      return html`<div class="link-state">
        <div class="link-icon ok">${icon("check")}</div>
        <h2 class="link-title">${t("transfer.done", params)}</h2>
        <p class="lead center-text">${t("transfer.done_sub")}</p>
        <div class="link-actions">
          <button class="pill go" @click=${() => this.forget(`/settings/bridges/${encodeURIComponent(s.target)}`)}>${t("move.finish")}</button>
        </div>
      </div>`;
    }
    if (s.step === "finishing") {
      return html`<div class="link-state">
        <div class="center"><span class="spinner big"></span></div>
        <h2 class="link-title">${t("transfer.finishing", params)}</h2>
        <p class="lead center-text">${t("transfer.finishing_sub")}</p>
      </div>`;
    }
    const count = (glyph: string, key: StringKey, c: { total: number; arrived: number }) =>
      html`<div class="item">
        <ha-icon icon=${c.total && c.arrived >= c.total ? "mdi:check-circle-outline" : glyph}></ha-icon>
        <div class="grow">${t(key)}</div>
        <span class="value">${c.arrived} / ${c.total}</span>
      </div>`;
    const arrived = s.devices.arrived > 0;
    return html`${s.step === "failed" ? html`<div class="mismatch"><p>${t("transfer.failed")}</p></div>` : nothing}
      <p class="lead">${t("transfer.waiting", params)}</p>
      ${this.steps(["transfer.step_1", "transfer.step_2", "transfer.step_3"], params, 1)}
      <div class="section-head">
        <h2 class="label">${t("transfer.arrived", params)}</h2>
        ${s.devices.arrived < s.devices.total ? html`<span class="scan-state"><span class="spinner"></span></span>` : nothing}
      </div>
      <div class="rows">
        ${count("mdi:lightbulb-group-outline", "transfer.devices", s.devices)}
        ${count("mdi:sofa-outline", "transfer.groups", s.groups)}
        ${count("mdi:palette-outline", "transfer.scenes", s.scenes)}
      </div>
      ${arrived && s.missing.length
        ? html`<p class="lead small">${t("transfer.missing", { names: s.missing.join(", "), to: s.target_name })}</p>`
        : nothing}
      <div class="link-actions">
        <button class=${classMap({ pill: true, go: !this.confirm, danger: this.confirm, confirm: this.confirm })} ?disabled=${this.busy || !arrived}
          @click=${() => this.finish()}>
          ${t(this.confirm ? "transfer.finish_confirm" : "transfer.finish", params)}
        </button>
        <button class="pill" ?disabled=${this.busy} @click=${() => this.forget(`/settings/bridges/${encodeURIComponent(s.source)}`)}>${t("transfer.cancel")}</button>
      </div>
      ${this.confirm ? html`<p class="lead small center-text">${t("transfer.finish_hint", params)}</p>` : nothing}`;
  }

  private async call(msg: { type: string } & Record<string, unknown>): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    haptic("light");
    const ok = await this.ctx.ws(msg);
    this.busy = false;
    return ok;
  }

  private async finish(): Promise<void> {
    if (!this.confirm) {
      haptic("warning");
      this.confirm = true;
      return;
    }
    this.confirm = false;
    await this.call({ type: "hue_studio/bridges/transfer/finish" });
  }

  private async forget(path: string): Promise<void> {
    if (await this.call({ type: "hue_studio/bridges/transfer/cancel" })) this.ctx.go(path);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-bridge-transfer-view": BridgeTransferView;
  }
}
