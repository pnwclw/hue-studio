// Base class of the views: they render from the shared StudioContext into the light DOM of
// the panel (or dialog), whose stylesheet styles them.
//
// Every screen has a fixed header and a body that scrolls (and bounces) on its own, so the
// header never moves with an overscroll. Two kinds of headers, like the Hue app: a tab
// (Home, Explore, Sync, Settings) has a large title; a screen opened from another one has
// a compact bar with a back button and its title.

import { html, nothing, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";

import type { StudioContext } from "../context.ts";
import { icon, LightElement } from "../ui.ts";

type Slot = TemplateResult | typeof nothing;

export class StudioView extends LightElement {
  @property({ attribute: false }) accessor ctx!: StudioContext;
  /** Bumped by the owner whenever the context changed, so the view re-renders. */
  @property({ attribute: false }) accessor rev = 0;

  /** A screen: the fixed header, then the scrolling body (a `.page` with `cls`). */
  protected screen(head: Slot, body: unknown, cls = ""): TemplateResult {
    return html`<div class="screen-head">${head}</div>
      <div class="screen-body"><div class="page ${cls}">${body}</div></div>`;
  }

  /**
   * Header of a tab: the large title. Phone (HA sidebar hidden): the menu button and the
   * actions above it; desktop: title and actions in one row.
   */
  protected tabHead(title: string, end: Slot = nothing, { start = nothing as Slot, menu = true } = {}): TemplateResult {
    const { ctx } = this;
    if (!ctx.narrow) {
      return html`<div class="tab-head wide">${start}<h1 class="big">${title}</h1><div class="grow"></div>${end}</div>`;
    }
    return html`<div class="tab-head">
      <div class="bar">
        ${menu ? html`<button class="round menu" aria-label=${ctx.t("panel.menu")} @click=${() => ctx.toggleSidebar()}>${icon("menu")}</button>` : nothing}
        ${start}
        <div class="grow"></div>
        ${end}
      </div>
      <h1 class="big">${title}</h1>
    </div>`;
  }

  /** Header of a screen opened from another one: back, the title, actions. */
  protected subHead(title: string, back: () => void, end: Slot = nothing): TemplateResult {
    return html`<div class="bar sub">
      <button class="round back" aria-label=${this.ctx.t("common.back")} @click=${back}>${icon("back")}</button>
      <div class="title">${title}</div>
      ${end}
    </div>`;
  }
}
