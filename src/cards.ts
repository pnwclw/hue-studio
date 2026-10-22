// Dashboard cards (loaded on every HA page with the more-info override):
//   custom:hue-studio-room-card        a room: toggle, brightness, sensors, its scenes
//   custom:hue-studio-automations-card Hue Studio's automations (of an area) with their switches
//     (custom:hue-studio-auto-light-card, the auto light card of before, now shows the same)
//   custom:hue-studio-gallery-card     gallery scenes to set once in a room
// All cards of a page share one StudioContext (one set of WebSocket subscriptions). They
// use HA's theme colors; everything else (scenes, colors, commands) is the panel's.

import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult, unsafeCSS } from "lit";
import { property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import { cardLines, fromConfig, isType, TYPE_ICONS } from "./automations.ts";
import { paletteArt } from "./color.ts";
import { PANEL_PATH, StudioContext } from "./context.ts";
import { automationCard, groupSlider, groupToggle, sceneDot, shownState, surfaceOf } from "./controls.ts";
import { thumbUrl } from "./gallery-data.ts";
import { currentHass, navigate } from "./ha-internals.ts";
import { localize, type StringKey } from "./i18n.ts";
import { findGroup, friendlyName, type Group, type Scene } from "./model.ts";
import { gallerySeasons, shownCategories } from "./seasons.ts";
import { CSS } from "./styles.ts";
import type { Hass } from "./types.ts";
import { icon, toggle } from "./ui.ts";
import { since } from "./views/room.ts";

// ---------- one context for every card of the page ----------

let shared: { ctx: StudioContext; cards: Set<StudioCard>; hass: Hass | null; timer?: ReturnType<typeof setTimeout> } | null = null;

function attach(card: StudioCard): StudioContext {
  if (!shared) {
    const ctx = new StudioContext(() => shared?.cards.forEach((c) => c.changed()));
    shared = { ctx, cards: new Set(), hass: null };
  }
  clearTimeout(shared.timer);
  shared.cards.add(card);
  return shared.ctx;
}

function detach(card: StudioCard): void {
  if (!shared) return;
  shared.cards.delete(card);
  if (shared.cards.size) return;
  // Dashboards re-create cards when switching views: keep the subscriptions for a moment.
  shared.timer = setTimeout(() => {
    if (shared && !shared.cards.size) {
      shared.ctx.dispose();
      shared = null;
    }
  }, 10_000);
}

function feed(hass: Hass): void {
  if (!shared || shared.hass === hass) return;
  shared.hass = hass;
  shared.ctx.setHass(hass);
  shared.cards.forEach((c) => c.changed());
}

const CARD_CSS = css`
  :host {
    display: block; height: auto; overflow: visible; background: none;
    --bg: var(--ha-card-background, var(--card-background-color, #1c1c1e));
    --surface: color-mix(in srgb, var(--primary-text-color, #fff) 8%, transparent);
    --surface-2: color-mix(in srgb, var(--primary-text-color, #fff) 14%, transparent);
    --text: var(--primary-text-color, #fff); --text-2: var(--secondary-text-color, rgba(235, 235, 245, 0.6));
    color: var(--text); font-size: 14px;
  }
  ha-card { overflow: hidden; }
  .body { padding: 14px; }
  .row { display: flex; align-items: center; gap: 10px; }
  .grow { flex: 1; min-width: 0; }
  .name { font-size: 16px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { font-size: 12px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .link { display: block; background: none; border: none; padding: 0; cursor: pointer; text-align: left; color: inherit; }
  .card-head.surface { margin: -14px -14px 0; padding: 14px; border-radius: 0; }
  .card-head.surface.lit { background: var(--lit-bg); }
  .card-head.dark-text { color: #1c1c1e; }
  .card-head.dark-text .sub { color: rgba(28, 28, 30, 0.7); }
  .card-head hue-studio-slider { margin-top: 10px; }
  .dots { display: flex; gap: 12px; overflow-x: auto; scrollbar-width: none; margin: 12px -14px 0; padding: 2px 14px; }
  .dots::-webkit-scrollbar { display: none; }
  .dot-btn { flex: none; width: 64px; display: flex; flex-direction: column; align-items: center; gap: 5px; border: none; background: none;
             padding: 0; cursor: pointer; font-size: 11px; color: var(--text); }
  .dot-btn .dot { width: 52px; height: 52px; border-radius: 50%; background-size: cover; background-position: center;
                  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); transition: transform 0.2s; }
  .dot-btn:active .dot { transform: scale(0.92); }
  .dot-btn.active .dot { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--text); }
  .dot-btn span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin: 0 -14px 10px; padding: 0 14px; }
  .chip { flex: none; height: 30px; padding: 0 12px; border-radius: 15px; border: 1.5px solid transparent; background: var(--surface);
          cursor: pointer; font-size: 13px; }
  .chip.on { border-color: var(--text); }
  .seg { margin-top: 12px; }
  .seg button.on { background: var(--surface-2); }
  .meta-line { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 8px; font-size: 12px; color: var(--text-2); }
  .meta-line span { display: inline-flex; align-items: center; gap: 4px; }
  .meta-line ha-icon { --mdc-icon-size: 15px; }
  .pic { width: 72px; height: 72px; flex: none; border-radius: 50%; background-size: cover; background-position: center;
         box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .actions .pill { height: 32px; font-size: 13px; }
  .gtiles { display: grid; grid-auto-flow: column; grid-auto-columns: 132px; gap: 8px; overflow-x: auto; scrollbar-width: none;
           margin: 0 -14px 12px; padding: 0 14px; }
  .gtiles::-webkit-scrollbar { display: none; }
  .gtile { position: relative; height: 84px; border-radius: 12px; border: none; padding: 0; cursor: pointer; overflow: hidden;
           background-size: cover; background-position: center; }
  .gtile span { position: absolute; left: 8px; right: 8px; bottom: 6px; font-size: 12px; font-weight: 500; color: #fff; text-align: left;
                text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gtile.done::after { content: "✓"; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
                       font-size: 28px; color: #fff; background: rgba(0, 0, 0, 0.35); }
  .cat { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: var(--text-2); margin: 0 0 6px; }
  .warn { color: var(--text-2); font-size: 13px; }
  .auto-card { box-shadow: none; }
`;

/** Base of the cards: shared context, HA's `hass`, a re-render on every change. */
abstract class StudioCard extends LitElement {
  static override styles = [unsafeCSS(CSS), CARD_CSS];

  @state() protected accessor rev = 0;
  protected ctx: StudioContext | null = null;
  private lastHass: Hass | undefined;

  set hass(hass: Hass) {
    this.lastHass = hass;
    if (this.ctx) feed(hass);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.ctx = attach(this);
    if (this.lastHass) feed(this.lastHass);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    detach(this);
    this.ctx = null;
  }

  changed(): void {
    this.rev++;
  }

  getCardSize(): number {
    return 3;
  }

  protected panel(path: string): void {
    navigate(`${PANEL_PATH}${path}`);
  }

  protected override shouldUpdate(changed: PropertyValues<this>): boolean {
    return !!this.ctx?.ready && super.shouldUpdate(changed);
  }

  protected missing(key: StringKey): TemplateResult {
    return html`<ha-card><div class="body warn">${this.ctx?.t(key) ?? ""}</div></ha-card>`;
  }
}

/** The group of a card's `area` (an HA area id) or `room` (a panel room key). */
function groupOf(ctx: StudioContext, config: { area?: string; room?: string }): Group | null {
  return findGroup(ctx.home, config.room || (config.area ? `area.${config.area}` : null));
}

// ---------- room ----------

interface RoomConfig {
  area?: string;
  room?: string;
  scenes?: boolean;
}

class HueStudioRoomCard extends StudioCard {
  @property({ attribute: false }) accessor config: RoomConfig = {};

  setConfig(config: RoomConfig): void {
    if (!config.area && !config.room) throw new Error("hue-studio-room-card: set an area");
    this.config = config;
  }

  static getStubConfig(hass: Hass): RoomConfig {
    const area = Object.keys(hass.areas || {})[0];
    return { area };
  }

  static getConfigForm() {
    return {
      schema: [
        { name: "area", required: true, selector: { area: {} } },
        { name: "scenes", selector: { boolean: {} } },
      ],
      computeLabel: (s: { name: string }) => cardLabel(`card.field_${s.name}`),
    };
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  protected override render() {
    const ctx = this.ctx!;
    const { t } = ctx;
    const g = groupOf(ctx, this.config);
    if (!g) return this.missing("card.no_room");
    const st = shownState(ctx, g);
    const surface = surfaceOf(st);
    const key = encodeURIComponent(g.key);
    const meta = [
      st.temperature !== null ? html`<span><ha-icon icon="mdi:thermometer"></ha-icon>${st.temperature.toFixed(1)}°</span>` : nothing,
      st.illuminance !== null ? html`<span><ha-icon icon="mdi:brightness-5"></ha-icon>${Math.round(st.illuminance)} lx</span>` : nothing,
      g.sensors.motion.length
        ? html`<span><ha-icon icon=${st.motion ? "mdi:motion-sensor" : "mdi:motion-sensor-off"}></ha-icon>${
            st.motion ? t("sensors.motion") : st.lastMotion ? t("sensors.motion_ago", { time: since(st.lastMotion, lang(ctx)) }) : t("sensors.no_motion")
          }</span>`
        : nothing,
    ];
    return html`<ha-card>
      <div class="body">
        <div class=${classMap({ "card-head": true, ...surface.classes })} style=${styleMap(surface.style)}>
          <div class="row">
            <ha-icon icon=${g.icon}></ha-icon>
            <button class="grow link" @click=${() => this.panel(`/room/${key}`)}>
              <div class="name">${g.name}</div>
              <div class="sub">${st.syncing ? t("light.sync_active") : st.on ? `${st.brightness}%` : t("card.off")}</div>
            </button>
            ${groupToggle(ctx, g, st)}
          </div>
          ${groupSlider(ctx, g, st, t("common.brightness"))}
        </div>
        ${meta.some((m) => m !== nothing) ? html`<div class="meta-line">${meta}</div>` : nothing}
        ${this.config.scenes === false ? nothing : this.scenes(g)}
      </div>
    </ha-card>`;
  }

  /** The room's Hue scenes. */
  private scenes(g: Group) {
    if (!g.scenes.length) return nothing;
    return html`<div class="dots">${g.scenes.map((s) => this.sceneDot(g, s))}</div>`;
  }

  private sceneDot(g: Group, s: Scene) {
    const ctx = this.ctx!;
    const info = ctx.sceneInfo[s.entity_id];
    const dot = sceneDot(ctx.gallery, s.name, info);
    const active = !!info && info.active !== "inactive";
    const apply = async () => {
      if (await ctx.call("scene", "turn_on", { entity_id: s.entity_id })) ctx.markManual(g);
    };
    return html`<button class=${classMap({ "dot-btn": true, active })} @click=${apply}>
      <div class="dot" style=${styleMap({ background: dot })}></div><span>${s.name}</span>
    </button>`;
  }
}

// ---------- automations ----------

interface AutomationsCardConfig {
  /** Only the automations of this area (else all of Hue Studio's). */
  area?: string;
}

class HueStudioAutomationsCard extends StudioCard {
  @property({ attribute: false }) accessor config: AutomationsCardConfig = {};

  setConfig(config: AutomationsCardConfig): void {
    this.config = config;
  }

  static getStubConfig(): AutomationsCardConfig {
    return {};
  }

  static getConfigForm() {
    return {
      schema: [{ name: "area", selector: { area: {} } }],
      computeLabel: (s: { name: string }) => cardLabel(`card.field_${s.name}`),
    };
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  protected override render() {
    const ctx = this.ctx!;
    const { t } = ctx;
    const area = this.config.area;
    if (!ctx.automations) return html`<ha-card><div class="body warn">${t("rooms.loading")}</div></ha-card>`;
    const list = Object.entries(ctx.automations.automations)
      .filter(([, a]) => !area || a.areas?.includes(area))
      .map(([entityId, a]) => {
        const config = ctx.automationConfigs[entityId];
        const draft = config ? fromConfig(config) : null;
        return { entityId, id: a.id, type: a.type, draft, name: draft?.alias || friendlyName(ctx.hass, entityId) };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const title = area ? `${ctx.hass.areas?.[area]?.name || area} · ${t("automations.title")}` : t("automations.title");
    const room = area ? `?room=${encodeURIComponent(area)}` : "";
    return html`<ha-card>
      <div class="body">
        <div class="cat">${title}</div>
        ${list.length ? nothing : html`<div class="warn">${t("automations.empty")}</div>`}
        <div class="auto-list">
          ${list.map(({ entityId, id, type, draft, name }) => {
            const on = ctx.hass.states[entityId]?.state === "on";
            const lines = draft ? cardLines(draft, name, t) : { title: name, sub: "" };
            const glyph = type && isType(type) ? TYPE_ICONS[type] : "mdi:lightning-bolt";
            const open = () => id && this.panel(`/automations/${encodeURIComponent(id)}${room}`);
            const sw = toggle(on, name, () => ctx.call("automation", on ? "turn_off" : "turn_on", { entity_id: entityId }));
            return automationCard(glyph, lines.title, lines.sub, open, sw);
          })}
        </div>
        <div class="actions"><button class="pill" @click=${() => this.panel(`/automations/new${room}`)}>${t("automations.add")}</button></div>
      </div>
    </ha-card>`;
  }
}

/** The card dashboards had before automations: now the area's automations. */
class HueStudioAutoLightCard extends HueStudioAutomationsCard {}

// ---------- gallery ----------

const DEFAULT_CATEGORIES = 3;

interface GalleryConfig {
  area?: string;
  rooms?: string[];
  categories?: string[];
}

class HueStudioGalleryCard extends StudioCard {
  @property({ attribute: false }) accessor config: GalleryConfig = {};
  @state() private accessor picked: string | null = null;
  @state() private accessor done: string | null = null;
  private doneTimer?: ReturnType<typeof setTimeout>;

  setConfig(config: GalleryConfig): void {
    this.config = config;
  }

  static getStubConfig(): GalleryConfig {
    return {};
  }

  static getConfigForm() {
    return {
      schema: [
        { name: "area", selector: { area: {} } },
        { name: "rooms", selector: { area: { multiple: true } } },
        { name: "categories", selector: { select: { multiple: true, options: galleryCategories() } } },
      ],
      computeLabel: (s: { name: string }) => cardLabel(`card.field_${s.name}`),
    };
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  protected override render() {
    const ctx = this.ctx!;
    const { t } = ctx;
    const rooms = ctx.home.rooms.filter((g) => !this.config.rooms?.length || this.config.rooms.includes(g.key.slice("area.".length)));
    const fixed = this.config.area ? groupOf(ctx, { area: this.config.area }) : null;
    const target = fixed || rooms.find((g) => g.key === this.picked) || rooms[0] || null;
    if (!target) return this.missing("card.no_room");
    if (!ctx.gallery) return html`<ha-card><div class="body warn">${t("rooms.loading")}</div></ha-card>`;
    const wanted = this.config.categories;
    // The chosen categories (else the first few) that show now (seasonal gallery); the whole gallery is one tap away.
    const now = shownCategories(ctx.gallery.categories, gallerySeasons(ctx.config), ctx.hass);
    const shown = wanted?.length ? wanted.filter((id) => now.includes(id)) : now;
    const sections = ctx.gallery.categories
      .filter((c) => shown.includes(c.id))
      .map((c) => ({ c, items: ctx.gallery!.scenes.filter((s) => s.category === c.id) }))
      .filter((s) => s.items.length)
      .slice(0, wanted?.length ? undefined : DEFAULT_CATEGORIES);
    const apply = async (id: string) => {
      if (await ctx.call("hue_studio", "apply_palette", { entity_id: target.target, gallery_scene: id })) {
        this.done = id;
        clearTimeout(this.doneTimer);
        this.doneTimer = setTimeout(() => (this.done = null), 1500);
      }
    };
    return html`<ha-card>
      <div class="body">
        <div class="row" style="margin-bottom:10px">
          <div class="grow name">${t("card.gallery_title")}</div>
          <button class="round" aria-label=${t("room.gallery")} @click=${() => this.panel(`/gallery?room=${encodeURIComponent(target.key)}`)}>
            ${icon("explore")}
          </button>
        </div>
        ${fixed
          ? nothing
          : html`<div class="chips">${rooms.map(
              (g) => html`<button class=${classMap({ chip: true, on: g.key === target.key })} @click=${() => (this.picked = g.key)}>${g.name}</button>`,
            )}</div>`}
        ${sections.map(
          ({ c, items }) => html`<div class="cat">${c.name}</div>
            <div class="gtiles">${items.map(
              (s) => html`<button class=${classMap({ gtile: true, done: this.done === s.id })}
                style=${styleMap({ background: `url("${thumbUrl(s.id)}") center / cover, ${paletteArt(s)}` })}
                aria-label=${s.name} @click=${() => apply(s.id)}><span>${s.name}</span></button>`,
            )}</div>`,
        )}
        <button class="pill" @click=${() => this.panel(`/gallery?room=${encodeURIComponent(target.key)}`)}>${t("card.whole_gallery")}</button>
      </div>
    </ha-card>`;
  }
}

/** Gallery categories for the card editor (loaded once the gallery is). */
function galleryCategories(): { value: string; label: string }[] {
  return (shared?.ctx.gallery?.categories || []).map((c) => ({ value: c.id, label: c.name }));
}

// ---------- registration ----------

const lang = (ctx: StudioContext): string => ctx.hass.locale?.language || ctx.hass.language || "en";

/** Labels of the card editors (outside any card). */
function cardLabel(key: string): string {
  return localize(currentHass())(key as StringKey);
}

const CARDS: [string, CustomElementConstructor, string][] = [
  ["hue-studio-room-card", HueStudioRoomCard, "room"],
  ["hue-studio-automations-card", HueStudioAutomationsCard, "automations"],
  ["hue-studio-gallery-card", HueStudioGalleryCard, "gallery"],
];

// Dashboards made with the old auto light card keep working (not offered in the picker).
if (!customElements.get("hue-studio-auto-light-card")) customElements.define("hue-studio-auto-light-card", HueStudioAutoLightCard);

const w = window as Window & { customCards?: { type: string; name: string; description: string; preview?: boolean }[] };
w.customCards ??= [];
for (const [tag, cls, key] of CARDS) {
  if (customElements.get(tag)) continue;
  customElements.define(tag, cls);
  // Read when HA's card picker opens: in the user's language by then.
  w.customCards.push({
    type: tag,
    preview: true,
    get name() {
      return localize(currentHass())(`card.${key}_name` as StringKey);
    },
    get description() {
      return localize(currentHass())(`card.${key}_description` as StringKey);
    },
  });
}
