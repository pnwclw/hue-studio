// What the automation editor and a sensor's settings share: a draft of one of our
// automations and its parts like the Hue app's (the lights it switches, its light under
// "General", its timers on sheets with a slider, the natural light / scene of the day page),
// and the sheets those open. Subclasses lay the parts out and save the draft.

import { html, nothing } from "lit";
import { state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import {
  type AutomationDraft,
  type AutomationInput,
  hhmm,
  LIGHT_KINDS,
  type LightKind,
  missing,
  placesOf,
  type PlaceGroup,
  pickedOf,
  withGroup,
  withLight,
} from "../automations.ts";
import { whiteArt } from "../../../core/color.ts";
import {
  dayConfig,
  GRADIENT_MODES,
  hasOwnPhases,
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
import { thumbUrl } from "../../scenes/gallery-data.ts";
import { haptic } from "../../../core/ha-internals.ts";
import type { StringKey } from "../../../i18n/index.ts";
import { allGroups, findGroup, friendlyName, type Group, lightIcon } from "../../../core/model.ts";
import type { DayConfig, DayPreview, DaySettings, Phase } from "../../../core/types.ts";
import { tileCard } from "../../../ds/controls.ts";
import { icon, type IconName, toggle } from "../../../ds/ui.ts";
import { StudioView } from "../../../ds/base.ts";
import { navRow, single } from "../../../ds/choice.ts";
import { PHASE_ICONS, type Picker, phaseRows, pickerSheet, stateLine } from "./day-parts.ts";

/** The fade sheet's scale (minutes), like the Hue app's; a longer fade stretches it. */
const FADE_MAX = 60;
/** Light levels to choose for "Daylight" (lx). */
const LUX = [5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 1000];
const BRIGHTNESS_LEVELS = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
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

/** A group of a picker sheet (a room or zone) and its items (lights, sensors); `whole`: only all or nothing. */
interface PickGroup {
  key: string;
  name: string;
  whole?: boolean;
  items: { id: string; name: string; icon: string }[];
}

/**
 * What the automation editor and a sensor's settings share: a draft of one of our automations
 * and its parts (lights, the light, its timers, the natural light / scene of the day page),
 * with their sheets.
 */
export class AutomationParts extends StudioView {
  @state() protected accessor draft: AutomationDraft | null = null;
  @state() protected accessor page: "main" | "day" = "main";
  @state() protected accessor preview: DayPreview | null = null;
  @state() protected accessor legacy: Legacy | null = null;
  @state() protected accessor picker: Picker | null = null;
  /** The fade sheet: its minutes until "Done". */
  @state() protected accessor fadeSheet: { value: number } | null = null;
  /** The light picker sheet: what it has chosen until "Done", the rooms opened in it. */
  @state() protected accessor lightsSheet: { places: Pick<AutomationInput, "rooms" | "zones">; open: string[] } | null = null;
  /** The "Turn off after" sheet: its minutes, those of the parts of the day (motion), the row the slider sets. */
  @state() protected accessor offSheet: { all: number; phases: Partial<Record<Phase, number>> | null; at: "all" | Phase } | null = null;
  /** The motion sensor picker sheet: what it has chosen until "Done", the rooms opened in it. */
  @state() protected accessor sensorsSheet: { chosen: string[]; open: string[] } | null = null;
  protected previewKey = "";
  protected legacyAsked = false;

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

  protected set(patch: Partial<AutomationInput>): void {
    const d = this.draft!;
    this.draft = { ...d, input: { ...d.input, ...patch } };
  }

  /** "30 min", or `zero` for 0. */
  protected minutes(v: number, zero: StringKey): string {
    const { t } = this.ctx;
    return v ? `${v} ${t("automations.min")}` : t(zero);
  }

  protected toggleRow(glyph: string, label: string, sub: string, on: boolean, change: (v: boolean) => void) {
    return html`<div class="item">
      <ha-icon icon=${glyph}></ha-icon>
      <div class="grow">${label}${sub ? html`<div class="dim small">${sub}</div>` : nothing}</div>
      ${toggle(on, label, () => {
        haptic("selection");
        change(!on);
      })}
    </div>`;
  }

  /** The fade as a row ("30 min"); it opens the fade sheet. */
  protected fadeRow(value: number | undefined) {
    const title = this.ctx.t("automations.fade_duration");
    return navRow({ title, value: this.minutes(value ?? 0, "automations.instantly") }, () => {
      haptic("selection");
      this.fadeSheet = { value: value ?? 0 };
    });
  }

  /** "06:30": a time of day some minutes from another ("HH:MM[:SS]"). */
  protected static shifted(time: string | undefined, minutes: number): string {
    const [h = 0, m = 0] = hhmm(time).split(":").map(Number);
    const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  /** What the fade means in time: when waking up starts, when going to sleep ends (null: no clock). */
  protected fadeMoment(d: AutomationDraft, fade: number): { label: string; time: string } | null {
    const { t } = this.ctx;
    if (d.type === "wake_up" && d.input.start_kind !== "sunrise")
      return { label: t("automations.fade_starts"), time: AutomationParts.shifted(d.input.time, -fade) };
    if (d.type === "go_to_sleep" && d.input.use_time !== false)
      return { label: t("automations.fade_ends"), time: AutomationParts.shifted(d.input.time, fade) };
    return null;
  }

  /** The fade sheet: minutes on a slider, the time they lead to beside them, "Done" keeps them. */
  protected fadeSheetView(d: AutomationDraft) {
    const { t } = this.ctx;
    const sheet = this.fadeSheet!;
    const title = t("automations.fade_duration");
    const moment = this.fadeMoment(d, sheet.value);
    const close = () => (this.fadeSheet = null);
    const done = () => {
      haptic("success");
      this.set({ fade: sheet.value });
      close();
    };
    return html`<div class=${classMap({ sheet: true, bottom: this.ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="box form sensor-sheet fade-sheet" role="dialog" aria-label=${title}>
        <div class="sheet-bar">
          <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
          <div class="grow">${title}</div>
          <button class="pill save" @click=${done}>${t("color.done")}</button>
        </div>
        <div class="fade-body">
          <div class="fade-values">
            <div><div class="caps">${t("automations.fade_for")}</div><div class="big-value">${this.minutes(sheet.value, "automations.instantly")}</div></div>
            ${moment ? html`<div><div class="caps">${moment.label}</div><div class="big-value">${moment.time}</div></div>` : nothing}
          </div>
          ${this.minutesSlider(sheet.value, title, (value) => (this.fadeSheet = { value }))}
        </div>
      </div>
    </div>`;
  }

  /** Minutes on a slider with its scale under it (the fade and "Turn off after" sheets). */
  protected minutesSlider(value: number, label: string, change: (v: number) => void) {
    const max = Math.max(FADE_MAX, Math.ceil(value / 10) * 10);
    const ticks = Array.from({ length: max / 10 + 1 }, (_, i) => i * 10);
    return html`<hue-studio-slider class="fade-slider" .min=${0} .max=${max} .value=${value} .label=${label}
        @value-input=${(e: CustomEvent<number>) => change(Math.round(e.detail))}
        @value-change=${(e: CustomEvent<number>) => change(Math.round(e.detail))}></hue-studio-slider>
      <div class="fade-ticks">${ticks.map((v) => html`<span>${v}</span>`)}</div>`;
  }

  /** "15 min", or "Never" (0: the lights stay on). */
  protected offLabel(v: number): string {
    return this.minutes(v, "automations.never");
  }

  /**
   * "Turn off after" as a row; it opens the sheet with the slider. A motion automation's
   * may differ by part of the day (the light of the day's phases), said under it.
   */
  protected offRow(d: AutomationDraft, sub = "") {
    const { t } = this.ctx;
    const motion = d.type === "motion";
    const phases = motion ? d.input.off_after_phases || {} : null;
    const own = PHASES.filter((p) => phases?.[p] !== undefined)
      .map((p) => `${t(`auto.phase_${p}` as StringKey)}: ${this.offLabel(phases![p]!)}`)
      .join(" · ");
    return navRow({ title: t("automations.off_after"), sub: own || sub, value: this.offLabel(d.input.off_after ?? 0) }, () => {
      haptic("selection");
      this.offSheet = { all: d.input.off_after ?? 0, phases: phases ? { ...phases } : null, at: "all" };
    });
  }

  protected offSheetView() {
    const { ctx } = this;
    const { t } = ctx;
    const sheet = this.offSheet!;
    const title = t("automations.off_after");
    const close = () => (this.offSheet = null);
    const done = () => {
      haptic("success");
      const phases = sheet.phases;
      this.set({
        off_after: sheet.all,
        ...(phases
          ? { off_after_phases: phases, ...(Object.keys(phases).length ? { phase_sensor: ctx.daylight?.phase_entity || "sensor.hue_studio_phase" } : {}) }
          : {}),
      });
      close();
    };
    const value = sheet.at === "all" ? sheet.all : (sheet.phases?.[sheet.at] ?? sheet.all);
    const change = (v: number) => {
      if (sheet.at === "all") this.offSheet = { ...sheet, all: v };
      else this.offSheet = { ...sheet, phases: { ...sheet.phases, [sheet.at]: v } };
    };
    const now = ctx.daylight?.now?.phase;
    const row = (at: "all" | Phase) => {
      const on = sheet.at === at;
      const own = at !== "all" && sheet.phases?.[at] !== undefined;
      const label = at === "all" ? t("automations.off_always") : t(`auto.phase_${at}` as StringKey);
      const val = at === "all" ? this.offLabel(sheet.all) : own ? this.offLabel(sheet.phases![at]!) : t("automations.off_like_all");
      return html`<button class=${classMap({ item: true, on })} role="radio" aria-checked=${on} @click=${() => {
        haptic("selection");
        this.offSheet = { ...sheet, at };
      }}>
        <div class="grow">${label}${at === now ? html`<div class="dim small">${t("automations.off_now")}</div>` : nothing}</div>
        <span class=${classMap({ value: true, own })}>${val}</span>
        ${on ? html`<span class="tick">${icon("check")}</span>` : nothing}
      </button>`;
    };
    return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="box form sensor-sheet fade-sheet off-sheet" role="dialog" aria-label=${title}>
        <div class="sheet-bar">
          <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
          <div class="grow">${title}</div>
          <button class="pill save" @click=${done}>${t("color.done")}</button>
        </div>
        <div class="fade-body">
          <div class="fade-values">
            <div><div class="caps">${sheet.at === "all" ? t("automations.off_always") : t(`auto.phase_${sheet.at}` as StringKey)}</div>
              <div class="big-value">${this.offLabel(value)}</div></div>
          </div>
          ${this.minutesSlider(value, title, change)}
          ${sheet.phases
            ? html`<p class="hint">${t("automations.off_phases_hint")}</p>
                <div class="rows choice-list off-phases" role="radiogroup">${(["all", ...PHASES] as const).map(row)}</div>
                ${sheet.at !== "all" && sheet.phases[sheet.at] !== undefined
                  ? html`<div class="center"><button class="pill" @click=${() => {
                      haptic("selection");
                      const phases = { ...sheet.phases };
                      delete phases[sheet.at as Phase];
                      this.offSheet = { ...sheet, phases };
                    }}>${t("automations.off_like_all")}</button></div>`
                  : nothing}`
            : nothing}
        </div>
      </div>
    </div>`;
  }

  /** A motion sensor's own light sensor (a Hue one has one): the first of the chosen ones' devices. */
  protected luxFor(motion: string[]): string {
    const { hass } = this.ctx;
    for (const id of motion) {
      const device = hass.entities?.[id]?.device_id;
      if (!device) continue;
      const lux = Object.keys(hass.entities || {}).find(
        (e) => e.startsWith("sensor.") && hass.entities?.[e]?.device_id === device && hass.states[e]?.attributes.device_class === "illuminance",
      );
      if (lux) return lux;
    }
    return "";
  }

  /** "Daylight", like the Hue app's: the lights go on only below a light level of the sensor's own light sensor. */
  protected daylightRow(d: AutomationDraft) {
    const { t } = this.ctx;
    const lux = d.input.lux_sensor || this.luxFor(d.input.motion || []);
    if (!lux) return nothing;
    const below = d.input.lux_below || 0;
    const values = [0, ...(LUX.includes(below) || !below ? LUX : [...LUX, below].sort((a, b) => a - b))];
    const label = (v: number) => (v ? t("sensor.daylight_below", { lux: v }) : t("sensor.daylight_off"));
    const now = Number.parseFloat(this.ctx.hass.states[lux]?.state ?? "");
    return navRow({ title: t("sensor.daylight"), sub: Number.isFinite(now) ? t("automations.lux_now", { lux: Math.round(now) }) : "", value: label(below) }, () =>
      this.choose(
        single(t("sensor.daylight"), values.map((v) => ({ value: String(v), label: label(v) })), String(below), (v) => this.set({ lux_sensor: lux, lux_below: Number(v) }), t("automations.daylight_hint")),
      ),
    );
  }

  /** The natural light / scene of the day page, over the main one. */
  protected dayScreen() {
    const { ctx } = this;
    const { t } = ctx;
    const natural = this.draft?.input.light === "natural";
    return html`${this.screen(this.subHead(t(natural ? "automations.light_natural" : "automations.light_auto"), () => this.leaveDay()), this.dayPage(natural), "settings-page auto-page")}
      ${this.picker ? pickerSheet(ctx, this.picker, (picker) => (this.picker = picker)) : nothing}`;
  }

  /** The sheets the parts open, outside the scrolling body. */
  protected partSheets(d: AutomationDraft) {
    return html`${this.fadeSheet ? this.fadeSheetView(d) : nothing}
      ${this.offSheet ? this.offSheetView() : nothing}
      ${this.lightsSheet ? this.lightsSheetView() : nothing}
      ${this.sensorsSheet ? this.sensorsSheetView() : nothing}`;
  }

  /** "Sunrise", "30 min before sunset", "15 min after sunrise". */
  protected offsetLabel(kind: string, minutes: number): string {
    const { t } = this.ctx;
    const sun = kind === "sunrise" ? "sunrise" : "sunset";
    if (!minutes) return t(`automations.wheel_${sun}` as StringKey);
    return t(`automations.${minutes < 0 ? "before" : "after"}_${sun}` as StringKey, { n: Math.abs(minutes) });
  }

  // ---- rooms and light ----

  /**
   * Where the automation's lights are, like the Hue app's: each room or zone it has as a
   * tile (the whole of it, or how many of its lights), places no longer known with them.
   */
  protected places(input: Pick<AutomationInput, "rooms" | "zones">): { group: Group | null; key: string; picked: "all" | string[] }[] {
    const { ctx } = this;
    const found = allGroups(ctx.home)
      .map((group) => ({ group, key: group.key, picked: pickedOf(input, group) }))
      .filter((p) => p.picked === "all" || p.picked.length);
    // Rooms and zones gone from the home screen, and single lights of no room shown here.
    const known = new Set([...found.map((p) => p.key), ...ctx.home.rooms.flatMap((g) => g.lights.map((l) => `hue.${l}`))]);
    const gone = placesOf(input)
      .filter((k) => !known.has(k))
      .map((key) => ({ group: null, key, picked: "all" as const }));
    return [...found, ...gone];
  }

  protected selectedLights(d: AutomationDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const places = this.places(d.input);
    const edit = () => {
      haptic("selection");
      const open = places.filter((p) => p.picked !== "all" && p.group).map((p) => p.key);
      this.lightsSheet = { places: { rooms: d.input.rooms, zones: d.input.zones || [] }, open };
    };
    // None yet: just "Add lights", like the Hue app's.
    if (!places.length)
      return html`<div class="rows lights-card">
        <div class="item lights-head">
          <div class="grow">${t("automations.add_lights")}</div>
          <button class="round add" aria-label=${t("automations.add_lights")} @click=${edit}>${icon("plus")}</button>
        </div>
      </div>`;
    return html`<div class="rows lights-card">
      <div class="item lights-head">
        <div class="grow">${t("automations.selected_lights")}</div>
        <button class="round" aria-label=${t("automations.edit_lights")} @click=${edit}>${icon("pencil")}</button>
      </div>
      ${places.length
        ? html`<div class="place-tiles">
            ${places.map(({ group, key, picked }) => {
              const id = key.slice(key.indexOf(".") + 1);
              const zone = !!group && ctx.home.zones.includes(group);
              const sub = !group
                ? t("automations.place_gone")
                : picked === "all"
                  ? t(zone ? "automations.entire_zone" : "automations.entire_room")
                  : t(picked.length === 1 ? "automations.one_light" : "automations.n_lights", { count: picked.length });
              return html`<button class=${classMap({ "place-tile": true, gone: !group })} @click=${edit}>
                <ha-icon icon=${group?.icon || "mdi:help-circle-outline"}></ha-icon>
                <span class="name">${group?.name || id}</span>
                <span class="sub">${sub}</span>
              </button>`;
            })}
          </div>`
        : html`<button class="item nav lights-empty" @click=${edit}>
            <div class="grow dim warn">${t("automations.missing_rooms")}</div>
            <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
          </button>`}
    </div>`;
  }

  /**
   * A picker like the Hue app's "Edit lights": groups (rooms) with a check (all, some,
   * none) that open into a strip of their items with a check each; whole groups (zones)
   * only check. "Done" keeps what it picked, the close button drops it.
   */
  protected pickSheet(o: {
    title: string;
    sections: { label: string; groups: PickGroup[] }[];
    /** Said when no section has a group. */
    empty?: string;
    picked: (g: PickGroup) => "all" | string[];
    sub: (g: PickGroup, picked: "all" | string[]) => string;
    flip: (g: PickGroup) => void;
    flipItem: (g: PickGroup, id: string) => void;
    open: string[];
    setOpen: (open: string[]) => void;
    close: () => void;
    done: () => void;
  }) {
    const { ctx } = this;
    const { t } = ctx;
    const check = (state: "all" | "some" | "none") =>
      html`<span class=${classMap({ "pick-check": true, [state]: true })}>${state === "all" ? icon("check") : state === "some" ? html`<i></i>` : nothing}</span>`;
    const group = (g: PickGroup) => {
      const picked = o.picked(g);
      const state = picked === "all" ? "all" : picked.length ? "some" : "none";
      const open = !g.whole && o.open.includes(g.key);
      const sub = o.sub(g, picked);
      const flip = () => {
        haptic("selection");
        o.flip(g);
      };
      const expand = () => {
        haptic("selection");
        o.setOpen(open ? o.open.filter((k) => k !== g.key) : [...o.open, g.key]);
      };
      return html`<div class="pick-room">
        <div class="item">
          <button class="pick-toggle" role="checkbox" aria-checked=${state === "all" ? "true" : state === "some" ? "mixed" : "false"} aria-label=${g.name} @click=${flip}>${check(state)}</button>
          <button class="pick-name" @click=${g.whole ? flip : expand}>
            <span class="grow">${g.name}${sub ? html`<span class="dim small">${sub}</span>` : nothing}</span>
          </button>
          ${g.whole
            ? nothing
            : html`<button class=${classMap({ round: true, expand: true, open })} aria-expanded=${open} aria-label=${g.name} @click=${expand}>
                <ha-icon icon="mdi:chevron-down"></ha-icon>
              </button>`}
        </div>
        ${open
          ? html`<div class="pick-lights">
              ${g.items.map((item) => {
                const on = picked === "all" || picked.includes(item.id);
                return tileCard({
                  art: html`<ha-icon icon=${item.icon}></ha-icon>`,
                  name: item.name,
                  toggle: check(on ? "all" : "none"),
                  classes: { "pick-light": true, on },
                  click: () => {
                    haptic("selection");
                    o.flipItem(g, item.id);
                  },
                });
              })}
            </div>`
          : nothing}
      </div>`;
    };
    return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && o.close()}>
      <div class="box form sensor-sheet lights-sheet" role="dialog" aria-label=${o.title}>
        <div class="sheet-bar">
          <button class="round close" aria-label=${t("common.close")} @click=${o.close}>${icon("close")}</button>
          <div class="grow">${o.title}</div>
          <button class="pill save" @click=${() => {
            haptic("success");
            o.done();
          }}>${t("color.done")}</button>
        </div>
        <div class="lights-body">
          ${o.empty && !o.sections.some((section) => section.groups.length) ? html`<p class="hint">${o.empty}</p>` : nothing}
          ${o.sections
            .filter((section) => section.groups.length)
            .map((section) => html`<h2 class="label">${section.label}</h2><div class="rows pick-rows">${section.groups.map(group)}</div>`)}
        </div>
      </div>
    </div>`;
  }

  /** The light picker: rooms with their lights, zones whole. */
  protected lightsSheetView() {
    const { ctx } = this;
    const { t } = ctx;
    const sheet = this.lightsSheet!;
    const input = { ...this.draft!.input, ...sheet.places };
    const asPick = (g: Group, whole: boolean): PickGroup => ({
      key: g.key,
      name: g.name,
      whole,
      items: g.lights.map((id) => ({ id, name: friendlyName(ctx.hass, id), icon: lightIcon(ctx.hass, id, ctx.lightInfo[id]) })),
    });
    const place = (g: PickGroup): PlaceGroup => ({ key: g.key, lights: g.items.map((i) => i.id) });
    const set = (places: Pick<AutomationInput, "rooms" | "zones">) => (this.lightsSheet = { ...sheet, places });
    return this.pickSheet({
      title: t("automations.edit_lights"),
      sections: [
        { label: t("automations.rooms"), groups: ctx.home.rooms.map((g) => asPick(g, false)) },
        { label: t("automations.zones"), groups: ctx.home.zones.map((g) => asPick(g, true)) },
      ],
      picked: (g) => pickedOf(input, place(g)),
      sub: (g, picked) =>
        picked === "all"
          ? t(g.whole ? "automations.entire_zone_selected" : "automations.entire_room_selected")
          : picked.length
            ? t("automations.some_selected", { count: picked.length, total: g.items.length })
            : "",
      flip: (g) => set(withGroup(input, place(g))),
      flipItem: (g, id) => set(withLight(input, place(g), id)),
      open: sheet.open,
      setOpen: (open) => (this.lightsSheet = { ...sheet, open }),
      close: () => (this.lightsSheet = null),
      done: () => {
        this.set(sheet.places);
        this.lightsSheet = null;
      },
    });
  }

  /** Motion sensors (any of HA's) by room, for the motion automation. */
  protected motionGroups(): PickGroup[] {
    const { ctx } = this;
    const { t } = ctx;
    const states = ctx.hass.states;
    const byArea = new Map<string, string[]>();
    for (const id of Object.keys(states)) {
      if (!id.startsWith("binary_sensor.") || !["motion", "occupancy", "presence"].includes(states[id].attributes.device_class as string)) continue;
      const area = this.areaOf(id) || "";
      byArea.set(area, [...(byArea.get(area) || []), id]);
    }
    const name = (area: string) => (area ? ctx.hass.areas?.[area]?.name || area : t("automations.no_room"));
    return [...byArea.entries()]
      .sort(([a], [b]) => Number(!a) - Number(!b) || name(a).localeCompare(name(b)))
      .map(([area, ids]) => ({
        key: area,
        name: name(area),
        items: ids
          .sort((a, b) => friendlyName(ctx.hass, a).localeCompare(friendlyName(ctx.hass, b)))
          .map((id) => ({ id, name: friendlyName(ctx.hass, id), icon: "mdi:motion-sensor" })),
      }));
  }

  /** An entity's area (its own, else its device's). */
  protected areaOf(id: string): string | null {
    const entry = this.ctx.hass.entities?.[id];
    return entry?.area_id || (entry?.device_id ? this.ctx.hass.devices?.[entry.device_id]?.area_id || null : null);
  }

  /** The motion sensor picker: rooms with their sensors, like the light picker. */
  protected sensorsSheetView() {
    const { t } = this.ctx;
    const sheet = this.sensorsSheet!;
    const set = (chosen: string[]) => (this.sensorsSheet = { ...sheet, chosen });
    return this.pickSheet({
      title: t("automations.motion_sensors"),
      sections: [{ label: t("automations.rooms"), groups: this.motionGroups() }],
      empty: t("automations.no_motion_sensors"),
      picked: (g) => {
        const on = g.items.filter((i) => sheet.chosen.includes(i.id)).map((i) => i.id);
        return on.length === g.items.length ? "all" : on;
      },
      sub: (g, picked) =>
        picked === "all"
          ? t(g.items.length === 1 ? "automations.one_sensor" : "automations.all_sensors")
          : picked.length
            ? t("automations.some_sensors", { count: picked.length, total: g.items.length })
            : "",
      flip: (g) => {
        const ids = g.items.map((i) => i.id);
        const all = ids.every((id) => sheet.chosen.includes(id));
        set(all ? sheet.chosen.filter((id) => !ids.includes(id)) : [...new Set([...sheet.chosen, ...ids])]);
      },
      flipItem: (_g, id) => set(sheet.chosen.includes(id) ? sheet.chosen.filter((x) => x !== id) : [...sheet.chosen, id]),
      open: sheet.open,
      setOpen: (open) => (this.sensorsSheet = { ...sheet, open }),
      close: () => (this.sensorsSheet = null),
      done: () => {
        const lux = this.luxFor(sheet.chosen);
        this.set({ motion: sheet.chosen, lux_sensor: lux });
        // Daytime brightness follows the sensors' own light sensor.
        if (this.day.settings.light_sensor) this.settings({ light_sensor: lux || null });
        this.sensorsSheet = null;
      },
    });
  }

  /** The motion sensors it has, like its lights: a tile each with its room; none yet: "Add sensors". */
  protected selectedSensors(d: AutomationDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const chosen = (d.input.motion || []).filter((id) => ctx.hass.states[id]);
    const edit = () => {
      haptic("selection");
      const open = this.motionGroups()
        .filter((g) => g.items.some((i) => chosen.includes(i.id)) && !g.items.every((i) => chosen.includes(i.id)))
        .map((g) => g.key);
      this.sensorsSheet = { chosen, open };
    };
    if (!chosen.length)
      return html`<div class="rows lights-card">
        <div class="item lights-head">
          <div class="grow">${t("automations.add_sensors")}</div>
          <button class="round add" aria-label=${t("automations.add_sensors")} @click=${edit}>${icon("plus")}</button>
        </div>
      </div>`;
    return html`<div class="rows lights-card">
      <div class="item lights-head">
        <div class="grow">${t("automations.motion_sensors")}</div>
        <button class="round" aria-label=${t("automations.motion_sensors")} @click=${edit}>${icon("pencil")}</button>
      </div>
      <div class="place-tiles">
        ${chosen.map((id) => {
          const area = this.areaOf(id);
          return html`<button class="place-tile" @click=${edit}>
            <ha-icon icon="mdi:motion-sensor"></ha-icon>
            <span class="name">${friendlyName(ctx.hass, id)}</span>
            <span class="sub">${(area && ctx.hass.areas?.[area]?.name) || t("automations.no_room")}</span>
          </button>`;
        })}
      </div>
    </div>`;
  }

  /** "General", like the Hue app's: the light (its kind and settings), then what each type adds. */
  protected general(d: AutomationDraft) {
    const { t } = this.ctx;
    const i = d.input;
    const light = LIGHT_KINDS[d.type].length ? this.light(d) : nothing;
    const extra =
      d.type === "wake_up"
        ? this.offRow(d, t("automations.off_after_wake"))
        : d.type === "go_to_sleep"
          ? this.fadeRow(i.fade)
          : nothing;
    if (light === nothing && extra === nothing) return nothing;
    return html`<h2 class="label">${t("automations.general")}</h2><div class="rows">${light}${extra}</div>`;
  }

  /** The light: its kind, then that kind's settings. */
  protected light(d: AutomationDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const kinds = LIGHT_KINDS[d.type];
    const kind = (d.input.light && kinds.includes(d.input.light) ? d.input.light : kinds[0]) as LightKind;
    const options = kinds.map((k) => ({ value: k, label: t(`automations.light_${k}` as StringKey), sub: t(`automations.light_${k}_sub` as StringKey), icon: LIGHT_ICONS[k] }));
    return html`${navRow({ icon: LIGHT_ICONS[kind], title: t("automations.light_kind"), value: t(`automations.light_${kind}` as StringKey) }, () =>
        this.choose(single(t("automations.light_kind"), options, kind, (light) => this.set({ light: light as LightKind }))),
      )}
      ${kind === "scene" ? this.sceneLight(d) : kind === "white" ? this.whiteLight(d) : this.dayLight(d, kind)}`;
  }

  protected brightnessRow(value: number | null, change: (v: number | null) => void, own?: StringKey) {
    const { t } = this.ctx;
    const label = (v: number | null) => (v === null ? t(own!) : `${v} %`);
    const options = [...(own ? [null] : []), ...[...BRIGHTNESS_LEVELS].reverse()].map((v) => ({ value: v === null ? "" : String(v), label: label(v) }));
    return navRow({ icon: "mdi:brightness-6", title: t("common.brightness"), value: label(value) }, () =>
      this.choose(single(t("common.brightness"), options, value === null ? "" : String(value), (v) => change(v ? Number(v) : null))),
    );
  }

  protected sceneLight(d: AutomationDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const scenes = d.input.scenes || [];
    return html`${this.places(d.input).map(({ key }) => {
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
  protected whiteRow(title: string, kelvin: number, change: (v: number) => void, glyph?: string) {
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

  protected whiteLight(d: AutomationDraft) {
    const { t } = this.ctx;
    return html`${this.whiteRow(t("automations.white"), d.input.kelvin || 2700, (kelvin) => this.set({ kelvin }))}
      ${this.brightnessRow(d.input.brightness || 100, (v) => this.set({ brightness: v ?? 100 }))}`;
  }

  /** Natural light or the scene of the day: what it shows now, and its settings page. */
  protected dayLight(d: AutomationDraft, kind: "natural" | "auto") {
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

  protected get day(): DayConfig {
    return dayConfig(this.draft?.input.scene_of_the_day);
  }

  protected setDay(config: DayConfig): void {
    this.set({ scene_of_the_day: config });
  }

  protected leaveDay(): void {
    this.page = "main";
    this.popPage();
  }

  protected dayPage(natural: boolean) {
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
  protected legacyOffer(natural: boolean) {
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

  protected today(natural: boolean) {
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
    const can = placesOf(d.input).length > 0;
    const another = async () => {
      haptic("selection");
      await ctx.query({ type: "hue_studio/daylight/next" });
    };
    // A row with its picture on a disc (white light, or the scene's), its actions as round icon
    // buttons at its end: show it now, another scene of the day, never this scene.
    const action = (glyph: IconName, label: string, run: () => void, disabled = false) =>
      html`<button class="round" ?disabled=${disabled} aria-label=${label} title=${label} @click=${run}>${icon(glyph)}</button>`;
    const row = (art: string | null, title: string, sub: string, actions: unknown = nothing) => html`<div class="rows">
      <div class="item">
        ${art !== null
          ? html`<span class="row-art disc" style=${styleMap({ background: art })}></span>`
          : html`<span class="row-art disc"><ha-icon icon="mdi:palette-swatch-variant"></ha-icon></span>`}
        <div class="grow">${title}${sub ? html`<div class="dim small">${sub}</div>` : nothing}</div>
        ${actions === nothing ? nothing : html`<div class="row-actions">${actions}</div>`}
      </div>
    </div>`;
    if (p?.kelvin) {
      return html`<h2 class="label">${t("auto.now")}</h2>
        ${row(whiteArt(p.kelvin), `${t("auto.style_natural")} · ${p.kelvin} K`, stateLine(t, p), action("play", t("auto.show_now"), () => void show(), !can))}`;
    }
    if (!p?.scene) return html`<h2 class="label">${t("auto.today")}</h2>${row(null, t("auto.no_scene"), "")}`;
    const scene = p.scene;
    return html`<h2 class="label">${t("auto.today")}</h2>
      ${row(
        `url("${thumbUrl(scene)}") center / cover`,
        p.scene_name || this.sceneName(scene),
        stateLine(t, p),
        html`${action("play", t("auto.show_now"), () => void show(), !can)}
          ${action("shuffle", t("auto.another"), () => void another(), (p.pool?.length ?? 0) < 2)}
          ${action("hide", t("auto.never"), () => this.setDay(withExcluded(this.day, scene, true)))}`,
      )}`;
  }

  protected sceneName(id: string): string {
    return this.ctx.gallery?.scenes.find((s) => s.id === id)?.name || id;
  }

  /** The global pool (a link to its settings), this automation's extra and skipped scenes. */
  protected scenes(config: DayConfig) {
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

  protected settings(patch: Partial<Record<keyof DaySettings, unknown>>): void {
    this.setDay(withSettings(this.day, patch));
  }

  /** The global phase times, or this automation's own. */
  protected phases(config: DayConfig) {
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
  protected kelvin(settings: DaySettings) {
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
  protected brightness(config: DayConfig) {
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
    // A motion sensor's automation: the day's brightness by the sensor's own light sensor.
    const d = this.draft!;
    const lux = d.type === "motion" ? d.input.lux_sensor || this.luxFor(d.input.motion || []) : "";
    const bySensor = !!config.settings.light_sensor;
    return html`<p class="lead">${t("auto.brightness_hint")}</p>
      ${lux
        ? html`<div class="rows">
            <div class="item">
              <ha-icon icon="mdi:brightness-5"></ha-icon>
              <div class="grow">${t("auto.daytime_brightness")}<div class="dim small">${t("auto.daytime_brightness_sub")}</div></div>
              ${toggle(bySensor, t("auto.daytime_brightness"), () => {
                haptic("selection");
                this.settings({ light_sensor: bySensor ? null : lux });
              })}
            </div>
          </div>`
        : nothing}
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

  protected gradient(settings: DaySettings) {
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

  protected openPicker(title: string, selected: string[], save: (ids: string[]) => void): void {
    this.picker = { title, selected: [...selected], query: "", save };
  }
}
