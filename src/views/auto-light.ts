// Auto light of one area (Settings → Auto light → area): who controls the lights, today's
// scene, phase boundaries, inputs (weather, light sensor, season), brightness, scene pools,
// excluded scenes and holidays. Everything is saved at once through the WebSocket API and
// services; the backend pushes the result back (hue_studio/auto_light/subscribe).

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import {
  autoAreas,
  candidateAreas,
  DEFAULT_NIGHT_FROM,
  DEFAULT_SHIFTS,
  GRADIENT_MODES,
  isMonthDay,
  monthDay,
  PHASES,
  phaseCounts,
  type PoolKey,
  poolOf,
  SEASONS,
  SHIFTS,
  stepsOf,
} from "../auto-light.ts";
import type { StudioContext } from "../context.ts";
import { thumbUrl } from "../gallery-data.ts";
import type { StringKey } from "../i18n.ts";
import { friendlyName } from "../model.ts";
import type { AutoLightConfig, AutoLightSettings, AutoLightState, Holiday, LightControl, Phase } from "../types.ts";
import { icon, normalize } from "../ui.ts";
import { StudioView } from "./base.ts";
import { scenesCount } from "./rooms.ts";

const CONTROLS: LightControl[] = ["auto", "manual", "off"];
const CONTROL_ICONS: Record<LightControl, string> = { auto: "mdi:lightbulb-auto", manual: "mdi:hand-back-right", off: "mdi:lightbulb-off-outline" };
const BRIGHTNESS_LEVELS = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
const SEASON_STATES = ["winter", "spring", "summer", "autumn"];

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

const areaName = (ctx: StudioContext, id: string): string => ctx.hass.areas?.[id]?.name || id;
const sceneName = (ctx: StudioContext, config: AutoLightConfig | undefined, id: string): string =>
  config?.names?.[id] || ctx.gallery?.scenes.find((s) => s.id === id)?.name || id;

