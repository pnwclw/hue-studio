// Base class of the views: they render from the shared StudioContext into the light DOM of
// the panel (or dialog), whose stylesheet styles them.
//
// Every screen has a fixed header and a body that scrolls (and bounces) on its own, so the
// header never moves with an overscroll. Two kinds of headers, like the Hue app: a tab
// (Home, Explore, Sync, Settings) has a large title that moves into its bar on scroll; a
// screen opened from another one has a compact bar with a back button and its title.

import { html, nothing, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";

import type { StudioContext } from "../context.ts";
import { icon, LightElement } from "../ui.ts";

type Slot = TemplateResult | typeof nothing;

export class StudioView extends LightElement {
  @property({ attribute: false }) accessor ctx!: StudioContext;
  /** Bumped by the owner whenever the context changed, so the view re-renders. */
  @property({ attribute: false }) accessor rev = 0;

  #headObserver?: ResizeObserver;

  /** A tab's header floats over the body: the body starts below it and scrolls under it. */
  protected override updated(changed: Map<PropertyKey, unknown>): void {
    super.updated(changed);
    this.#syncHead();
    const head = this.querySelector<HTMLElement>(":scope > .screen-head");
    if (!head || head.dataset.observed) return;
    head.dataset.observed = "1";
    this.#headObserver?.disconnect();
    this.#headObserver = new ResizeObserver(() => this.style.setProperty("--head-h", `${head.offsetHeight}px`));
    this.#headObserver.observe(head);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#headObserver?.disconnect();
  }

  /** A screen: the fixed header, then the scrolling body (a `.page` with `cls`). */
  protected screen(head: Slot, body: unknown, cls = ""): TemplateResult {
    return html`<div class="screen-head">${head}</div>
      <div class="screen-body" @scroll=${this.#syncHead}><div class="page ${cls}">${body}</div></div>`;
  }

  /**
   * A tab (Home, Explore, Sync, Settings), like an iOS large title. Phone (HA sidebar
   * hidden): a bar with the menu button and the actions over a large title that scrolls
   * with the body; once the title went under the bar, it shows in the bar beside the menu
   * button (`center`, e.g. a search field, takes its place). Desktop: title and actions in
   * one row as tall as the HA sidebar's header, `center` before the actions.
   */
  protected tabScreen(
    title: string,
    body: unknown,
    { end = nothing as Slot, center = nothing as Slot, cls = "" } = {},
  ): TemplateResult {
    const { ctx } = this;
    if (!ctx.narrow) {
      return this.screen(html`<div class="tab-head wide"><h1 class="big">${title}</h1><div class="grow"></div>${center}${end}</div>`, body, cls);
    }
    const head = html`<div class="tab-head">
      <div class="bar">
        <button class="round menu-btn" aria-label=${ctx.t("panel.menu")} @click=${() => ctx.toggleSidebar()}>${icon("menu")}</button>
        ${center === nothing ? html`<div class="bar-title" aria-hidden="true">${title}</div>` : center}
        ${end}
      </div>
    </div>`;
    return this.screen(head, html`${center === nothing ? html`<h1 class="big tab-title">${title}</h1>` : nothing}${body}`, cls);
  }

  /** The large title went under the bar: the bar gets its own title and background. */
  #syncHead = (): void => {
    const head = this.querySelector<HTMLElement>(":scope > .screen-head");
    if (!head?.querySelector(":scope > .tab-head:not(.wide)")) return;
    const title = this.querySelector<HTMLElement>(":scope > .screen-body .tab-title");
    const under = title ? title.getBoundingClientRect().bottom <= head.getBoundingClientRect().bottom + 2 : true;
    head.classList.toggle("scrolled", under);
  };

  /** Header of a screen opened from another one: back, the title (or `center` instead), actions. */
  protected subHead(title: string, back: () => void, end: Slot = nothing, center: Slot = nothing): TemplateResult {
    return html`<div class="bar sub">
      <button class="round back" aria-label=${this.ctx.t("common.back")} @click=${back}>${icon("back")}</button>
      ${center === nothing ? html`<div class="title">${title}</div>` : center}
      ${end}
    </div>`;
  }
}
