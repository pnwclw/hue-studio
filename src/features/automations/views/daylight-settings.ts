// Settings → Light of the day: what natural light and the scene of the day of every automation
// start from. Today's scene and the mood (HA's "Mood" select of Hue Studio), phase times, the
// sources (weather and season; HA integrations to add when there are none), the daytime
// brightness (a light sensor, else cloud cover) and the scene pool: every
// scene's tags — the phases, seasons, weather and moods it fits — starting from Hue Studio's
// ready-made ones. The pool is shown by phase (and season) or by mood; a tap on a scene opens
// its tags.

import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

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
import { thumbUrl } from "../../scenes/gallery-data.ts";
import { haptic } from "../../../core/ha-internals.ts";
import type { StringKey } from "../../../i18n/index.ts";
import { friendlyName } from "../../../core/model.ts";
import type { DaylightMessage, Mood, Phase, SceneTags } from "../../../core/types.ts";
import { icon, toggle } from "../../../ds/ui.ts";
import { StudioView } from "../../../ds/base.ts";
import { navRow, single } from "../../../ds/choice.ts";
import { PHASE_ICONS, type Picker, phaseRows, pickerSheet, stateLine } from "./day-parts.ts";

/** HA's dialog to add an integration (core ones: Season, Met.no). */
const addIntegration = (domain: string) => `/config/integrations/dashboard/add?domain=${domain}`;
const SEASON_STATES = ["winter", "spring", "summer", "autumn"];

type Page = "main" | "phases" | "sources" | "pool";

@customElement("hue-studio-daylight-settings-view")
export class DaylightSettingsView extends StudioView {
  /** The screen shown: the overview, or one of its parts. */
  @state() private accessor page: Page = "main";
  /** What the pool editor shows (null: where today's scene comes from). */
  @state() private accessor view: PoolView | null = null;
  /** The scene whose tags are open. */
  @state() private accessor editing: string | null = null;
  @state() private accessor picker: Picker | null = null;

  private open(page: Page): void {
    haptic("selection");
    this.pushPage();
    this.page = page;
  }

  private back(): void {
    if (this.page === "main") return this.ctx.go("/settings");
    this.page = "main";
    this.popPage();
  }

  protected override renderPage() {
    const { ctx } = this;
    const { t } = ctx;
    const day = ctx.daylight;
    const titles: Record<Page, string> = { main: t("daylight.title"), phases: t("auto.phases"), sources: t("daylight.sources"), pool: t("daylight.pool") };
    let body;
    if (!day) body = html`<p class="empty">${t("rooms.loading")}</p>`;
    else if (this.page === "phases")
      body = html`<p class="lead">${t("daylight.phases_hint")}</p>
        ${phaseRows(t, phaseTimes({}, day.settings), (patch) => ctx.setDaylight(patch), (c) => this.choose(c), day.now.phase)}`;
    else if (this.page === "sources") body = this.sources(day);
    else if (this.page === "pool") body = this.pool(day);
    else body = this.overview(day);
    return html`${this.screen(this.subHead(titles[this.page], () => this.back()), body, "settings-page auto-page daylight-page")}
      ${day && this.editing ? this.tagSheet(day, this.editing) : nothing}
      ${this.picker ? pickerSheet(ctx, this.picker, (picker) => (this.picker = picker)) : nothing}`;
  }

  /** Today: the scene and the mood; then a row for each setting: the phases, the sources, the
   *  daytime brightness, the pool. */
  private overview(day: DaylightMessage) {
    const { ctx } = this;
    const { t } = ctx;
    const times = phaseTimes({}, day.settings);
    const name = (id: string | null | undefined) => (id && ctx.hass.states[id] ? friendlyName(ctx.hass, id) : "");
    const weather = name(day.settings.weather || day.sources.weather);
    const season = name(day.settings.season || day.sources.season) || t("daylight.season_none");
    return html`<p class="lead">${t("daylight.intro")}</p>
      <h2 class="label">${t("auto.today")}</h2>
      <div class="rows">${this.today(day)}${day.mood_entity ? this.mood(day) : nothing}</div>
      <h2 class="label">${t("daylight.settings")}</h2>
      <div class="rows">
        ${navRow(
          { icon: PHASE_ICONS[day.now.phase], title: t("auto.phases"), sub: t("daylight.phases_sub", { phase: t(`auto.phase_${day.now.phase}` as StringKey), night: times.night_from }) },
          () => this.open("phases"),
        )}
        ${navRow({ icon: "mdi:weather-partly-cloudy", title: t("daylight.sources"), sub: [weather || t("daylight.not_set"), season].join(" · ") }, () => this.open("sources"))}
        ${this.brightness(day)}
        ${navRow({ icon: "mdi:image-multiple-outline", title: t("daylight.pool"), sub: t("daylight.pool_count", { count: Object.keys(day.tags).length }) }, () => this.open("pool"))}
      </div>`;
  }

