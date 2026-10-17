// One automation, edited like in the Hue app: its name, when (per type), rooms/zones and light.
// Natural light and the scene of the day have a second page with what this automation adds to
// the global light of the day (Settings → Light of the day): extra and skipped scenes, its own
// phase times, brightness, the white of each phase; everything stays a draft until "Save"
// writes the automation into Home Assistant (HA's automation config API), which stores and
// runs it.

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import {
  allDayDraft,
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
  placesOf,
  offsetMinutes,
  splitPlaces,
  type StartKind,
  toConfig,
  TYPE_ICONS,
  WEEKDAYS,
  type Weekday,
} from "../automations.ts";
import { whiteArt } from "../color.ts";
import {
  dayConfig,
  GRADIENT_MODES,
  hasOwnPhases,
  isLegacy,
  KELVIN_RANGE,
  NATURAL_KELVIN,
  PHASES,
  phaseTimes,
  splitLegacy,
  withExcluded,
  withIncluded,
  withOffset,
  withOwnPhases,
  withSettings,
} from "../daylight.ts";
import { thumbUrl } from "../gallery-data.ts";
import { haptic, leavePanel } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import { findGroup, friendlyName } from "../model.ts";
import type { DayConfig, DayPreview, DaySettings, Phase } from "../types.ts";
import { icon, toggle } from "../ui.ts";
import { StudioView } from "./base.ts";
import { navRow, several, single, timeRow } from "./choice.ts";
import { PHASE_ICONS, type Picker, phaseRows, pickerSheet, stateLine } from "./day-parts.ts";

const FADES = [0, 1, 5, 10, 15, 20, 30, 45, 60, 90];
const OFF_AFTER = [0, 1, 2, 5, 10, 15, 20, 30, 45, 60, 120, 240];
const BRIGHTNESS_LEVELS = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
/** Minutes before (−) or after sunrise or sunset. */
const OFFSETS = [-120, -90, -60, -45, -30, -20, -15, -10, -5, 0, 5, 10, 15, 20, 30, 45, 60, 90, 120];
const LUX = [5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 1000];
/** Common whites, from candlelight to daylight. */
const WHITES = [2000, 2200, 2500, 2700, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500].filter((k) => k >= KELVIN_RANGE[0] && k <= KELVIN_RANGE[1]);
/** A phase's brightness, brighter or dimmer. */
const OFFSET_STEPS = [-60, -50, -40, -30, -20, -15, -10, -5, 0, 5, 10, 15, 20, 30, 40, 50, 60];
const LIGHT_ICONS: Record<LightKind, string> = {
  scene: "mdi:palette-outline",
  white: "mdi:lightbulb-outline",
  natural: "mdi:white-balance-sunny",
  auto: "mdi:image-filter-hdr",
};
type Legacy = Record<string, { natural: boolean; config: DayConfig }>;

@customElement("hue-studio-automation-edit-view")
export class AutomationEditView extends StudioView {
  /** The config id of the automation, or null for a new one (`newType`). */
  @property() accessor automationId: string | null = null;
  @property() accessor newType: string | null = null;
  /** The room or zone a new automation starts with (a group key, or an area id), from its screen. */
  @property() accessor room: string | null = null;
  /** `all_day`: a new all-day scene (a schedule showing the scene of the day). */
  @property() accessor preset: string | null = null;
  /** A new motion automation started from a sensor's settings: its motion and light level sensors. */
  @property() accessor sensor: string | null = null;
  @property() accessor lux: string | null = null;
  /** Where "back" and saving leave the panel for (the page its more-info sheet was on). */
  @property() accessor exitPath: string | null = null;

  @state() private accessor draft: AutomationDraft | null = null;
  @state() private accessor page: "main" | "day" = "main";
  @state() private accessor confirmDelete = false;
  @state() private accessor saving = false;
  @state() private accessor preview: DayPreview | null = null;
  @state() private accessor legacy: Legacy | null = null;
  @state() private accessor picker: Picker | null = null;
  @state() private accessor editingName = false;
  private previewKey = "";
  private legacyAsked = false;

  private get isNew(): boolean {
    return !this.automationId;
  }

  /** The group key of `room` (dashboards' cards pass a bare area id). */
  private get roomKey(): string | null {
    return this.room ? (this.room.includes(".") ? this.room : `area.${this.room}`) : null;
  }

  /** Where "back" and saving lead: the page or the room or zone it came from, else the tab. */
  private leave(): void {
    if (this.exitPath) return leavePanel(this.exitPath);
    const key = this.roomKey;
    this.ctx.go(key && findGroup(this.ctx.home, key) ? `/room/${encodeURIComponent(key)}` : "/automations");
  }

