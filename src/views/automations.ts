// Automations (a tab, like the Hue app's): Hue Studio's automations with their switch, the
// other Home Assistant automations that touch Hue lights, and "+" with the Hue app's types.
// Every automation is a Home Assistant automation (a blueprint of ours, see automations.ts):
// HA stores and runs it, and its own editor stays one tap away.

import { html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

import { type AutomationDraft, fromConfig, roomsLine, TYPE_ICONS, TYPES, whenLine } from "../automations.ts";
import type { StudioContext } from "../context.ts";
import type { StringKey } from "../i18n.ts";
import { friendlyName } from "../model.ts";
import { icon, toggle } from "../ui.ts";
import { StudioView } from "./base.ts";

/** One of our automations, read back from its config (null while it loads). */
interface Listed {
  entityId: string;
  draft: AutomationDraft | null;
  custom: boolean;
  type: string | null;
}

function ours(ctx: StudioContext): Listed[] {
  const name = (l: Listed) => l.draft?.alias || friendlyName(ctx.hass, l.entityId);
  return Object.entries(ctx.automations?.automations || {})
    .map(([entityId, a]) => {
      const config = ctx.automationConfigs[entityId];
      return { entityId, draft: config ? fromConfig(config) : null, custom: a.custom, type: a.type };
    })
    .sort((a, b) => name(a).localeCompare(name(b)));
}

/** HA's editor of an automation (by its config id), or a new one. */
const haEditor = (ctx: StudioContext, entityId: string | null): void => {
  const id = entityId ? ctx.hass.states[entityId]?.attributes.id : null;
  ctx.openHa(id ? `/config/automation/edit/${encodeURIComponent(id)}` : "/config/automation/edit/new");
};

function row(ctx: StudioContext, l: Listed): TemplateResult {
  const { t } = ctx;
  const state = ctx.hass.states[l.entityId];
  const on = state?.state === "on";
  const draft = l.draft;
  const name = draft?.alias || friendlyName(ctx.hass, l.entityId);
  const sub = l.custom
    ? t("automations.custom_sub")
    : draft
      ? [whenLine(draft, t), roomsLine(ctx.hass, draft.input.rooms)].filter(Boolean).join(" · ")
      : "";
  const open = () => (l.custom || !draft ? haEditor(ctx, l.entityId) : ctx.go(`/automations/${encodeURIComponent(draft.id)}`));
  const glyph = l.type && l.type in TYPE_ICONS ? TYPE_ICONS[l.type as keyof typeof TYPE_ICONS] : "mdi:robot-outline";
  return html`<div class="item automation">
    <button class="plain grow row-open" @click=${open}>
      <ha-icon icon=${glyph}></ha-icon>
      <span class="grow">${name}<span class="dim small">${sub}</span></span>
    </button>
    ${toggle(on, name, () => ctx.call("automation", on ? "turn_off" : "turn_on", { entity_id: l.entityId }))}
  </div>`;
}

/** The automations of a room (an area), for its screen; "+" adds one there. */
export function automationRows(ctx: StudioContext, area: string): TemplateResult {
  const { t } = ctx;
  const list = ours(ctx).filter((l) => l.draft?.input.rooms.includes(area));
  return html`<div class="rows automations">
    ${list.map((l) => row(ctx, l))}
    <button class="item" @click=${() => ctx.go(`/automations/new?room=${encodeURIComponent(area)}`)}>
      <ha-icon icon="mdi:plus"></ha-icon><div class="grow">${t("automations.add")}</div>
    </button>
  </div>`;
}

@customElement("hue-studio-automations-view")
export class AutomationsView extends StudioView {
  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const add = html`<button class="round" aria-label=${t("automations.add")} @click=${() => ctx.go("/automations/new")}>${icon("plus")}</button>`;
    const msg = ctx.automations;
    if (!msg) return this.tabScreen(t("automations.title"), html`<p class="empty">${t("rooms.loading")}</p>`, { end: add });
    const list = ours(ctx);
    const related = msg.related.filter((id) => ctx.hass.states[id]);
    return this.tabScreen(
      t("automations.title"),
      html`${list.length
          ? html`<div class="rows automations">${list.map((l) => row(ctx, l))}</div>`
          : html`<div class="automations-empty">
              <p class="lead">${t("automations.empty")}</p>
              <button class="pill apply" @click=${() => ctx.go("/automations/new")}>${t("automations.add")}</button>
            </div>`}
        <h2 class="label">${t("automations.ha")}</h2>
        <p class="lead">${t("automations.ha_hint")}</p>
        <div class="rows automations">
          ${related.map((id) => {
            const on = ctx.hass.states[id].state === "on";
            const name = friendlyName(ctx.hass, id);
            return html`<div class="item automation">
              <button class="plain grow row-open" @click=${() => haEditor(ctx, id)}>
                <ha-icon icon="mdi:robot-outline"></ha-icon><span class="grow">${name}</span>
              </button>
              ${toggle(on, name, () => ctx.call("automation", on ? "turn_off" : "turn_on", { entity_id: id }))}
            </div>`;
          })}
          <button class="item" @click=${() => haEditor(ctx, null)}>
            <ha-icon icon="mdi:home-assistant"></ha-icon><div class="grow">${t("automations.custom")}<div class="dim small">${t("automations.custom_hint")}</div></div>
            <ha-icon class="chevron" icon="mdi:open-in-new"></ha-icon>
          </button>
        </div>`,
      { end: add, cls: "automations-page" },
    );
  }
}

/** "+": the Hue app's automation types, then a custom one in HA's editor. */
@customElement("hue-studio-automation-new-view")
export class AutomationNewView extends StudioView {
  /** The room the new automation starts with (an area id), from its screen. */
  @property() accessor room: string | null = null;

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const room = this.room ? `?room=${encodeURIComponent(this.room)}` : "";
    return this.screen(
      this.subHead(t("automations.new"), () => history.back()),
      html`<div class="rows">
          ${TYPES.map(
            (type) => html`<button class="item" @click=${() => ctx.go(`/automations/new/${type}${room}`)}>
              <ha-icon icon=${TYPE_ICONS[type]}></ha-icon>
              <div class="grow">${t(`automations.type_${type}` as StringKey)}<div class="dim small">${t(`automations.type_${type}_sub` as StringKey)}</div></div>
              <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
            </button>`,
          )}
        </div>
        <div class="rows">
          <button class="item" @click=${() => haEditor(ctx, null)}>
            <ha-icon icon="mdi:home-assistant"></ha-icon>
            <div class="grow">${t("automations.custom")}<div class="dim small">${t("automations.custom_hint")}</div></div>
            <ha-icon class="chevron" icon="mdi:open-in-new"></ha-icon>
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
