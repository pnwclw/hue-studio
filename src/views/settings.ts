// Settings (a tab of the panel), laid out like the Hue app's: the home (devices, bridges,
// MotionAware and entertainment areas), then Hue Studio's own (rooms and zones, scene
// gallery, integration settings, experimental). Every row opens a screen of its own.

import { html, nothing, type TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";

import { hueZones, planHasNews } from "../rooms.ts";
import { StudioView } from "./base.ts";

@customElement("hue-studio-settings-view")
export class SettingsView extends StudioView {
  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const plan = ctx.rooms;
    const boxes = Object.keys(ctx.boxes).length;
    const row = (glyph: string, title: string, to: string, sub = "", badge = false): TemplateResult =>
      html`<button class="item" @click=${() => ctx.go(to)}>
        <ha-icon icon=${glyph}></ha-icon>
        <div class="grow">${title}${sub ? html`<div class="dim small">${sub}</div>` : nothing}</div>
        ${badge ? html`<span class="dot-badge" aria-hidden="true"></span>` : nothing}
        <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
      </button>`;
    const roomsSub = !plan
      ? t(ctx.roomsUnavailable ? "rooms.unavailable" : "rooms.loading")
      : planHasNews(plan)
        ? t("settings.rooms_differ")
        : t("settings.rooms_zones", { zones: hueZones(ctx.hass).length });
    return this.tabScreen(
      t("settings.title"),
      html`<h2 class="label">${t("settings.home")}</h2>
        <div class="rows">
          ${row("mdi:lightbulb-group-outline", t("settings.devices"), "/settings/devices", t("settings.devices_sub"))}
          ${row("mdi:router-wireless", t("settings.bridges"), "/settings/bridges", boxes ? t("settings.bridges_sub", { boxes }) : "")}
          ${row("mdi:motion-sensor", t("settings.motionaware"), "/settings/motionaware")}
          ${row("mdi:television-ambient-light", t("settings.entertainment"), "/settings/entertainment")}
        </div>
        <h2 class="label">Hue Studio</h2>
        <div class="rows">
          ${row("mdi:floor-plan", t("rooms.title"), "/rooms", roomsSub, planHasNews(plan))}
          ${row("mdi:image-multiple-outline", t("settings.gallery"), "/settings/gallery", t(ctx.config.gallery_seasonal ? "settings.gallery_seasonal" : "settings.gallery_all"))}
          ${row("mdi:cog-outline", t("settings.integration"), "/settings/integration", t("settings.integration_sub"))}
          ${row("mdi:flask-outline", t("exp.title"), "/settings/experimental", t(ctx.config.footer ? "exp.on" : "exp.sub"))}
        </div>`,
      { cls: "settings-page" },
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-settings-view": SettingsView;
  }
}
