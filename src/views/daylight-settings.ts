// Settings → Light of the day: what natural light and the scene of the day of every automation
// start from. The mood (HA's "Mood" select of Hue Studio), phase times, the sources (weather,
// season, light sensor; HA integrations to add when there are none) and the scene pool: every
// scene's tags — the phases, seasons, weather and moods it fits — starting from Hue Studio's
// ready-made ones. The pool is shown by phase (and season) or by mood; a tap on a scene opens
// its tags.

import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import {
  inPool,
  MOOD_ICONS,
  MOODS,
  PHASES,
  phaseTimes,
  type PoolView,
  SEASONS,
  scenesOf,
  TAG_KEYS,
  TAG_VALUES,
  type TagKey,
  tagsFor,
  viewCounts,
  withTag,
} from "../daylight.ts";
import { thumbUrl } from "../gallery-data.ts";
import { haptic } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import { friendlyName } from "../model.ts";
import type { DaylightMessage, Mood, SceneTags } from "../types.ts";
import { icon, toggle } from "../ui.ts";
import { StudioView } from "./base.ts";
import { PHASE_ICONS, type Picker, phaseRows, pickerSheet, stateLine } from "./day-parts.ts";

/** HA's dialog to add an integration (core ones: Season, Met.no). */
const addIntegration = (domain: string) => `/config/integrations/dashboard/add?domain=${domain}`;
const SEASON_STATES = ["winter", "spring", "summer", "autumn"];