  private sceneName(id: string): string {
    return this.ctx.gallery?.scenes.find((s) => s.id === id)?.name || id;
  }

  /** Today's scene of the global pool and what it depends on: a row with its picture on a disc,
   *  opening the pool where it comes from. */
  private today(day: DaylightMessage) {
    const { t } = this.ctx;
    const p = day.now;
    const scene = p.scene;
    return html`<button class="item nav" @click=${() => this.open("pool")}>
      ${scene
        ? html`<span class="row-art disc" style=${styleMap({ background: `url("${thumbUrl(scene)}") center / cover` })}></span>`
        : html`<span class="row-art disc"><ha-icon icon="mdi:palette-swatch-variant"></ha-icon></span>`}
      <div class="grow">${scene ? p.scene_name || this.sceneName(scene) : t("daylight.empty")}
        <div class="dim small">${stateLine(t, p, false)} · ${t("daylight.pool_count", { count: p.pool.length })}</div>
      </div>
      <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
    </button>`;
  }

  /** The mood: by the day, or one of the moods (HA's select, so automations can set it too). */
  private mood(day: DaylightMessage) {
    const { ctx } = this;
    const { t } = ctx;
    const entity = day.mood_entity!;
    const current = ctx.hass.states[entity]?.state || "auto";
    const label = (m: string) => (m === "auto" ? t("daylight.mood_auto") : t(`auto.mood_${m}` as StringKey));
    const glyph = (m: string) => (m === "auto" ? "mdi:theme-light-dark" : MOOD_ICONS[m as Mood]);
    const options = ["auto", ...MOODS].map((m) => ({ value: m, label: label(m), icon: glyph(m) }));
    return navRow({ icon: glyph(current), title: t("daylight.mood"), value: label(current) }, () =>
      this.choose(
        single(t("daylight.mood"), options, current, (option) => void ctx.call("select", "select_option", { entity_id: entity, option }, { optimistic: false }), t("daylight.mood_hint")),
      ),
    );
  }

  /** The day's brightness: a light sensor (the brighter outside, the dimmer), else cloud cover. */
  private brightness(day: DaylightMessage) {
    const { ctx } = this;
    const { t } = ctx;
    const states = ctx.hass.states;
    const sensors = Object.keys(states)
      .filter((id) => id.startsWith("sensor.") && states[id].attributes.device_class === "illuminance")
      .sort((a, b) => friendlyName(ctx.hass, a).localeCompare(friendlyName(ctx.hass, b)));
    const current = day.settings.light_sensor || "";
    const title = t("daylight.brightness");
    const options = [
      { value: "", label: t("daylight.brightness_clouds"), icon: "mdi:weather-cloudy" },
      ...sensors.map((id) => ({ value: id, label: friendlyName(ctx.hass, id), icon: "mdi:brightness-5" })),
    ];
    // What it goes by, as the line under it (a sensor's name is too long for the value).
    return navRow({ icon: "mdi:brightness-5", title, sub: current ? friendlyName(ctx.hass, current) : t("daylight.brightness_clouds") }, () =>
      this.choose(single(title, options, current, (v) => ctx.setDaylight({ light_sensor: v || null }), t("daylight.brightness_hint"))),
    );
  }

