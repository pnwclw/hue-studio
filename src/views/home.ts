// Home: rooms (HA areas) and zones (other Hue groups) as cards with toggle and brightness;
// a note when the Hue rooms differ from the areas, and Hue lights that have no area.

import { html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import { groupSlider, metaOf, surfaceOf, toggleGroup } from "../controls.ts";
import { allGroups, type Group, groupState } from "../model.ts";
import { planHasNews } from "../rooms.ts";
import { syncingIn } from "../sync.ts";
import { icon, toggle } from "../ui.ts";
import { StudioView } from "./base.ts";
import { noRoomRows } from "./rooms.ts";

@customElement("hue-studio-home-view")
export class HomeView extends StudioView {
  protected override render() {
    const { ctx } = this;
    const { t, home } = ctx;
    const groups = allGroups(home);
    const anyOn = groups.some((g) => groupState(ctx.hass, g).on);
    const section = (title: string, list: Group[]) =>
      list.length ? html`<h2 class="label">${title}</h2><div class="cards">${list.map((g) => this.card(g))}</div>` : nothing;

    const loose = noRoomRows(ctx);
    return html`<div class="page">
      ${this.head(
        ctx.hass.config?.location_name || t("home.title"),
        groups.length ? toggle(anyOn, t("home.all_lights"), () => this.toggleAll(anyOn)) : nothing,
      )}
      ${planHasNews(ctx.rooms)
        ? html`<button class="notice" @click=${() => ctx.go("/rooms")}>
            ${icon("rooms")}<span class="grow">${t("home.rooms_differ")}</span><span class="go">${t("home.review")}</span>
          </button>`
        : nothing}
      ${section(t("home.rooms"), home.rooms)} ${section(t("home.zones"), home.zones)}
      ${loose === nothing ? nothing : html`<h2 class="label">${t("home.no_room")}</h2>${loose}`}
      ${groups.length ? nothing : html`<p class="empty">${t("home.empty")}</p>`}
    </div>`;
  }

  private card(g: Group) {
    const { ctx } = this;
    const { t } = ctx;
    const state = groupState(ctx.hass, g, ctx.lightInfo);
    const surface = surfaceOf(state);
    return html`<div
      class=${classMap({ card: true, ...surface.classes })}
      style=${styleMap(surface.style)}
      @click=${() => ctx.go(`/room/${encodeURIComponent(g.key)}`)}
    >
      <div class="row">
        <ha-icon icon=${g.icon}></ha-icon>
        <div class="text">
          <div class="name">${g.name}</div>
          ${syncingIn(ctx.boxes, g).length ? html`<div class="meta sync-meta">${icon("sync")}${t("sync.syncing")}</div>` : metaOf(state)}
        </div>
        ${toggle(state.on, t("common.toggle"), () => toggleGroup(ctx, g))}
      </div>
      ${groupSlider(ctx, g, state, t("common.brightness"))}
    </div>`;
  }

  private toggleAll(anyOn: boolean): void {
    const targets = [...new Set(allGroups(this.ctx.home).flatMap((g) => g.target))];
    this.ctx.call("light", anyOn ? "turn_off" : "turn_on", { entity_id: targets });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-home-view": HomeView;
  }
}
