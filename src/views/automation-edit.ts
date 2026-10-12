// One automation, edited like in the Hue app: its name, when (per type), rooms and light.
// Natural light and the scene of the day have a second page with their settings (pools by
// phase, season and weather, phases, brightness, weather and sensors, holidays, excluded
// scenes); everything stays a draft until "Save" writes the automation into Home Assistant
// (HA's automation config API), which stores and runs it.

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import {
  areaFor,
  type AutomationDraft,
  type AutomationInput,
  type Duration,
  type EndKind,
  fromConfig,
  hhmm,
  isType,
  LIGHT_KINDS,
  type LightKind,
  missing,
  newDraft,
  offsetDuration,
  offsetMinutes,
  type StartKind,
  toConfig,
  TYPE_ICONS,
  WEEKDAYS,
  type Weekday,
} from "../automations.ts";
import { whiteArt } from "../color.ts";
import {
  dayConfig,
  DEFAULT_NIGHT_FROM,
  DEFAULT_SHIFTS,
  GRADIENT_MODES,
  isMonthDay,
  KELVIN_RANGE,
  monthDay,
  NATURAL_KELVIN,
  PHASES,
  phaseCounts,
  type PoolKey,
  poolOf,
  SEASONS,
  SHIFTS,
  stepsOf,
  withExcluded,
  withOffset,
  withPool,
  withSettings,
} from "../daylight.ts";
import { thumbUrl } from "../gallery-data.ts";
import { haptic } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import { findGroup, friendlyName } from "../model.ts";
import type { DayConfig, DayPreview, DaySettings, Holiday, Phase } from "../types.ts";
import { icon, normalize, toggle } from "../ui.ts";
import { StudioView } from "./base.ts";

const FADES = [0, 1, 5, 10, 15, 20, 30, 45, 60, 90];
const OFF_AFTER = [0, 1, 2, 5, 10, 15, 20, 30, 45, 60, 120, 240];
const BRIGHTNESS_LEVELS = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
const SEASON_STATES = ["winter", "spring", "summer", "autumn"];
const PHASE_ICONS: Record<Phase, string> = {
  morning: "mdi:weather-sunset-up",
  day: "mdi:white-balance-sunny",
  golden: "mdi:weather-sunset",
  evening: "mdi:weather-sunset-down",
  night: "mdi:weather-night",
};

/** The gallery picker: which scenes are chosen and what to do with them. */
interface Picker {
  title: string;
  selected: string[];
  query: string;
  save: (ids: string[]) => void;
}

/** The holiday editor: a new holiday (index null) or one of the list. */
interface HolidayDraft {
  index: number | null;
  from: string;
  to: string;
  phases: Phase[];
  pool: string[];
}

type Legacy = Record<string, { natural: boolean; config: DayConfig }>;

@customElement("hue-studio-automation-edit-view")
export class AutomationEditView extends StudioView {
  /** The config id of the automation, or null for a new one (`newType`). */
  @property() accessor automationId: string | null = null;
  @property() accessor newType: string | null = null;
  /** The room a new automation starts with (an area id). */
  @property() accessor room: string | null = null;

  @state() private accessor draft: AutomationDraft | null = null;
  @state() private accessor page: "main" | "day" = "main";
  @state() private accessor confirmDelete = false;
  @state() private accessor saving = false;
  @state() private accessor preview: DayPreview | null = null;
  @state() private accessor legacy: Legacy | null = null;
  @state() private accessor pool: PoolKey | null = null;
  @state() private accessor picker: Picker | null = null;
  @state() private accessor holiday: HolidayDraft | null = null;
  private previewKey = "";
  private legacyAsked = false;

  private get isNew(): boolean {
    return !this.automationId;
  }

