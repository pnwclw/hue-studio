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

import type { StudioContext } from "../core/context.ts";
import { haptic } from "../core/ha-internals.ts";
import { icon, LightElement } from "./ui.ts";
import "./wheel.ts";
import { type Choice, choiceRows, isScreen, type MomentKind, type MomentValue, timeWheels } from "./choice.ts";

type Slot = TemplateResult | typeof nothing;

/** A step of a flow: art on the blue (or none), the panel, the footer's buttons (the main one last). */
export interface FlowStep {
  art?: Slot;
  panel: Slot;
  foot?: Slot;
}

/** A flow's picture in a ring (the Hue app's search): progress as an accent arc (null: none;
 *  "spin": a short arc going round while the end is not known), once over a badge at its top
 *  right; `alarm` turns the ring red (nothing was found). */
export function flowRing(art: TemplateResult, progress: number | "spin" | null, badge: "ok" | "fail" | null = null, alarm = false): TemplateResult {
  const r = 148;
  const c = 2 * Math.PI * r;
  const arc = progress === "spin" ? 0.22 : progress;
  return html`<div class=${classMap({ "flow-ring": true, over: !!badge, alarm, spin: progress === "spin" })} role="status" aria-live="polite">
    <svg viewBox="0 0 300 300" aria-hidden="true">
      <circle class="track" cx="150" cy="150" r=${r}></circle>
      ${arc === null ? nothing : html`<circle class="bar" cx="150" cy="150" r=${r} stroke-dasharray=${c} stroke-dashoffset=${c * (1 - arc)}></circle>`}
    </svg>
    ${art}
    ${badge ? html`<span class=${`badge ${badge}`}>${icon(badge === "ok" ? "check" : "close")}</span>` : nothing}
  </div>`;
}

export class StudioView extends LightElement {
  @property({ attribute: false }) accessor ctx!: StudioContext;
  /** Bumped by the owner whenever the context changed, so the view re-renders. */
  @property({ attribute: false }) accessor rev = 0;

  /** The choice open over the view (choice.ts), shown by `withChoice`. */
  @state() protected accessor choosing: Choice | null = null;
  /** A question on an action sheet (the Hue app's): leaving with changes, deleting (`askSheet`). */
  @state() protected accessor ask: { note: string; action: string; run: () => void; safe?: boolean } | null = null;

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
    const { t } = this.ctx;
    haptic("warning");
    this.ask = { note: t("common.leave_note"), action: t("common.leave"), run: leave };
  }

  /** Delete something only once the action sheet asked (its note, the red action). */
  protected askDelete(note: string, action: string, run: () => void): void {
    haptic("warning");
    this.ask = { note, action, run };
  }

  /** Do something only once the action sheet asked (its note, the action, not red). */
  protected askAction(note: string, action: string, run: () => void): void {
    this.ask = { note, action, run, safe: true };
  }

  /** The action sheet of `ask` (render it outside the scrolling body). */
  protected askSheet(): TemplateResult | typeof nothing {
    const ask = this.ask;
    if (!ask) return nothing;
    const { t } = this.ctx;
    const stay = () => (this.ask = null);
    return html`<div class=${classMap({ sheet: true, bottom: this.ctx.narrow, menu: true })} @click=${(e: Event) => e.target === e.currentTarget && stay()}>
      <div class="box action-sheet" role="dialog" aria-label=${ask.action}>
        <p class="note">${ask.note}</p>
        <button class=${ask.safe ? "" : "danger"} @click=${() => {
          this.ask = null;
          ask.run();
        }}>${ask.action}</button>
        <button class="cancel" @click=${stay}>${t("common.cancel")}</button>
      </div>
    </div>`;
  }

  /** A flow's step, the Hue app's ("Add devices", a new bridge, a MotionAware area): a picker,
   *  its art on the blue over a rounded panel, the buttons in a stacked footer; the first
   *  step closes (✕), the others go back. */
  protected flow(first: boolean, back: () => void, step: FlowStep): TemplateResult {
    const { t } = this.ctx;
    const head = html`<div class="bar">
      <button class=${first ? "round close" : "round back"} aria-label=${t(first ? "common.close" : "common.back")} @click=${back}>
        ${icon(first ? "close" : "back")}
      </button>
    </div>`;
    const art = step.art !== undefined && step.art !== nothing;
    return html`${this.screen(
        head,
        html`${art ? html`<div class="flow-art">${step.art}</div>` : nothing}<div class="flow-panel">${step.panel}</div>`,
        art ? "flow with-art" : "flow",
      )}
      ${step.foot && step.foot !== nothing ? html`<div class="screen-foot stack">${step.foot}</div>` : nothing}`;
  }

  /** A flow panel's title and lead. */
  protected flowTitle(text: string, lead?: unknown): TemplateResult {
    return html`<h1 class="big flow-title">${text}</h1>${lead ? html`<p class="lead flow-lead">${lead}</p>` : nothing}`;
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
    return html`${this.withChoice(this.renderPage())}${this.askSheet()}`;
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

  /**
   * A name typed on a page of its own, never on a dialog: the bar (back, its title, the action
   * pill), the glyph of what is named (if any), the outlined field with its clear button, a hint
   * (or `warn` instead), more below (rows, an icon grid). Comes up ready to type.
   */
  protected nameScreen(o: {
    title: string;
    value: string;
    max: number;
    label: string;
    input: (value: string) => void;
    done: () => void;
    doneLabel: string;
    back: () => void;
    canDone?: boolean;
    glyph?: string;
    placeholder?: string;
    inputmode?: string;
    hint?: string;
    warn?: string;
    more?: unknown;
    cls?: string;
    /** The filled field (a Sync Box input's name, the Hue app's) instead of the outlined one. */
    filled?: boolean;
  }): TemplateResult {
    const { t } = this.ctx;
    const ok = o.canDone ?? !!o.value.trim();
    const pill = html`<button class="pill save" ?disabled=${!ok} @click=${() => ok && o.done()}>${o.doneLabel}</button>`;
    const body = html`${o.glyph ? html`<div class="name-pic"><ha-icon icon=${o.glyph}></ha-icon></div>` : nothing}
      <label class="name-field">
        <input class=${o.filled ? "field filled" : "field outlined"} maxlength=${o.max} aria-label=${o.label} placeholder=${o.placeholder ?? ""} inputmode=${o.inputmode ?? "text"}
          .value=${o.value} @input=${(e: InputEvent) => o.input((e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => e.key === "Enter" && ok && o.done()} />
        ${o.value
          ? html`<button class="round mini" aria-label=${t("common.clear")} @click=${(e: Event) => {
              e.preventDefault();
              o.input("");
              this.querySelector<HTMLInputElement>(".name-field input")?.focus();
            }}>${icon("close")}</button>`
          : nothing}
      </label>
      ${o.warn ? html`<p class="hint warn">${o.warn}</p>` : o.hint ? html`<p class="hint">${o.hint}</p>` : nothing}
      ${o.more ?? nothing}`;
    if (!this.#nameFocused) {
      this.#nameFocused = true;
      void this.updateComplete.then(() => {
        const field = this.querySelector<HTMLInputElement>(".name-page .name-field input");
        field?.focus();
        field?.select();
      });
    }
    return this.screen(this.subHead(o.title, o.back, pill), body, `settings-page name-page ${o.cls ?? ""}`);
  }

  /** The next name page comes up ready to type again (call when one closes). */
  protected nameClosed(): void {
    this.#nameFocused = false;
  }

  #nameFocused = false;

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
