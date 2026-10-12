// Settings → Scene gallery: all categories all year, or each category in its time. The user
// sets every category's rule: always, in some seasons, and/or between two dates (a holiday);
// Halloween, winter holidays and the season categories start with rules of their own. The
// season comes from HA's Season integration, else from the month. The gallery tab and the
// gallery cards follow it.

import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import { haptic } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import { friendlyName } from "../model.ts";
import {
  DEFAULT_RULES,
  gallerySeasons,
  isMonthDay,
  isSeasonal,
  monthDay,
  type Rule,
  ruleOf,
  ruleShows,
  sameRule,
  type Season,
  SEASONS,
  seasonEntity,
  seasonNow,
  type Window,
} from "../seasons.ts";
import { StudioView } from "./base.ts";

/** Seasons in the order of the year, from spring. */
const YEAR: Season[] = ["spring", "summer", "autumn", "winter"];

@customElement("hue-studio-gallery-settings-view")
export class GallerySettingsView extends StudioView {
  /** The category whose rule is open for editing. */
  @state() private accessor editing: string | null = null;

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const seasonal = !!gallerySeasons(ctx.config).seasonal;
    const source = seasonEntity(ctx.hass);
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
          ? html`<h2 class="label">${t("seasonal.categories")}</h2>
              <p class="lead">${t("seasonal.categories_hint")}</p>
              <div class="rows">${(ctx.gallery?.categories || []).map((c) => this.category(c.id, c.name))}</div>
              <p class="lead small">
                ${source ? t("seasonal.season_from", { name: friendlyName(ctx.hass, source) }) : t("seasonal.season_by_month")}
              </p>`
          : nothing}`,
      "settings-page",
    );
  }

  /** A category: when it shows, whether it does now; a tap opens its rule. */
  private category(id: string, name: string) {
    const { ctx } = this;
    const { t } = ctx;
    const rule = ruleOf(id, ctx.config.gallery_rules);
    const now = new Date();
    const open = this.editing === id;
    const shown = ruleShows(rule, seasonNow(ctx.hass, now), now);
    const toggle = () => {
      haptic("selection");
      this.editing = open ? null : id;
    };
    return html`<button class=${classMap({ item: true, "rule-row": true, open })} aria-expanded=${open} @click=${toggle}>
        <div class="grow">${name}<div class="dim small">${this.summary(rule)}</div></div>
        ${isSeasonal(rule)
          ? html`<span class=${classMap({ "season-state": true, on: shown })}>${t(shown ? "seasonal.shown" : "seasonal.hidden")}</span>`
          : nothing}
        <ha-icon class="chevron" icon=${open ? "mdi:chevron-up" : "mdi:chevron-down"}></ha-icon>
      </button>
      ${open ? this.editor(id, rule) : nothing}`;
  }

  /** "Always", "Winter", "1 Oct – 2 Nov", or both. */
  private summary(rule: Rule): string {
    const { t } = this.ctx;
    const parts = YEAR.filter((s) => rule.seasons?.includes(s)).map((s) => t(`auto.season_${s}` as StringKey));
    if (rule.window) parts.push(`${this.day(rule.window[0])} – ${this.day(rule.window[1])}`);
    return parts.length ? parts.join(" · ") : t("seasonal.always");
  }

  /** "1 Oct" in the user's language. */
  private day(md: string): string {
    const { hass } = this.ctx;
    const lang = hass.locale?.language || hass.language || "en";
    return new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" }).format(new Date(2000, Number(md.slice(0, 2)) - 1, Number(md.slice(3))));
  }

  /** A category's rule: always, or seasons and/or a date window; back to its default. */
  private editor(id: string, rule: Rule) {
    const { ctx } = this;
    const { t } = ctx;
    const rules = ctx.config.gallery_rules || {};
    const fallback = DEFAULT_RULES[id] ?? {};
    const save = (next: Rule) => {
      haptic("selection");
      const rest = { ...rules };
      delete rest[id];
      const clean: Rule = {
        ...(next.seasons?.length ? { seasons: SEASONS.filter((s) => next.seasons!.includes(s)) } : {}),
        ...(next.window ? { window: next.window } : {}),
      };
      ctx.setConfig({ gallery_rules: sameRule(clean, fallback) ? rest : { ...rest, [id]: clean } });
    };
    const seasons = rule.seasons || [];
    const flip = (s: Season) => save({ ...rule, seasons: seasons.includes(s) ? seasons.filter((x) => x !== s) : [...seasons, s] });
    const today = new Date();
    const span: Window = rule.window ?? fallback.window ?? [monthDay(today), monthDay(new Date(today.getTime() + 13 * 86400000))];
    return html`<div class="rule-editor">
      <div class="chips">
        <button class=${classMap({ chip: true, on: !isSeasonal(rule) })} @click=${() => save({})}>${t("seasonal.always")}</button>
        ${YEAR.map(
          (s) => html`<button class=${classMap({ chip: true, on: seasons.includes(s) })} aria-pressed=${seasons.includes(s)} @click=${() => flip(s)}>
            ${t(`auto.season_${s}` as StringKey)}
          </button>`,
        )}
        <button
          class=${classMap({ chip: true, on: !!rule.window })}
          aria-pressed=${!!rule.window}
          @click=${() => save({ ...rule, window: rule.window ? undefined : span })}
        >
          <ha-icon icon="mdi:calendar-range"></ha-icon>${t("seasonal.dates")}
        </button>
      </div>
      ${rule.window
        ? html`<div class="dates">
              ${this.dateField(span[0], t("seasonal.from"), (md) => save({ ...rule, window: [md, span[1]] }))}
              ${this.dateField(span[1], t("seasonal.to"), (md) => save({ ...rule, window: [span[0], md] }))}
            </div>
            <p class="dim small">${t("seasonal.dates_sub")}</p>`
        : nothing}
      ${id in rules ? html`<button class="pill" @click=${() => save(fallback)}>${t("seasonal.reset")}</button>` : nothing}
    </div>`;
  }

  /** A day of the year: shown without a year; the native date picker (invisible, on top) sets it. */
  private dateField(value: string, label: string, set: (md: string) => void) {
    const year = new Date().getFullYear();
    return html`<label class="date-field">
      <span class="dim small">${label}</span>
      <span class="date-value">
        ${this.day(value)}
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
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-gallery-settings-view": GallerySettingsView;
  }
}
