// Base class of the views: they render from the shared StudioContext into the light DOM of
// the panel (or dialog), whose stylesheet styles them.
//
// Every screen has a fixed header and a body that scrolls (and bounces) on its own, so the
// header never moves with an overscroll. Two kinds of headers, like the Hue app: a tab
// (Home, Explore, Sync, Settings) has a large title that moves into its bar on scroll; a
// screen opened from another one has a compact bar with a back button and its title.

import { html, nothing, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import type { StudioContext } from "../context.ts";
import { haptic } from "../ha-internals.ts";
import { icon, LightElement } from "../ui.ts";
import "../wheel.ts";
import { type Choice, choiceRows, isScreen, type MomentKind, type MomentValue, timeWheels } from "./choice.ts";

type Slot = TemplateResult | typeof nothing;

export class StudioView extends LightElement {
  @property({ attribute: false }) accessor ctx!: StudioContext;
  /** Bumped by the owner whenever the context changed, so the view re-renders. */
  @property({ attribute: false }) accessor rev = 0;

  /** The choice open over the view (views/choice.ts), shown by `withChoice`. */
  @state() protected accessor choosing: Choice | null = null;
  /** Leaving an editor with unsaved changes: what leaving does, asked first (`leaveSheet`). */
  @state() protected accessor leaveAsk: (() => void) | null = null;

  #headObserver?: ResizeObserver;
  /** Where the body was scrolled to on the pages below the one shown (`pushPage`). */
  #scrolls: number[] = [];

  /** A tab's header floats over the body: the body starts below it and scrolls under it. */
  protected override updated(changed: Map<PropertyKey, unknown>): void {
    super.updated(changed);
    this.#syncHead();
    // Lights a Sync Box drives pulse on one beat: their animations start at the timeline's origin.
    for (const a of this.getAnimations({ subtree: true })) {
      if ((a as CSSAnimation).animationName === "sync-pulse" && a.startTime !== 0) a.startTime = 0;
    }
    const head = this.querySelector<HTMLElement>(":scope > .screen-head");
    if (!head || head.dataset.observed) return;
    head.dataset.observed = "1";
    // Measured now, before the first paint, so the body never starts under the header.
    this.style.setProperty("--head-h", `${head.offsetHeight}px`);
    this.#headObserver?.disconnect();
    this.#headObserver = new ResizeObserver(() => this.style.setProperty("--head-h", `${head.offsetHeight}px`));
    this.#headObserver.observe(head);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#headObserver?.disconnect();
  }

  /** Leave an editor at once, or (the Hue app's) ask first when it has unsaved changes. */
  protected confirmLeave(dirty: boolean, leave: () => void): void {
    if (!dirty) return leave();
    haptic("warning");
    this.leaveAsk = leave;
  }

  /** "Close and don't save" over an editor (render it outside the scrolling body). */
  protected leaveSheet(): TemplateResult | typeof nothing {
    const leave = this.leaveAsk;
    if (!leave) return nothing;
    const { t } = this.ctx;
    const stay = () => (this.leaveAsk = null);
    return html`<div class=${classMap({ sheet: true, bottom: this.ctx.narrow, menu: true })} @click=${(e: Event) => e.target === e.currentTarget && stay()}>
      <div class="box action-sheet" role="dialog" aria-label=${t("common.leave")}>
        <p class="note">${t("common.leave_note")}</p>
        <button class="danger" @click=${() => {
          this.leaveAsk = null;
          leave();
        }}>${t("common.leave")}</button>
        <button class="cancel" @click=${stay}>${t("common.cancel")}</button>
      </div>
    </div>`;
  }

  /** A screen: the fixed header, then the scrolling body (a `.page` with `cls`). */
  protected screen(head: Slot, body: unknown, cls = ""): TemplateResult {
    return html`<div class="screen-head">${head}</div>
      <div class="screen-body" @scroll=${this.#syncHead}><div class="page ${cls}">${body}</div></div>`;
  }

  /**
   * A tab (Home, Sync, Settings) or a full-screen page (the scene gallery), like an iOS
   * large title. Phone: a bar with the menu button (or `lead`, e.g. close) and the actions
   * over a large title that scrolls with the body; once the title went under the bar, it
   * shows in the bar beside that button (`center`, e.g. a search field, takes its place).
   * Desktop: `lead`, title and actions in one row as tall as the HA sidebar's header,
   * `center` before the actions.
   */
  protected tabScreen(
    title: string,
    body: unknown,
    { end = nothing as Slot, center = nothing as Slot, lead = nothing as Slot, cls = "" } = {},
  ): TemplateResult {
    const { ctx } = this;
    if (!ctx.narrow) {
      return this.screen(html`<div class="tab-head wide">${lead}<h1 class="big">${title}</h1><div class="grow"></div>${center}${end}</div>`, body, cls);
    }
    const head = html`<div class="tab-head">
      <div class="bar">
        ${lead === nothing
          ? html`<button class="round menu-btn" aria-label=${ctx.t("panel.menu")} @click=${() => ctx.toggleSidebar()}>${icon("menu")}</button>`
          : lead}
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

  /** Views offering choices draw their page here; `render` adds the open choice to it. */
  protected renderPage(): TemplateResult {
    return html``;
  }

  protected override render(): unknown {
    return this.withChoice(this.renderPage());
  }

  /** Open a choice: a sheet over the view, or a screen of its own. */
  protected choose(choice: Choice): void {
    haptic("selection");
    if (isScreen(choice)) this.pushPage();
    this.choosing = { ...choice, lists: choice.lists.map((l) => ({ ...l, selected: [...l.selected] })) };
  }

  protected closeChoice(): void {
    const was = this.choosing;
    this.choosing = null;
    if (was && isScreen(was)) this.popPage();
  }

  /**
   * The view's own page with the open choice: a screen of its own instead of it, or a sheet
   * after it (outside the scrolling body, which would clip it on iOS).
   */
  private withChoice(page: TemplateResult): TemplateResult {
    const c = this.choosing;
    if (!c) return page;
    if (c.moment) return this.momentScreen(c);
    const { t } = this.ctx;
    const flip = (index: number, value: string) => {
      const list = c.lists[index];
      let selected: string[];
      if (list.multi) {
        selected = list.selected.includes(value) ? list.selected.filter((v) => v !== value) : [...list.selected, value];
        if (selected.length < (list.min ?? 0)) return;
      } else selected = [value];
      haptic("selection");
      list.pick(selected);
      if (!list.multi && c.lists.length === 1) {
        this.closeChoice();
        return;
      }
      this.choosing = { ...c, lists: c.lists.map((l, i) => (i === index ? { ...l, selected } : l)) };
    };
    const action = c.action;
    const body = html`${c.hint ? html`<p class="hint">${c.hint}</p>` : nothing}${c.lists.map((l, i) => choiceRows(l, (v) => flip(i, v)))}
      ${action
        ? html`<div class="save-area"><button class="pill reset" @click=${() => {
            haptic("selection");
            action.run();
            this.closeChoice();
          }}>${action.label}</button></div>`
        : nothing}`;
    if (isScreen(c)) return this.screen(this.subHead(c.title, () => this.closeChoice()), body, "settings-page choice-page");
    return html`${page}
      <div class=${classMap({ sheet: true, bottom: this.ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && this.closeChoice()}>
        <div class="box form sensor-sheet choice-sheet" role="dialog" aria-label=${c.title}>
          <div class="sheet-bar">
            <button class="round close" aria-label=${t("common.close")} @click=${() => this.closeChoice()}>${icon("close")}</button>
            <div class="grow">${c.title}</div>
          </div>
          <div class="form-body">${body}</div>
        </div>
      </div>`;
  }

  /** A time screen (momentChoice): kinds with a tick, the chosen one's wheels under it, "Done" keeps them. */
  private momentScreen(c: Choice): TemplateResult {
    const m = c.moment!;
    const { t } = this.ctx;
    const set = (patch: Partial<MomentValue>) => {
      this.choosing = { ...c, moment: { ...m, ...patch } };
    };
    const done = html`<button class="pill save" @click=${() => {
      haptic("success");
      m.done({ kind: m.kind, time: m.time, offset: m.offset });
      this.closeChoice();
    }}>${t("color.done")}</button>`;
    const wheels = (k: MomentKind) => {
      if (k.wheel === "time") return timeWheels(m.time, (time) => set({ time }));
      if (k.wheel === "sun") {
        const values = m.offsets.includes(m.offset) ? m.offsets : [...m.offsets, m.offset].sort((a, b) => a - b);
        const options = values.map((v) => ({ value: String(v), label: m.offsetLabel(k.value, v) }));
        return html`<div class="wheels"><hue-studio-wheel .options=${options} .value=${String(m.offset)} .change=${(v: string) => set({ offset: Number(v) })}></hue-studio-wheel></div>`;
      }
      return nothing;
    };
    const rows =
      m.kinds.length === 1
        ? html`<div class="item wheels-item">${wheels(m.kinds[0])}</div>`
        : m.kinds.map((k) => {
            const on = k.value === m.kind;
            return html`<button class=${classMap({ item: true, on })} role="radio" aria-checked=${on} @click=${() => {
                if (on) return;
                haptic("selection");
                set({ kind: k.value });
              }}>
                <div class="grow">${k.label}</div>
                ${on ? html`<span class="tick">${icon("check")}</span>` : nothing}
              </button>
              ${on && k.wheel !== "none" ? html`<div class="item wheels-item">${wheels(k)}</div>` : nothing}`;
          });
    const body = html`${c.hint ? html`<p class="hint">${c.hint}</p>` : nothing}<div class="rows moment-list" role="radiogroup">${rows}</div>`;
    return this.screen(this.subHead(c.title, () => this.closeChoice(), done), body, "settings-page choice-page moment-page");
  }

  /** Before showing a page over the current one: remember the scroll, start the next at the top. */
  protected pushPage(): void {
    const body = this.querySelector<HTMLElement>(":scope > .screen-body");
    this.#scrolls.push(body?.scrollTop ?? 0);
    void this.updateComplete.then(() => this.querySelector<HTMLElement>(":scope > .screen-body")?.scrollTo(0, 0));
  }

  /** Back from a page over the current one: the current one where it was scrolled to. */
  protected popPage(): void {
    const top = this.#scrolls.pop() ?? 0;
    void this.updateComplete.then(() => this.querySelector<HTMLElement>(":scope > .screen-body")?.scrollTo(0, top));
  }

  /** Header of a screen opened from another one: back (close for an editor that comes up as a
   *  sheet), the title (or `center` instead), actions. */
  protected subHead(title: string, back: () => void, end: Slot = nothing, center: Slot = nothing, close = false): TemplateResult {
    const { t } = this.ctx;
    return html`<div class="bar sub">
      <button class=${close ? "round close" : "round back"} aria-label=${t(close ? "common.close" : "common.back")} @click=${back}>${icon(close ? "close" : "back")}</button>
      ${center === nothing ? html`<div class="title">${title}</div>` : center}
      ${end}
    </div>`;
  }
}
