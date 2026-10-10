// Settings (a tab of the panel): rooms and zones, how the Hue rooms follow the HA areas,
// and the integration's own options page for what has no screen here yet.

import { html, nothing } from "lit";
import { customElement } from "lit/decorators.js";

import { hueZones, lightsWithoutArea, planHasNews } from "../rooms.ts";
import { icon, toggle } from "../ui.ts";
import { StudioView } from "./base.ts";

@customElement("hue-studio-settings-view")
export class SettingsView extends StudioView {
  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const plan = ctx.rooms;
    const zones = hueZones(ctx.hass).length;
    const loose = lightsWithoutArea(ctx.hass).length;
    const roomsSub = !plan
      ? t(ctx.roomsUnavailable ? "rooms.unavailable" : "rooms.loading")
      : planHasNews(plan)
        ? t("settings.rooms_differ")
        : t("settings.rooms_match");
    const autoAlign = !!ctx.config.auto_align;
    return html`<div class="page settings-page">
      ${this.head(t("settings.title"), nothing)}
      <h2 class="label">${t("settings.rooms")}</h2>
      <div class="rows">
        <button class="item" @click=${() => ctx.go("/rooms")}>
          <ha-icon icon="mdi:floor-plan"></ha-icon>
          <div class="grow">
            ${t("rooms.title")}
            <div class="dim small">${roomsSub}</div>
          </div>
          ${planHasNews(plan) ? html`<span class="dot-badge" aria-hidden="true"></span>` : nothing}
          <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
        </button>
        <div class="item">
          <ha-icon icon="mdi:sync"></ha-icon>
          <div class="grow">
            ${t("settings.auto_align")}
            <div class="dim small">${t("settings.auto_align_sub")}</div>
          </div>
          ${toggle(autoAlign, t("settings.auto_align"), () => ctx.setConfig({ auto_align: !autoAlign }))}
        </div>
      </div>
      <p class="lead small">
        ${t("settings.counts", { zones, lights: loose })}
      </p>
      <h2 class="label">${t("settings.more")}</h2>
      <div class="rows">
        <button class="item" @click=${() => ctx.openSettings()}>
          <ha-icon icon="mdi:cog-outline"></ha-icon>
          <div class="grow">
            ${t("settings.integration")}
            <div class="dim small">${t("settings.integration_sub")}</div>
          </div>
          ${icon("open")}
        </button>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-settings-view": SettingsView;
  }
}
