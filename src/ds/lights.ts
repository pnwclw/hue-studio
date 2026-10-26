// A set's lights, the Hue app's way (measured on its entertainment area editor): the editor's
// "Lights" card — its title and the accent "+", the lights as cards in a row that scrolls
// sideways, a red "−" in each card's zone — and "Add lights to …", a tall sheet of rooms as
// list rows (their glyph, a fold button) with the lights not in the set yet as cards under
// them, a round check in each card's zone. A zone's and an entertainment area's editors use
// both; the caller keeps the set and what is being picked.

import { html, nothing, type TemplateResult } from "lit";
import { classMap } from "lit/directives/class-map.js";

import type { StudioContext } from "../core/context.ts";
import { haptic } from "../core/ha-internals.ts";
import { friendlyName, lightIcon } from "../core/model.ts";
import { tileCard } from "./controls.ts";
import { icon } from "./ui.ts";

/** A room of the sheet: its lights that may join the set. */
export interface LightRoom {
  key: string;
  name: string;
  icon: string;
  lights: string[];
}

/** A light's card without its switch: its glyph and name, `zone` in the zone instead. */
const memberTile = (ctx: StudioContext, id: string, zone: TemplateResult, classes: Record<string, boolean>, click?: () => void) =>
  tileCard({
    art: html`<ha-icon icon=${lightIcon(ctx.hass, id, ctx.lightInfo[id])}></ha-icon>`,
    name: friendlyName(ctx.hass, id),
    toggle: zone,
    classes: { light: true, member: true, ...classes },
    click,
  });

/** The "Lights" card of an editor: "+" opens the sheet, a card's "−" takes the light out. */
export function lightsCard(ctx: StudioContext, o: { lights: string[]; add: () => void; remove: (id: string) => void; locked?: boolean }): TemplateResult {
  const { t } = ctx;
  return html`<div class="rows lights-card set-lights">
    <div class="item lights-head">
      <div class="grow">${t("zone.lights")}</div>
      <button class="round add" ?disabled=${o.locked} aria-label=${t("lights.add")} @click=${() => {
        haptic("selection");
        o.add();
      }}>${icon("plus")}</button>
    </div>
    ${o.lights.length
      ? html`<div class="light-row">
          ${o.lights.map((id) =>
            memberTile(
              ctx,
              id,
              html`<button class="minus" ?disabled=${o.locked} aria-label=${t("lights.remove", { name: friendlyName(ctx.hass, id) })}
                @click=${(e: Event) => {
                  e.stopPropagation();
                  haptic("selection");
                  o.remove(id);
                }}><i></i></button>`,
              {},
            ),
          )}
        </div>`
      : nothing}
  </div>`;
}

/**
 * "Add lights to …": the rooms with lights that may join, each a row (open ones show their
 * lights as cards with a check). "Done" adds the checked ones, the close button drops them.
 */
export function addLightsSheet(
  ctx: StudioContext,
  o: {
    title: string;
    rooms: LightRoom[];
    picked: string[];
    open: string[];
    flip: (id: string) => void;
    fold: (key: string) => void;
    close: () => void;
    done: () => void;
  },
): TemplateResult {
  const { t } = ctx;
  const room = (r: LightRoom) => {
    const open = o.open.includes(r.key);
    const count = r.lights.filter((id) => o.picked.includes(id)).length;
    const sub = !count ? "" : count === r.lights.length ? t("lights.all_selected") : t("lights.some_selected", { count });
    const fold = () => {
      haptic("selection");
      o.fold(r.key);
    };
    return html`<div class="add-room">
      <div class="item" @click=${fold}>
        <ha-icon icon=${r.icon}></ha-icon>
        <div class="grow">${r.name}${sub ? html`<div class="dim small">${sub}</div>` : nothing}</div>
        <button class=${classMap({ round: true, expand: true, open })} aria-expanded=${open} aria-label=${r.name}
          @click=${(e: Event) => {
            e.stopPropagation();
            fold();
          }}><ha-icon icon="mdi:chevron-down"></ha-icon></button>
      </div>
      ${open
        ? html`<div class="add-room-lights">
            ${r.lights.map((id) => {
              const on = o.picked.includes(id);
              return memberTile(ctx, id, html`<span class=${classMap({ check: true, on })}>${icon("check")}</span>`, { on }, () => {
                haptic("selection");
                o.flip(id);
              });
            })}
          </div>`
        : nothing}
    </div>`;
  };
  return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow, tall: ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && o.close()}>
    <div class="box form sensor-sheet add-lights" role="dialog" aria-label=${o.title}>
      <div class="sheet-bar">
        <button class="round close" aria-label=${t("common.close")} @click=${o.close}>${icon("close")}</button>
        <div class="grow">${o.title}</div>
        <button class="pill save" @click=${() => {
          haptic("success");
          o.done();
        }}>${t("color.done")}</button>
      </div>
      <div class="form-body">
        ${o.rooms.length
          ? html`<h2 class="label">${t("automations.rooms")}</h2><div class="rows">${o.rooms.map(room)}</div>`
          : html`<p class="hint">${t("lights.none_left")}</p>`}
      </div>
    </div>
  </div>`;
}
