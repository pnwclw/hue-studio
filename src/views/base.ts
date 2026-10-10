// Base class of the views: they render from the shared StudioContext into the light DOM of
// the panel (or dialog), whose stylesheet styles them.

import { html, nothing, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";

import type { StudioContext } from "../context.ts";
import { icon, LightElement } from "../ui.ts";

type Slot = TemplateResult | typeof nothing;

export class StudioView extends LightElement {
  @property({ attribute: false }) accessor ctx!: StudioContext;
  /** Bumped by the owner whenever the context changed, so the view re-renders. */
  @property({ attribute: false }) accessor rev = 0;

  /**
   * Header of a top-level screen. Phone (HA sidebar hidden): a sticky bar with the menu
   * button and actions, the large title scrolling below it, like iOS. Desktop: one row,
   * title and actions side by side, no bar.
   */
  protected head(title: string, end: Slot, { start = nothing as Slot, menu = true } = {}): TemplateResult {
    const { ctx } = this;
    if (!ctx.narrow) {
      return html`<div class="head">${start}<h1 class="big">${title}</h1><div class="grow"></div>${end}</div>`;
    }
    return html`<div class="topbar">
        ${menu
          ? html`<button class="round menu" aria-label=${ctx.t("panel.menu")} @click=${() => ctx.toggleSidebar()}>${icon("menu")}</button>`
          : nothing}
        ${start}
        <div class="grow"></div>
        ${end}
      </div>
      <h1 class="big">${title}</h1>`;
  }
}
