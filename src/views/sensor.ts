// A Hue sensor's settings, like the Hue app's "Sensor settings": its picture and name
// (renamed on the bridge, HA follows), its room (the HA device's area), what it does —
// its motion automation edited right here, laid out like the automation editor (the
// lights it switches, their light, "Turn off after" by part of the day, daylight from its
// own light sensor) — motion sensitivity (on the bridge; HA's `hue` does not expose it)
// and support. "Save" stores the name, the room and the automation at once (created
// once it has lights, deleted when they are all taken away). The sensitivity sheet is the Hue app's: a slider whose value goes
// to the bridge as soon as it is let go, so the sensor can be tried out (it calibrates for
// about 15 s, then a dot lights up on motion); its "Save" keeps it, closing goes back.
// "Delete" at the bottom removes the sensor from its bridge (a second tap confirms).

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import { areaFor, type AutomationDraft, fromConfig, missing, newDraft, placesOf, toConfig } from "../automations.ts";
import { haptic } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import { BATTERY_ICON, defaultSensitivity, findGroup, type HueSensor, hueSensor, sensitivityLevels } from "../model.ts";
import type { DevicesMessage, HueDeviceInfo } from "../types.ts";
import { icon } from "../ui.ts";
import { AutomationParts } from "./automation-parts.ts";

const NAME_MAX = 32;
const HELP_URL = "https://www.philips-hue.com/support";
/** How long a motion sensor calibrates after its sensitivity changed (the Hue app's "about 15 seconds"). */
const CALIBRATION_MS = 15_000;

type Sheet = "room" | "sensitivity" | "placement" | "battery";

/** A motion automation that uses the sensor. */
interface Uses {
  id: string;
  draft: AutomationDraft;
}

@customElement("hue-studio-sensor-view")
export class SensorView extends AutomationParts {
  /** The room (group key) it was opened from. */
  @property() accessor key = "";
  /** The sensor's HA device id. */
  @property() accessor device = "";
  /** Where closing goes when opened outside a room (Settings → Devices → Sensors). */
  @property() accessor back = "";

  @state() private accessor devices: DevicesMessage | null = null;
  @state() private accessor name: string | null = null;
  @state() private accessor editingName = false;
  /** The room picked (an area id, null: none); undefined: unchanged. */
  @state() private accessor area: string | null | undefined = undefined;
  /** The sensitivity sheet: the value tried out (sent to the bridge) and the one it opened with. */
  @state() private accessor trying: number | null = null;
  private opened: number | null = null;
  /** The value last sent to the bridge (its own may not have come back yet). */
  private sent: number | null = null;
  /** Until when the sensor calibrates after a value was sent (the bridge may not say). */
  @state() private accessor calibrating = 0;
  private calibrationTimer?: ReturnType<typeof setTimeout>;
  @state() private accessor sheet: Sheet | null = null;
  @state() private accessor saving = false;
  /** "Delete" was tapped once: the next tap deletes. */
  @state() private accessor confirmDelete = false;
  private stop?: () => void;
  /** The config id of the motion automation it stands for; null: a new one (once it has lights). */
  private automationId: string | null = null;
  /** The draft as it was read, to tell whether it changed. */
  private original = "";

  override connectedCallback(): void {
    super.connectedCallback();
    this.stop = this.ctx.watch<DevicesMessage>("hue_studio/devices/subscribe", (msg) => (this.devices = msg));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop?.();
    clearTimeout(this.calibrationTimer);
    // Left with a value only tried out: the sensor gets back the one it had.
    const info = this.info;
    if (this.sheet === "sensitivity" && info && this.opened !== null) this.sendSensitivity(info, this.opened);
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
    if (this.back) return this.back;
    return findGroup(this.ctx.home, this.key) ? `/room/${encodeURIComponent(this.key)}` : "/";
  }

  private get currentArea(): string | null {
    return this.ctx.hass.devices?.[this.device]?.area_id ?? null;
  }

  /** The name or the room changed. */
  private get deviceDirty(): boolean {
    const info = this.info;
    return (
      (this.name !== null && this.name.trim() !== "" && this.name.trim() !== (info?.name ?? "")) ||
      (this.area !== undefined && this.area !== this.currentArea)
    );
  }

  /** The automation changed (a new one only counts once it has lights). */
  private get draftDirty(): boolean {
    const d = this.draft;
    if (!d || JSON.stringify(d) === this.original) return false;
    return !!this.automationId || placesOf(d.input).length > 0;
  }

  private get dirty(): boolean {
    return this.deviceDirty || this.draftDirty;
  }

