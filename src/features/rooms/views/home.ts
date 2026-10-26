// Home: rooms (HA areas) and zones (other Hue groups) as cards with toggle and brightness;
// a banner while a Sync Box syncs (stop it right there, like the Hue app), a note when the
// Hue rooms differ from the areas, and Hue lights that have no area.

import { html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import { banner, groupSlider, groupToggle, metaOf, shownState, surfaceOf, syncBanner } from "../../../ds/controls.ts";
import { allGroups, type Group } from "../../../core/model.ts";
import { planHasNews } from "../rooms.ts";
import { icon, toggle } from "../../../ds/ui.ts";
import { StudioView } from "../../../ds/base.ts";
import { noRoomRows } from "./rooms.ts";

@customElement("hue-studio-home-view")
export class HomeView extends StudioView {
  protected override renderPage() {
    const { ctx } = this;
    const { t, home } = ctx;
    const groups = allGroups(home);
    const anyOn = groups.some((g) => shownState(ctx, g).on);
    const section = (title: string, list: Group[]) =>
      list.length ? html`<h2 class="label">${title}</h2><div class="cards">${list.map((g) => this.card(g))}</div>` : nothing;

    const loose = noRoomRows(ctx, (c) => this.choose(c));
    return this.tabScreen(
      ctx.hass.config?.location_name || t("home.title"),
      html`${this.syncBanners()}
      ${planHasNews(ctx.rooms)
        ? banner({ title: t("home.rooms_differ_title"), text: t("home.rooms_differ"), open: { label: t("home.review"), run: () => ctx.go("/rooms") } })
        : nothing}
      ${section(t("home.rooms"), home.rooms)} ${section(t("home.zones"), home.zones)}
      ${loose === nothing ? nothing : html`<h2 class="label">${t("home.no_room")}</h2>${loose}`}
      ${groups.length ? nothing : html`<p class="empty">${t("home.empty")}</p>`}`,
      { end: groups.length ? toggle(anyOn, t("home.all_lights"), () => this.toggleAll(anyOn)) : nothing },
    );
  }

  /** A box that syncs drives its lights: say so and offer to stop it (a tap elsewhere opens the box). */
  private syncBanners() {
    const { ctx } = this;
    return Object.entries(ctx.boxes)
      .filter(([, box]) => box.available && box.syncing)
      .map(([id, box]) => syncBanner(ctx, id, box));
  }

  private card(g: Group) {
    const { ctx } = this;
    const { t } = ctx;
    const state = shownState(ctx, g);
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
          ${state.syncing ? html`<div class="meta sync-meta">${icon("sync")}${t("light.sync_active")}</div>` : metaOf(state)}
        </div>
        ${groupToggle(ctx, g, state)}
      </div>
      ${groupSlider(ctx, g, state, t("common.brightness"))}
    </div>`;
  }

  /** Every room and zone, but those a Sync Box drives (they count as off). */
  private toggleAll(anyOn: boolean): void {
    const free = allGroups(this.ctx.home).filter((g) => !shownState(this.ctx, g).syncing);
    const targets = [...new Set(free.flatMap((g) => g.target))];
    this.ctx.call("light", anyOn ? "turn_off" : "turn_on", { entity_id: targets });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-home-view": HomeView;
  }
}
