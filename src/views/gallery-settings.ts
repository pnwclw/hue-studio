// Settings → Scene gallery: all categories all year, or the everyday ones plus those in
// season (holidays within their date windows, editable here; seasons from HA's Season
// integration, else by month). The gallery tab and the gallery cards follow it.

import { html, nothing } from "lit";
import { customElement } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import type { StringKey } from "../i18n.ts";
import {
  categoryShown,
  gallerySeasons,
  HOLIDAY_WINDOWS,
  isMonthDay,
  SEASON_CATEGORIES,
  seasonEntity,
  seasonNow,
  type Window,
  windowOf,
} from "../seasons.ts";
import { friendlyName } from "../model.ts";
import { haptic } from "../ha-internals.ts";
import { StudioView } from "./base.ts";

@customElement("hue-studio-gallery-settings-view")
export class GallerySettingsView extends StudioView {
  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const options = gallerySeasons(ctx.config);
    const seasonal = !!options.seasonal;
    const now = new Date();
    const season = seasonNow(ctx.hass, now);
    const source = seasonEntity(ctx.hass);
    const name = (id: string) => ctx.gallery?.categories.find((c) => c.id === id)?.name ?? id;
    const state = (id: string) => {
      const shown = categoryShown(id, { seasonal: true, windows: options.windows }, season, now);
      return html`<span class=${classMap({ "season-state": true, on: shown })}>${t(shown ? "seasonal.shown" : "seasonal.hidden")}</span>`;
    };
    const choose = (on: boolean) => {
      if (on === seasonal) return;
      haptic("selection");
      ctx.setConfig({ gallery_seasonal: on });
    };
    const mode = (on: boolean, title: StringKey, sub: StringKey) =>
      html`<button class=${classMap({ item: true, on: on === seasonal })} role="radio" aria-checked=${on === seasonal} @click=${() => choose(on)}>
        <div class="grow">${t(title)}<div class="dim small">${t(sub)}</div></div>
        <span class="radio"></span>
      </button>`;

    return this.screen(
      this.subHead(t("settings.gallery"), () => ctx.go("/settings")),
      html`<p class="lead">${t("seasonal.intro")}</p>
        <div class="rows" role="radiogroup" aria-label=${t("settings.gallery")}>
          ${mode(false, "seasonal.all", "seasonal.all_sub")} ${mode(true, "seasonal.seasonal", "seasonal.seasonal_sub")}
        </div>
        ${seasonal
          ? html`<h2 class="label">${t("seasonal.holidays")}</h2>
              <p class="lead">${t("seasonal.holidays_hint")}</p>
              <div class="rows">${Object.keys(HOLIDAY_WINDOWS).map((id) => this.holiday(id, name(id), state(id)))}</div>
              <h2 class="label">${t("seasonal.seasons")}</h2>
              <p class="lead">${source ? t("seasonal.season_from", { name: friendlyName(ctx.hass, source) }) : t("seasonal.season_by_month")}</p>
              <div class="rows">
                ${Object.entries(SEASON_CATEGORIES).map(
                  ([id, s]) => html`<div class="item">
                    <div class="grow">${name(id)}<div class="dim small">${t(`auto.season_${s}` as StringKey)}</div></div>
                    ${state(id)}
                  </div>`,
                )}
              </div>`
          : nothing}`,
      "settings-page",
    );
  }

  /** A holiday category: its window as two dates (the year is only for the picker). */
  private holiday(id: string, name: string, state: unknown) {
    const { ctx } = this;
    const { t } = ctx;
    const windows = ctx.config.gallery_windows || {};
    const [from, to] = windowOf(id, windows);
    const year = new Date().getFullYear();
    const save = (next: Window) => {
      const rest = { ...windows };
      delete rest[id];
      const same = next[0] === HOLIDAY_WINDOWS[id][0] && next[1] === HOLIDAY_WINDOWS[id][1];
      ctx.setConfig({ gallery_windows: same ? rest : { ...rest, [id]: next } });
    };
    const lang = ctx.hass.locale?.language || ctx.hass.language || "en";
    const format = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" });
    // A day of the year: shown without a year; the native date picker (invisible, on top) sets it.
    const field = (value: string, label: string, set: (md: string) => void) =>
      html`<label class="date-field">
        <span class="dim small">${label}</span>
        <span class="date-value">
          ${format.format(new Date(year, Number(value.slice(0, 2)) - 1, Number(value.slice(3))))}
          <input
            type="date"
            aria-label=${label}
            .value=${`${year}-${value}`}
            @click=${(e: Event) => {
              try {
                (e.target as HTMLInputElement).showPicker();
              } catch {
                // Not supported, or already open: the input handles the tap itself.
              }
            }}
            @change=${(e: Event) => {
              const md = (e.target as HTMLInputElement).value.slice(5);
              if (isMonthDay(md)) set(md);
            }}
          />
        </span>
      </label>`;
    return html`<div class="item holiday">
      <div class="grow">${name}</div>
      ${state}
      <div class="dates">
        ${field(from, t("seasonal.from"), (md) => save([md, to]))} ${field(to, t("seasonal.to"), (md) => save([from, md]))}
        ${id in windows ? html`<button class="pill" @click=${() => save(HOLIDAY_WINDOWS[id])}>${t("seasonal.reset")}</button>` : nothing}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-gallery-settings-view": GallerySettingsView;
  }
}