  /** Its motion automation: the first of ours that uses it, else a new one for its motion and light sensors. */
  protected override willUpdate(): void {
    const { ctx } = this;
    if (this.draft || !ctx.automations || ctx.automationConfigsRead !== ctx.automations) return;
    const sensor = hueSensor(ctx.hass, this.device);
    const motion = sensor?.sensors.motion[0];
    if (!sensor || !motion) return;
    const used = this.uses(sensor)[0];
    if (used) {
      this.automationId = used.id;
      this.draft = used.draft;
    } else {
      const draft = newDraft("motion", this.info?.name ?? sensor.name, []);
      this.draft = { ...draft, input: { ...draft.input, motion: [motion], lux_sensor: this.luxFor([motion]) } };
    }
    this.original = JSON.stringify(this.draft);
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

  protected override renderPage() {
    const { ctx } = this;
    const { t } = ctx;
    const close = () => ctx.go(this.roomPath);
    const sensor = hueSensor(ctx.hass, this.device);
    if (!sensor) return this.screen(this.subHead("", close), html`<p class="empty">${t("sensor.not_found")}</p>`);
    if (this.page === "day" && this.draft) return this.dayScreen();
    const info = this.info;
    const name = this.name ?? info?.name ?? sensor.name;
    const area = this.area !== undefined ? this.area : this.currentArea;
    const others = this.uses(sensor).filter((u) => u.id !== this.automationId);
    const room = encodeURIComponent(this.key);
    const d = this.draft;
    const lacking = d && placesOf(d.input).length ? missing(d) : null;
    const battery = sensor.battery ? ctx.hass.states[sensor.battery] : undefined;
    const level = battery && Number.isFinite(parseFloat(battery.state)) ? `${Math.round(parseFloat(battery.state))}%` : "";

    const head = html`<div class="bar sub">
      <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
      <div class="title">${t("sensor.settings")}</div>
      <button class="pill save" ?disabled=${!this.dirty || this.saving || !info || !!lacking} @click=${() => this.save(info!)}>${t("scene.save")}</button>
    </div>`;
    const body = html`
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

      ${d ? this.selectedLights(d) : nothing}
      ${d && placesOf(d.input).length
        ? html`<h2 class="label">${t("automations.general")}</h2>
            <div class="rows">${this.light(d)}${this.offRow(d, t("automations.off_after_motion"))}${this.daylightRow(d)}</div>`
        : nothing}
      ${lacking ? html`<p class="hint warn">${t(`automations.missing_${lacking}` as StringKey)}</p>` : nothing}

      ${info?.sensitivity
        ? html`<h2 class="label">${t("sensor.motion")}</h2>
            <div class="rows">${this.row("mdi:motion-sensor", t("sensor.sensitivity"), this.level(info.sensitivity.value, info.sensitivity.max), () => this.open("sensitivity"))}</div>`
        : nothing}

      ${others.length
        ? html`<h2 class="label">${t("sensor.other_automations")}</h2>
            <div class="rows">
              ${others.map(
                (u) => html`<button class="item nav" @click=${() => ctx.go(`/automations/${encodeURIComponent(u.id)}?room=${room}`)}>
                  <div class="grow">${u.draft.alias}</div>
                  <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
                </button>`,
              )}
            </div>`
        : nothing}

      <h2 class="label">${t("sensor.support")}</h2>
      <div class="rows">
        ${this.row("mdi:gesture-tap", t("sensor.placement"), "", () => this.open("placement"))}
        ${this.row(BATTERY_ICON, t("sensor.battery"), level, () => this.open("battery"))}
        ${this.row("mdi:help-circle", t("sensor.help"), "", () => window.open(HELP_URL, "_blank", "noopener"))}
        ${this.row("mdi:home-assistant", t("sensor.in_ha"), "", () => ctx.openHa(`/config/devices/device/${encodeURIComponent(this.device)}`))}
      </div>

      ${info
        ? html`<div class="delete-area">
            <button class=${classMap({ "delete-btn": true, confirm: this.confirmDelete })} ?disabled=${this.saving} @click=${() => this.deleteDevice(info)}>
              ${t(this.confirmDelete ? "devices.delete_confirm" : "devices.delete")}
            </button>
            ${this.confirmDelete ? html`<p class="hint warn">${t("devices.delete_hint")}</p>` : nothing}
          </div>`
        : nothing}`;
    // The sheets sit outside the scrolling body: a scroller (iOS) would clip them.
    return html`${this.screen(head, body, "settings-page automation-page sensor-edit")}
      ${this.sheet ? this.renderSheet(this.sheet, sensor, info, area, level) : nothing}
      ${d ? this.partSheets(d) : nothing}`;
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
    this.confirmDelete = false;
    this.sheet = sheet;
    if (sheet === "sensitivity") {
      this.opened = this.trying = this.info?.sensitivity?.value ?? null;
      this.sent = null;
    }
  }

  /** Close a sheet; the sensitivity one puts back the value it opened with unless `keep`. */
  private close(keep = false): void {
    const info = this.info;
    if (this.sheet === "sensitivity" && !keep && info && this.opened !== null) this.sendSensitivity(info, this.opened);
    if (this.sheet === "sensitivity" && keep) haptic("success");
    this.sheet = null;
    this.trying = this.opened = null;
  }

  /** Send a sensitivity to the bridge; the sensor calibrates for a while. */
  private sendSensitivity(info: HueDeviceInfo, value: number): void {
    if (value === (this.sent ?? info.sensitivity?.value)) return;
    this.sent = value;
    void this.ctx.ws({ type: "hue_studio/devices/sensitivity", device: info.id, sensitivity: value });
    this.calibrating = Date.now() + CALIBRATION_MS;
    clearTimeout(this.calibrationTimer);
    this.calibrationTimer = setTimeout(() => (this.calibrating = 0), CALIBRATION_MS);
  }

  /** The Hue app's sensitivity sheet: what it does, the level, a stepped slider, trying it out. */
  private sensitivitySheet(sensor: HueSensor, info: HueDeviceInfo, sensitivity: NonNullable<HueDeviceInfo["sensitivity"]>): TemplateResult {
    const { t } = this.ctx;
    const { max } = sensitivity;
    const value = this.trying ?? sensitivity.value;
    const fallback = defaultSensitivity(max);
    const name = this.level(value, max);
    const motion = sensor.sensors.motion[0];
    const calibrating = sensitivity.changing || this.calibrating > Date.now();
    const moving = !calibrating && motion !== undefined && this.ctx.hass.states[motion]?.state === "on";
    const step = (e: Event) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (v !== this.trying) haptic("selection");
      this.trying = v;
    };
    return html`<p class="hint">${t("sensor.sensitivity_hint")}</p>
      <p class="hint">${t("sensor.sensitivity_calibrate")}</p>
      <div class="sens-level">
        <div class="label">${t("sensor.sensitivity_label")}</div>
        <div class="value">${value === fallback ? t("sensor.level_default", { level: name }) : name}</div>
      </div>
      <div class="sens-slider" style="--f:${max ? value / max : 0}">
        <input
          type="range"
          min="0"
          max=${max}
          step="1"
          .value=${String(value)}
          aria-label=${t("sensor.sensitivity")}
          aria-valuetext=${name}
          @input=${step}
          @change=${(e: Event) => this.sendSensitivity(info, Number((e.target as HTMLInputElement).value))}
        />
        <div class="ticks">
          ${Array.from({ length: max + 1 }, (_, i) => html`<span style="--i:${i / max}">${this.level(i, max)}</span>`)}
        </div>
      </div>
      <div class=${classMap({ "sens-try": true, calibrating, moving })} role="status">
        <span class="dot"></span>
        <span>${calibrating ? t("sensor.calibrating") : moving ? t("sensor.motion_now") : t("sensor.try_out")}</span>
      </div>`;
  }

