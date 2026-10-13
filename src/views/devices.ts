// Settings → Devices: every Hue device by area. "Add devices" opens the flow that searches
// for new ones (views/device-add.ts); a search running shows here too. Any device can get a
// name and an HA area (for lights also the Hue room of that area), be identified, or be
// deleted from its bridge (HA removes its device then).

import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import { haptic } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import type { DevicesMessage, HueDeviceInfo } from "../types.ts";
import { StudioView } from "./base.ts";
import { KIND_ICONS } from "./device-add.ts";

/** What the user typed for a device, until saved. */
interface Draft {
  name: string;
  area: string;
}

@customElement("hue-studio-devices-view")
export class DevicesView extends StudioView {
  @state() private accessor devices: DevicesMessage | null = null;
  @state() private accessor open: string | null = null;
  @state() private accessor drafts: Record<string, Draft> = {};
  /** The device whose "Delete" was tapped once (a second tap deletes it). */
  @state() private accessor confirmDelete: string | null = null;
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
    const all = bridges.flatMap(([, b]) => b.devices);
    const fresh = all.filter((d) => d.new);
    const loose = all.filter((d) => !d.new && !d.area);
    const areas = ctx.hass.areas || {};
    const byArea = Object.entries(areas)
      .map(([id, a]) => [a.name, all.filter((d) => !d.new && d.area === id)] as const)
      .filter(([, list]) => list.length)
      .sort(([a], [b]) => a.localeCompare(b));
    return this.screen(
      this.subHead(t("settings.devices"), () => ctx.go("/settings")),
      html`<div class="rows">
        <button class="item add-row" @click=${() => ctx.go("/settings/devices/add")}>
          <span class="round plus-blue"><ha-icon icon="mdi:plus"></ha-icon></span>
          <div class="grow">${t("devices.title")}<div class="dim small">${t(searching ? "devices.searching" : "devices.sub")}</div></div>
          ${searching ? html`<span class="dot-badge live" aria-hidden="true"></span>` : nothing}
          <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
        </button>
      </div>
      ${!this.devices ? html`<p class="empty">${t("rooms.loading")}</p>` : nothing}
      ${fresh.length ? html`<h2 class="label">${t("devices.new")}</h2><div class="rows">${fresh.map((d) => this.device(d))}</div>` : nothing}
      ${loose.length
        ? html`<h2 class="label">${t("devices.no_area")}</h2>
            <p class="lead small">${t("devices.no_area_hint")}</p>
            <div class="rows">${loose.map((d) => this.device(d))}</div>`
        : nothing}
      ${byArea.map(([name, list]) => html`<h2 class="label">${name}</h2><div class="rows">${list.map((d) => this.device(d))}</div>`)}`,
      "settings-page",
    );
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
        haptic("success");
        this.open = null;
        ctx.toast(t("devices.saved", { name: current.name || d.name }));
      }
    };
    const remove = async () => {
      if (this.confirmDelete !== d.id) {
        haptic("warning");
        this.confirmDelete = d.id;
        return;
      }
      this.busy = true;
      const ok = await ctx.ws({ type: "hue_studio/devices/delete", device: d.id });
      this.busy = false;
      this.confirmDelete = null;
      if (ok) {
        haptic("success");
        this.open = null;
        ctx.toast(t("devices.deleted", { name: d.name }));
      }
    };
    const toggleOpen = () => {
      this.open = isOpen ? null : d.id;
      this.confirmDelete = null;
    };
    const sub = [d.product, t(`devices.kind_${d.kind}` as StringKey), d.reachable === false ? t("devices.unreachable") : ""].filter(Boolean).join(" · ");
    return html`<div class=${classMap({ "device-card": true, open: isOpen })}>
      <button class="item" aria-expanded=${isOpen} @click=${toggleOpen}>
        <ha-icon icon=${KIND_ICONS[d.kind]}></ha-icon>
        <div class="grow">${d.name}<div class=${classMap({ "dim small": true, warn: d.reachable === false })}>${sub}</div></div>
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
            ${d.model || d.software ? html`<p class="hint">${[d.model, d.software ? t("devices.software", { version: d.software }) : ""].filter(Boolean).join(" · ")}</p>` : nothing}
            <div class="actions">
              <button class="pill" @click=${() => ctx.ws({ type: "hue_studio/devices/identify", device: d.id })}>${t("devices.identify")}</button>
              <button class="pill apply" ?disabled=${this.busy || !draft.area} @click=${save}>${t("zone.save")}</button>
            </div>
            <div class="danger-row">
              <button class=${classMap({ pill: true, danger: true, confirm: this.confirmDelete === d.id })} ?disabled=${this.busy} @click=${remove}>
                ${t(this.confirmDelete === d.id ? "devices.delete_confirm" : "devices.delete")}
              </button>
            </div>
            ${this.confirmDelete === d.id ? html`<p class="hint warn">${t("devices.delete_hint")}</p>` : nothing}
          </div>`
        : nothing}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-devices-view": DevicesView;
  }
}
