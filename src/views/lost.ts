// Settings → Devices → Lost devices: devices a move to another bridge let go that no
// bridge took (migration.py keeps them). Each can be looked for again on a bridge, by
// its QR code (where the bridge takes install codes), its serial number, or by being
// switched off and on while the bridge searches; found, it gets its name, settings,
// Home Assistant entities, area and room back (the search runs as a move of that one
// device: its progress is the move screen). Or it is forgotten.

import { html, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import { type InstallCode, parseSerials } from "../devices.ts";
import { haptic } from "../ha-internals.ts";
import { friendlyName } from "../model.ts";
import type { DevicesMessage, LostDevice } from "../types.ts";
import { icon } from "../ui.ts";
import { StudioView } from "./base.ts";
import { bridgeRow } from "./choice.ts";
import "./qr-scan.ts";

@customElement("hue-studio-lost-view")
export class LostView extends StudioView {
  @state() private accessor lost: LostDevice[] | null = null;
  @state() private accessor devices: DevicesMessage | null = null;
  /** The device being looked for (its MAC), the bridge, its serial number and QR code. */
  @state() private accessor open: string | null = null;
  @state() private accessor target: string | null = null;
  @state() private accessor serial = "";
  @state() private accessor code: string | null = null;
  @state() private accessor scanning = false;
  @state() private accessor confirmForget = false;
  @state() private accessor busy = false;
  private stops: (() => void)[] = [];

  override connectedCallback(): void {
    super.connectedCallback();
    this.stops = [
      this.ctx.watch<LostDevice[]>("hue_studio/bridges/lost/subscribe", (msg) => (this.lost = msg)),
      this.ctx.watch<DevicesMessage>("hue_studio/devices/subscribe", (msg) => (this.devices = msg)),
    ];
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stops.forEach((stop) => stop());
  }

  private nameOf(d: LostDevice): string {
    const { hass } = this.ctx;
    return d.entity_id && hass.states[d.entity_id] ? friendlyName(hass, d.entity_id) : d.name;
  }

  private pick(d: LostDevice): void {
    haptic("selection");
    this.open = this.open === d.mac ? null : d.mac;
    this.target = d.target in (this.ctx.rooms?.bridges ?? {}) ? d.target : Object.keys(this.ctx.rooms?.bridges ?? {})[0] ?? null;
    this.serial = "";
    this.code = null;
    this.confirmForget = false;
  }

  protected override renderPage() {
    const { ctx } = this;
    const { t } = ctx;
    const body = html`<p class="lead">${t("lost.intro")}</p>
      ${this.lost === null ? html`<p class="empty">${t("rooms.loading")}</p>` : nothing}
      ${this.lost?.length === 0 ? html`<p class="empty">${t("lost.none")}</p>` : nothing}
      ${this.lost?.length
        ? html`<div class="rows">
            ${this.lost.map(
              (d) => html`<button class=${classMap({ item: true, current: this.open === d.mac })} @click=${() => this.pick(d)}>
                  <ha-icon icon=${d.light ? "mdi:lightbulb-question-outline" : "mdi:help-circle-outline"}></ha-icon>
                  <div class="grow">${this.nameOf(d)}
                    <div class="dim small">${[d.area ? ctx.hass.areas?.[d.area]?.name : "", t("lost.since", { when: new Date(d.at * 1000).toLocaleString(ctx.hass.language) })].filter(Boolean).join(" · ")}</div>
                  </div>
                  ${this.open === d.mac ? html`<span class="check on">${icon("check")}</span>` : nothing}
                </button>`,
            )}
          </div>`
        : nothing}
      ${this.open && this.lost?.some((d) => d.mac === this.open) ? this.finder(this.lost.find((d) => d.mac === this.open)!) : nothing}`;
    return html`${this.screen(this.subHead(t("lost.title"), () => ctx.go("/settings/devices")), body, "settings-page lost")}
      <hue-studio-qr-scan .ctx=${ctx} .open=${this.scanning} .names=${this.open ? { [this.open]: this.nameOf(this.lost!.find((d) => d.mac === this.open)!) } : {}}
        @qr-code=${(e: CustomEvent<InstallCode>) => (this.code = e.detail.code)}
        @close=${() => (this.scanning = false)}></hue-studio-qr-scan>`;
  }

  /** Looking for one device: the bridge, its QR code and serial number, find or forget. */
  private finder(d: LostDevice): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const bridges = Object.entries(ctx.rooms?.bridges ?? {});
    const target = this.target;
    const name = target ? (ctx.rooms?.bridges?.[target] ?? "") : "";
    const takes = !!(target && this.devices?.[target]?.install_codes);
    const parsed = parseSerials(this.serial);
    const bad = !!this.serial.trim() && (parsed.codes.length !== 1 || parsed.invalid.length > 0);
    const find = async () => {
      if (!target || this.busy) return;
      this.busy = true;
      const prepared = parsed.codes[0] || this.code ? [{ mac: d.mac, ...(parsed.codes[0] ? { serial: parsed.codes[0] } : {}), ...(this.code ? { code: this.code } : {}) }] : [];
      const ok = await ctx.ws({ type: "hue_studio/bridges/lost/find", mac: d.mac, target, prepared });
      this.busy = false;
      if (ok) ctx.go("/settings/bridges/move");
    };
    const forget = async () => {
      if (!this.confirmForget) {
        this.confirmForget = true;
        return;
      }
      this.busy = true;
      await ctx.ws({ type: "hue_studio/bridges/lost/forget", mac: d.mac });
      this.busy = false;
      this.open = null;
    };
    return html`<h2 class="label">${t("lost.look", { name: this.nameOf(d) })}</h2>
      ${bridges.length > 1
        ? html`<div class="rows">
            ${bridgeRow(t("add_device.bridge"), bridges, target, (c) => this.choose(c), (id) => ((this.target = id), (this.code = null)))}
          </div>`
        : nothing}
      <p class="lead small">${t(takes ? "lost.how_qr" : "lost.how", { bridge: name })}</p>
      <div class="rows">
        ${takes
          ? html`<button class="item" @click=${() => (this.scanning = true)}>
              <ha-icon icon=${this.code ? "mdi:qrcode" : "mdi:qrcode-scan"}></ha-icon>
              <div class="grow">${t(this.code ? "qr.scanned" : "move.prep_scan")}</div>
              <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
            </button>`
          : nothing}
        <div class="item col">
          <div class="line"><span>${t("move.serial")}</span></div>
          <input class="field" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="A1B2C3" maxlength="6"
            aria-label=${t("move.serial")} .value=${this.serial} @input=${(e: InputEvent) => (this.serial = (e.target as HTMLInputElement).value)} />
          <div class=${classMap({ "dim small": true, error: bad })}>${bad ? t("move.serial_bad") : t("move.serial_hint")}</div>
        </div>
      </div>
      <div class="link-actions">
        <button class="pill apply" ?disabled=${!target || bad || this.busy} @click=${find}>${t("lost.find", { bridge: name })}</button>
        <button class=${classMap({ pill: true, reset: true, danger: true, confirm: this.confirmForget })} ?disabled=${this.busy} @click=${forget}>
          ${t(this.confirmForget ? "lost.forget_confirm" : "lost.forget")}
        </button>
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-lost-view": LostView;
  }
}
