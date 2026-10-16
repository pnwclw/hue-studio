// Settings → Devices, like the Hue app's: "+" adds devices (views/device-add.ts), then a row
// per kind with its count ("Lights & smart plugs", switches, sensors, other devices); new
// devices a search found are listed above them. A kind's list (`list`) has a search field,
// filters by location and type, and the devices by room; a device opens its settings
// (views/device.ts; a Hue sensor HA has opens the sensor's own, views/sensor.ts).

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import {
  allDevices,
  byLocation,
  type DeviceFilter,
  type DeviceGroup,
  DEVICE_GROUPS,
  deviceIcon,
  deviceTypes,
  filterDevices,
  type FoundDevice,
  GROUP_ICONS,
  groupOf,
  NO_AREA,
} from "../devices.ts";
import { haptic } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import { hueSensor } from "../model.ts";
import type { DevicesMessage, HueDeviceInfo } from "../types.ts";
import { icon } from "../ui.ts";
import { StudioView } from "./base.ts";

type Picker = "location" | "type" | "bridge";

/** Where a device's settings are: a Hue sensor HA has gets the sensor's own page. */
export function devicePath(ctx: StudioView["ctx"], d: HueDeviceInfo): string {
  if (d.kind === "sensor" && d.ha_device && hueSensor(ctx.hass, d.ha_device)) return `/settings/devices/sensor/${encodeURIComponent(d.ha_device)}`;
  return `/settings/devices/device/${encodeURIComponent(d.id)}`;
}

@customElement("hue-studio-devices-view")
export class DevicesView extends StudioView {
  /** A kind's list, or null: the overview. */
  @property() accessor list: DeviceGroup | null = null;
  /** A bridge to show the devices of (`?bridge=`, from its page), or null: every bridge. */
  @property() accessor bridge: string | null = null;

