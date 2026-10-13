// A Hue sensor's settings, like the Hue app's "Sensor settings": its picture and name
// (renamed on the bridge, HA follows), its room (the HA device's area), the lights it
// switches ("Add lights": the motion automations that use it, and a new one), motion
// sensitivity (on the bridge; HA's `hue` does not expose it), daylight (the light level
// below which its automations switch the lights on) and support. "Save" stores the name,
// the room and the sensitivity at once.

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import { type AutomationDraft, fromConfig, roomsLine } from "../automations.ts";
import { haptic } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import { BATTERY_ICON, findGroup, type HueSensor, hueSensor, sensitivityLevels } from "../model.ts";
import type { DevicesMessage, HueDeviceInfo } from "../types.ts";
import { icon } from "../ui.ts";
import { StudioView } from "./base.ts";

const NAME_MAX = 32;
const HELP_URL = "https://www.philips-hue.com/support";

type Sheet = "room" | "sensitivity" | "placement" | "battery";

/** A motion automation that uses the sensor. */
interface Uses {
  id: string;
  draft: AutomationDraft;
}

@customElement("hue-studio-sensor-view")
export class SensorView extends StudioView {
  /** The room (group key) it was opened from. */
  @property() accessor key = "";
  /** The sensor's HA device id. */
  @property() accessor device = "";