@customElement("hue-studio-daylight-settings-view")
export class DaylightSettingsView extends StudioView {
  /** What the pool editor shows (null: where today's scene comes from). */
  @state() private accessor view: PoolView | null = null;
  /** The scene whose tags are open. */
  @state() private accessor editing: string | null = null;
  @state() private accessor picker: Picker | null = null;

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const day = ctx.daylight;
    const body = !day
      ? html`<p class="empty">${t("rooms.loading")}</p>`
      : html`<p class="lead">${t("daylight.intro")}</p>
          ${this.today(day)}
          ${day.mood_entity ? html`<h2 class="label">${t("daylight.mood")}</h2>${this.moods(day)}` : nothing}
          <h2 class="label">${t("auto.phases")}</h2>
          <p class="lead">${t("daylight.phases_hint")}</p>
          ${phaseRows(t, phaseTimes({}, day.settings), (patch) => ctx.setDaylight(patch), day.now.phase)}
          <h2 class="label">${t("daylight.sources")}</h2>
          ${this.sources(day)}
          <h2 class="label">${t("daylight.pool")}</h2>
          ${this.pool(day)}`;
    return html`${this.screen(this.subHead(t("daylight.title"), () => ctx.go("/settings")), body, "settings-page auto-page daylight-page")}
      ${day && this.editing ? this.tagSheet(day, this.editing) : nothing}
      ${this.picker ? pickerSheet(ctx, this.picker, (picker) => (this.picker = picker)) : nothing}`;
  }

  private sceneName(id: string): string {
    return this.ctx.gallery?.scenes.find((s) => s.id === id)?.name || id;
  }

  /** Today's scene of the global pool, and what it depends on. */
  private today(day: DaylightMessage) {
    const { t } = this.ctx;
    const p = day.now;
    if (!p.scene) return html`<div class="today empty-today"><ha-icon icon="mdi:palette-swatch-variant"></ha-icon><span>${t("daylight.empty")}</span></div>`;
    return html`<div class="today">
      <img class="pic" src=${thumbUrl(p.scene)} alt="" />
      <div class="text">
        <div class="dim small">${t("auto.today")}</div>
        <div class="name">${p.scene_name || this.sceneName(p.scene)}</div>
        <div class="dim small">${stateLine(t, p, false)} · ${t("daylight.pool_count", { count: p.pool.length })}</div>
      </div>
    </div>`;
  }

  /** The mood: by the day, or one of the moods (HA's select, so automations can set it too). */
  private moods(day: DaylightMessage) {
    const { ctx } = this;
    const { t } = ctx;
    const entity = day.mood_entity!;
    const current = ctx.hass.states[entity]?.state || "auto";
    const pick = (option: string) => {
      if (option === current) return;
      haptic("selection");
      void ctx.call("select", "select_option", { entity_id: entity, option }, { optimistic: false });
    };
    const chip = (option: string, glyph: string, label: string) =>
      html`<button class=${classMap({ chip: true, on: option === current })} role="radio" aria-checked=${option === current} @click=${() => pick(option)}>
        <ha-icon icon=${glyph}></ha-icon>${label}
      </button>`;
    return html`<p class="lead">${t("daylight.mood_hint")}</p>
      <div class="chips wrap" role="radiogroup" aria-label=${t("daylight.mood")}>
        ${chip("auto", "mdi:theme-light-dark", t("daylight.mood_auto"))}
        ${MOODS.map((m) => chip(m, MOOD_ICONS[m], t(`auto.mood_${m}` as StringKey)))}
      </div>`;
  }

  /** Weather, season and light sensor: chosen, found, or an integration to add. */
  private sources(day: DaylightMessage) {
    const { ctx } = this;
    const { t } = ctx;
    const states = ctx.hass.states;
    const ids = Object.keys(states).sort((a, b) => friendlyName(ctx.hass, a).localeCompare(friendlyName(ctx.hass, b)));
    const weather = ids.filter((id) => id.startsWith("weather."));
    const seasons = ids.filter((id) => id.startsWith("sensor.") && (SEASON_STATES.includes(states[id].state) || id === day.settings.season));
    const lux = ids.filter((id) => id.startsWith("sensor.") && states[id].attributes.device_class === "illuminance");
    const picker = (key: "weather" | "season" | "light_sensor", options: string[], auto: string) =>
      html`<select class="select" aria-label=${t(`daylight.source_${key}` as StringKey)}
        @change=${(e: Event) => ctx.setDaylight({ [key]: (e.target as HTMLSelectElement).value || null })}>
        <option value="" ?selected=${!day.settings[key]}>${auto}</option>
        ${options.map((id) => html`<option value=${id} ?selected=${day.settings[key] === id}>${friendlyName(ctx.hass, id)}</option>`)}
      </select>`;
    const found = (key: "weather" | "season") => {
      const id = day.sources[key];
      return id ? t("daylight.found", { name: friendlyName(ctx.hass, id) }) : t(`daylight.${key}_none` as StringKey);
    };
    const add = (domain: string) =>
      html`<button class="pill small-pill" @click=${() => ctx.openHa(addIntegration(domain))}>${t("daylight.add")}</button>`;
    return html`<p class="lead">${t("daylight.sources_hint")}</p>
      <div class="rows">
        <div class="item wrap"><ha-icon icon="mdi:weather-partly-rainy"></ha-icon>
          <div class="grow">${t("daylight.source_weather")}<div class="dim small">${weather.length ? t("daylight.source_weather_sub") : t("daylight.weather_add")}</div></div>
          ${weather.length ? picker("weather", weather, found("weather")) : add("met")}
        </div>
        <div class="item wrap"><ha-icon icon="mdi:leaf"></ha-icon>
          <div class="grow">${t("daylight.source_season")}<div class="dim small">${seasons.length ? t("daylight.source_season_sub") : t("daylight.season_add")}</div></div>
          ${seasons.length ? picker("season", seasons, found("season")) : add("season")}
        </div>
        <div class="item wrap"><ha-icon icon="mdi:brightness-5"></ha-icon>
          <div class="grow">${t("daylight.source_light_sensor")}<div class="dim small">${t("daylight.source_light_sensor_sub")}</div></div>
          ${picker("light_sensor", lux, t("auto.none"))}
        </div>
      </div>`;
  }

  /** The pool: ready-made tags on/off, then its scenes by phase (and season) or mood. */
  private pool(day: DaylightMessage) {
    const { ctx } = this;
    const { t } = ctx;
    const order = (ctx.gallery?.scenes || []).map((s) => s.id);
    const view: PoolView = this.view || (day.now.mood ? { mood: day.now.mood } : { phase: day.now.pool_phase, season: day.now.season });
    const counts = viewCounts(day.tags);
    const scenes = scenesOf(view, day.tags, order);
    const go = (next: PoolView) => {
      haptic("selection");
      this.view = next;
    };
    const chip = (on: boolean, label: string, pick: () => void, glyph = "") =>
      html`<button class=${classMap({ chip: true, on })} @click=${pick}>${glyph ? html`<ha-icon icon=${glyph}></ha-icon>` : nothing}${label}</button>`;
    const isPhase = "phase" in view;
    const flipDefaults = () => {
      haptic("selection");
      void ctx.setDaylight({ defaults: !day.settings.defaults });
    };
    const out = "out" in view;
    const pickScenes = () => {
      const before = new Set(scenes);
      this.picker = {
        title: t("auto.choose_scenes"),
        selected: [...scenes],
        query: "",
        save: (ids) => {
          const chosen = new Set(ids);
          for (const id of order) {
            if (chosen.has(id) === before.has(id)) continue;
            void ctx.setSceneTags(id, tagsFor(view, day.tags[id] || {}, chosen.has(id)));
          }
        },
      };
    };
    return html`<p class="lead">${t("daylight.pool_hint")}</p>
      <div class="rows">
        <div class="item">
          <ha-icon icon="mdi:auto-fix"></ha-icon>
          <div class="grow">${t("daylight.defaults")}<div class="dim small">${t("daylight.defaults_sub")}</div></div>
          ${toggle(day.settings.defaults, t("daylight.defaults"), flipDefaults)}
        </div>
      </div>
      <div class="chips wrap pool-views">
        ${PHASES.map((phase) =>
          chip(isPhase && view.phase === phase, `${t(`auto.phase_${phase}` as StringKey)} · ${counts[phase] || 0}`, () => go({ phase, season: isPhase ? view.season : null }), PHASE_ICONS[phase]),
        )}
      </div>
      <div class="chips wrap pool-views">
        ${MOODS.map((mood) =>
          chip("mood" in view && view.mood === mood, `${t(`auto.mood_${mood}` as StringKey)} · ${counts[mood] || 0}`, () => go({ mood }), MOOD_ICONS[mood]),
        )}
        ${chip(out, t("daylight.out"), () => go({ out: true }), "mdi:eye-off-outline")}
      </div>
      ${isPhase
        ? html`<div class="chips wrap pool-views">
            ${chip(!view.season, t("auto.season_all"), () => go({ phase: view.phase, season: null }))}
            ${SEASONS.map((season) => chip(view.season === season, t(`auto.season_${season}` as StringKey), () => go({ phase: view.phase, season })))}
          </div>`
        : nothing}
      <p class="lead small">${t(out ? "daylight.out_hint" : "mood" in view ? "daylight.mood_view_hint" : "daylight.phase_view_hint")}</p>
      <div class="scene-tiles">
        ${scenes.map(
          (id) => html`<div class=${classMap({ tile: true, dimmed: out })} style="background-image: url(${thumbUrl(id)})">
            <button class="tile-open" aria-label=${this.sceneName(id)} @click=${() => (this.editing = id)}></button>
            <span>${this.sceneName(id)}</span>
            ${out
              ? nothing
              : html`<button class="round mini remove" aria-label=${t("auto.remove_scene")}
                  @click=${() => ctx.setSceneTags(id, tagsFor(view, day.tags[id] || {}, false))}>${icon("close")}</button>`}
          </div>`,
        )}
        ${out ? nothing : html`<button class="tile add-tile" @click=${pickScenes}>${icon("plus")}<span>${t("auto.add_scenes")}</span></button>`}
      </div>`;
  }

  /** One scene's tags: the phases, seasons, weather and moods it fits. */
  private tagSheet(day: DaylightMessage, scene: string) {
    const { ctx } = this;
    const { t } = ctx;
    const close = () => (this.editing = null);
    const tags: SceneTags = day.tags[scene] || {};
    const own = scene in day.user_tags;
    const set = (next: SceneTags | null) => {
      haptic("selection");
      void ctx.setSceneTags(scene, next);
    };
    const label = (key: TagKey, value: string) =>
      t(`auto.${key === "phases" ? "phase" : key === "seasons" ? "season" : key === "weather" ? "weather" : "mood"}_${value}` as StringKey);
    const group = (key: TagKey) => {
      const list = (tags[key] as string[] | undefined) || [];
      return html`<h3 class="sublabel">${t(`daylight.tag_${key}` as StringKey)}</h3>
        <div class="chips wrap">
          ${TAG_VALUES[key].map(
            (value) => html`<button class=${classMap({ chip: true, on: list.includes(value) })} aria-pressed=${list.includes(value)}
              @click=${() => set(withTag(tags, key, value, !list.includes(value)))}>
              ${key === "moods" ? html`<ha-icon icon=${MOOD_ICONS[value as Mood]}></ha-icon>` : nothing}${label(key, value)}
            </button>`,
          )}
        </div>
        ${!list.length && key !== "moods" ? html`<p class="hint">${t(key === "phases" ? "daylight.no_phases" : "daylight.any")}</p>` : nothing}`;
    };
    return html`<div class="sheet" @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="box form tag-editor" role="dialog" aria-label=${this.sceneName(scene)}>
        <div class="sheet-bar">
          <img class="tag-pic" src=${thumbUrl(scene)} alt="" />
          <div class="grow">${this.sceneName(scene)}
            <div class="dim small">${t(!inPool(tags) ? "daylight.not_in_pool" : own ? "daylight.own_tags" : "daylight.ready_tags")}</div>
          </div>
          <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
        </div>
        <div class="form-body">${TAG_KEYS.map(group)}</div>
        <div class="actions">
          ${own && day.defaults[scene] ? html`<button class="pill reset" @click=${() => set(null)}>${t("daylight.reset_tags")}</button>` : nothing}
          ${inPool(tags) ? html`<button class="pill reset" @click=${() => set({})}>${t("daylight.remove")}</button>` : nothing}
          <button class="pill apply" @click=${close}>${t("color.done")}</button>
        </div>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-daylight-settings-view": DaylightSettingsView;
  }
}