/** "Evening · Winter · Gloomy · 80 %" for an area's current state. */
function stateLine(ctx: StudioContext, s: AutoLightState | undefined): string {
  const { t } = ctx;
  if (!s?.phase) return "";
  const parts = [
    t(`auto.phase_${s.phase}` as StringKey),
    s.season ? t(`auto.season_${s.season}` as StringKey) : "",
    s.mood ? t(`auto.mood_${s.mood}` as StringKey) : "",
    s.holiday ? t("auto.holiday") : "",
    s.brightness !== undefined ? `${s.brightness} %` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

/** The Auto light section of Settings: one row per area, and "add an area". */
export function autoLightRows(ctx: StudioContext, onAdd: () => void): TemplateResult {
  const { t } = ctx;
  const msg = ctx.autoLight;
  const areas = autoAreas(ctx.hass, msg);
  return html`<div class="rows">
    ${areas.map((area) => {
      const s = msg?.state[area];
      const sub = [s ? t(`auto.control_${s.control}` as StringKey) : "", s?.scene_name || ""].filter(Boolean).join(" · ");
      return html`<button class="item" @click=${() => ctx.go(`/settings/auto/${encodeURIComponent(area)}`)}>
        ${s?.scene ? html`<img class="thumb" src=${thumbUrl(s.scene)} alt="" />` : html`<ha-icon icon=${CONTROL_ICONS[s?.control || "auto"]}></ha-icon>`}
        <div class="grow">${areaName(ctx, area)}<div class="dim small">${sub}</div></div>
        <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
      </button>`;
    })}
    ${candidateAreas(ctx.hass, msg).length
      ? html`<button class="item" @click=${onAdd}><ha-icon icon="mdi:plus"></ha-icon><div class="grow">${t("auto.add_area")}</div></button>`
      : nothing}
  </div>`;
}

/** Sheet: pick an area with Hue lights to give auto light to. */
export function addAreaSheet(ctx: StudioContext, close: () => void): TemplateResult {
  const { t } = ctx;
  const add = async (area: string) => {
    if (await ctx.ws({ type: "hue_studio/auto_light/settings", area_id: area, settings: {} })) {
      close();
      ctx.go(`/settings/auto/${encodeURIComponent(area)}`);
    }
  };
  return html`<div class="sheet" @click=${(e: Event) => e.target === e.currentTarget && close()}>
    <div class="box form" role="dialog" aria-label=${t("auto.add_area")}>
      <div class="sheet-bar"><div class="grow">${t("auto.add_area")}</div>
        <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
      </div>
      <div class="rows pick">
        ${candidateAreas(ctx.hass, ctx.autoLight).map(
          (area) => html`<button class="item" @click=${() => add(area)}>
            <ha-icon icon=${ctx.hass.areas?.[area]?.icon || "mdi:sofa-outline"}></ha-icon><div class="grow">${areaName(ctx, area)}</div>
          </button>`,
        )}
      </div>
      <p class="lead small pad">${t("auto.add_area_hint")}</p>
    </div>
  </div>`;
}

@customElement("hue-studio-auto-light-view")
export class AutoLightView extends StudioView {
  @property() accessor area = "";
  @state() private accessor pool: PoolKey | null = null;
  @state() private accessor picker: Picker | null = null;
  @state() private accessor holiday: HolidayDraft | null = null;
  @state() private accessor confirmRemove = false;

  private get config(): AutoLightConfig | undefined {
    return this.ctx.autoLight?.areas[this.area];
  }

  private get now(): AutoLightState | undefined {
    return this.ctx.autoLight?.state[this.area];
  }

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const back = html`<div class="topbar">
      <button class="round back" aria-label=${t("common.back")} @click=${() => ctx.go("/settings")}>${icon("back")}</button>
      <div class="grow"></div>
    </div>`;
    if (!ctx.autoLight) return html`<div class="page">${back}<p class="empty">${t("rooms.loading")}</p></div>`;
    const config = this.config;
    if (!config) return html`<div class="page">${back}<p class="empty">${t("auto.not_found")}</p></div>`;
    return html`<div class="page auto-page">
        ${back}
        <h1 class="big">${areaName(ctx, this.area)}</h1>
        <p class="lead">${t("auto.intro")}</p>
        ${this.control()} ${this.today(config)}
        <h2 class="label">${t("auto.pools")}</h2>
        ${this.pools(config)}
        <h2 class="label">${t("auto.phases")}</h2>
        ${this.phases(config.settings)}
        <h2 class="label">${t("auto.brightness")}</h2>
        ${this.brightness(config)}
        <h2 class="label">${t("auto.inputs")}</h2>
        ${this.inputs(config.settings)}
        <h2 class="label">${t("auto.holidays")}</h2>
        ${this.holidays(config)}
        ${config.excluded.length ? html`<h2 class="label">${t("auto.excluded")}</h2>${this.excluded(config)}` : nothing}
        <div class="center stack">
          <button class=${classMap({ pill: true, reset: true, danger: true, confirm: this.confirmRemove })} @click=${() => this.removeArea()}>
            ${this.confirmRemove ? t("auto.remove_confirm") : t("auto.remove")}
          </button>
        </div>
      </div>
      ${this.holiday ? this.holidaySheet(this.holiday) : nothing} ${this.picker ? this.pickerSheet(this.picker) : nothing}`;
  }

  // ---- saving ----

  private settings(patch: Partial<AutoLightSettings>): Promise<boolean> {
    return this.ctx.ws({ type: "hue_studio/auto_light/settings", area_id: this.area, settings: patch });
  }

  private saveLists(patch: { holidays?: Holiday[]; excluded?: string[] }): Promise<boolean> {
    return this.ctx.ws({ type: "hue_studio/auto_light/update", area_id: this.area, ...patch });
  }

  private service(service: string, data: Record<string, unknown>): Promise<boolean> {
    return this.ctx.call("hue_studio", service, { area: this.area, ...data }, { optimistic: false });
  }

  private entity(key: string): string | undefined {
    return this.ctx.autoLight?.entities[this.area]?.[key];
  }

  private async removeArea(): Promise<void> {
    if (!this.confirmRemove) {
      this.confirmRemove = true;
      return;
    }
    if (await this.ctx.ws({ type: "hue_studio/auto_light/remove", area_id: this.area })) this.ctx.go("/settings");
  }

  // ---- control and today ----

  private control() {
    const { ctx } = this;
    const { t } = ctx;
    const current = this.now?.control || "auto";
    const select = this.entity("light_control");
    const choose = (option: LightControl) => {
      if (select && option !== current) ctx.call("select", "select_option", { entity_id: select, option }, { optimistic: false });
    };
    return html`<div class="seg three" role="radiogroup" aria-label=${t("auto.control")}>
        ${CONTROLS.map(
          (c) => html`<button role="radio" aria-checked=${c === current} class=${classMap({ on: c === current })} ?disabled=${!select} @click=${() => choose(c)}>
            ${t(`auto.control_${c}` as StringKey)}
          </button>`,
        )}
      </div>
      <p class="lead small">${t(`auto.control_${current}_hint` as StringKey)}</p>`;
  }

  private today(config: AutoLightConfig) {
    const { ctx } = this;
    const { t } = ctx;
    const now = this.now;
    if (!now?.scene) {
      return html`<div class="today empty-today"><ha-icon icon="mdi:palette-swatch-variant"></ha-icon><span>${t("auto.no_scene")}</span></div>`;
    }
    const scene = now.scene;
    const next = this.entity("next_light_scene");
    return html`<div class="today">
      <img class="pic" src=${thumbUrl(scene)} alt="" />
      <div class="text">
        <div class="dim small">${t("auto.today")}</div>
        <div class="name">${now.scene_name || sceneName(ctx, config, scene)}</div>
        <div class="dim small">${stateLine(ctx, now)}</div>
      </div>
      <div class="today-actions">
        <button class="pill" ?disabled=${!next} @click=${() => next && ctx.call("button", "press", { entity_id: next }, { optimistic: false })}>
          ${t("auto.next")}
        </button>
        <button class="pill" ?disabled=${now.control === "off"} @click=${() => this.service("apply_auto_light", { resume: true, transition: 2 })}>
          ${t("auto.show_now")}
        </button>
        <button class="pill" @click=${() => this.service("auto_light_exclude", { scene, excluded: true })}>${t("auto.never")}</button>
      </div>
    </div>`;
  }

  // ---- pools ----

  private pools(config: AutoLightConfig) {
    const { ctx } = this;
    const { t } = ctx;
    const now = this.now;
    // Start where today's scene comes from (the clear pool when there is no gloomy one).
    const phase = now?.pool_phase || "evening";
    const mood = now?.mood === "gloomy" && poolOf(config, { phase, season: "all", step: "gloomy" }).length ? "gloomy" : "clear";
    const key: PoolKey = this.pool || { phase, season: "all", step: phase === "day" ? String(now?.step ?? 2) : mood };
    const set = (patch: Partial<PoolKey>) => {
      const next = { ...key, ...patch };
      if (patch.phase && !stepsOf(next.phase).includes(next.step)) next.step = stepsOf(next.phase)[0];
      this.pool = next;
    };
    const counts = phaseCounts(config);
    const scenes = poolOf(config, key);
    const save = (ids: string[]) => this.service("auto_light_pool", { phase: key.phase, season: key.season, step: key.step, scenes: ids });
    const stepLabel = (step: string) => (key.phase === "day" ? t(`auto.step_${step}` as StringKey) : t(`auto.mood_${step}` as StringKey));
    const chips = <T extends string>(values: readonly T[], current: T, label: (v: T) => string, pick: (v: T) => void) =>
      html`<div class="chips">${values.map((v) => html`<button class=${classMap({ chip: true, on: v === current })} @click=${() => pick(v)}>${label(v)}</button>`)}</div>`;
    return html`<p class="lead">${t("auto.pools_hint")}</p>
      ${chips(PHASES, key.phase, (p) => `${t(`auto.phase_${p}` as StringKey)}${counts[p] ? ` · ${counts[p]}` : ""}`, (phase) => set({ phase }))}
      ${chips(SEASONS, key.season, (s) => t(`auto.season_${s}` as StringKey), (season) => set({ season }))}
      ${chips(stepsOf(key.phase), key.step, stepLabel, (step) => set({ step }))}
      <p class="lead small">${t(key.phase === "day" ? "auto.steps_hint" : "auto.moods_hint")}</p>
      <div class="scene-tiles">
        ${scenes.map(
          (id) => html`<div class="tile" style="background-image: url(${thumbUrl(id)})">
            <span>${sceneName(ctx, config, id)}</span>
            <button class="round mini remove" aria-label=${t("auto.remove_scene")} @click=${() => save(scenes.filter((s) => s !== id))}>${icon("close")}</button>
          </div>`,
        )}
        <button class="tile add-tile" @click=${() => this.openPicker(t("auto.choose_scenes"), scenes, save)}>
          ${icon("plus")}<span>${t("auto.add_scenes")}</span>
        </button>
      </div>`;
  }

  private excluded(config: AutoLightConfig) {
    const { ctx } = this;
    return html`<p class="lead">${ctx.t("auto.excluded_hint")}</p>
      <div class="scene-tiles">
        ${config.excluded.map(
          (id) => html`<div class="tile dimmed" style="background-image: url(${thumbUrl(id)})">
            <span>${sceneName(ctx, config, id)}</span>
            <button class="round mini remove" aria-label=${ctx.t("auto.restore_scene")} @click=${() => this.service("auto_light_exclude", { scene: id, excluded: false })}>
              ${icon("back")}
            </button>
          </div>`,
        )}
      </div>`;
  }

  // ---- phases, brightness, inputs ----

  private stepper(value: number, min: number, max: number, step: number, unit: string, change: (v: number) => void) {
    const set = (v: number) => change(Math.min(max, Math.max(min, v)));
    return html`<div class="stepper">
      <button class="round mini-step" aria-label="−" ?disabled=${value <= min} @click=${() => set(value - step)}>−</button>
      <span class="value">${value > 0 && min < 0 ? "+" : ""}${value} ${unit}</span>
      <button class="round mini-step" aria-label="+" ?disabled=${value >= max} @click=${() => set(value + step)}>+</button>
    </div>`;
  }

  private phases(settings: AutoLightSettings) {
    const { t } = this.ctx;
    const shifts = { ...DEFAULT_SHIFTS, ...settings.shifts };
    const nightFrom = settings.night_from || DEFAULT_NIGHT_FROM;
    return html`<p class="lead">${t("auto.phases_hint")}</p>
      <div class="rows">
        ${SHIFTS.map(
          (key) => html`<div class="item">
            <ha-icon icon=${PHASE_ICONS[key]}></ha-icon>
            <div class="grow">${t(`auto.phase_${key}` as StringKey)}<div class="dim small">${t(`auto.shift_${key}` as StringKey)}</div></div>
            ${this.stepper(shifts[key], -240, 240, 5, t("auto.minutes"), (v) => this.settings({ shifts: { ...shifts, [key]: v } }))}
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

  private brightness(config: AutoLightConfig) {
    const { t } = this.ctx;
    const fixed = config.settings.brightness || {};
    const setFixed = (phase: Phase, value: string) => {
      const next = { ...fixed } as Record<string, number>;
      if (value) next[phase] = Number(value);
      else delete next[phase];
      this.settings({ brightness: next });
    };
    const setOffset = (phase: Phase, value: number) =>
      this.service("auto_light_offset", { phase, delta: value === 0 ? 0 : value - (config.offsets[phase] || 0) });
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
            ${this.stepper(config.offsets[phase] || 0, -60, 60, 5, "%", (v) => setOffset(phase, v))}
          </div>`,
        )}
      </div>`;
  }

  private inputs(settings: AutoLightSettings) {
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
      <div class="item wrap"><ha-icon icon="mdi:gradient-horizontal"></ha-icon>
        <div class="grow">${t("auto.gradient_mode")}<div class="dim small">${t("auto.gradient_mode_sub")}</div></div>${modes}</div>
    </div>`;
  }

  // ---- holidays ----

  private holidays(config: AutoLightConfig) {
    const { ctx } = this;
    const { t } = ctx;
    const lang = ctx.hass.locale?.language || ctx.hass.language || "en";
    const remove = (index: number) => this.saveLists({ holidays: config.holidays.filter((_, i) => i !== index) });
    return html`<p class="lead">${t("auto.holidays_hint")}</p>
      <div class="rows">
        ${config.holidays.map(
          (h, index) => html`<div class="item">
            <ha-icon icon="mdi:party-popper"></ha-icon>
            <button class="grow plain" @click=${() => (this.holiday = { index, ...h, phases: [...h.phases], pool: [...h.pool] })}>
              ${monthDay(h.from, lang)} – ${monthDay(h.to, lang)}
              <div class="dim small">${h.phases.map((p) => t(`auto.phase_${p}` as StringKey)).join(", ")} · ${scenesCount(ctx, h.pool.length)}</div>
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
    const { ctx } = this;
    const { t } = ctx;
    const config = this.config!;
    const close = () => (this.holiday = null);
    const set = (patch: Partial<HolidayDraft>) => (this.holiday = { ...this.holiday!, ...patch });
    const valid = isMonthDay(draft.from) && isMonthDay(draft.to) && draft.phases.length > 0 && draft.pool.length > 0;
    const save = async () => {
      if (!valid) return;
      const entry: Holiday = { from: draft.from, to: draft.to, phases: draft.phases, pool: draft.pool };
      const list = [...config.holidays];
      if (draft.index === null) list.push(entry);
      else list[draft.index] = entry;
      if (await this.saveLists({ holidays: list })) close();
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
            ${draft.pool.map((id) => html`<div class="tile" style="background-image: url(${thumbUrl(id)})"><span>${sceneName(ctx, config, id)}</span></div>`)}
            <button class="tile add-tile" @click=${() => this.openPicker(t("auto.choose_scenes"), draft.pool, (ids) => set({ pool: ids }))}>
              ${icon("plus")}<span>${t("auto.add_scenes")}</span>
            </button>
          </div>
        </div>
        <div class="actions"><button class="pill apply" ?disabled=${!valid} @click=${save}>${t("zone.save")}</button></div>
      </div>
    </div>`;
  }

  // ---- gallery picker ----

  private openPicker(title: string, selected: string[], save: (ids: string[]) => void): void {
    this.picker = { title, selected: [...selected], query: "", save };
  }

  private pickerSheet(picker: Picker) {
    const { ctx } = this;
    const { t } = ctx;
    const close = () => (this.picker = null);
    const flip = (id: string) => {
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

const PHASE_ICONS: Record<Phase, string> = {
  morning: "mdi:weather-sunset-up",
  day: "mdi:white-balance-sunny",
  golden: "mdi:weather-sunset",
  evening: "mdi:weather-sunset-down",
  night: "mdi:weather-night",
};

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-auto-light-view": AutoLightView;
  }
}
