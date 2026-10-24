// Automations (a tab, like the Hue app's): Hue Studio's automations with their switch, by
// type under a header that folds them away (a room's screen lists its own), the other Home
// Assistant automations that touch Hue lights, and "+" with the Hue app's types.
// Every automation is a Home Assistant automation (a blueprint of ours, see automations.ts):
// HA stores and runs it, and its own editor stays one tap away.

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { automationArt, customArt } from "../automation-art.ts";
import { type AutomationDraft, cardLines, type Controls, controlsGroup, fromConfig, placesOf, roomsLine, TYPE_ICONS, TYPES } from "../automations.ts";
import { haptic } from "../ha-internals.ts";
import type { StudioContext } from "../context.ts";
import type { StringKey } from "../i18n.ts";
import { automationCard } from "../controls.ts";
import { friendlyName, type Group } from "../model.ts";
import { icon, toggle } from "../ui.ts";
import { StudioView } from "./base.ts";

/** One of our automations, read back from its config (null while it loads). */
interface Listed {
  entityId: string;
  draft: AutomationDraft | null;
  custom: boolean;
  type: string | null;
  /** What HA reports it controls (areas, Hue rooms/zones). */
  controls: Controls;
}

function ours(ctx: StudioContext): Listed[] {
  const name = (l: Listed) => l.draft?.alias || friendlyName(ctx.hass, l.entityId);
  return Object.entries(ctx.automations?.automations || {})
    .map(([entityId, a]) => {
      const config = ctx.automationConfigs[entityId];
      return { entityId, draft: config ? fromConfig(config) : null, custom: a.custom, type: a.type, controls: { areas: a.areas, groups: a.groups, lights: a.lights } };
    })
    .sort((a, b) => name(a).localeCompare(name(b)));
}

/** HA's editor of an automation (by its config id), or a new one. */
const haEditor = (ctx: StudioContext, entityId: string | null): void => {
  const id = entityId ? ctx.hass.states[entityId]?.attributes.id : null;
  ctx.openHa(id ? `/config/automation/edit/${encodeURIComponent(id)}` : "/config/automation/edit/new");
};

/** The automations of one room or zone. */
const ofGroup = (list: Listed[], g: Group): Listed[] => list.filter((l) => controlsGroup(l.controls, g.key, g.group, g.lights));

/** One of ours; `inGroup`: listed under its room, so other rooms are named only if it has any;
 *  `byType`: under its type's header, which shows the type's icon (the card has none). */
function row(ctx: StudioContext, l: Listed, inGroup = false, from: Group | null = null, byType = false): TemplateResult {
  const { t } = ctx;
  const state = ctx.hass.states[l.entityId];
  const on = state?.state === "on";
  const draft = l.draft;
  const name = draft?.alias || friendlyName(ctx.hass, l.entityId);
  const lines = draft && !l.custom ? cardLines(draft, name, t) : { title: name, sub: l.custom ? t("automations.custom_sub") : "" };
  const rooms = draft && !l.custom && (!inGroup || placesOf(draft.input).length > 1) ? roomsLine(ctx.hass, draft.input) : "";
  const id = ctx.automations?.automations[l.entityId]?.id;
  const room = from ? `?room=${encodeURIComponent(from.key)}` : "";
  // Ours open here (one whose config can't be read says so there); taken over in HA: HA's editor.
  const open = () => (l.custom || !id ? haEditor(ctx, l.entityId) : ctx.go(`/automations/${encodeURIComponent(id)}${room}`));
  const glyph = l.type && l.type in TYPE_ICONS ? TYPE_ICONS[l.type as keyof typeof TYPE_ICONS] : "mdi:lightning-bolt";
  const sub = [lines.sub, rooms].filter(Boolean).join(" · ");
  // Going to sleep starts right here too, like the Hue app's play (its conditions skipped).
  const start = draft?.type === "go_to_sleep" && !l.custom ? { label: t("automations.start_now"), run: () => void ctx.call("automation", "trigger", { entity_id: l.entityId, skip_condition: true }) } : null;
  return automationCard(byType ? "" : glyph, lines.title, sub, open, toggle(on, name, () => ctx.call("automation", on ? "turn_off" : "turn_on", { entity_id: l.entityId })), start);
}

/** The automations of a room or zone, for its screen (nothing without any: its "+" adds them). */
export function roomAutomations(ctx: StudioContext, g: Group): TemplateResult | typeof nothing {
  const list = ofGroup(ours(ctx), g);
  if (!list.length) return nothing;
  return html`<h2 class="label">${ctx.t("automations.title")}</h2>
    <div class="auto-list">${list.map((l) => row(ctx, l, true, g))}</div>`;
}

/** Ours by type (the order of "+"), the ones taken over in HA's editor last. */
function byType(list: Listed[]): { type: string; items: Listed[] }[] {
  const typeOf = (l: Listed) => (l.custom || !l.type || !(TYPES as readonly string[]).includes(l.type) ? "custom" : l.type);
  return [...TYPES, "custom"].map((type) => ({ type, items: list.filter((l) => typeOf(l) === type) })).filter((s) => s.items.length);
}