  @state() private accessor devices: DevicesMessage | null = null;
  @state() private accessor name: string | null = null;
  @state() private accessor editingName = false;
  /** The room picked (an area id, null: none); undefined: unchanged. */
  @state() private accessor area: string | null | undefined = undefined;
  @state() private accessor sensitivity: number | null = null;
  @state() private accessor sheet: Sheet | null = null;
  @state() private accessor saving = false;
  private stop?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.stop = this.ctx.watch<DevicesMessage>("hue_studio/devices/subscribe", (msg) => (this.devices = msg));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop?.();
  }

  /** The bridge's side of the sensor (its id there, sensitivity). */
  private get info(): HueDeviceInfo | null {
    return (
      Object.values(this.devices || {})
        .flatMap((b) => b.devices)
        .find((d) => d.ha_device === this.device) ?? null
    );
  }

  private get roomPath(): string {
    return findGroup(this.ctx.home, this.key) ? `/room/${encodeURIComponent(this.key)}` : "/";
  }

  private get currentArea(): string | null {
    return this.ctx.hass.devices?.[this.device]?.area_id ?? null;
  }

  private get dirty(): boolean {
    const info = this.info;
    return (
      (this.name !== null && this.name.trim() !== "" && this.name.trim() !== (info?.name ?? "")) ||
      (this.area !== undefined && this.area !== this.currentArea) ||
      (this.sensitivity !== null && this.sensitivity !== info?.sensitivity?.value)
    );
  }

  /** Motion automations of ours that use the sensor. */
  private uses(sensor: HueSensor): Uses[] {
    const { ctx } = this;
    return Object.entries(ctx.automations?.automations || {})
      .flatMap(([entityId, a]) => {
        const config = ctx.automationConfigs[entityId];
        const draft = config && a.id ? fromConfig(config) : null;
        return draft?.type === "motion" && (draft.input.motion || []).some((id) => sensor.sensors.motion.includes(id)) ? [{ id: a.id!, draft }] : [];
      })
      .sort((a, b) => a.draft.alias.localeCompare(b.draft.alias));
  }

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const close = () => ctx.go(this.roomPath);
    const sensor = hueSensor(ctx.hass, this.device);
    if (!sensor) return this.screen(this.subHead("", close), html`<p class="empty">${t("sensor.not_found")}</p>`);
    const info = this.info;
    const name = this.name ?? info?.name ?? sensor.name;
    const area = this.area !== undefined ? this.area : this.currentArea;
    const uses = this.uses(sensor);
    const room = encodeURIComponent(this.key);
    const motion = sensor.sensors.motion[0];
    const lux = sensor.sensors.illuminance[0];
    const add = () => {
      const params = new URLSearchParams({ room: this.key, ...(motion ? { sensor: motion } : {}), ...(lux ? { lux } : {}) });
      ctx.go(`/automations/new/motion?${params}`);
    };
    const daylight = uses.find((u) => u.draft.input.lux_sensor && u.draft.input.lux_below);
    const battery = sensor.battery ? ctx.hass.states[sensor.battery] : undefined;
    const level = battery && Number.isFinite(parseFloat(battery.state)) ? `${Math.round(parseFloat(battery.state))}%` : "";

    const head = html`<div class="bar sub">
      <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
      <div class="title">${t("sensor.settings")}</div>
      <button class="pill save" ?disabled=${!this.dirty || this.saving || !info} @click=${() => this.save(info!)}>${t("scene.save")}</button>
    </div>`;
    const body = html`<div class="page sensor-edit">
      <div class="sensor-hero">
        <ha-icon class="pic" icon=${sensor.icon}></ha-icon>
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
            ?disabled=${!info}
            @click=${() => {
              this.editingName = !this.editingName;
              if (this.editingName) this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".name-input")?.focus());
            }}
          >${icon("pencil")}</button>
        </div>
      </div>

      <div class="rows">
        <button class="item" ?disabled=${!info} @click=${() => this.open("room")}>
          <div class="grow">${t("sensor.room")}</div>
          <span class="value">${area ? ctx.hass.areas?.[area]?.name || area : t("sensor.no_room")}</span>
        </button>
      </div>

      <div class="rows">
        ${uses.map(
          (u) => html`<button class="item" @click=${() => ctx.go(`/automations/${encodeURIComponent(u.id)}?room=${room}`)}>
            <ha-icon icon="mdi:lightbulb-group-outline"></ha-icon>
            <div class="grow">${roomsLine(ctx.hass, u.draft.input) || u.draft.alias}<div class="dim small">${u.draft.alias}</div></div>
          </button>`,
        )}
        <button class="item" ?disabled=${!motion} @click=${add}>
          <div class="grow">${t("sensor.add_lights")}</div>
          <span class="round plus-blue">${icon("plus")}</span>
        </button>
      </div>

      <h2 class="label">${t("sensor.general")}</h2>
      <div class="rows">
        ${info?.sensitivity
          ? this.row("mdi:motion-sensor", t("sensor.sensitivity"), this.level(this.sensitivity ?? info.sensitivity.value, info.sensitivity.max), () => this.open("sensitivity"))
          : nothing}
        ${motion
          ? this.row(
              "mdi:white-balance-sunny",
              t("sensor.daylight"),
              daylight ? t("sensor.daylight_below", { lux: daylight.draft.input.lux_below ?? 0 }) : t("sensor.daylight_off"),
              () => {
                const u = daylight ?? uses[0];
                if (u) ctx.go(`/automations/${encodeURIComponent(u.id)}?room=${room}`);
                else add();
              },
            )
          : nothing}
      </div>

      <h2 class="label">${t("sensor.support")}</h2>
      <div class="rows">
        ${this.row("mdi:gesture-tap", t("sensor.placement"), "", () => this.open("placement"))}
        ${this.row(BATTERY_ICON, t("sensor.battery"), level, () => this.open("battery"))}
        ${this.row("mdi:help-circle", t("sensor.help"), "", () => window.open(HELP_URL, "_blank", "noopener"))}
        ${this.row("mdi:home-assistant", t("sensor.in_ha"), "", () => ctx.openHa(`/config/devices/device/${encodeURIComponent(this.device)}`))}
      </div>
    </div>`;
    // The sheet sits outside the scrolling body: a scroller (iOS) would clip it.
    return html`<div class="screen-head">${head}</div>
      <div class="screen-body">${body}</div>
      ${this.sheet ? this.renderSheet(this.sheet, info, area, level) : nothing}`;
  }

  /** A row like the Hue app's: picture, title and value, no chevron. */
  private row(glyph: string, title: string, sub: string, act: () => void): TemplateResult {
    return html`<button class="item" @click=${act}>
      <ha-icon icon=${glyph}></ha-icon>
      <div class="grow">${title}${sub ? html`<div class="dim small">${sub}</div>` : nothing}</div>
    </button>`;
  }

  /** "Medium", or "3 of 5" where the Hue app has no names. */
  private level(value: number, max: number): string {
    const names = sensitivityLevels(max);
    return names?.[value] ? this.ctx.t(`sensor.level_${names[value]}` as StringKey) : this.ctx.t("sensor.level_n", { n: value + 1, of: max + 1 });
  }

  private open(sheet: Sheet): void {
    haptic("selection");
    this.editingName = false;
    this.sheet = sheet;
  }

  private renderSheet(sheet: Sheet, info: HueDeviceInfo | null, area: string | null, level: string): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const done = () => (this.sheet = null);
    const pick = (selected: boolean, label: string, act: () => void) =>
      html`<button class=${classMap({ item: true, on: selected })} role="radio" aria-checked=${selected} @click=${() => {
        haptic("selection");
        act();
        done();
      }}>
        <div class="grow">${label}</div>
        ${selected ? html`<span class="tick">${icon("check")}</span>` : nothing}
      </button>`;
    let title = "";
    let content: TemplateResult;
    if (sheet === "room") {
      title = t("sensor.room");
      const areas = Object.entries(ctx.hass.areas || {}).sort(([, a], [, b]) => a.name.localeCompare(b.name));
      content = html`<div class="rows">${areas.map(([id, a]) => pick(id === area, a.name, () => (this.area = id)))}</div>`;
    } else if (sheet === "sensitivity" && info?.sensitivity) {
      title = t("sensor.sensitivity");
      const { max } = info.sensitivity;
      const value = this.sensitivity ?? info.sensitivity.value;
      content = html`<p class="hint">${t("sensor.sensitivity_hint")}</p>
        <div class="rows">${Array.from({ length: max + 1 }, (_, i) => pick(i === value, this.level(i, max), () => (this.sensitivity = i)))}</div>`;
    } else if (sheet === "battery") {
      title = t("sensor.battery");
      content = html`${level ? html`<p class="big-value">${level}</p>` : nothing}<p class="hint">${t("sensor.battery_text")}</p>`;
    } else {
      title = t("sensor.placement");
      content = html`<p class="hint">${t("sensor.placement_text")}</p>`;
    }
    return html`<div class="sheet" @click=${(e: Event) => e.target === e.currentTarget && done()}>
      <div class="box form sensor-sheet" role="dialog" aria-label=${title}>
        <div class="sheet-bar">
          <div class="grow">${title}</div>
          <button class="round close" aria-label=${t("common.close")} @click=${done}>${icon("close")}</button>
        </div>
        <div class="form-body">${content}</div>
      </div>
    </div>`;
  }

  private async save(info: HueDeviceInfo): Promise<void> {
    const { ctx } = this;
    this.saving = true;
    const name = this.name?.trim() || info.name;
    const ok = await ctx.ws({
      type: "hue_studio/devices/setup",
      device: info.id,
      name,
      area_id: this.area !== undefined ? this.area : this.currentArea,
      ...(this.sensitivity !== null && this.sensitivity !== info.sensitivity?.value ? { sensitivity: this.sensitivity } : {}),
    });
    this.saving = false;
    if (!ok) return;
    haptic("success");
    ctx.toast(ctx.t("devices.saved", { name }));
    this.name = null;
    this.area = undefined;
    this.sensitivity = null;
    this.editingName = false;
    ctx.go(this.roomPath);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-sensor-view": SensorView;
  }
}

