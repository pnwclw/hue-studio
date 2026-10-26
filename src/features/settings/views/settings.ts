// Settings (a tab of the panel), laid out like the Hue app's: the home (devices, bridges and
// Sync Boxes, MotionAware areas with a Hue Bridge Pro, entertainment areas), then Hue
// Studio's own (rooms and zones, light of the day, scene gallery, integration settings,
// experimental). Every row opens a screen of its own.

import { html, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";

import { hasPro } from "../../devices/devices.ts";
import type { StringKey } from "../../../i18n/index.ts";
import { hueZones, planHasNews } from "../../rooms/rooms.ts";
import type { BridgesMessage } from "../../../core/types.ts";
import { StudioView } from "../../../ds/base.ts";

@customElement("hue-studio-settings-view")
export class SettingsView extends StudioView {
  @state() private accessor bridges: BridgesMessage | null = null;
  private stop?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.stop = this.ctx.watch<BridgesMessage>("hue_studio/bridges/subscribe", (m) => (this.bridges = m));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop?.();
  }

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const plan = ctx.rooms;
    const boxes = Object.keys(ctx.boxes).length;
    const bridges = Object.keys(this.bridges || {}).length;
    const bridgesSub = !this.bridges ? "" : t(boxes ? "settings.bridges_boxes" : "settings.bridges_count", { bridges, boxes });
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
          ${row("hue-studio:devices", t("settings.devices"), "/settings/devices", t("settings.devices_sub"))}
          ${row("hue-studio:bridge", t("settings.bridges"), "/settings/bridges", bridgesSub)}
          ${hasPro(this.bridges) ? row("hue-studio:motionaware", t("settings.motionaware"), "/settings/motionaware") : nothing}
          ${row("hue-studio:sync", t("settings.entertainment"), "/settings/entertainment")}
        </div>
        <h2 class="label">Hue Studio</h2>
        <div class="rows">
          ${row("mdi:floor-plan", t("rooms.title"), "/rooms", roomsSub, planHasNews(plan))}
          ${row("mdi:palette-swatch-variant", t("daylight.title"), "/settings/daylight", this.daylightSub())}
          ${row("mdi:image-multiple-outline", t("settings.gallery"), "/settings/gallery", t(ctx.config.gallery_seasonal ? "settings.gallery_seasonal" : "settings.gallery_all"))}
          ${row("mdi:cog-outline", t("settings.integration"), "/settings/integration", t("settings.integration_sub"))}
          ${row("mdi:flask-outline", t("exp.title"), "/settings/experimental", t(ctx.config.footer ? "exp.on" : "exp.sub"))}
        </div>`,
      { cls: "settings-page" },
    );
  }

  /** "Evening · Cozy · 38 scenes". */
  private daylightSub(): string {
    const { t, daylight } = this.ctx;
    if (!daylight) return t("daylight.sub");
    const { now } = daylight;
    return [
      t(`auto.phase_${now.phase}` as StringKey),
      now.mood ? t(`auto.mood_${now.mood}` as StringKey) : "",
      t("daylight.pool_count", { count: Object.keys(daylight.tags).length }),
    ]
      .filter(Boolean)
      .join(" · ");
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-settings-view": SettingsView;
  }
}