  protected override willUpdate(): void {
    if (this.draft) return;
    const { ctx } = this;
    if (this.newType && isType(this.newType)) {
      const key = this.roomKey;
      const places = key && findGroup(ctx.home, key) ? [key] : [];
      this.draft =
        this.preset === "all_day" && this.newType === "schedule"
          ? allDayDraft(ctx.t("add.all_day"), places)
          : newDraft(this.newType, ctx.t(`automations.type_${this.newType}` as StringKey), places);
      if (this.newType === "motion" && this.sensor && ctx.hass.states[this.sensor]) {
        const lux = this.lux && ctx.hass.states[this.lux] ? { lux_sensor: this.lux } : {};
        this.draft = { ...this.draft, input: { ...this.draft.input, motion: [this.sensor], ...lux } };
      }
    } else if (this.automationId) {
      const entity = ctx.automationEntity(this.automationId);
      const config = entity ? ctx.automationConfigs[entity] : undefined;
      if (config) this.draft = fromConfig(config);
      // From before 0.10: its pools go global (the context moves them), the rest stays.
      const day = this.draft?.input.scene_of_the_day;
      if (this.draft && isLegacy(day)) this.draft = { ...this.draft, input: { ...this.draft.input, scene_of_the_day: splitLegacy(day!).local } };
    }
  }

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    super.updated(changed);
    const d = this.draft;
    const light = d?.input.light;
    if (!d || !LIGHT_KINDS[d.type].length || (light !== "natural" && light !== "auto")) return;
    // Again when the global light of the day changes (pool, phase times, mood).
    const global = this.ctx.daylight;
    const key = JSON.stringify([light, d.input.scene_of_the_day || {}, global?.now, global?.settings, global?.user_tags]);
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

  protected override renderPage() {
    const { ctx } = this;
    const { t } = ctx;
    const d = this.draft;
    const back = () => (this.page === "day" ? this.leaveDay() : this.leave());
    if (!d) {
      const entity = this.automationId ? ctx.automationEntity(this.automationId) : null;
      const loading = !ctx.automations || (entity && ctx.automationConfigsRead !== ctx.automations);
      if (loading || !entity || !this.automationId)
        return this.screen(this.subHead(t("automations.title"), back), html`<p class="empty">${t(loading ? "rooms.loading" : "automations.not_found")}</p>`);
      // It exists, but its config can't be read here (not an admin, or kept outside HA's automations.yaml).
      const id = this.automationId;
      return this.screen(
        this.subHead(friendlyName(ctx.hass, entity), back),
        html`<p class="empty">${t("automations.not_readable")}</p>
          <div class="center"><button class="pill" @click=${() => ctx.openHa(`/config/automation/edit/${encodeURIComponent(id)}`)}>${t("automations.open_ha")}</button></div>`,
        "settings-page automation-page",
      );
    }
    if (this.page === "day") {
      const natural = d.input.light === "natural";
      return html`${this.screen(this.subHead(t(natural ? "automations.light_natural" : "automations.light_auto"), back), this.dayPage(natural), "settings-page auto-page")}
        ${this.picker ? pickerSheet(ctx, this.picker, (picker) => (this.picker = picker)) : nothing}`;
    }
    const typeName = t(`automations.type_${d.type}` as StringKey);
    const lacking = missing(d);
    return this.screen(
      this.subHead(this.isNew ? t("automations.new") : typeName, back),
      html`${this.hero(d, typeName)}
        <h2 class="label">${t("automations.when")}</h2>
        ${this.when(d)}
        <h2 class="label">${t(ctx.home.zones.length ? "automations.rooms_zones" : "automations.rooms")}</h2>
        <div class="rows">${this.rooms(d)}</div>
        ${LIGHT_KINDS[d.type].length ? html`<h2 class="label">${t("automations.light")}</h2>${this.light(d)}` : nothing}
        <div class="save-area">
          <button class="pill apply" ?disabled=${!!lacking || this.saving} @click=${() => this.save()}>${t(this.isNew ? "automations.create" : "zone.save")}</button>
          ${lacking ? html`<p class="lead small warn">${t(`automations.missing_${lacking}` as StringKey)}</p>` : nothing}
        </div>
        ${this.isNew
          ? nothing
          : html`<div class="rows">
                <button class="item nav" @click=${() => ctx.openHa(`/config/automation/edit/${encodeURIComponent(d.id)}`)}>
                  <ha-icon icon="mdi:home-assistant"></ha-icon><div class="grow">${t("automations.open_ha")}</div>${icon("open")}
                </button>
              </div>
              <div class="delete-area">
                <button class=${classMap({ "delete-btn": true, confirm: this.confirmDelete })} @click=${() => this.deleteIt()}>
                  ${t(this.confirmDelete ? "automations.delete_confirm" : "automations.delete")}
                </button>
              </div>`}`,
      "settings-page automation-page",
    );
  }

