// A Hue device's settings, like the Hue app's "Light settings": its picture and name
// (renamed on the bridge, HA follows), its room (the HA device's area; a light also moves
// to the Hue room of that area), for lights the function and the power-on behavior, then
// support: identify, device info, help, the device in HA, and "Delete" (from the bridge).
// "Save" stores what changed at once. Hue sensors HA has get their own page (sensor.ts).

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import { allDevices, deviceIcon, type FoundDevice, groupOf, LIGHT_FUNCTIONS, POWER_ON } from "../devices.ts";
import { haptic } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import type { DevicesMessage, LightFunction, PowerOn } from "../types.ts";
import { icon } from "../ui.ts";
import { StudioView } from "./base.ts";

const NAME_MAX = 32;
const HELP_URL = "https://www.philips-hue.com/support";

type Sheet = "room" | "function" | "power" | "info";

@customElement("hue-studio-device-view")
export class DeviceView extends StudioView {
  /** The bridge's device id. */
  @property() accessor device = "";

  @state() private accessor devices: DevicesMessage | null = null;
  @state() private accessor name: string | null = null;
  @state() private accessor editingName = false;
  /** What was picked; undefined: unchanged. */
  @state() private accessor area: string | null | undefined = undefined;
  @state() private accessor fn: LightFunction | undefined = undefined;
  @state() private accessor power: PowerOn | undefined = undefined;
  @state() private accessor sheet: Sheet | null = null;
  @state() private accessor saving = false;
  /** "Delete" was tapped once: the next tap deletes. */
  @state() private accessor confirmDelete = false;
  private stop?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.stop = this.ctx.watch<DevicesMessage>("hue_studio/devices/subscribe", (msg) => (this.devices = msg));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop?.();
  }

  private get info(): FoundDevice | null {
    return allDevices(this.devices).find((d) => d.id === this.device) ?? null;
  }

  private dirty(d: FoundDevice): boolean {
    return (
      (this.name !== null && this.name.trim() !== "" && this.name.trim() !== d.name) ||
      (this.area !== undefined && this.area !== d.area) ||
      (this.fn !== undefined && this.fn !== d.function) ||
      (this.power !== undefined && this.power !== d.power_on)
    );
  }

  private back(d: FoundDevice | null): void {
    this.ctx.go(d ? `/settings/devices/${groupOf(d.kind)}` : "/settings/devices");
  }

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const d = this.info;
    if (!d) {
      return this.screen(
        this.subHead("", () => this.back(null)),
        html`<p class="empty">${t(this.devices ? "devices.not_found" : "rooms.loading")}</p>`,
      );
    }
    const light = d.kind === "light";
    const name = this.name ?? d.name;
    const area = this.area !== undefined ? this.area : d.area;
    const fn = this.fn ?? d.function ?? null;
    const power = this.power ?? d.power_on ?? null;
    const unreachable = d.reachable === false;

    const head = html`<div class="bar sub">
      <button class="round close" aria-label=${t("common.close")} @click=${() => this.back(d)}>${icon("close")}</button>
      <div class="title">${t(`devices.settings_${d.kind}` as StringKey)}</div>
      <button class="pill save" ?disabled=${!this.dirty(d) || this.saving} @click=${() => this.save(d)}>${t("scene.save")}</button>
    </div>`;
    const body = html`<div class="page sensor-edit device-edit">
      <div class="sensor-hero">
        <ha-icon class="pic" icon=${deviceIcon(ctx.hass, d)}></ha-icon>
        <div class="name-row">
          ${this.editingName
            ? html`<input
                class="name-input"
                .value=${name}
                maxlength=${NAME_MAX}
                aria-label=${t("sensor.rename")}
                @input=${(e: InputEvent) => (this.name = (e.target as HTMLInputElement).value)}
                @keydown=${(e: KeyboardEvent) => e.key === "Enter" && (this.editingName = false)}
              />`
            : html`<h1 class="big">${name}</h1>`}
          <button
            class="round rename"
            aria-label=${t("sensor.rename")}
            @click=${() => {
              this.editingName = !this.editingName;
              if (this.editingName) this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".name-input")?.focus());
            }}
          >${icon("pencil")}</button>
        </div>
        ${unreachable ? html`<div class="small warn">${t("devices.unreachable")}</div>` : nothing}
      </div>

      <div class="rows">
        <button class="item" @click=${() => this.open("room")}>
          <div class="grow">${t("sensor.room")}</div>
          <span class="value">${area ? ctx.hass.areas?.[area]?.name || area : t("sensor.no_room")}</span>
        </button>
      </div>

      ${light
        ? html`<h2 class="label">${t("sensor.general")}</h2>
            <div class="rows">
              ${this.row(t("devices.function"), t("devices.function_sub"), fn ? t(`devices.function_${fn}` as StringKey) : "", () => this.open("function"))}
              ${this.row(t("devices.power_on"), t("devices.power_on_sub"), power ? t(`devices.power_${power}` as StringKey) : "", () => this.open("power"))}
            </div>`
        : nothing}

      ${unreachable || light
        ? html`<div class=${classMap({ "info-box": true, warn: unreachable })} role="note">
            <div class="info-head"><ha-icon icon=${unreachable ? "mdi:alert-circle" : "mdi:information"}></ha-icon>${t(unreachable ? "devices.unreachable" : "devices.info")}</div>
            <p>${t(unreachable ? "devices.info_unreachable" : "devices.info_light")}</p>
          </div>`
        : nothing}

      <h2 class="label">${t("sensor.support")}</h2>
      <div class="rows">
        ${this.link("mdi:gesture-tap", t("devices.identify"), t(light ? "devices.identify_light" : "devices.identify_other"), () => this.identify(d))}
        ${this.link("mdi:information", t("devices.device_info"), "", () => this.open("info"))}
        ${this.link("mdi:help-circle", t("sensor.help"), "", () => window.open(HELP_URL, "_blank", "noopener"))}
        ${d.ha_device
          ? this.link("mdi:home-assistant", t("sensor.in_ha"), "", () => ctx.openHa(`/config/devices/device/${encodeURIComponent(d.ha_device!)}`))
          : nothing}
      </div>

      <div class="delete-area">
        <button class=${classMap({ "delete-btn": true, confirm: this.confirmDelete })} ?disabled=${this.saving} @click=${() => this.deleteDevice(d)}>
          ${t(this.confirmDelete ? "devices.delete_confirm" : "devices.delete")}
        </button>
        ${this.confirmDelete ? html`<p class="hint warn">${t("devices.delete_hint")}</p>` : nothing}
      </div>
    </div>`;
    // The sheet sits outside the scrolling body: a scroller (iOS) would clip it.
    return html`<div class="screen-head">${head}</div>
      <div class="screen-body">${body}</div>
      ${this.sheet ? this.renderSheet(this.sheet, d, area, fn, power) : nothing}`;
  }

  /** A setting: title and what it is about, its value on the right. */
  private row(title: string, sub: string, value: string, act: () => void): TemplateResult {
    return html`<button class="item" @click=${act}>
      <div class="grow">${title}<div class="dim small">${sub}</div></div>
      ${value ? html`<span class="value">${value}</span>` : nothing}
    </button>`;
  }

  /** A support row: picture and title (and a line under it). */
  private link(glyph: string, title: string, sub: string, act: () => void): TemplateResult {
    return html`<button class="item" @click=${act}>
      <ha-icon icon=${glyph}></ha-icon>
      <div class="grow">${title}${sub ? html`<div class="dim small">${sub}</div>` : nothing}</div>
    </button>`;
  }

  private open(sheet: Sheet): void {
    haptic("selection");
    this.editingName = false;
    this.confirmDelete = false;
    this.sheet = sheet;
  }

  private renderSheet(sheet: Sheet, d: FoundDevice, area: string | null, fn: LightFunction | null, power: PowerOn | null): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const done = () => (this.sheet = null);
    const pick = (selected: boolean, label: string, sub: string, act: () => void) =>
      html`<button class=${classMap({ item: true, on: selected })} role="radio" aria-checked=${selected} @click=${() => {
        haptic("selection");
        act();
        done();
      }}>
        <div class="grow">${label}${sub ? html`<div class="dim small">${sub}</div>` : nothing}</div>
        ${selected ? html`<span class="tick">${icon("check")}</span>` : nothing}
      </button>`;
    let title: string;
    let content: TemplateResult;
    if (sheet === "room") {
      title = t("sensor.room");
      const areas = Object.entries(ctx.hass.areas || {}).sort(([, a], [, b]) => a.name.localeCompare(b.name));
      content = html`${d.kind === "light" ? html`<p class="hint">${t("devices.room_hint")}</p>` : nothing}
        <div class="rows" role="radiogroup">${areas.map(([id, a]) => pick(id === area, a.name, "", () => (this.area = id)))}</div>`;
    } else if (sheet === "function") {
      title = t("devices.function");
      content = html`<p class="hint">${t("devices.function_hint")}</p>
        <div class="rows" role="radiogroup">
          ${LIGHT_FUNCTIONS.map((f) => pick(f === fn, t(`devices.function_${f}` as StringKey), "", () => (this.fn = f)))}
        </div>`;
    } else if (sheet === "power") {
      title = t("devices.power_on");
      const choices: PowerOn[] = power === "custom" ? [...POWER_ON, "custom"] : POWER_ON;
      content = html`<p class="hint">${t("devices.power_on_hint")}</p>
        <div class="rows" role="radiogroup">
          ${choices.map((p) =>
            p === "custom"
              ? html`<div class="item on" role="radio" aria-checked="true" aria-disabled="true">
                  <div class="grow">${t("devices.power_custom")}<div class="dim small">${t("devices.power_custom_sub")}</div></div>
                  ${this.power === undefined ? html`<span class="tick">${icon("check")}</span>` : nothing}
                </div>`
              : pick(p === power, t(`devices.power_${p}` as StringKey), t(`devices.power_${p}_sub` as StringKey), () => (this.power = p)),
          )}
        </div>`;
    } else {
      title = t("devices.device_info");
      const bridge = this.devices?.[d.bridge]?.name;
      const facts: [string, string | null | undefined][] = [
        [t("devices.product"), d.product],
        [t("devices.model"), d.model],
        [t("devices.software_label"), d.software],
        [t("devices.bridge"), bridge],
        [t("devices.connection"), d.reachable == null ? null : t(d.reachable ? "devices.reachable" : "devices.unreachable")],
      ];
      content = html`<div class="rows facts">
        ${facts
          .filter(([, v]) => v)
          .map(([k, v]) => html`<div class="item"><div class="grow">${k}</div><span class="value">${v}</span></div>`)}
      </div>`;
    }
    // Like the Hue app's: a sheet from the bottom (phones), close on the left.
    return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && done()}>
      <div class="box form sensor-sheet" role="dialog" aria-label=${title}>
        <div class="sheet-bar">
          <button class="round close" aria-label=${t("common.close")} @click=${done}>${icon("close")}</button>
          <div class="grow">${title}</div>
        </div>
        <div class="form-body">${content}</div>
      </div>
    </div>`;
  }

  private async identify(d: FoundDevice): Promise<void> {
    haptic("selection");
    await this.ctx.ws({ type: "hue_studio/devices/identify", device: d.id });
  }

  private async save(d: FoundDevice): Promise<void> {
    const { ctx } = this;
    this.saving = true;
    const name = this.name?.trim() || d.name;
    const ok = await ctx.ws({
      type: "hue_studio/devices/setup",
      device: d.id,
      name,
      area_id: this.area !== undefined ? this.area : d.area,
      ...(this.fn !== undefined && this.fn !== d.function ? { function: this.fn } : {}),
      ...(this.power !== undefined && this.power !== d.power_on && this.power !== "custom" ? { power_on: this.power } : {}),
    });
    this.saving = false;
    if (!ok) return;
    haptic("success");
    ctx.toast(ctx.t("devices.saved", { name }));
    this.name = null;
    this.area = this.fn = this.power = undefined;
    this.editingName = false;
    this.back(d);
  }

  private async deleteDevice(d: FoundDevice): Promise<void> {
    const { ctx } = this;
    if (!this.confirmDelete) {
      haptic("warning");
      this.confirmDelete = true;
      return;
    }
    this.saving = true;
    const ok = await ctx.ws({ type: "hue_studio/devices/delete", device: d.id });
    this.saving = false;
    this.confirmDelete = false;
    if (!ok) return;
    haptic("success");
    ctx.toast(ctx.t("devices.deleted", { name: d.name }));
    this.back(d);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-device-view": DeviceView;
  }
}
