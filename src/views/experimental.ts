// Settings → Experimental: features that are still taking shape. For now the "Liquid
// Glass" footer: a floating tab bar on every Home Assistant page on phones, and its tabs.

import { html, nothing } from "lit";
import { customElement } from "lit/decorators.js";

import { choosablePanels, DEFAULT_TABS, FOOTER_MAX_TABS, moveTab, panelIcon, panelLabel } from "../footer-model.ts";
import { icon, toggle } from "../ui.ts";
import { StudioView } from "./base.ts";

@customElement("hue-studio-experimental-view")
export class ExperimentalView extends StudioView {
  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const on = !!ctx.config.footer;
    const panels = ctx.hass.panels || {};
    const chosen = (ctx.config.footer_tabs?.length ? ctx.config.footer_tabs : DEFAULT_TABS).filter((p) => panels[p]);
    const others = choosablePanels(panels).filter((p) => !chosen.includes(p.url_path));
    const save = (tabs: string[]) => ctx.setConfig({ footer_tabs: tabs });
    const full = chosen.length >= FOOTER_MAX_TABS;
    return this.screen(
      this.subHead(t("exp.title"), () => ctx.go("/settings")),
      html`<p class="lead">${t("exp.intro")}</p>
      <div class="rows">
        <div class="item">
          <ha-icon icon="mdi:dock-bottom"></ha-icon>
          <div class="grow">${t("exp.footer")}<div class="dim small">${t("exp.footer_sub")}</div></div>
          ${toggle(on, t("exp.footer"), () => ctx.setConfig({ footer: !on }))}
        </div>
      </div>
      <h2 class="label">${t("exp.tabs")}</h2>
      <p class="lead">${t("exp.tabs_hint", { count: FOOTER_MAX_TABS })}</p>
      <div class="rows">
        ${chosen.map((path, i) => {
          const panel = panels[path];
          return html`<div class="item">
            <ha-icon icon=${panelIcon(panel)}></ha-icon>
            <div class="grow">${panelLabel(panel, ctx.hass.localize)}</div>
            <button class="round mini-step" aria-label=${t("exp.up")} ?disabled=${i === 0} @click=${() => save(moveTab(chosen, path, -1))}>
              <ha-icon icon="mdi:chevron-up"></ha-icon>
            </button>
            <button class="round mini-step" aria-label=${t("exp.down")} ?disabled=${i === chosen.length - 1} @click=${() => save(moveTab(chosen, path, 1))}>
              <ha-icon icon="mdi:chevron-down"></ha-icon>
            </button>
            <button class="round mini-step" aria-label=${t("exp.remove")} ?disabled=${chosen.length === 1} @click=${() => save(chosen.filter((p) => p !== path))}>
              ${icon("close")}
            </button>
          </div>`;
        })}
        <div class="item dim">
          <ha-icon icon="mdi:dots-horizontal"></ha-icon>
          <div class="grow">${t("footer.more")}<div class="dim small">${t("exp.more_sub")}</div></div>
        </div>
      </div>
      ${others.length
        ? html`<h2 class="label">${t("exp.add")}</h2>
            <div class="rows">
              ${others.map(
                (panel) => html`<button class="item" ?disabled=${full} @click=${() => save([...chosen, panel.url_path])}>
                  <ha-icon icon=${panelIcon(panel)}></ha-icon>
                  <div class="grow">${panelLabel(panel, ctx.hass.localize)}</div>
                  <ha-icon icon="mdi:plus"></ha-icon>
                </button>`,
              )}
            </div>`
        : nothing}`,
      "settings-page",
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-experimental-view": ExperimentalView;
  }
}