  /** Weather and season: chosen, found, or an integration to add. */
  private sources(day: DaylightMessage) {
    const { ctx } = this;
    const { t } = ctx;
    const states = ctx.hass.states;
    const ids = Object.keys(states).sort((a, b) => friendlyName(ctx.hass, a).localeCompare(friendlyName(ctx.hass, b)));
    const weather = ids.filter((id) => id.startsWith("weather."));
    const seasons = ids.filter((id) => id.startsWith("sensor.") && (SEASON_STATES.includes(states[id].state) || id === day.settings.season));
    const found = (key: "weather" | "season") => {
      const id = day.sources[key];
      return id ? t("daylight.found", { name: friendlyName(ctx.hass, id) }) : t(`daylight.${key}_none` as StringKey);
    };
    const row = (key: "weather" | "season", glyph: string, options: string[], auto: string, sub: string) => {
      const title = t(`daylight.source_${key}` as StringKey);
      const current = day.settings[key] || "";
      return navRow({ icon: glyph, title, sub, value: current ? friendlyName(ctx.hass, current) : auto }, () =>
        this.choose(
          single(
            title,
            [{ value: "", label: auto }, ...options.map((id) => ({ value: id, label: friendlyName(ctx.hass, id), icon: glyph }))],
            current,
            (v) => ctx.setDaylight({ [key]: v || null }),
            sub,
          ),
        ),
      );
    };
    const add = (glyph: string, title: string, sub: string, domain: string) =>
      html`<button class="item nav" @click=${() => ctx.openHa(addIntegration(domain))}>
        <ha-icon icon=${glyph}></ha-icon>
        <div class="grow">${title}<div class="dim small">${sub}</div></div>
        <span class="value">${t("daylight.add")}</span>${icon("open")}
      </button>`;
    return html`<p class="lead">${t("daylight.sources_hint")}</p>
      <div class="rows">
        ${weather.length
          ? row("weather", "mdi:weather-partly-rainy", weather, found("weather"), t("daylight.source_weather_sub"))
          : add("mdi:weather-partly-rainy", t("daylight.source_weather"), t("daylight.weather_add"), "met")}
        ${seasons.length
          ? row("season", "mdi:leaf", seasons, found("season"), t("daylight.source_season_sub"))
          : add("mdi:leaf", t("daylight.source_season"), t("daylight.season_add"), "season")}
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
    const isPhase = "phase" in view;
    const out = "out" in view;
    const flipDefaults = () => {
      haptic("selection");
      void ctx.setDaylight({ defaults: !day.settings.defaults });
    };
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
    // What is shown: a phase, a mood, or the scenes left out; and for a phase, a season.
    const key = isPhase ? `phase:${view.phase}` : "mood" in view ? `mood:${view.mood}` : "out";
    const viewLabel = isPhase ? t(`auto.phase_${view.phase}` as StringKey) : "mood" in view ? t(`auto.mood_${view.mood}` as StringKey) : t("daylight.out");
    const count = (n: number | undefined) => t("daylight.pool_count", { count: n || 0 });
    const views = [
      ...PHASES.map((phase) => ({ value: `phase:${phase}`, label: t(`auto.phase_${phase}` as StringKey), sub: count(counts[phase]), icon: PHASE_ICONS[phase] })),
      ...MOODS.map((mood) => ({ value: `mood:${mood}`, label: t(`auto.mood_${mood}` as StringKey), sub: count(counts[mood]), icon: MOOD_ICONS[mood] })),
      { value: "out", label: t("daylight.out"), icon: "mdi:eye-off-outline" },
    ];
    const go = (value: string) => {
      const [kind, name] = value.split(":");
      this.view = kind === "phase" ? { phase: name as Phase, season: isPhase ? view.season : null } : kind === "mood" ? { mood: name as Mood } : { out: true };
    };
    const seasonLabel = (s: string | null) => (s ? t(`auto.season_${s}` as StringKey) : t("auto.season_all"));
    const chip = (label: string, open: () => void, on = true) =>
      html`<button class=${classMap({ chip: true, "filter-chip": true, on })} aria-haspopup="dialog" @click=${open}>
        <span>${label}</span><ha-icon icon="mdi:chevron-down"></ha-icon>
      </button>`;
    return html`<p class="lead">${t("daylight.pool_hint")}</p>
      <div class="rows">
        <div class="item">
          <ha-icon icon="mdi:auto-fix"></ha-icon>
          <div class="grow">${t("daylight.defaults")}<div class="dim small">${t("daylight.defaults_sub")}</div></div>
          ${toggle(day.settings.defaults, t("daylight.defaults"), flipDefaults)}
        </div>
      </div>
      <div class="section-head filter-head">
        <h2 class="label">${t("daylight.pool_view")}</h2>
        <span class="count">${scenes.length}</span>
      </div>
      <div class="chips filters">
        ${chip(viewLabel, () => this.choose(single(t("daylight.pool_view"), views, key, go)))}
        ${isPhase
          ? chip(seasonLabel(view.season), () =>
              this.choose(
                single(
                  t("daylight.tag_seasons"),
                  [null, ...SEASONS].map((s) => ({ value: s || "", label: seasonLabel(s) })),
                  view.season || "",
                  (s) => (this.view = { phase: view.phase, season: (s || null) as typeof view.season }),
                ),
              ), !!view.season)
          : nothing}
      </div>
      <p class="hint">${t(out ? "daylight.out_hint" : "mood" in view ? "daylight.mood_view_hint" : "daylight.phase_view_hint")}</p>
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
