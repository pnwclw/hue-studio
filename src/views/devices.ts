// Settings → Add devices: HA-first setup of Hue devices. Search the bridge's Zigbee
// network (optionally by serial numbers), then give each new device — or one without an
// area — a name, an HA area and, for lights, the Hue room of that area.

import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import type { StringKey } from "../i18n.ts";
import type { DevicesMessage, HueDeviceInfo } from "../types.ts";
import { icon } from "../ui.ts";
import { StudioView } from "./base.ts";

const KIND_ICONS: Record<HueDeviceInfo["kind"], string> = {
  light: "mdi:lightbulb-outline",
  switch: "mdi:light-switch",
  sensor: "mdi:motion-sensor",
  other: "mdi:devices",
};

/** What the user typed for a device, until saved. */
interface Draft {
  name: string;
  area: string;
}

@customElement("hue-studio-devices-view")
export class DevicesView extends StudioView {
  @state() private accessor devices: DevicesMessage | null = null;
  @state() private accessor serials = "";
  @state() private accessor open: string | null = null;
  @state() private accessor drafts: Record<string, Draft> = {};
  @state() private accessor busy = false;
  private stop?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.stop = this.ctx.watch<DevicesMessage>("hue_studio/devices/subscribe", (msg) => (this.devices = msg));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop?.();
  }

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const bridges = Object.entries(this.devices || {});
    const searching = bridges.some(([, b]) => b.searching);
    const unsupported = bridges.length > 0 && bridges.every(([, b]) => b.searching === null);
    const all = bridges.flatMap(([, b]) => b.devices);
    const fresh = all.filter((d) => d.new);
    const loose = all.filter((d) => !d.new);
    return html`<div class="page settings-page">
      <div class="topbar">
        <button class="round back" aria-label=${t("common.back")} @click=${() => ctx.go("/settings")}>${icon("back")}</button>
      </div>
      <h1 class="big">${t("devices.title")}</h1>
      <p class="lead">${t("devices.intro")}</p>
      <div class="rows">
        <div class="item col">
          <div class="line">
            <span>${t(searching ? "devices.searching" : "devices.search")}</span>
            <button class="pill go" ?disabled=${searching || unsupported || this.busy || !this.devices} @click=${() => this.search()}>
              ${searching ? t("devices.searching_short") : t("devices.search_button")}
            </button>
          </div>
          <input class="field" placeholder=${t("devices.serials")} aria-label=${t("devices.serials")} .value=${this.serials}
            @input=${(e: InputEvent) => (this.serials = (e.target as HTMLInputElement).value)} />
          <div class="dim small">${t(unsupported ? "devices.unsupported" : "devices.serials_hint")}</div>
        </div>
      </div>
      ${!this.devices ? html`<p class="empty">${t("rooms.loading")}</p>` : nothing}
      ${fresh.length ? html`<h2 class="label">${t("devices.new")}</h2><div class="rows">${fresh.map((d) => this.device(d))}</div>` : nothing}
      ${loose.length
        ? html`<h2 class="label">${t("devices.no_area")}</h2>
            <p class="lead small">${t("devices.no_area_hint")}</p>
            <div class="rows">${loose.map((d) => this.device(d))}</div>`
        : nothing}
      ${this.devices && !all.length ? html`<p class="lead small center-text">${t("devices.all_set")}</p>` : nothing}
    </div>`;
  }

  private device(d: HueDeviceInfo) {
    const { ctx } = this;
    const { t } = ctx;
    const isOpen = this.open === d.id;
    const draft = this.drafts[d.id] ?? { name: d.name, area: d.area ?? "" };
    const set = (patch: Partial<Draft>) => (this.drafts = { ...this.drafts, [d.id]: { ...(this.drafts[d.id] ?? draft), ...patch } });
    const areas = Object.entries(ctx.hass.areas || {}).sort(([, a], [, b]) => a.name.localeCompare(b.name));
    const save = async () => {
      this.busy = true;
      const current = this.drafts[d.id] ?? draft;
      const ok = await ctx.ws({ type: "hue_studio/devices/setup", device: d.id, name: current.name, area_id: current.area || null });
      this.busy = false;
      if (ok) {
        this.open = null;
        ctx.toast(t("devices.saved", { name: current.name || d.name }));
      }
    };
    return html`<div class=${classMap({ "device-card": true, open: isOpen })}>
      <button class="item" aria-expanded=${isOpen} @click=${() => (this.open = isOpen ? null : d.id)}>
        <ha-icon icon=${KIND_ICONS[d.kind]}></ha-icon>
        <div class="grow">${d.name}<div class="dim small">${d.product} · ${t(`devices.kind_${d.kind}` as StringKey)}</div></div>
        <ha-icon class="chevron" icon=${isOpen ? "mdi:chevron-up" : "mdi:chevron-down"}></ha-icon>
      </button>
      ${isOpen
        ? html`<div class="device-form">
            <input class="field" maxlength="32" aria-label=${t("devices.name")} placeholder=${t("devices.name")} .value=${draft.name}
              @input=${(e: InputEvent) => set({ name: (e.target as HTMLInputElement).value })} />
            <select class="select wide" aria-label=${t("devices.area")} @change=${(e: Event) => set({ area: (e.target as HTMLSelectElement).value })}>
              <option value="" ?selected=${!draft.area}>${t("devices.pick_area")}</option>
              ${areas.map(([id, a]) => html`<option value=${id} ?selected=${draft.area === id}>${a.name}</option>`)}
            </select>
            <p class="hint">${t(d.kind === "light" ? "devices.room_hint" : "devices.area_hint")}</p>
            <div class="actions">
              <button class="pill" @click=${() => ctx.ws({ type: "hue_studio/devices/identify", device: d.id })}>${t("devices.identify")}</button>
              <button class="pill apply" ?disabled=${this.busy || !draft.area} @click=${save}>${t("zone.save")}</button>
            </div>
          </div>`
        : nothing}
    </div>`;
  }

  private async search(): Promise<void> {
    this.busy = true;
    const serials = this.serials.split(/[\s,;]+/).filter(Boolean);
    if (await this.ctx.ws({ type: "hue_studio/devices/search", serials })) this.ctx.toast(this.ctx.t("devices.search_started"));
    this.busy = false;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-devices-view": DevicesView;
  }
}