  private renderSheet(sheet: Sheet, sensor: HueSensor, info: HueDeviceInfo | null, area: string | null, level: string): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const done = () => this.close();
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
      content = this.sensitivitySheet(sensor, info, info.sensitivity);
    } else if (sheet === "battery") {
      title = t("sensor.battery");
      content = html`${level ? html`<p class="big-value">${level}</p>` : nothing}<p class="hint">${t("sensor.battery_text")}</p>`;
    } else {
      title = t("sensor.placement");
      content = html`<p class="hint">${t("sensor.placement_text")}</p>`;
    }
    // Like the Hue app's: a sheet from the bottom (phones), close on the left, "Save" where it keeps something.
    return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && done()}>
      <div class="box form sensor-sheet" role="dialog" aria-label=${title}>
        <div class="sheet-bar">
          <button class="round close" aria-label=${t("common.close")} @click=${done}>${icon("close")}</button>
          <div class="grow">${title}</div>
          ${sheet === "sensitivity"
            ? html`<button class="pill save" ?disabled=${this.trying === null} @click=${() => this.close(true)}>${t("scene.save")}</button>`
            : nothing}
        </div>
        <div class="form-body">${content}</div>
      </div>
    </div>`;
  }

  private async deleteDevice(info: HueDeviceInfo): Promise<void> {
    const { ctx } = this;
    if (!this.confirmDelete) {
      haptic("warning");
      this.confirmDelete = true;
      return;
    }
    this.saving = true;
    const ok = await ctx.ws({ type: "hue_studio/devices/delete", device: info.id });
    this.saving = false;
    this.confirmDelete = false;
    if (!ok) return;
    haptic("success");
    ctx.toast(ctx.t("devices.deleted", { name: info.name }));
    ctx.go(this.roomPath);
  }

  private async save(info: HueDeviceInfo): Promise<void> {
    const { ctx } = this;
    this.saving = true;
    const name = this.name?.trim() || info.name;
    let ok = true;
    if (this.deviceDirty)
      ok = await ctx.ws({
        type: "hue_studio/devices/setup",
        device: info.id,
        name,
        area_id: this.area !== undefined ? this.area : this.currentArea,
      });
    const d = this.draft;
    if (ok && d && this.draftDirty) {
      // Without lights the sensor switches nothing: its automation goes.
      if (!placesOf(d.input).length) ok = await ctx.deleteAutomation(d.id);
      else {
        const draft = { ...d, alias: d.alias.trim() || name };
        ok = await ctx.saveAutomation(toConfig(draft, ctx.t("automations.description", { url: `/hue/automations/${d.id}` })), areaFor(draft));
      }
    }
    this.saving = false;
    if (!ok) return;
    haptic("success");
    ctx.toast(ctx.t("devices.saved", { name }));
    this.name = null;
    this.area = undefined;
    this.editingName = false;
    ctx.go(this.roomPath);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-sensor-view": SensorView;
  }
}