  @state() private accessor devices: DevicesMessage | null = null;
  @state() private accessor filter: DeviceFilter = { query: "", area: null, type: null };
  @state() private accessor picker: Picker | null = null;
  private stop?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.stop = this.ctx.watch<DevicesMessage>("hue_studio/devices/subscribe", (msg) => (this.devices = msg));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop?.();
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("bridge")) this.filter = { ...this.filter, bridge: this.bridge };
  }

  protected override render() {
    return this.list ? this.renderList(this.list) : this.renderOverview();
  }

  /** Several bridges: their devices can be told apart (filter, the bridge under a name). */
  private get severalBridges(): boolean {
    return Object.keys(this.devices || {}).length > 1;
  }

  private addButton(): TemplateResult {
    const { ctx } = this;
    const searching = Object.values(this.devices || {}).some((b) => b.searching);
    return html`<button class="round plus-blue add-devices" aria-label=${ctx.t("devices.add")} @click=${() => ctx.go("/settings/devices/add")}>
      ${icon("plus")}${searching ? html`<span class="dot-badge live" aria-hidden="true"></span>` : nothing}
    </button>`;
  }

  /** A device: its picture, name, and "Unreachable" when the bridge cannot reach it. */
  private deviceRow(d: HueDeviceInfo, sub = ""): TemplateResult {
    const { ctx } = this;
    const unreachable = d.reachable === false;
    return html`<button class="item" @click=${() => ctx.go(devicePath(ctx, d))}>
      <ha-icon icon=${deviceIcon(ctx.hass, d)}></ha-icon>
      <div class="grow">
        <div class="name">${d.name}</div>
        ${unreachable ? html`<div class="small warn">${ctx.t("devices.unreachable")}</div>` : sub ? html`<div class="dim small">${sub}</div>` : nothing}
      </div>
    </button>`;
  }

  private renderOverview(): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    // From a bridge's page: that bridge's devices.
    const only = this.bridge && this.devices?.[this.bridge] ? this.bridge : null;
    const all = allDevices(this.devices).filter((d) => !only || d.bridge === only);
    const query = only ? `?bridge=${encodeURIComponent(only)}` : "";
    const searching = Object.values(this.devices || {}).some((b) => b.searching);
    const fresh = all.filter((d) => d.new);
    const count = (g: DeviceGroup) => all.filter((d) => groupOf(d.kind) === g).length;
    const unreachable = (g: DeviceGroup) => all.some((d) => groupOf(d.kind) === g && d.reachable === false);
    const groups = DEVICE_GROUPS.filter((g) => g === "lights" || g === "sensors" || count(g));
    return this.screen(
      this.subHead(t("settings.devices"), () => ctx.go("/settings"), this.addButton()),
      html`${!this.devices ? html`<p class="empty">${t("rooms.loading")}</p>` : nothing}
        ${only
          ? html`<p class="lead small">${t("devices.on_bridge", { bridge: this.devices![only].name })}
              <button class="text-link" @click=${() => ctx.go("/settings/devices")}>${t("devices.all_bridges")}</button></p>`
          : nothing}
        ${searching
          ? html`<button class="notice" @click=${() => ctx.go("/settings/devices/add")}>
              <span class="dot-badge live" aria-hidden="true"></span><span class="grow">${t("devices.searching")}</span><ha-icon class="go" icon="mdi:chevron-right"></ha-icon>
            </button>`
          : nothing}
        ${fresh.length
          ? html`<h2 class="label">${t("devices.new")}</h2>
              <div class="rows device-list">${fresh.map((d) => this.deviceRow(d, d.product))}</div>`
          : nothing}
        ${this.devices
          ? html`<div class="rows device-list kinds">
              ${groups.map(
                (g) => html`<button class="item" @click=${() => ctx.go(`/settings/devices/${g}${query}`)}>
                  <ha-icon icon=${GROUP_ICONS[g]}></ha-icon>
                  <div class="grow">${t(`devices.${g}` as StringKey)}</div>
                  ${unreachable(g) ? html`<span class="dot-badge warn" aria-hidden="true"></span>` : nothing}
                  <span class="value">${count(g)}</span>
                  <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
                </button>`,
              )}
            </div>`
          : nothing}`,
      "settings-page devices-page",
    );
  }

  private renderList(group: DeviceGroup): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const areas = ctx.hass.areas || {};
    const areaName = (id: string) => areas[id]?.name;
    const mine: FoundDevice[] = allDevices(this.devices).filter((d) => groupOf(d.kind) === group);
    const shown = filterDevices(mine, this.filter);
    const sections = byLocation(shown, areaName, t("devices.no_area"));
    const { area, type, query, bridge } = this.filter;
    const bridgeSub = (d: FoundDevice) => (this.severalBridges && !bridge ? this.devices?.[d.bridge]?.name : "") || "";
    const chip = (which: Picker, label: string, on: boolean) =>
      html`<button class=${classMap({ chip: true, "filter-chip": true, on })} aria-haspopup="dialog" @click=${() => this.openPicker(which)}>
        <span>${label}</span><ha-icon icon="mdi:chevron-down"></ha-icon>
      </button>`;
    const body = html`<label class="search-field device-search">
        ${icon("search")}
        <input
          class="q"
          type="search"
          enterkeyhint="search"
          placeholder=${t("devices.search")}
          aria-label=${t("devices.search")}
          .value=${query}
          @input=${(e: InputEvent) => (this.filter = { ...this.filter, query: (e.target as HTMLInputElement).value })}
        />
      </label>
      <div class="section-head filter-head">
        <h2 class="label">${t("devices.filter_by")}</h2>
        <span class="count">${shown.length}</span>
      </div>
      <div class="chips filters">
        ${chip("location", area === null ? t("devices.location") : area === NO_AREA ? t("devices.no_area") : (areaName(area) ?? area), area !== null)}
        ${chip("type", type ?? t("devices.type"), type !== null)}
        ${this.severalBridges ? chip("bridge", (bridge && this.devices?.[bridge]?.name) || t("devices.bridge_filter"), !!bridge) : nothing}
      </div>
      ${!this.devices ? html`<p class="empty">${t("rooms.loading")}</p>` : nothing}
      ${this.devices && !shown.length ? html`<p class="empty">${t(mine.length ? "devices.no_matches" : "devices.none")}</p>` : nothing}
      ${sections.map(
        (s) => html`<div class="section-head">
            <h2 class="label">${s.name}</h2>
            <span class="count">${s.devices.length}</span>
          </div>
          <div class="rows device-list">${s.devices.map((d) => this.deviceRow(d, bridgeSub(d as FoundDevice)))}</div>`,
      )}`;
    return html`<div class="screen-head">${this.subHead(t(`devices.${group}` as StringKey), () => ctx.go(this.bridge ? `/settings/devices?bridge=${encodeURIComponent(this.bridge)}` : "/settings/devices"), this.addButton())}</div>
      <div class="screen-body"><div class="page settings-page devices-page">${body}</div></div>
      ${this.picker ? this.renderPicker(this.picker, mine) : nothing}`;
  }

  private openPicker(which: Picker): void {
    haptic("selection");
    this.picker = which;
  }

  /** The filter's choices, as a sheet (outside the scrolling body: iOS would clip it). */
  private renderPicker(which: Picker, mine: HueDeviceInfo[]): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const done = () => (this.picker = null);
    const areas = ctx.hass.areas || {};
    const current = which === "location" ? this.filter.area : which === "type" ? this.filter.type : (this.filter.bridge ?? null);
    const set = (value: string | null) => {
      haptic("selection");
      const key = which === "location" ? "area" : which;
      this.filter = { ...this.filter, [key]: value };
      done();
    };
    const options: [string | null, string][] =
      which === "location"
        ? [
            [null, t("devices.all_locations")],
            ...[...new Set(mine.map((d) => (d.area && areas[d.area] ? d.area : NO_AREA)))]
              .map((id): [string, string] => [id, id === NO_AREA ? t("devices.no_area") : areas[id]!.name])
              .sort(([a, x], [b, y]) => (a === NO_AREA ? 1 : 0) - (b === NO_AREA ? 1 : 0) || x.localeCompare(y)),
          ]
        : which === "type"
          ? [[null, t("devices.all_types")], ...deviceTypes(mine).map((p): [string, string] => [p, p])]
          : [[null, t("devices.all_bridges")], ...Object.entries(this.devices || {}).map(([id, b]): [string, string] => [id, b.name])];
    const title = t(which === "location" ? "devices.location" : which === "type" ? "devices.type" : "devices.bridge_filter");
    return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && done()}>
      <div class="box form sensor-sheet" role="dialog" aria-label=${title}>
        <div class="sheet-bar">
          <button class="round close" aria-label=${t("common.close")} @click=${done}>${icon("close")}</button>
          <div class="grow">${title}</div>
        </div>
        <div class="form-body">
          <div class="rows" role="radiogroup">
            ${options.map(
              ([value, label]) => html`<button class=${classMap({ item: true, on: value === current })} role="radio" aria-checked=${value === current} @click=${() => set(value)}>
                <div class="grow">${label}</div>
                ${value === current ? html`<span class="tick">${icon("check")}</span>` : nothing}
              </button>`,
            )}
          </div>
        </div>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-devices-view": DevicesView;
  }
}
