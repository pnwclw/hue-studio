// Parts shared by the light of the day's settings and an automation's natural light / scene
// of the day page: the phase times editor, the "Evening · Winter · …" line and the
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
import { type Choice, single, timeRow } from "./choice.ts";

export const PHASE_ICONS: Record<Phase, string> = {
  morning: "mdi:weather-sunset-up",
  day: "mdi:white-balance-sunny",
  golden: "mdi:weather-sunset",
  evening: "mdi:weather-sunset-down",
  night: "mdi:weather-night",
};

/** Minutes after (or before) sunrise or sunset a phase may start at. */
const SHIFT_STEPS = [-120, -90, -60, -45, -30, -20, -15, -10, -5, 0, 5, 10, 15, 20, 30, 40, 50, 60, 75, 90, 120, 180, 240];

/** Phase times: the shifts from sunrise/sunset (each a choice) and when the night starts. */
export function phaseRows(
  t: Translate,
  times: { night_from: string; shifts: typeof DEFAULT_SHIFTS },
  change: (patch: { night_from?: string; shifts?: typeof DEFAULT_SHIFTS }) => void,
  choose: (choice: Choice) => void,
  current?: Phase,
) {
  const minutes = (v: number) => `${v < 0 ? "−" : ""}${Math.abs(v)} ${t("automations.min")}`;
  const title = (phase: Phase) => html`${t(`auto.phase_${phase}` as StringKey)}${phase === current ? html` <span class="now-tag">${t("auto.now")}</span>` : nothing}`;
  return html`<div class="rows">
    ${SHIFTS.map((key) => {
      const value = times.shifts[key];
      const values = SHIFT_STEPS.includes(value) ? SHIFT_STEPS : [...SHIFT_STEPS, value].sort((a, b) => a - b);
      const name = t(`auto.phase_${key}` as StringKey);
      return html`<button class="item nav" @click=${() =>
        choose(
          single(
            name,
            values.map((v) => ({ value: String(v), label: minutes(v) })),
            String(value),
            (v) => change({ shifts: { ...times.shifts, [key]: Number(v) } }),
            t(`auto.shift_${key}` as StringKey),
          ),
        )}>
        <ha-icon icon=${PHASE_ICONS[key]}></ha-icon>
        <div class="grow">${title(key)}<div class="dim small">${t(`auto.shift_${key}` as StringKey)}</div></div>
        <span class="value">${minutes(value)}</span>
        <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
      </button>`;
    })}
    ${timeRow({ icon: PHASE_ICONS.night, title: t("auto.phase_night"), sub: t("auto.night_from") }, times.night_from, (night_from) => change({ night_from }))}
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
    brightness ? `${p.brightness}\u00a0%` : "",
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