  /** Its picture and name (renamed in place), and its type when the name is another. */
  private hero(d: AutomationDraft, typeName: string) {
    const { t } = this.ctx;
    const done = (e: Event) => {
      this.editingName = false;
      const alias = (e.target as HTMLInputElement).value.trim();
      if (alias !== d.alias) this.draft = { ...d, alias };
    };
    return html`<div class="sensor-hero">
      <ha-icon class="pic" icon=${TYPE_ICONS[d.type]}></ha-icon>
      <div class="name-row">
        ${this.editingName || !d.alias
          ? html`<input class="name-input" .value=${d.alias} placeholder=${t("automations.name")} aria-label=${t("automations.name")}
              @keydown=${(e: KeyboardEvent) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} @blur=${done}
              @input=${(e: InputEvent) => (this.draft = { ...d, alias: (e.target as HTMLInputElement).value })} />`
          : html`<h1 class="big">${d.alias}</h1>`}
        <button class="round rename" aria-label=${t("automations.rename")} @click=${() => {
          this.editingName = true;
          void this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".name-input")?.focus());
        }}>${icon("pencil")}</button>
      </div>
      ${d.alias && d.alias !== typeName ? html`<div class="kind">${typeName}</div>` : nothing}
    </div>`;
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
      this.leave();
    }
  }

  private async deleteIt(): Promise<void> {
    if (!this.confirmDelete) {
      this.confirmDelete = true;
      haptic("warning");
      return;
    }
    if (!(await this.ctx.deleteAutomation(this.draft!.id))) return;
    if (this.exitPath) leavePanel(this.exitPath);
    else this.ctx.go("/automations");
  }

  // ---- rows ----

  /** "30 min", or `zero` for 0. */
  private minutes(v: number, zero: StringKey): string {
    const { t } = this.ctx;
    return v ? `${v} ${t("automations.min")}` : t(zero);
  }

  /** A row choosing minutes out of `options` (the current value joins them when it is another). */
  private minutesRow(glyph: string, title: string, sub: string, value: number | undefined, options: number[], zero: StringKey, change: (v: number) => void) {
    const current = value ?? 0;
    const values = options.includes(current) ? options : [...options, current].sort((a, b) => a - b);
    return navRow({ icon: glyph, title, sub, value: this.minutes(current, zero) }, () =>
      this.choose(single(title, values.map((v) => ({ value: String(v), label: this.minutes(v, zero) })), String(current), (v) => change(Number(v)))),
    );
  }

  private toggleRow(glyph: string, label: string, sub: string, on: boolean, change: (v: boolean) => void) {
    return html`<div class="item">
      <ha-icon icon=${glyph}></ha-icon>
      <div class="grow">${label}${sub ? html`<div class="dim small">${sub}</div>` : nothing}</div>
      ${toggle(on, label, () => {
        haptic("selection");
        change(!on);
      })}
    </div>`;
  }

  private time(glyph: string, title: string, value: string | undefined, change: (v: string) => void, sub = "") {
    return timeRow({ icon: glyph, title, sub }, hhmm(value), (v) => change(`${v}:00`));
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
    const summary =
      days.length === 7
        ? t("automations.every_day")
        : days.length === 5 && !days.includes("sat") && !days.includes("sun")
          ? t("automations.weekdays")
          : days.length === 2 && days.includes("sat") && days.includes("sun")
            ? t("automations.weekend")
            : "";
    return html`<div class="item days-item">
      <div class="line"><span>${t("automations.repeat")}</span><span class="dim">${summary}</span></div>
      <div class="days-row">
        ${WEEKDAYS.map(
          (day) => html`<button class=${classMap({ on: days.includes(day) })} aria-pressed=${days.includes(day)} @click=${() => flip(day)}>
            ${t(`automations.day_${day}` as StringKey)}
          </button>`,
        )}
      </div>
    </div>`;
  }

  /** "15 min before", "Exactly then", "30 min after". */
  private offsetLabel(minutes: number): string {
    const { t } = this.ctx;
    if (!minutes) return t("automations.offset_exact");
    return t(minutes < 0 ? "automations.offset_before" : "automations.offset_after", { n: Math.abs(minutes) });
  }

  /** A start or an end: its kind (a time, sunrise or sunset), then the time or the offset. */
  private moment<K extends string>(
    title: string,
    kinds: readonly K[],
    kind: K,
    time: string | undefined,
    offset: Duration | undefined,
    set: (patch: { kind?: K; time?: string; offset?: Duration }) => void,
  ) {
    const { t } = this.ctx;
    const sun = kind === "sunrise" || kind === "sunset";
    const label = (k: K) => t((k === "none" ? "automations.none" : `automations.kind_${k}`) as StringKey);
    const glyph = (k: K) => (k === "sunrise" ? "mdi:weather-sunset-up" : k === "sunset" ? "mdi:weather-sunset-down" : k === "none" ? "mdi:minus-circle-outline" : "mdi:clock-outline");
    const kindRow = navRow({ icon: glyph(kind), title, value: label(kind) }, () =>
      this.choose(single(title, kinds.map((k) => ({ value: k, label: label(k), icon: glyph(k) })), kind, (k) => set({ kind: k as K }))),
    );
    if (kind === "none") return kindRow;
    if (!sun) return html`${kindRow}${this.time("mdi:clock-time-four-outline", t("automations.time"), time, (v) => set({ time: v }))}`;
    const minutes = offsetMinutes(offset);
    const values = OFFSETS.includes(minutes) ? OFFSETS : [...OFFSETS, minutes].sort((a, b) => a - b);
    return html`${kindRow}
      ${navRow({ icon: "mdi:timer-outline", title: t("automations.offset"), value: this.offsetLabel(minutes) }, () =>
        this.choose(single(t("automations.offset"), values.map((v) => ({ value: String(v), label: this.offsetLabel(v) })), String(minutes), (v) => set({ offset: offsetDuration(Number(v)) }))),
      )}`;
  }

  private zones(d: AutomationDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const zones = Object.keys(ctx.hass.states).filter((id) => id.startsWith("zone."));
    if (zones.length < 2) return nothing;
    const current = d.input.zone || "zone.home";
    return navRow({ icon: "mdi:map-marker-radius-outline", title: t("automations.zone"), value: friendlyName(ctx.hass, current) }, () =>
      this.choose(
        single(t("automations.zone"), zones.map((id) => ({ value: id, label: friendlyName(ctx.hass, id), icon: "mdi:map-marker-radius-outline" })), current, (zone) => this.set({ zone })),
      ),
    );
  }

  // ---- when ----

  private when(d: AutomationDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const i = d.input;
    const start = (p: { kind?: StartKind; time?: string; offset?: Duration }) =>
      this.set({ ...(p.kind ? { start_kind: p.kind } : {}), ...(p.time ? { start_time: p.time } : {}), ...(p.offset ? { start_offset: p.offset } : {}) });
    switch (d.type) {
      case "wake_up":
        return html`<div class="rows">
          ${this.time("mdi:alarm", t("automations.wake_time"), i.time, (time) => this.set({ time }))}
          ${this.days(d)}
          ${this.minutesRow("mdi:transition", t("automations.fade_in"), t("automations.fade_in_sub"), i.fade, FADES, "automations.instantly", (fade) => this.set({ fade }))}
          ${this.minutesRow("mdi:lightbulb-off-outline", t("automations.off_after"), t("automations.off_after_wake"), i.off_after, OFF_AFTER, "automations.never", (v) => this.set({ off_after: v }))}
        </div>`;
      case "go_to_sleep":
        return html`<div class="rows">
          ${this.time("mdi:bed-clock", t("automations.time"), i.time, (time) => this.set({ time }))}
          ${this.days(d)}
          ${this.minutesRow("mdi:transition", t("automations.fade_out"), t("automations.fade_out_sub"), i.fade, FADES, "automations.instantly", (fade) => this.set({ fade }))}
        </div>`;
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
          <div class="rows">
            ${this.moment(t("automations.start"), ["time", "sunset"] as const, i.start_kind === "sunset" ? "sunset" : "time", i.start_time, i.start_offset, start)}
            ${this.time("mdi:clock-end", t("automations.end"), i.end_time, (end_time) => this.set({ end_time }))}
            ${this.days(d)}
          </div>
          <div class="rows">
            ${this.zones(d)}
            ${this.toggleRow("mdi:home-off-outline", t("automations.only_away"), t("automations.only_away_sub"), i.only_away !== false, (v) => this.set({ only_away: v }))}
          </div>`;
      case "schedule":
        return html`<div class="rows">
          ${this.moment(t("automations.start"), ["time", "sunrise", "sunset"] as const, (i.start_kind || "time") as StartKind, i.start_time, i.start_offset, start)}
          ${this.moment(t("automations.end"), ["none", "time", "sunrise", "sunset"] as const, (i.end_kind || "none") as EndKind, i.end_time, i.end_offset, (p) =>
            this.set({ ...(p.kind ? { end_kind: p.kind } : {}), ...(p.time ? { end_time: p.time } : {}), ...(p.offset ? { end_offset: p.offset } : {}) }))}
          ${this.days(d)}
          ${this.minutesRow("mdi:transition", t("automations.fade"), t("automations.fade_sub"), i.fade, FADES, "automations.instantly", (fade) => this.set({ fade }))}
        </div>`;
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
    const chosen = (i.motion || []).filter((id) => states[id]);
    const area = (id: string) => {
      const entry = ctx.hass.entities?.[id];
      const areaId = entry?.area_id || (entry?.device_id ? ctx.hass.devices?.[entry.device_id]?.area_id : null);
      return (areaId && ctx.hass.areas?.[areaId]?.name) || "";
    };
    const pickSensors = () =>
      this.choose(
        several(
          t("automations.motion_sensors"),
          sensors.map((id) => ({ value: id, label: friendlyName(ctx.hass, id), sub: area(id), icon: "mdi:motion-sensor" })),
          chosen,
          (motion) => this.set({ motion }),
          { hint: sensors.length ? t("automations.motion_hint") : t("automations.no_motion_sensors") },
        ),
      );
    const below = i.lux_below || 0;
    const luxValues = LUX.includes(below) ? LUX : [...LUX, below].sort((a, b) => a - b);
    return html`<div class="rows">
      ${navRow(
        {
          icon: "mdi:motion-sensor",
          title: t("automations.motion_sensors"),
          sub: chosen.length ? chosen.map((id) => friendlyName(ctx.hass, id)).join(", ") : t("automations.motion_none"),
          warn: !chosen.length,
        },
        pickSensors,
      )}
      ${this.minutesRow("mdi:timer-off-outline", t("automations.off_after"), t("automations.off_after_motion"), i.off_after, OFF_AFTER, "automations.never", (v) => this.set({ off_after: v }))}
    </div>
    <div class="rows">
      ${navRow(
        { icon: "mdi:brightness-5", title: t("automations.lux_sensor"), sub: t("automations.lux_sensor_sub"), value: i.lux_sensor ? friendlyName(ctx.hass, i.lux_sensor) : t("auto.none") },
        () =>
          this.choose(
            single(
              t("automations.lux_sensor"),
              [{ value: "", label: t("auto.none") }, ...lux.map((id) => ({ value: id, label: friendlyName(ctx.hass, id), sub: area(id), icon: "mdi:brightness-5" }))],
              i.lux_sensor || "",
              (lux_sensor) => this.set({ lux_sensor }),
            ),
          ),
      )}
      ${i.lux_sensor
        ? navRow({ icon: "mdi:weather-night", title: t("automations.lux_below"), value: `${below} lx` }, () =>
            this.choose(single(t("automations.lux_below"), luxValues.map((v) => ({ value: String(v), label: `${v} lx` })), String(below), (v) => this.set({ lux_below: Number(v) }))),
          )
        : nothing}
    </div>`;
  }

  // ---- rooms and light ----

  /** Rooms (HA areas) and zones (Hue rooms/zones no area holds), as on the home screen. */
  private rooms(d: AutomationDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const places = placesOf(d.input);
    const groups = [...ctx.home.rooms, ...ctx.home.zones];
    const chosen = groups.filter((g) => places.includes(g.key));
    const title = t(ctx.home.zones.length ? "automations.rooms_zones" : "automations.rooms");
    const options = groups.map((g) => ({
      value: g.key,
      label: g.name,
      icon: g.icon,
      sub: ctx.home.zones.includes(g) ? t("automations.zone_kind") : undefined,
    }));
    // Places no longer on the home screen stay chosen until unticked (they are listed last).
    const gone = places.filter((k) => !groups.some((g) => g.key === k));
    const goneOptions = gone.map((k) => ({ value: k, label: t("automations.place_gone"), sub: k.slice(k.indexOf(".") + 1), icon: "mdi:help-circle-outline" }));
    return navRow(
      {
        icon: chosen[0]?.icon || "mdi:sofa-outline",
        title: chosen.length ? chosen.map((g) => g.name).join(", ") : t("automations.rooms_none"),
        warn: !chosen.length || !!gone.length,
        sub: !chosen.length ? t("automations.missing_rooms") : gone.length ? t("automations.place_gone") : undefined,
      },
      () => this.choose(several(title, [...options, ...goneOptions], places, (keys) => this.set(splitPlaces(keys)))),
    );
  }

  private light(d: AutomationDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const kinds = LIGHT_KINDS[d.type];
    const kind = (d.input.light && kinds.includes(d.input.light) ? d.input.light : kinds[0]) as LightKind;
    const options = kinds.map((k) => ({ value: k, label: t(`automations.light_${k}` as StringKey), sub: t(`automations.light_${k}_sub` as StringKey), icon: LIGHT_ICONS[k] }));
    return html`<div class="rows">
      ${navRow({ icon: LIGHT_ICONS[kind], title: t("automations.light_kind"), value: t(`automations.light_${kind}` as StringKey) }, () =>
        this.choose(single(t("automations.light_kind"), options, kind, (light) => this.set({ light: light as LightKind }))),
      )}
      ${kind === "scene" ? this.sceneLight(d) : kind === "white" ? this.whiteLight(d) : this.dayLight(d, kind)}
    </div>`;
  }

  private brightnessRow(value: number | null, change: (v: number | null) => void, own?: StringKey) {
    const { t } = this.ctx;
    const label = (v: number | null) => (v === null ? t(own!) : `${v} %`);
    const options = [...(own ? [null] : []), ...[...BRIGHTNESS_LEVELS].reverse()].map((v) => ({ value: v === null ? "" : String(v), label: label(v) }));
    return navRow({ icon: "mdi:brightness-6", title: t("common.brightness"), value: label(value) }, () =>
      this.choose(single(t("common.brightness"), options, value === null ? "" : String(value), (v) => change(v ? Number(v) : null))),
    );
  }

  private sceneLight(d: AutomationDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const scenes = d.input.scenes || [];
    return html`${placesOf(d.input).map((key) => {
        const group = findGroup(ctx.home, key);
        // A place with no Hue lights left is not on the home screen: its HA name, or that it is gone.
        const id = key.slice(key.indexOf(".") + 1);
        const known = group?.name || (key.startsWith("area.") ? ctx.hass.areas?.[id]?.name : ctx.hass.states[id] ? friendlyName(ctx.hass, id) : "");
        const name = known || t("automations.place_gone");
        const own = group?.scenes || [];
        const current = own.find((s) => scenes.includes(s.entity_id));
        const pick = (value: string) => {
          const rest = scenes.filter((s) => !own.some((o) => o.entity_id === s));
          this.set({ scenes: value ? [...rest, value] : rest });
        };
        if (!own.length)
          return html`<div class="item">
            <ha-icon icon=${group?.icon || (known ? "mdi:sofa-outline" : "mdi:help-circle-outline")}></ha-icon>
            <div class="grow">${name}<div class=${classMap({ "dim small": true, warn: !known })}>${known ? t("automations.room_no_scenes") : t("automations.place_gone_sub", { id })}</div></div>
          </div>`;
        return navRow({ icon: group?.icon || "mdi:sofa-outline", title: name, value: current?.name || t("automations.no_scene") }, () =>
          this.choose(
            single(
              name,
              [{ value: "", label: t("automations.no_scene") }, ...own.map((s) => ({ value: s.entity_id, label: s.name, icon: "mdi:palette-outline" }))],
              current?.entity_id || "",
              pick,
            ),
          ),
        );
      })}
      ${this.brightnessRow(d.input.brightness ?? null, (brightness) => this.set({ brightness }), "automations.scene_brightness")}`;
  }

  /** A row choosing a white out of the common ones (the current one joins them). */
  private whiteRow(title: string, kelvin: number, change: (v: number) => void, glyph?: string) {
    const values = WHITES.includes(kelvin) ? WHITES : [...WHITES, kelvin].sort((a, b) => a - b);
    return navRow({ ...(glyph ? { icon: glyph } : { art: whiteArt(kelvin) }), title, value: `${kelvin} K` }, () =>
      this.choose(
        single(
          title,
          values.map((v) => ({ value: String(v), label: `${v} K`, art: whiteArt(v) })),
          String(kelvin),
          (v) => change(Number(v)),
          this.ctx.t("auto.kelvin_hint"),
        ),
      ),
    );
  }

  private whiteLight(d: AutomationDraft) {
    const { t } = this.ctx;
    return html`${this.whiteRow(t("automations.white"), d.input.kelvin || 2700, (kelvin) => this.set({ kelvin }))}
      ${this.brightnessRow(d.input.brightness || 100, (v) => this.set({ brightness: v ?? 100 }))}`;
  }

  /** Natural light or the scene of the day: what it shows now, and its settings page. */
  private dayLight(d: AutomationDraft, kind: "natural" | "auto") {
    const { t } = this.ctx;
    const p = this.preview;
    const art = p?.kelvin ? whiteArt(p.kelvin) : p?.scene ? `url("${thumbUrl(p.scene)}") center / cover` : "";
    const what = p?.kelvin ? `${p.kelvin} K` : p?.scene_name || (kind === "auto" ? t("auto.no_scene") : "");
    return html`<button class="item nav" @click=${() => {
        this.pushPage();
        this.page = "day";
      }}>
        ${art ? html`<span class="thumb" style="background:${art}"></span>` : html`<ha-icon icon="mdi:palette-swatch-variant"></ha-icon>`}
        <div class="grow">${t(kind === "natural" ? "automations.natural_settings" : "automations.auto_settings")}
          <div class="dim small">${[what, stateLine(t, p)].filter(Boolean).join(" · ")}</div>
        </div>
        <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
      </button>`;
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
    this.popPage();
  }

  private dayPage(natural: boolean) {
    const { t } = this.ctx;
    const config = this.day;
    return html`<p class="lead">${t(natural ? "auto.intro_natural" : "auto.intro")}</p>
      ${this.legacyOffer(natural)} ${this.today(natural)}
      ${natural ? html`<h2 class="label">${t("auto.kelvin")}</h2>${this.kelvin(config.settings)}` : this.scenes(config)}
      <h2 class="label">${t("auto.phases")}</h2>
      ${this.phases(config)}
      <h2 class="label">${t("auto.brightness")}</h2>
      ${this.brightness(config)}
      ${natural ? nothing : html`<h2 class="label">${t("auto.more")}</h2>${this.gradient(config.settings)}`}
      <div class="save-area"><button class="pill apply" @click=${() => this.leaveDay()}>${t("color.done")}</button></div>`;
  }

  /** The old auto light's settings of one of the rooms, while these are still empty. */
  private legacyOffer(natural: boolean) {
    const { ctx } = this;
    const { t } = ctx;
    const d = this.draft!;
    const day = this.day;
    const empty = !day.include.length && !day.exclude.length && !Object.keys(day.settings).length;
    const area = d.input.rooms.find((a) => this.legacy?.[a]);
    if (!empty || !area) return nothing;
    const old = this.legacy![area];
    const use = async () => {
      haptic("success");
      // Its pools join the global pool, its sources the global settings (unless set).
      const { local, pools, holidays, sources } = splitLegacy(old.config);
      await ctx.query({ type: "hue_studio/daylight/merge", pools, holidays }, { quiet: true });
      const missing = Object.fromEntries(Object.entries(sources).filter(([key]) => !ctx.daylight?.settings[key as keyof typeof sources]));
      if (Object.keys(missing).length) await ctx.setDaylight(missing);
      this.set({ scene_of_the_day: local, light: old.natural || natural ? "natural" : "auto" });
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
        { area_id: d.input.rooms, entity_id: d.input.zones || [], light: natural ? "natural" : "auto", scene_of_the_day: this.day, transition: 2 },
        { optimistic: false },
      );
    if (p?.kelvin) {
      return html`<div class="today">
        <span class="pic" style="background:${whiteArt(p.kelvin)}"></span>
        <div class="text">
          <div class="dim small">${t("auto.now")}</div>
          <div class="name">${t("auto.style_natural")} · ${p.kelvin} K</div>
          <div class="dim small">${stateLine(t, p)}</div>
        </div>
        <div class="today-actions"><button class="pill" ?disabled=${!placesOf(d.input).length} @click=${show}>${t("auto.show_now")}</button></div>
      </div>`;
    }
    if (!p?.scene) return html`<div class="today empty-today"><ha-icon icon="mdi:palette-swatch-variant"></ha-icon><span>${t("auto.no_scene")}</span></div>`;
    const scene = p.scene;
    return html`<div class="today">
      <img class="pic" src=${thumbUrl(scene)} alt="" />
      <div class="text">
        <div class="dim small">${t("auto.today")}</div>
        <div class="name">${p.scene_name || this.sceneName(scene)}</div>
        <div class="dim small">${stateLine(t, p)}</div>
      </div>
      <div class="today-actions">
        <button class="pill" ?disabled=${!placesOf(d.input).length} @click=${show}>${t("auto.show_now")}</button>
        <button class="pill" @click=${() => this.setDay(withExcluded(this.day, scene, true))}>${t("auto.never")}</button>
      </div>
    </div>`;
  }

  private sceneName(id: string): string {
    return this.ctx.gallery?.scenes.find((s) => s.id === id)?.name || id;
  }

  /** The global pool (a link to its settings), this automation's extra and skipped scenes. */
  private scenes(config: DayConfig) {
    const { ctx } = this;
    const { t } = ctx;
    const global = ctx.daylight;
    const count = global ? Object.keys(global.tags).length : 0;
    const mood = global?.now.mood;
    const tiles = (ids: string[], action: (id: string) => void, label: StringKey, glyph: "close" | "back", dimmed = false) =>
      ids.map(
        (id) => html`<div class=${classMap({ tile: true, dimmed })} style="background-image: url(${thumbUrl(id)})">
          <span>${this.sceneName(id)}</span>
          <button class="round mini remove" aria-label=${t(label)} @click=${() => action(id)}>${icon(glyph)}</button>
        </div>`,
      );
    const add = () =>
      this.openPicker(t("auto.choose_scenes"), config.include, (ids) =>
        this.setDay({ ...config, include: ids, exclude: config.exclude.filter((s) => !ids.includes(s)) }),
      );
    return html`<h2 class="label">${t("auto.scenes")}</h2>
      <p class="lead">${t("auto.scenes_hint")}</p>
      <div class="rows">
        <button class="item" @click=${() => ctx.go("/settings/daylight")}>
          <ha-icon icon="mdi:palette-swatch-variant"></ha-icon>
          <div class="grow">${t("daylight.title")}
            <div class="dim small">${[t("daylight.pool_count", { count }), mood ? t(`auto.mood_${mood}` as StringKey) : ""].filter(Boolean).join(" · ")}</div>
          </div>
          <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
        </button>
      </div>
      <h2 class="label">${t("auto.extra")}</h2>
      <p class="lead">${t("auto.extra_hint")}</p>
      <div class="scene-tiles">
        ${tiles(config.include, (id) => this.setDay(withIncluded(this.day, id, false)), "auto.remove_scene", "close")}
        <button class="tile add-tile" @click=${add}>${icon("plus")}<span>${t("auto.add_scenes")}</span></button>
      </div>
      ${config.exclude.length
        ? html`<h2 class="label">${t("auto.excluded")}</h2>
            <p class="lead">${t("auto.excluded_hint")}</p>
            <div class="scene-tiles">${tiles(config.exclude, (id) => this.setDay(withExcluded(this.day, id, false)), "auto.restore_scene", "back", true)}</div>`
        : nothing}`;
  }

  private settings(patch: Partial<Record<keyof DaySettings, unknown>>): void {
    this.setDay(withSettings(this.day, patch));
  }

  /** The global phase times, or this automation's own. */
  private phases(config: DayConfig) {
    const { ctx } = this;
    const { t } = ctx;
    const own = hasOwnPhases(config.settings);
    const global = ctx.daylight?.settings;
    const flip = () => {
      haptic("selection");
      this.setDay(withOwnPhases(this.day, !own, global));
    };
    return html`<p class="lead">${t("auto.phases_hint")}</p>
      <div class="rows">
        <div class="item">
          <ha-icon icon="mdi:clock-edit-outline"></ha-icon>
          <div class="grow">${t("auto.own_phases")}<div class="dim small">${t(own ? "auto.own_phases_on" : "auto.own_phases_off")}</div></div>
          ${toggle(own, t("auto.own_phases"), flip)}
        </div>
      </div>
      ${own ? phaseRows(t, phaseTimes(config.settings, global), (patch) => this.settings(patch), (c) => this.choose(c), this.preview?.phase) : nothing}`;
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
      <div class="rows">${PHASES.map((phase) => this.whiteRow(t(`auto.phase_${phase}` as StringKey), values[phase], (v) => set(phase, v)))}</div>`;
  }

  /** Each phase's brightness: automatic or fixed, then brighter or dimmer by some percent. */
  private brightness(config: DayConfig) {
    const { t } = this.ctx;
    const fixed = config.settings.brightness || {};
    const setFixed = (phase: Phase, value: number | null) => {
      const next = { ...fixed } as Record<string, number>;
      if (value !== null) next[phase] = value;
      else delete next[phase];
      this.settings({ brightness: Object.keys(next).length ? next : null });
    };
    const signed = (v: number) => (v > 0 ? `+${v} %` : v < 0 ? `−${-v} %` : t("auto.offset_none"));
    const level = (v: number | undefined) => (v === undefined ? t("auto.brightness_curve") : `${v} %`);
    const open = (phase: Phase) => {
      const offset = config.offsets[phase] || 0;
      const offsets = OFFSET_STEPS.includes(offset) ? OFFSET_STEPS : [...OFFSET_STEPS, offset].sort((a, b) => a - b);
      this.choose({
        title: t(`auto.phase_${phase}` as StringKey),
        lists: [
          {
            label: t("auto.brightness"),
            options: [{ value: "", label: t("auto.brightness_curve"), sub: t("auto.brightness_curve_sub") }, ...[...BRIGHTNESS_LEVELS].reverse().map((v) => ({ value: String(v), label: `${v} %` }))],
            selected: [fixed[phase] === undefined ? "" : String(fixed[phase])],
            pick: ([v]) => setFixed(phase, v ? Number(v) : null),
          },
          {
            label: t("auto.offset_label"),
            hint: t("auto.offset_hint"),
            options: offsets.map((v) => ({ value: String(v), label: signed(v) })),
            selected: [String(offset)],
            pick: ([v]) => this.setDay(withOffset(this.day, phase, Number(v))),
          },
        ],
      });
    };
    return html`<p class="lead">${t("auto.brightness_hint")}</p>
      <div class="rows">
        ${PHASES.map((phase) => {
          const offset = config.offsets[phase] || 0;
          return navRow(
            { icon: PHASE_ICONS[phase], title: t(`auto.phase_${phase}` as StringKey), value: [level(fixed[phase]), offset ? signed(offset) : ""].filter(Boolean).join(" · ") },
            () => open(phase),
          );
        })}
      </div>`;
  }

  private gradient(settings: DaySettings) {
    const { t } = this.ctx;
    const label = (m: string) => (m ? t(`auto.gradient_${m}` as StringKey) : t("auto.gradient_default"));
    const current = settings.gradient_mode || "";
    return html`<div class="rows">
      ${navRow({ icon: "mdi:gradient-horizontal", title: t("auto.gradient_mode"), sub: t("auto.gradient_mode_sub"), value: label(current) }, () =>
        this.choose(
          single(t("auto.gradient_mode"), ["", ...GRADIENT_MODES].map((m) => ({ value: m, label: label(m) })), current, (m) => this.settings({ gradient_mode: m || null })),
        ),
      )}
    </div>`;
  }

  private openPicker(title: string, selected: string[], save: (ids: string[]) => void): void {
    this.picker = { title, selected: [...selected], query: "", save };
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-automation-edit-view": AutomationEditView;
  }
}
