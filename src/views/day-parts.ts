// Parts shared by the light of the day's settings and an automation's natural light / scene
// of the day page: steppers, the phase times editor, the "Evening · Winter · …" line and the
// scene picker sheet.

import { html, nothing } from "lit";
import { classMap } from "lit/directives/class-map.js";

import type { StudioContext } from "../context.ts";
import { DEFAULT_SHIFTS, SHIFTS } from "../daylight.ts";
import { thumbUrl } from "../gallery-data.ts";
import { haptic } from "../ha-internals.ts";
import type { StringKey, Translate } from "../i18n.ts";
import type { DayPreview, Phase } from "../types.ts";
import { icon, normalize } from "../ui.ts";

export const PHASE_ICONS: Record<Phase, string> = {
  morning: "mdi:weather-sunset-up",
  day: "mdi:white-balance-sunny",
  golden: "mdi:weather-sunset",
  evening: "mdi:weather-sunset-down",
  night: "mdi:weather-night",
};

/** A − value + stepper. */
export function stepper(value: number, min: number, max: number, step: number, unit: string, change: (v: number) => void, signed = false) {
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

/** Phase times: the shifts from sunrise/sunset and when the night starts. */
export function phaseRows(
  t: Translate,
  times: { night_from: string; shifts: typeof DEFAULT_SHIFTS },
  change: (patch: { night_from?: string; shifts?: typeof DEFAULT_SHIFTS }) => void,
  current?: Phase,
) {
  const now = (phase: Phase) => (phase === current ? html`<span class="now-tag">${t("auto.now")}</span>` : nothing);
  return html`<div class="rows">
    ${SHIFTS.map(
      (key) => html`<div class="item">
        <ha-icon icon=${PHASE_ICONS[key]}></ha-icon>
        <div class="grow">${t(`auto.phase_${key}` as StringKey)} ${now(key)}<div class="dim small">${t(`auto.shift_${key}` as StringKey)}</div></div>
        ${stepper(times.shifts[key], -240, 240, 5, t("automations.min"), (v) => change({ shifts: { ...times.shifts, [key]: v } }))}
      </div>`,
    )}
    <div class="item">
      <ha-icon icon=${PHASE_ICONS.night}></ha-icon>
      <div class="grow">${t("auto.phase_night")} ${now("night")}<div class="dim small">${t("auto.night_from")}</div></div>
      <input class="select time" type="time" .value=${times.night_from} @change=${(e: Event) => {
        const v = (e.target as HTMLInputElement).value;
        if (/^\d\d:\d\d$/.test(v)) change({ night_from: v });
      }} />
    </div>
  </div>`;
}

/** "Evening · Winter · Gloomy · Party · 80 %". */
export function stateLine(t: Translate, p: DayPreview | null, brightness = true): string {
  if (!p) return "";
  return [
    t(`auto.phase_${p.pool_phase || p.phase}` as StringKey),
    p.kelvin ? "" : t(`auto.season_${p.season}` as StringKey),
    t(`auto.weather_${p.weather}` as StringKey),
    p.mood ? t(`auto.mood_${p.mood}` as StringKey) : "",
    brightness ? `${p.brightness} %` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The gallery picker: which scenes are chosen and what to do with them. */
export interface Picker {
  title: string;
  selected: string[];
  query: string;
  /** Scenes offered (default: the whole gallery). */
  only?: string[];
  save: (ids: string[]) => void;
}

/** A sheet to pick gallery scenes (`update` keeps the picker's state, null closes it). */
export function pickerSheet(ctx: StudioContext, picker: Picker, update: (picker: Picker | null) => void) {
  const { t } = ctx;
  const close = () => update(null);
  const flip = (id: string) => {
    haptic("selection");
    const current = picker.selected;
    update({ ...picker, selected: current.includes(id) ? current.filter((s) => s !== id) : [...current, id] });
  };
  const q = normalize(picker.query);
  const offered = picker.only ? new Set(picker.only) : null;
  const scenes = (ctx.gallery?.scenes || []).filter((s) => (!offered || offered.has(s.id)) && (!q || normalize(s.name).includes(q)));
  return html`<div class="sheet" @click=${(e: Event) => e.target === e.currentTarget && close()}>
    <div class="box form picker" role="dialog" aria-label=${picker.title}>
      <div class="sheet-bar"><div class="grow">${picker.title}</div>
        <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
      </div>
      <div class="form-body">
        <input class="field" placeholder=${t("gallery.search")} aria-label=${t("gallery.search")} .value=${picker.query}
          @input=${(e: InputEvent) => update({ ...picker, query: (e.target as HTMLInputElement).value })} />
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
          picker.save(picker.selected);
          close();
        }}>${t("auto.use_scenes", { count: picker.selected.length })}</button>
      </div>
    </div>
  </div>`;
}