  protected override willUpdate(): void {
    if (this.draft) return;
    const { ctx } = this;
    if (this.newType && isType(this.newType)) {
      const rooms = this.room && ctx.hass.areas?.[this.room] ? [this.room] : [];
      this.draft = newDraft(this.newType, ctx.t(`automations.type_${this.newType}` as StringKey), rooms);
    } else if (this.automationId) {
      const entity = ctx.automationEntity(this.automationId);
      const config = entity ? ctx.automationConfigs[entity] : undefined;
      if (config) this.draft = fromConfig(config);
    }
  }

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    super.updated(changed);
    const d = this.draft;
    const light = d?.input.light;
    if (!d || !LIGHT_KINDS[d.type].length || (light !== "natural" && light !== "auto")) return;
    const key = JSON.stringify([light, d.input.scene_of_the_day || {}]);
    if (key !== this.previewKey) {
      this.previewKey = key;
      void this.ctx
        .query<DayPreview>({ type: "hue_studio/automations/preview", natural: light === "natural", scene_of_the_day: dayConfig(d.input.scene_of_the_day) }, { quiet: true })
        .then((preview) => {
          if (this.previewKey === key) this.preview = preview;
        });
    }
    if (!this.legacyAsked && this.page === "day") {
      this.legacyAsked = true;
      void this.ctx.query<Legacy>({ type: "hue_studio/automations/legacy_auto_light" }, { quiet: true }).then((legacy) => (this.legacy = legacy));
    }
  }

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const d = this.draft;
    const back = () => (this.page === "day" ? this.leaveDay() : ctx.go("/automations"));
    if (!d) {
      const loading = !ctx.automations || (this.automationId && ctx.automationEntity(this.automationId) && !this.draft);
      return this.screen(this.subHead(t("automations.title"), back), html`<p class="empty">${t(loading ? "rooms.loading" : "automations.not_found")}</p>`);
    }
    if (this.page === "day") {
      const natural = d.input.light === "natural";
      return html`${this.screen(this.subHead(t(natural ? "automations.light_natural" : "automations.light_auto"), back), this.dayPage(natural), "auto-page")}
        ${this.holiday ? this.holidaySheet(this.holiday) : nothing} ${this.picker ? this.pickerSheet(this.picker) : nothing}`;
    }
    const title = this.isNew ? t("automations.new") : d.alias || t(`automations.type_${d.type}` as StringKey);
    const lacking = missing(d);
    return this.screen(
      this.subHead(title, back),
      html`<div class="automation-type">
          <ha-icon icon=${TYPE_ICONS[d.type]}></ha-icon>
          <span>${t(`automations.type_${d.type}` as StringKey)}</span>
        </div>
        <input class="field" placeholder=${t("automations.name")} aria-label=${t("automations.name")} .value=${d.alias}
          @input=${(e: InputEvent) => (this.draft = { ...d, alias: (e.target as HTMLInputElement).value })} />
        <h2 class="label">${t("automations.when")}</h2>
        ${this.when(d)}
        <h2 class="label">${t("automations.rooms")}</h2>
        ${this.rooms(d)}
        ${LIGHT_KINDS[d.type].length ? html`<h2 class="label">${t("automations.light")}</h2>${this.light(d)}` : nothing}
        <div class="center stack">
          <button class="pill apply" ?disabled=${!!lacking || this.saving} @click=${() => this.save()}>${t(this.isNew ? "automations.create" : "zone.save")}</button>
          ${lacking ? html`<p class="lead small">${t(`automations.missing_${lacking}` as StringKey)}</p>` : nothing}
          ${this.isNew
            ? nothing
            : html`<button class="pill reset" @click=${() => ctx.openHa(`/config/automation/edit/${encodeURIComponent(d.id)}`)}>${t("automations.open_ha")}</button>
                <button class=${classMap({ pill: true, reset: true, danger: true, confirm: this.confirmDelete })} @click=${() => this.deleteIt()}>
                  ${t(this.confirmDelete ? "automations.delete_confirm" : "automations.delete")}
                </button>`}
        </div>`,
      "settings-page automation-page",
    );
  }

  // ---- saving ----

  private set(patch: Partial<AutomationInput>): void {
    const d = this.draft!;
    this.draft = { ...d, input: { ...d.input, ...patch } };
  }

  private async save(): Promise<void> {
    const { ctx } = this;
    const d = this.draft;
    if (!d || missing(d)) return;
    this.saving = true;
    const description = ctx.t("automations.description", { url: `/hue/automations/${d.id}` });
    const ok = await ctx.saveAutomation(toConfig(d, description), areaFor(d));
    this.saving = false;
    if (ok) {
      haptic("success");
      ctx.go("/automations");
    }
  }

  private async deleteIt(): Promise<void> {
    if (!this.confirmDelete) {
      this.confirmDelete = true;
      haptic("warning");
      return;
    }
    if (await this.ctx.deleteAutomation(this.draft!.id)) this.ctx.go("/automations");
  }

  // ---- controls ----

  private stepper(value: number, min: number, max: number, step: number, unit: string, change: (v: number) => void, signed = false) {
    const set = (v: number) => {
      haptic("selection");
      change(Math.min(max, Math.max(min, v)));
    };
    return html`<div class="stepper">
      <button class="round mini-step" aria-label="−" ?disabled=${value <= min} @click=${() => set(value - step)}>−</button>
      <span class="value">${signed && value > 0 ? "+" : ""}${value} ${unit}</span>
      <button class="round mini-step" aria-label="+" ?disabled=${value >= max} @click=${() => set(value + step)}>+</button>
    </div>`;
  }

  private seg<T extends string>(values: readonly T[], current: T, label: (v: T) => string, pick: (v: T) => void, extra = "") {
    const cls = values.length === 2 ? "two" : values.length === 3 ? "three" : "";
    return html`<div class="seg ${cls} ${extra}" role="radiogroup">
      ${values.map(
        (v) => html`<button role="radio" aria-checked=${v === current} class=${classMap({ on: v === current })} @click=${() => {
          if (v === current) return;
          haptic("selection");
          pick(v);
        }}>${label(v)}</button>`,
      )}
    </div>`;
  }

  private timeRow(glyph: string, label: string, value: string | undefined, change: (v: string) => void) {
    return html`<div class="item">
      <ha-icon icon=${glyph}></ha-icon><div class="grow">${label}</div>
      <input class="select time" type="time" aria-label=${label} .value=${hhmm(value)} @change=${(e: Event) => {
        const v = (e.target as HTMLInputElement).value;
        if (/^\d\d:\d\d$/.test(v)) change(`${v}:00`);
      }} />
    </div>`;
  }

  private minutesRow(glyph: string, label: string, sub: string, value: number | undefined, options: number[], zero: StringKey, change: (v: number) => void) {
    const { t } = this.ctx;
    const values = options.includes(value ?? 0) ? options : [...options, value ?? 0].sort((a, b) => a - b);
    return html`<div class="item wrap">
      <ha-icon icon=${glyph}></ha-icon>
      <div class="grow">${label}${sub ? html`<div class="dim small">${sub}</div>` : nothing}</div>
      <select class="select" aria-label=${label} @change=${(e: Event) => change(Number((e.target as HTMLSelectElement).value))}>
        ${values.map((v) => html`<option value=${v} ?selected=${v === (value ?? 0)}>${v ? `${v} ${t("automations.min")}` : t(zero)}</option>`)}
      </select>
    </div>`;
  }

  private toggleRow(glyph: string, label: string, sub: string, on: boolean, change: (v: boolean) => void) {
    return html`<div class="item">
      <ha-icon icon=${glyph}></ha-icon>
      <div class="grow">${label}${sub ? html`<div class="dim small">${sub}</div>` : nothing}</div>
      ${toggle(on, label, () => change(!on))}
    </div>`;
  }

  private days(d: AutomationDraft) {
    const { t } = this.ctx;
    const days = d.input.days?.length ? d.input.days : [...WEEKDAYS];
    const flip = (day: Weekday) => {
      const next = days.includes(day) ? days.filter((x) => x !== day) : [...days, day];
      if (!next.length) return;
      haptic("selection");
      this.set({ days: WEEKDAYS.filter((x) => next.includes(x)) });
    };
    return html`<div class="chips days">
      ${WEEKDAYS.map(
        (day) => html`<button class=${classMap({ chip: true, on: days.includes(day) })} aria-pressed=${days.includes(day)} @click=${() => flip(day)}>
          ${t(`automations.day_${day}` as StringKey)}
        </button>`,
      )}
    </div>`;
  }

  /** A start or an end: at a time, or at sunrise/sunset with an offset. */
  private moment<K extends string>(
    kinds: readonly K[],
    kind: K,
    time: string | undefined,
    offset: Duration | undefined,
    set: (patch: { kind?: K; time?: string; offset?: Duration }) => void,
  ) {
    const { t } = this.ctx;
    const sun = kind === "sunrise" || kind === "sunset";
    const label = (k: K) => t((k === "sunrise" || k === "sunset" ? `automations.seg_${k}` : `automations.${k}`) as StringKey);
    return html`${this.seg(kinds, kind, label, (k) => set({ kind: k }))}
      ${kind === "none"
        ? nothing
        : html`<div class="rows">
            ${sun
              ? html`<div class="item wrap">
                  <ha-icon icon=${kind === "sunrise" ? "mdi:weather-sunset-up" : "mdi:weather-sunset-down"}></ha-icon>
                  <div class="grow">${t("automations.offset")}<div class="dim small">${t("automations.offset_sub")}</div></div>
                  ${this.stepper(offsetMinutes(offset), -180, 180, 5, t("automations.min"), (v) => set({ offset: offsetDuration(v) }), true)}
                </div>`
              : this.timeRow("mdi:clock-outline", t("automations.time"), time, (v) => set({ time: v }))}
          </div>`}`;
  }

  private zones(d: AutomationDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const zones = Object.keys(ctx.hass.states).filter((id) => id.startsWith("zone."));
    if (zones.length < 2) return nothing;
    return html`<div class="item wrap">
      <ha-icon icon="mdi:map-marker-radius-outline"></ha-icon><div class="grow">${t("automations.zone")}</div>
      <select class="select" aria-label=${t("automations.zone")} @change=${(e: Event) => this.set({ zone: (e.target as HTMLSelectElement).value })}>
        ${zones.map((id) => html`<option value=${id} ?selected=${id === (d.input.zone || "zone.home")}>${friendlyName(ctx.hass, id)}</option>`)}
      </select>
    </div>`;
  }

  // ---- when ----

  private when(d: AutomationDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const i = d.input;
    switch (d.type) {
      case "wake_up":
        return html`<div class="rows">
            ${this.timeRow("mdi:alarm", t("automations.wake_time"), i.time, (time) => this.set({ time }))}
            ${this.minutesRow("mdi:transition", t("automations.fade_in"), t("automations.fade_in_sub"), i.fade, FADES, "automations.instantly", (fade) => this.set({ fade }))}
            ${this.minutesRow("mdi:lightbulb-off-outline", t("automations.off_after"), t("automations.off_after_wake"), i.off_after, OFF_AFTER, "automations.never", (v) => this.set({ off_after: v }))}
          </div>
          ${this.days(d)}`;
      case "go_to_sleep":
        return html`<div class="rows">
            ${this.timeRow("mdi:bed-clock", t("automations.time"), i.time, (time) => this.set({ time }))}
            ${this.minutesRow("mdi:transition", t("automations.fade_out"), t("automations.fade_out_sub"), i.fade, FADES, "automations.instantly", (fade) => this.set({ fade }))}
          </div>
          ${this.days(d)}`;
      case "coming_home":
        return html`<p class="lead">${t("automations.coming_home_hint")}</p>
          <div class="rows">
            ${this.zones(d)}
            ${this.toggleRow("mdi:weather-sunset-down", t("automations.only_dark"), t("automations.only_dark_sub"), !!i.only_dark, (v) => this.set({ only_dark: v }))}
          </div>`;
      case "leaving_home":
        return html`<p class="lead">${t("automations.leaving_home_hint")}</p>${this.zones(d) === nothing ? nothing : html`<div class="rows">${this.zones(d)}</div>`}`;
      case "mimic_presence":
        return html`<p class="lead">${t("automations.mimic_hint")}</p>
          <h3 class="sublabel">${t("automations.start")}</h3>
          ${this.moment(["time", "sunset"] as const, i.start_kind === "sunset" ? "sunset" : "time", i.start_time, i.start_offset, (p) =>
            this.set({ ...(p.kind ? { start_kind: p.kind } : {}), ...(p.time ? { start_time: p.time } : {}), ...(p.offset ? { start_offset: p.offset } : {}) }))}
          <h3 class="sublabel">${t("automations.end")}</h3>
          <div class="rows">${this.timeRow("mdi:clock-end", t("automations.end"), i.end_time, (end_time) => this.set({ end_time }))}</div>
          <div class="rows">
            ${this.zones(d)}
            ${this.toggleRow("mdi:home-off-outline", t("automations.only_away"), t("automations.only_away_sub"), i.only_away !== false, (v) => this.set({ only_away: v }))}
          </div>
          ${this.days(d)}`;
      case "schedule":
        return html`<h3 class="sublabel">${t("automations.start")}</h3>
          ${this.moment(["time", "sunrise", "sunset"] as const, (i.start_kind || "time") as StartKind, i.start_time, i.start_offset, (p) =>
            this.set({ ...(p.kind ? { start_kind: p.kind } : {}), ...(p.time ? { start_time: p.time } : {}), ...(p.offset ? { start_offset: p.offset } : {}) }))}
          <h3 class="sublabel">${t("automations.end")}</h3>
          ${this.moment(["none", "time", "sunrise", "sunset"] as const, (i.end_kind || "none") as EndKind, i.end_time, i.end_offset, (p) =>
            this.set({ ...(p.kind ? { end_kind: p.kind } : {}), ...(p.time ? { end_time: p.time } : {}), ...(p.offset ? { end_offset: p.offset } : {}) }))}
          <div class="rows">
            ${this.minutesRow("mdi:transition", t("automations.fade"), t("automations.fade_sub"), i.fade, FADES, "automations.instantly", (fade) => this.set({ fade }))}
          </div>
          ${this.days(d)}`;
      case "motion":
        return this.motion(d);
    }
  }

  private motion(d: AutomationDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const i = d.input;
    const states = ctx.hass.states;
    const inRooms = (id: string) => {
      const entry = ctx.hass.entities?.[id];
      const area = entry?.area_id || (entry?.device_id ? ctx.hass.devices?.[entry.device_id]?.area_id : null);
      return !!area && i.rooms.includes(area);
    };
    const byName = (a: string, b: string) => Number(inRooms(b)) - Number(inRooms(a)) || friendlyName(ctx.hass, a).localeCompare(friendlyName(ctx.hass, b));
    const sensors = Object.keys(states)
      .filter((id) => id.startsWith("binary_sensor.") && ["motion", "occupancy", "presence"].includes(states[id].attributes.device_class))
      .sort(byName);
    const lux = Object.keys(states)
      .filter((id) => id.startsWith("sensor.") && states[id].attributes.device_class === "illuminance")
      .sort(byName);
    const chosen = i.motion || [];
    const flip = (id: string) => {
      haptic("selection");
      this.set({ motion: chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id] });
    };
    return html`<p class="lead">${t("automations.motion_hint")}</p>
      <div class="rows pick">
        ${sensors.length
          ? sensors.map(
              (id) => html`<button class=${classMap({ item: true, on: chosen.includes(id) })} role="checkbox" aria-checked=${chosen.includes(id)} @click=${() => flip(id)}>
                <ha-icon icon="mdi:motion-sensor"></ha-icon><div class="grow">${friendlyName(ctx.hass, id)}</div>
                <span class="check">${icon("check")}</span>
              </button>`,
            )
          : html`<div class="item dim">${t("automations.no_motion_sensors")}</div>`}
      </div>
      <div class="rows">
        <div class="item wrap">
          <ha-icon icon="mdi:brightness-5"></ha-icon>
          <div class="grow">${t("automations.lux_sensor")}<div class="dim small">${t("automations.lux_sensor_sub")}</div></div>
          <select class="select" aria-label=${t("automations.lux_sensor")} @change=${(e: Event) => this.set({ lux_sensor: (e.target as HTMLSelectElement).value })}>
            <option value="" ?selected=${!i.lux_sensor}>${t("auto.none")}</option>
            ${lux.map((id) => html`<option value=${id} ?selected=${id === i.lux_sensor}>${friendlyName(ctx.hass, id)}</option>`)}
          </select>
        </div>
        ${i.lux_sensor
          ? html`<div class="item wrap">
              <ha-icon icon="mdi:weather-night"></ha-icon><div class="grow">${t("automations.lux_below")}</div>
              ${this.stepper(i.lux_below || 0, 0, 1000, 10, "lx", (v) => this.set({ lux_below: v }))}
            </div>`
          : nothing}
        ${this.minutesRow("mdi:timer-off-outline", t("automations.off_after"), t("automations.off_after_motion"), i.off_after, OFF_AFTER, "automations.never", (v) => this.set({ off_after: v }))}
      </div>`;
  }

  // ---- rooms and light ----

  private rooms(d: AutomationDraft) {
    const { ctx } = this;
    const rooms = ctx.home.rooms.filter((g) => g.kind === "area");
    const area = (key: string) => key.slice("area.".length);
    const flip = (id: string) => {
      haptic("selection");
      const current = d.input.rooms;
      this.set({ rooms: current.includes(id) ? current.filter((r) => r !== id) : [...current, id] });
    };
    return html`<div class="chips wrap rooms-pick">
      ${rooms.map((g) => {
        const on = d.input.rooms.includes(area(g.key));
        return html`<button class=${classMap({ chip: true, on })} aria-pressed=${on} @click=${() => flip(area(g.key))}>
          <ha-icon icon=${g.icon}></ha-icon>${g.name}
        </button>`;
      })}
    </div>`;
  }

  private light(d: AutomationDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const kinds = LIGHT_KINDS[d.type];
    const kind = (d.input.light && kinds.includes(d.input.light) ? d.input.light : kinds[0]) as LightKind;
    return html`${this.seg(kinds, kind, (k) => t(`automations.light_${k}` as StringKey), (light) => this.set({ light }), "kinds")}
      ${kind === "scene" ? this.sceneLight(d) : kind === "white" ? this.whiteLight(d) : this.dayLight(d, kind)}`;
  }

  private sceneLight(d: AutomationDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const scenes = d.input.scenes || [];
    const brightness = d.input.brightness ?? null;
    return html`<div class="rows">
      ${d.input.rooms.map((area) => {
        const group = findGroup(ctx.home, `area.${area}`);
        const own = group?.scenes || [];
        const current = own.find((s) => scenes.includes(s.entity_id))?.entity_id || "";
        const pick = (value: string) => {
          const rest = scenes.filter((s) => !own.some((o) => o.entity_id === s));
          this.set({ scenes: value ? [...rest, value] : rest });
        };
        return html`<div class="item wrap">
          <ha-icon icon=${group?.icon || "mdi:sofa-outline"}></ha-icon>
          <div class="grow">${group?.name || area}</div>
          ${own.length
            ? html`<select class="select" aria-label=${group?.name || area} @change=${(e: Event) => pick((e.target as HTMLSelectElement).value)}>
                <option value="" ?selected=${!current}>${t("automations.no_scene")}</option>
                ${own.map((s) => html`<option value=${s.entity_id} ?selected=${s.entity_id === current}>${s.name}</option>`)}
              </select>`
            : html`<span class="dim small">${t("automations.room_no_scenes")}</span>`}
        </div>`;
      })}
      <div class="item wrap">
        <ha-icon icon="mdi:brightness-6"></ha-icon><div class="grow">${t("common.brightness")}</div>
        <select class="select" aria-label=${t("common.brightness")} @change=${(e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          this.set({ brightness: v ? Number(v) : null });
        }}>
          <option value="" ?selected=${brightness === null}>${t("automations.scene_brightness")}</option>
          ${BRIGHTNESS_LEVELS.map((v) => html`<option value=${v} ?selected=${brightness === v}>${v} %</option>`)}
        </select>
      </div>
    </div>`;
  }

  private whiteLight(d: AutomationDraft) {
    const { t } = this.ctx;
    const kelvin = d.input.kelvin || 2700;
    return html`<div class="rows">
      <div class="item wrap">
        <span class="swatch-dot" style="background:${whiteArt(kelvin)}"></span>
        <div class="grow">${t("automations.white")}</div>
        ${this.stepper(kelvin, KELVIN_RANGE[0], KELVIN_RANGE[1], 100, "K", (v) => this.set({ kelvin: v }))}
      </div>
      <div class="item wrap">
        <ha-icon icon="mdi:brightness-6"></ha-icon><div class="grow">${t("common.brightness")}</div>
        ${this.stepper(d.input.brightness || 100, 5, 100, 5, "%", (v) => this.set({ brightness: v }))}
      </div>
    </div>`;
  }

  /** Natural light or the scene of the day: what it shows now, and its settings page. */
  private dayLight(d: AutomationDraft, kind: "natural" | "auto") {
    const { ctx } = this;
    const { t } = ctx;
    const p = this.preview;
    const art = p?.kelvin ? whiteArt(p.kelvin) : p?.scene ? `url("${thumbUrl(p.scene)}") center / cover` : "";
    const what = p?.kelvin ? `${p.kelvin} K` : p?.scene_name || (kind === "auto" ? t("auto.no_scene") : "");
    return html`<p class="lead small">${t(kind === "natural" ? "automations.natural_hint" : "automations.auto_hint")}</p>
      <div class="rows">
        <button class="item" @click=${() => (this.page = "day")}>
          ${art ? html`<span class="thumb" style="background:${art}"></span>` : html`<ha-icon icon="mdi:palette-swatch-variant"></ha-icon>`}
          <div class="grow">${t(kind === "natural" ? "automations.natural_settings" : "automations.auto_settings")}
            <div class="dim small">${[what, this.stateLine(p)].filter(Boolean).join(" · ")}</div>
          </div>
          <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
        </button>
      </div>`;
  }

  /** "Evening · Winter · Gloomy · 80 %". */
  private stateLine(p: DayPreview | null): string {
    const { t } = this.ctx;
    if (!p) return "";
    return [
      t(`auto.phase_${p.pool_phase || p.phase}` as StringKey),
      p.kelvin ? "" : t(`auto.season_${p.season}` as StringKey),
      t(`auto.mood_${p.mood}` as StringKey),
      p.holiday ? t("auto.holiday") : "",
      `${p.brightness} %`,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  // ---- natural light and the scene of the day ----

  private get day(): DayConfig {
    return dayConfig(this.draft?.input.scene_of_the_day);
  }

  private setDay(config: DayConfig): void {
    this.set({ scene_of_the_day: config });
  }

  private leaveDay(): void {
    this.page = "main";
    this.pool = null;
  }

  private dayPage(natural: boolean) {
    const { t } = this.ctx;
    const config = this.day;
    return html`<p class="lead">${t(natural ? "auto.intro_natural" : "auto.intro")}</p>
      ${this.legacyOffer(natural)} ${this.today(natural)}
      ${natural ? html`<h2 class="label">${t("auto.kelvin")}</h2>${this.kelvin(config.settings)}` : html`<h2 class="label">${t("auto.pools")}</h2>${this.pools(config)}`}
      <h2 class="label">${t("auto.phases")}</h2>
      ${this.phases(config.settings)}
      <h2 class="label">${t("auto.brightness")}</h2>
      ${this.brightness(config)}
      <h2 class="label">${t("auto.inputs")}</h2>
      ${this.inputs(config.settings, natural)}
      ${natural ? nothing : html`<h2 class="label">${t("auto.holidays")}</h2>${this.holidays(config)}`}
      ${config.excluded.length && !natural ? html`<h2 class="label">${t("auto.excluded")}</h2>${this.excluded(config)}` : nothing}
      <div class="center"><button class="pill apply" @click=${() => this.leaveDay()}>${t("color.done")}</button></div>`;
  }

  /** The old auto light's settings of one of the rooms, while these are still empty. */
  private legacyOffer(natural: boolean) {
    const { ctx } = this;
    const { t } = ctx;
    const d = this.draft!;
    const empty = !Object.keys(this.day.pools).length && !Object.keys(this.day.settings).length;
    const area = d.input.rooms.find((a) => this.legacy?.[a]);
    if (!empty || !area) return nothing;
    const old = this.legacy![area];
    const use = () => {
      haptic("success");
      this.set({ scene_of_the_day: old.config, light: old.natural ? "natural" : natural ? "natural" : "auto" });
    };
    return html`<div class="rows">
      <button class="item" @click=${use}>
        <ha-icon icon="mdi:history"></ha-icon>
        <div class="grow">${t("automations.legacy", { area: ctx.hass.areas?.[area]?.name || area })}<div class="dim small">${t("automations.legacy_sub")}</div></div>
      </button>
    </div>`;
  }

  private today(natural: boolean) {
    const { ctx } = this;
    const { t } = ctx;
    const d = this.draft!;
    const p = this.preview;
    const show = () =>
      ctx.call(
        "hue_studio",
        "apply_light",
        { area_id: d.input.rooms, light: natural ? "natural" : "auto", scene_of_the_day: this.day, transition: 2 },
        { optimistic: false },
      );
    if (p?.kelvin) {
      return html`<div class="today">
        <span class="pic" style="background:${whiteArt(p.kelvin)}"></span>
        <div class="text">
          <div class="dim small">${t("auto.now")}</div>
          <div class="name">${t("auto.style_natural")} · ${p.kelvin} K</div>
          <div class="dim small">${this.stateLine(p)}</div>
        </div>
        <div class="today-actions"><button class="pill" ?disabled=${!d.input.rooms.length} @click=${show}>${t("auto.show_now")}</button></div>
      </div>`;
    }
    if (!p?.scene) return html`<div class="today empty-today"><ha-icon icon="mdi:palette-swatch-variant"></ha-icon><span>${t("auto.no_scene")}</span></div>`;
    const scene = p.scene;
    return html`<div class="today">
      <img class="pic" src=${thumbUrl(scene)} alt="" />
      <div class="text">
        <div class="dim small">${t("auto.today")}</div>
        <div class="name">${p.scene_name || this.sceneName(scene)}</div>
        <div class="dim small">${this.stateLine(p)}</div>
      </div>
      <div class="today-actions">
        <button class="pill" ?disabled=${!d.input.rooms.length} @click=${show}>${t("auto.show_now")}</button>
        <button class="pill" @click=${() => this.setDay(withExcluded(this.day, scene, true))}>${t("auto.never")}</button>
      </div>
    </div>`;
  }

  private sceneName(id: string): string {
    return this.ctx.gallery?.scenes.find((s) => s.id === id)?.name || id;
  }

  private pools(config: DayConfig) {
    const { ctx } = this;
    const { t } = ctx;
    const p = this.preview;
    // Start where today's scene comes from (the clear pool when there is no gloomy one).
    const phase = p?.pool_phase || "evening";
    const mood = p?.mood === "gloomy" && poolOf(config, { phase, season: "all", step: "gloomy" }).length ? "gloomy" : "clear";
    const key: PoolKey = this.pool || { phase, season: "all", step: phase === "day" ? String(p?.step ?? 2) : mood };
    const set = (patch: Partial<PoolKey>) => {
      const next = { ...key, ...patch };
      if (patch.phase && !stepsOf(next.phase).includes(next.step)) next.step = stepsOf(next.phase)[0];
      haptic("selection");
      this.pool = next;
    };
    const counts = phaseCounts(config);
    const scenes = poolOf(config, key);
    const save = (ids: string[]) => this.setDay(withPool(this.day, key, ids));
    const stepLabel = (step: string) => (key.phase === "day" ? t(`auto.step_${step}` as StringKey) : t(`auto.mood_${step}` as StringKey));
    const chips = <T extends string>(values: readonly T[], current: T, label: (v: T) => string, pick: (v: T) => void) =>
      html`<div class="chips">${values.map((v) => html`<button class=${classMap({ chip: true, on: v === current })} @click=${() => pick(v)}>${label(v)}</button>`)}</div>`;
    return html`<p class="lead">${t("auto.pools_hint")}</p>
      ${chips(PHASES, key.phase, (ph) => `${t(`auto.phase_${ph}` as StringKey)}${counts[ph] ? ` · ${counts[ph]}` : ""}`, (ph) => set({ phase: ph }))}
      ${chips(SEASONS, key.season, (s) => t(`auto.season_${s}` as StringKey), (season) => set({ season }))}
      ${chips(stepsOf(key.phase), key.step, stepLabel, (step) => set({ step }))}
      <p class="lead small">${t(key.phase === "day" ? "auto.steps_hint" : "auto.moods_hint")}</p>
      <div class="scene-tiles">
        ${scenes.map(
          (id) => html`<div class="tile" style="background-image: url(${thumbUrl(id)})">
            <span>${this.sceneName(id)}</span>
            <button class="round mini remove" aria-label=${t("auto.remove_scene")} @click=${() => save(scenes.filter((s) => s !== id))}>${icon("close")}</button>
          </div>`,
        )}
        <button class="tile add-tile" @click=${() => this.openPicker(t("auto.choose_scenes"), scenes, save)}>${icon("plus")}<span>${t("auto.add_scenes")}</span></button>
      </div>`;
  }

  private excluded(config: DayConfig) {
    const { t } = this.ctx;
    return html`<p class="lead">${t("auto.excluded_hint")}</p>
      <div class="scene-tiles">
        ${config.excluded.map(
          (id) => html`<div class="tile dimmed" style="background-image: url(${thumbUrl(id)})">
            <span>${this.sceneName(id)}</span>
            <button class="round mini remove" aria-label=${t("auto.restore_scene")} @click=${() => this.setDay(withExcluded(this.day, id, false))}>${icon("back")}</button>
          </div>`,
        )}
      </div>`;
  }

  private settings(patch: Partial<Record<keyof DaySettings, unknown>>): void {
    this.setDay(withSettings(this.day, patch));
  }

  private phases(settings: DaySettings) {
    const { t } = this.ctx;
    const shifts = { ...DEFAULT_SHIFTS, ...settings.shifts };
    const nightFrom = settings.night_from || DEFAULT_NIGHT_FROM;
    return html`<p class="lead">${t("auto.phases_hint")}</p>
      <div class="rows">
        ${SHIFTS.map(
          (key) => html`<div class="item">
            <ha-icon icon=${PHASE_ICONS[key]}></ha-icon>
            <div class="grow">${t(`auto.phase_${key}` as StringKey)}<div class="dim small">${t(`auto.shift_${key}` as StringKey)}</div></div>
            ${this.stepper(shifts[key], -240, 240, 5, t("automations.min"), (v) => this.settings({ shifts: { ...shifts, [key]: v } }))}
          </div>`,
        )}
        <div class="item">
          <ha-icon icon=${PHASE_ICONS.night}></ha-icon>
          <div class="grow">${t("auto.phase_night")}<div class="dim small">${t("auto.night_from")}</div></div>
          <input class="select time" type="time" .value=${nightFrom} @change=${(e: Event) => {
            const v = (e.target as HTMLInputElement).value;
            if (/^\d\d:\d\d$/.test(v)) this.settings({ night_from: v });
          }} />
        </div>
      </div>`;
  }

  /** Natural light: the white of each phase. */
  private kelvin(settings: DaySettings) {
    const { t } = this.ctx;
    const values = { ...NATURAL_KELVIN, ...settings.kelvin };
    const set = (phase: Phase, value: number) => {
      const next = { ...settings.kelvin, [phase]: value } as Record<string, number>;
      if (value === NATURAL_KELVIN[phase]) delete next[phase];
      this.settings({ kelvin: Object.keys(next).length ? next : null });
    };
    return html`<p class="lead">${t("auto.kelvin_hint")}</p>
      <div class="rows">
        ${PHASES.map(
          (phase) => html`<div class="item">
            <span class="swatch-dot" style="background:${whiteArt(values[phase])}"></span>
            <div class="grow">${t(`auto.phase_${phase}` as StringKey)}</div>
            ${this.stepper(values[phase], KELVIN_RANGE[0], KELVIN_RANGE[1], 100, "K", (v) => set(phase, v))}
          </div>`,
        )}
      </div>`;
  }

  private brightness(config: DayConfig) {
    const { t } = this.ctx;
    const fixed = config.settings.brightness || {};
    const setFixed = (phase: Phase, value: string) => {
      const next = { ...fixed } as Record<string, number>;
      if (value) next[phase] = Number(value);
      else delete next[phase];
      this.settings({ brightness: Object.keys(next).length ? next : null });
    };
    return html`<p class="lead">${t("auto.brightness_hint")}</p>
      <div class="rows">
        ${PHASES.map(
          (phase) => html`<div class="item wrap">
            <ha-icon icon=${PHASE_ICONS[phase]}></ha-icon>
            <div class="grow">${t(`auto.phase_${phase}` as StringKey)}</div>
            <select class="select" aria-label=${t("auto.brightness")} @change=${(e: Event) => setFixed(phase, (e.target as HTMLSelectElement).value)}>
              <option value="" ?selected=${fixed[phase] === undefined}>${t("auto.brightness_curve")}</option>
              ${BRIGHTNESS_LEVELS.map((v) => html`<option value=${v} ?selected=${fixed[phase] === v}>${v} %</option>`)}
            </select>
            ${this.stepper(config.offsets[phase] || 0, -60, 60, 5, "%", (v) => this.setDay(withOffset(this.day, phase, v)), true)}
          </div>`,
        )}
      </div>`;
  }

  private inputs(settings: DaySettings, natural: boolean) {
    const { ctx } = this;
    const { t } = ctx;
    const states = ctx.hass.states;
    const ids = Object.keys(states).sort((a, b) => friendlyName(ctx.hass, a).localeCompare(friendlyName(ctx.hass, b)));
    const weather = ids.filter((id) => id.startsWith("weather."));
    const lux = ids.filter((id) => id.startsWith("sensor.") && states[id].attributes.device_class === "illuminance");
    const seasons = ids.filter((id) => id.startsWith("sensor.") && (SEASON_STATES.includes(states[id].state) || id === settings.season));
    const picker = (key: "weather" | "light_sensor" | "season", options: string[], none: StringKey) =>
      html`<select class="select" aria-label=${t(`auto.input_${key}` as StringKey)} @change=${(e: Event) => this.settings({ [key]: (e.target as HTMLSelectElement).value || null })}>
        <option value="" ?selected=${!settings[key]}>${t(none)}</option>
        ${options.map((id) => html`<option value=${id} ?selected=${settings[key] === id}>${friendlyName(ctx.hass, id)}</option>`)}
      </select>`;
    const modes = html`<select class="select" aria-label=${t("auto.gradient_mode")} @change=${(e: Event) => this.settings({ gradient_mode: (e.target as HTMLSelectElement).value || null })}>
      <option value="" ?selected=${!settings.gradient_mode}>${t("auto.gradient_default")}</option>
      ${GRADIENT_MODES.map((m) => html`<option value=${m} ?selected=${settings.gradient_mode === m}>${t(`auto.gradient_${m}` as StringKey)}</option>`)}
    </select>`;
    return html`<div class="rows">
      <div class="item wrap"><ha-icon icon="mdi:weather-partly-rainy"></ha-icon>
        <div class="grow">${t("auto.input_weather")}<div class="dim small">${t("auto.input_weather_sub")}</div></div>${picker("weather", weather, "auto.none")}</div>
      <div class="item wrap"><ha-icon icon="mdi:brightness-5"></ha-icon>
        <div class="grow">${t("auto.input_light_sensor")}<div class="dim small">${t("auto.input_light_sensor_sub")}</div></div>${picker("light_sensor", lux, "auto.none")}</div>
      <div class="item wrap"><ha-icon icon="mdi:leaf"></ha-icon>
        <div class="grow">${t("auto.input_season")}<div class="dim small">${t("auto.input_season_sub")}</div></div>${picker("season", seasons, "auto.season_by_month")}</div>
      ${natural
        ? nothing
        : html`<div class="item wrap"><ha-icon icon="mdi:gradient-horizontal"></ha-icon>
            <div class="grow">${t("auto.gradient_mode")}<div class="dim small">${t("auto.gradient_mode_sub")}</div></div>${modes}</div>`}
    </div>`;
  }

  private holidays(config: DayConfig) {
    const { ctx } = this;
    const { t } = ctx;
    const lang = ctx.hass.locale?.language || ctx.hass.language || "en";
    const remove = (index: number) => this.setDay({ ...this.day, holidays: config.holidays.filter((_, i) => i !== index) });
    return html`<p class="lead">${t("auto.holidays_hint")}</p>
      <div class="rows">
        ${config.holidays.map(
          (h, index) => html`<div class="item">
            <ha-icon icon="mdi:party-popper"></ha-icon>
            <button class="grow plain" @click=${() => (this.holiday = { index, ...h, phases: [...h.phases], pool: [...h.pool] })}>
              ${monthDay(h.from, lang)} – ${monthDay(h.to, lang)}
              <div class="dim small">${h.phases.map((p) => t(`auto.phase_${p}` as StringKey)).join(", ")} · ${t("automations.scenes_count", { count: h.pool.length })}</div>
            </button>
            <button class="round mini-step" aria-label=${t("auto.remove_holiday")} @click=${() => remove(index)}>${icon("close")}</button>
          </div>`,
        )}
        <button class="item" @click=${() => (this.holiday = { index: null, from: "12-24", to: "12-26", phases: ["evening"], pool: [] })}>
          <ha-icon icon="mdi:plus"></ha-icon><div class="grow">${t("auto.add_holiday")}</div>
        </button>
      </div>`;
  }

  private holidaySheet(draft: HolidayDraft) {
    const { t } = this.ctx;
    const close = () => (this.holiday = null);
    const set = (patch: Partial<HolidayDraft>) => (this.holiday = { ...this.holiday!, ...patch });
    const valid = isMonthDay(draft.from) && isMonthDay(draft.to) && draft.phases.length > 0 && draft.pool.length > 0;
    const save = () => {
      if (!valid) return;
      const entry: Holiday = { from: draft.from, to: draft.to, phases: draft.phases, pool: draft.pool };
      const list = [...this.day.holidays];
      if (draft.index === null) list.push(entry);
      else list[draft.index] = entry;
      this.setDay({ ...this.day, holidays: list });
      close();
    };
    const field = (key: "from" | "to") =>
      html`<input class="field md" maxlength="5" placeholder="MM-DD" aria-label=${t(`auto.holiday_${key}` as StringKey)} .value=${draft[key]}
        @input=${(e: InputEvent) => set({ [key]: (e.target as HTMLInputElement).value.trim() })} />`;
    return html`<div class="sheet" @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="box form holiday-editor" role="dialog" aria-label=${t("auto.holiday")}>
        <div class="sheet-bar"><div class="grow">${t("auto.holiday")}</div>
          <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
        </div>
        <div class="form-body">
          <div class="md-row">${field("from")}<span>–</span>${field("to")}</div>
          <p class="hint">${t("auto.holiday_dates_hint")}</p>
          <div class="chips">
            ${PHASES.map(
              (p) => html`<button class=${classMap({ chip: true, on: draft.phases.includes(p) })}
                @click=${() => set({ phases: draft.phases.includes(p) ? draft.phases.filter((x) => x !== p) : [...draft.phases, p] })}>
                ${t(`auto.phase_${p}` as StringKey)}
              </button>`,
            )}
          </div>
          <div class="scene-tiles small">
            ${draft.pool.map((id) => html`<div class="tile" style="background-image: url(${thumbUrl(id)})"><span>${this.sceneName(id)}</span></div>`)}
            <button class="tile add-tile" @click=${() => this.openPicker(t("auto.choose_scenes"), draft.pool, (ids) => set({ pool: ids }))}>
              ${icon("plus")}<span>${t("auto.add_scenes")}</span>
            </button>
          </div>
        </div>
        <div class="actions"><button class="pill apply" ?disabled=${!valid} @click=${save}>${t("zone.save")}</button></div>
      </div>
    </div>`;
  }

  private openPicker(title: string, selected: string[], save: (ids: string[]) => void): void {
    this.picker = { title, selected: [...selected], query: "", save };
  }

  private pickerSheet(picker: Picker) {
    const { ctx } = this;
    const { t } = ctx;
    const close = () => (this.picker = null);
    const flip = (id: string) => {
      haptic("selection");
      const current = this.picker!.selected;
      this.picker = { ...this.picker!, selected: current.includes(id) ? current.filter((s) => s !== id) : [...current, id] };
    };
    const q = normalize(picker.query);
    const scenes = (ctx.gallery?.scenes || []).filter((s) => !q || normalize(s.name).includes(q));
    return html`<div class="sheet" @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="box form picker" role="dialog" aria-label=${picker.title}>
        <div class="sheet-bar"><div class="grow">${picker.title}</div>
          <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
        </div>
        <div class="form-body">
          <input class="field" placeholder=${t("gallery.search")} aria-label=${t("gallery.search")} .value=${picker.query}
            @input=${(e: InputEvent) => (this.picker = { ...this.picker!, query: (e.target as HTMLInputElement).value })} />
        </div>
        <div class="scene-tiles picker-grid">
          ${scenes.map(
            (s) => html`<button class=${classMap({ tile: true, on: picker.selected.includes(s.id) })} style="background-image: url(${thumbUrl(s.id)})"
              role="checkbox" aria-checked=${picker.selected.includes(s.id)} @click=${() => flip(s.id)}>
              <span>${s.name}</span><i class="check">${icon("check")}</i>
            </button>`,
          )}
        </div>
        <div class="actions">
          <button class="pill apply" @click=${() => {
            picker.save(this.picker!.selected);
            close();
          }}>${t("auto.use_scenes", { count: picker.selected.length })}</button>
        </div>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-automation-edit-view": AutomationEditView;
  }
}