@customElement("hue-studio-automations-view")
export class AutomationsView extends StudioView {
  /** Types folded away under their header (for this visit). */
  @state() private accessor folded = new Set<string>();

  /** A type's header (the Hue app's): its icon, name and count, a round button that folds it. */
  private typeHead(type: string, count: number): TemplateResult {
    const { t } = this.ctx;
    const folded = this.folded.has(type);
    const glyph = type in TYPE_ICONS ? TYPE_ICONS[type as keyof typeof TYPE_ICONS] : "mdi:home-assistant";
    const name = type === "custom" ? t("automations.custom") : t(`automations.type_${type}` as StringKey);
    const flip = () => {
      haptic("selection");
      const next = new Set(this.folded);
      if (folded) next.delete(type);
      else next.add(type);
      this.folded = next;
    };
    return html`<div class="auto-type">
      <ha-icon icon=${glyph}></ha-icon>
      <span class="title">${name}</span>
      <span class="count">${count}</span>
      <button class="round" aria-expanded=${!folded} aria-label=${name} @click=${flip}>
        <ha-icon icon=${folded ? "mdi:chevron-down" : "mdi:chevron-up"}></ha-icon>
      </button>
    </div>`;
  }

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const add = html`<button class="round plus-blue" aria-label=${t("automations.add")} @click=${() => ctx.go("/automations/new")}>${icon("plus")}</button>`;
    const msg = ctx.automations;
    if (!msg) return this.tabScreen(t("automations.title"), html`<p class="empty">${t("rooms.loading")}</p>`, { end: add });
    const list = ours(ctx);
    const related = msg.related.filter((id) => ctx.hass.states[id]);
    return this.tabScreen(
      t("automations.title"),
      html`${list.length
          ? byType(list).map(
              ({ type, items }) => html`${this.typeHead(type, items.length)}
                ${this.folded.has(type) ? nothing : html`<div class="auto-list">${items.map((l) => row(ctx, l, false, null, true))}</div>`}`,
            )
          : html`<div class="automations-empty">
              <p class="lead">${t("automations.empty")}</p>
              <button class="pill apply" @click=${() => ctx.go("/automations/new")}>${t("automations.add")}</button>
            </div>`}
        <h2 class="label">${t("automations.ha")}</h2>
        <p class="lead">${t("automations.ha_hint")}</p>
        ${related.length
          ? html`<div class="auto-list">
              ${related.map((id) => {
                const on = ctx.hass.states[id].state === "on";
                const name = friendlyName(ctx.hass, id);
                const sw = toggle(on, name, () => ctx.call("automation", on ? "turn_off" : "turn_on", { entity_id: id }));
                return automationCard("mdi:lightning-bolt", name, "", () => haEditor(ctx, id), sw);
              })}
            </div>`
          : nothing}
        <div class="rows">
          <button class="item" @click=${() => haEditor(ctx, null)}>
            <ha-icon icon="mdi:home-assistant"></ha-icon><div class="grow">${t("automations.custom")}<div class="dim small">${t("automations.custom_hint")}</div></div>
            <ha-icon class="chevron" icon="mdi:open-in-new"></ha-icon>
          </button>
        </div>`,
      { end: add, cls: "settings-page automations-page" },
    );
  }
}

/** "+": the Hue app's automation types as picture cards, then (last, outlined) a custom one in HA's editor. */
@customElement("hue-studio-automation-new-view")
export class AutomationNewView extends StudioView {
  /** The room the new automation starts with (an area id), from its screen. */
  @property() accessor room: string | null = null;

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const room = this.room ? `?room=${encodeURIComponent(this.room)}` : "";
    // Like the Hue app's: a picture card for each type; last and outlined, a custom one in HA's editor.
    return this.screen(
      // No title in the bar: the question under it is the title (the Hue app's).
      this.subHead("", () => history.back(), nothing, nothing, true),
      html`<h1 class="big new-question">${t("automations.new_question")}</h1>
        <div class="type-cards">
          ${TYPES.map(
            (type) => html`<button class="type-card" @click=${() => ctx.go(`/automations/new/${type}${room}`)}>
              ${automationArt(type)}
              <span class="text">
                <span class="title">${t(`automations.type_${type}` as StringKey)}</span>
                <span class="sub">${t(`automations.type_${type}_sub` as StringKey)}</span>
              </span>
            </button>`,
          )}
          <button class="type-card custom" @click=${() => haEditor(ctx, null)}>
            ${customArt()}
            <ha-icon class="open" icon="mdi:open-in-new"></ha-icon>
            <span class="text">
              <span class="title">${t("automations.custom")}</span>
              <span class="sub">${t("automations.custom_hint")}</span>
            </span>
          </button>
        </div>`,
      "settings-page",
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-automations-view": AutomationsView;
    "hue-studio-automation-new-view": AutomationNewView;
  }
}
