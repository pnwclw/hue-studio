// Moving a room, or lights that go to a room on another bridge, to another bridge
// (custom_components/hue_studio/migration.py). First what it does: the lights, the scenes
// copied, zones moved or split, what stays behind, the bridge it goes to, serial numbers
// if they are at hand. Then the move as it goes: the old bridge lets the lights go, the
// new one finds them, names, rooms and scenes come back, and Home Assistant keeps their
// entity ids. Lights not found leave it waiting: search again (serial numbers), put them
// back on the old bridge, or stop waiting. The move runs in Home Assistant: this screen
// only watches it, so it can be left and opened again (Settings → Bridges shows it).

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import { MAX_SERIALS, parseSerials } from "../devices.ts";
import { haptic } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import { friendlyName } from "../model.ts";
import { bridgeName, bridgeOf, groupBridge } from "../rooms.ts";
import type { MovePlan, MoveState, MoveStep } from "../types.ts";
import { icon } from "../ui.ts";
import { StudioView } from "./base.ts";

/** The steps shown while a move goes, in order. */
const STEPS: MoveStep[] = ["removing", "searching", "restoring", "rooms", "scenes"];
const ERRORS = ["not_found", "interrupted", "bridge", "target_offline", "source_offline"];

@customElement("hue-studio-bridge-move-view")
export class BridgeMoveView extends StudioView {
  /** An area whose Hue lights (its room) move. */
  @property() accessor area: string | null = null;
  /** Or some lights, into `toArea`. */
  @property({ attribute: false }) accessor lights: string[] | null = null;
  @property() accessor toArea: string | null = null;
  /** The bridge to move to (else picked here). */
  @property() accessor to: string | null = null;

  @state() private accessor state: MoveState | null | undefined = undefined;
  @state() private accessor target: string | null = null;
  @state() private accessor plan: MovePlan | null = null;
  @state() private accessor planError: string | null = null;
  @state() private accessor serials = "";
  @state() private accessor showSerials = false;
  @state() private accessor busy = false;
  @state() private accessor now = Date.now();
  private planKey = "";
  private stop?: () => void;
  private ticker?: ReturnType<typeof setInterval>;

  override connectedCallback(): void {
    super.connectedCallback();
    this.stop = this.ctx.watch<MoveState | null>("hue_studio/bridges/move/subscribe", (m) => {
      const was = this.state?.step;
      this.state = m;
      if (m && was && was !== m.step) haptic(m.step === "done" ? "success" : m.step === "waiting" || m.step === "failed" ? "failure" : "light");
    });
    this.ticker = setInterval(() => (this.now = Date.now()), 1000);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop?.();
    clearInterval(this.ticker);
  }

  /** The lights asked for (an area's Hue lights, or the lights given). */
  private get moving(): string[] {
    if (this.lights?.length) return this.lights;
    return this.ctx.home.rooms.find((r) => r.key === `area.${this.area}`)?.lights || [];
  }

  /** The bridges they can go to: every other bridge (a room: other than the one most of it is on). */
  private get targets(): [string, string][] {
    const plan = this.ctx.rooms;
    const room = !this.lights?.length ? this.ctx.home.rooms.find((r) => r.key === `area.${this.area}`) : undefined;
    const source = room ? groupBridge(plan, room) : (this.moving.map((l) => bridgeOf(plan, l)).find(Boolean) ?? null);
    return Object.entries(plan?.bridges || {}).filter(([id]) => id !== source);
  }

  private get request(): Record<string, unknown> | null {
    const target = this.target ?? this.to ?? this.targets[0]?.[0] ?? null;
    if (!target) return null;
    if (this.lights?.length) return { target, lights: this.lights, ...(this.toArea ? { to_area: this.toArea } : {}) };
    if (this.area) return { target, area: this.area };
    return null;
  }

  protected override willUpdate(): void {
    // A plan for what is asked, fetched again when the bridge changes.
    if (this.state !== null) return;
    const request = this.request;
    const key = JSON.stringify(request);
    if (!request || key === this.planKey) return;
    this.planKey = key;
    this.plan = null;
    this.planError = null;
    void this.ctx.query<MovePlan>({ type: "hue_studio/bridges/move_plan", ...request }, { quiet: true }).then((plan) => {
      if (key !== this.planKey) return;
      this.plan = plan;
      if (!plan) this.planError = this.ctx.t("move.plan_failed");
    });
  }

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const state = this.state;
    const body =
      state === undefined
        ? html`<p class="empty">${t("rooms.loading")}</p>`
        : state
          ? this.progress(state)
          : this.request
            ? this.planPage()
            : html`<p class="empty">${t("move.nothing")}</p>`;
    return this.screen(this.subHead(t("move.title"), () => this.leave()), body, "settings-page bridge-move");
  }

  private leave(): void {
    const area = this.state?.area ?? this.toArea ?? this.area;
    this.ctx.go(area && this.ctx.home.rooms.some((r) => r.key === `area.${area}`) ? `/room/${encodeURIComponent(`area.${area}`)}` : "/settings/bridges");
  }

  // ---------- before: what the move does ----------

  private planPage(): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const plan = this.plan;
    const request = this.request!;
    const current = request.target as string;
    const what = this.area && !this.lights?.length ? ctx.hass.areas?.[this.area]?.name || this.area : this.moving.map((l) => friendlyName(ctx.hass, l)).join(", ");
    const parsed = parseSerials(this.serials);
    const bad = parsed.invalid.length > 0 || parsed.tooMany;
    const row = (glyph: string, text: string, sub = "", warn = false) =>
      html`<div class="item"><ha-icon icon=${glyph}></ha-icon><div class="grow">${text}${sub ? html`<div class=${classMap({ "dim small": true, warn })}>${sub}</div>` : nothing}</div></div>`;
    return html`<p class="lead">${t("move.intro", { what, from: plan?.source_name ?? "", to: plan?.target_name ?? bridgeName(ctx.rooms, current) ?? "" })}</p>
      ${this.targets.length > 1 && !this.to
        ? html`<h2 class="label">${t("move.to")}</h2>
            <div class="chips wrap">
              ${this.targets.map(
                ([id, name]) => html`<button class=${classMap({ chip: true, on: id === current })} @click=${() => (this.target = id)}>
                  <ha-icon icon="mdi:router-wireless"></ha-icon>${name}
                </button>`,
              )}
            </div>`
        : nothing}
      ${this.planError ? html`<p class="lead small error">${this.planError}</p>` : nothing}
      ${!plan && !this.planError ? html`<p class="empty">${t("rooms.loading")}</p>` : nothing}
      ${plan
        ? html`<h2 class="label">${t("move.what")}</h2>
            <div class="rows">
              ${row("mdi:lightbulb-group-outline", plan.lights.length === 1 ? t("rooms.one_light") : t("rooms.lights_count", { count: plan.lights.length }),
                plan.lights.map((l) => friendlyName(ctx.hass, l)).join(", "))}
              ${plan.room ? row("mdi:sofa-outline", t("move.room", { name: plan.room })) : nothing}
              ${plan.scenes ? row("mdi:palette-outline", t("move.scenes", { count: plan.scenes })) : nothing}
              ${plan.zones.map((z) => row("mdi:texture-box", t(z.whole ? "move.zone_moves" : "move.zone_split", { name: z.name })))}
            </div>
            ${plan.entertainment.length || plan.staying.length || plan.over_limit
              ? html`<div class="rows conflicts">
                  ${plan.entertainment.length ? row("mdi:alert-outline", t("move.entertainment", { names: plan.entertainment.join(", ") }), "", true) : nothing}
                  ${plan.staying.length ? row("mdi:alert-outline", t("move.staying", { names: plan.staying.join(", "), bridge: plan.source_name })) : nothing}
                  ${plan.over_limit ? row("mdi:alert-outline", t("move.over_limit", { bridge: plan.target_name })) : nothing}
                </div>`
              : nothing}
            <h2 class="label">${t("move.how")}</h2>
            <ol class="rows steps-list">
              ${(["move.how_1", "move.how_2", "move.how_3"] as StringKey[]).map(
                (key, i) => html`<li class="item"><span class="step-no">${i + 1}</span><div class="grow">${t(key, { from: plan.source_name, to: plan.target_name })}</div></li>`,
              )}
            </ol>
            <div class="rows">${this.serialField(parsed, bad, t("move.serials_sub", { from: plan.source_name, to: plan.target_name }))}</div>
            <div class="center"><button class="pill go" ?disabled=${this.busy || bad} @click=${() => this.start(parsed.codes)}>${t("move.start", { bridge: plan.target_name })}</button></div>`
        : nothing}`;
  }

  private serialField(parsed: ReturnType<typeof parseSerials>, bad: boolean, sub: string): TemplateResult {
    const { t } = this.ctx;
    return this.showSerials
      ? html`<div class="item col">
          <div class="line"><span>${t("devices.serials")}</span><span class="dim">${parsed.codes.length}/${MAX_SERIALS}</span></div>
          <input class="field" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="A1B2C3, D4E5F6"
            aria-label=${t("devices.serials")} .value=${this.serials} @input=${(e: InputEvent) => (this.serials = (e.target as HTMLInputElement).value)} />
          <div class=${classMap({ "dim small": true, error: bad })}>
            ${bad ? t(parsed.tooMany ? "add_device.serials_many" : "add_device.serials_bad", { codes: parsed.invalid.join(", ") }) : sub}
          </div>
        </div>`
      : html`<button class="item" @click=${() => (this.showSerials = true)}>
          <ha-icon icon="mdi:numeric"></ha-icon>
          <div class="grow">${t("add_device.add_serials")}<div class="dim small">${sub}</div></div>
          <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
        </button>`;
  }

  private async start(serials: string[]): Promise<void> {
    if (this.busy || !this.request) return;
    this.busy = true;
    haptic("light");
    const ok = await this.ctx.ws({ type: "hue_studio/bridges/move", ...this.request, serials });
    this.busy = false;
    if (ok) this.serials = "";
  }

  // ---------- during and after ----------

  private progress(s: MoveState): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const found = s.lights.filter((l) => l.found).length;
    const missing = s.lights.filter((l) => !l.found);
    if (s.step === "done") {
      return html`<div class="link-state">
        <div class="link-icon ok">${icon("check")}</div>
        <h2 class="link-title">${t("move.done", { what: s.room || s.lights.map((l) => l.name).join(", "), bridge: s.target_name })}</h2>
        <p class="lead center-text">${t("move.done_sub")}</p>
        <div class="link-actions"><button class="pill go" @click=${() => this.finish()}>${t("move.finish")}</button></div>
      </div>`;
    }
    const stuck = s.step === "waiting" || s.step === "failed";
    const reached = stuck ? -1 : STEPS.indexOf(s.step);
    const left = s.searching_until ? Math.max(0, Math.round(s.searching_until - this.now / 1000)) : 0;
    const parsed = parseSerials(this.serials);
    const bad = parsed.invalid.length > 0 || parsed.tooMany;
    const reason = ERRORS.includes(s.error || "") ? s.error! : "bridge";
    return html`<p class="lead">${t("move.going", { what: s.room || s.lights.map((l) => l.name).join(", "), from: s.source_name, to: s.target_name })}</p>
      ${stuck
        ? html`<div class="mismatch"><p>${t(`move.error_${reason}` as StringKey, { from: s.source_name, to: s.target_name, count: missing.length })}</p></div>`
        : html`<ol class="rows steps-list move-steps">
            ${STEPS.map((step, i) => {
              const done = i < reached;
              const now = i === reached;
              return html`<li class=${classMap({ item: true, dim: !done && !now })}>
                <span class="step-no">${done ? icon("check") : now ? html`<span class="spinner"></span>` : i + 1}</span>
                <div class="grow">${t(`move.step_${step}` as StringKey, { from: s.source_name, to: s.target_name })}
                  ${now && step === "searching" ? html`<div class="dim small">${t("move.searching", { found, count: s.lights.length, seconds: left })}</div>` : nothing}
                </div>
              </li>`;
            })}
          </ol>`}
      <h2 class="label">${t("move.lights")}</h2>
      <div class="rows">
        ${s.lights.map(
          (l) => html`<div class="item">
            <ha-icon icon=${l.found ? "mdi:check-circle-outline" : "mdi:lightbulb-question-outline"}></ha-icon>
            <div class="grow">${l.entity_id && ctx.hass.states[l.entity_id] ? friendlyName(ctx.hass, l.entity_id) : l.name}
              <div class="dim small">${l.found ? t("move.found_on", { bridge: s.target_name }) : t("move.not_yet")}</div>
            </div>
          </div>`,
        )}
      </div>
      ${stuck
        ? html`<ol class="rows steps-list">
              ${(["move.tip_power", "move.tip_close", "move.tip_reset"] as StringKey[]).map(
                (key, i) => html`<li class="item"><span class="step-no">${i + 1}</span><div class="grow">${t(key, { to: s.target_name })}</div></li>`,
              )}
            </ol>
            <div class="rows">${this.serialField(parsed, bad, t("move.serials_retry"))}</div>
            <div class="link-actions">
              <button class="pill go" ?disabled=${this.busy || bad || s.running} @click=${() => this.retry(parsed.codes)}>${t("move.again", { bridge: s.target_name })}</button>
              ${found === 0 && s.source !== s.target
                ? html`<button class="pill" ?disabled=${this.busy || s.running} @click=${() => this.retry(parsed.codes, s.source)}>${t("move.back", { bridge: s.source_name })}</button>`
                : nothing}
              <button class="pill" ?disabled=${this.busy || s.running} @click=${() => this.finish()}>${t("move.stop")}</button>
            </div>`
        : nothing}`;
  }

  private async retry(serials: string[], target?: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    await this.ctx.ws({ type: "hue_studio/bridges/move/retry", serials, ...(target ? { target } : {}) });
    this.busy = false;
  }

  private async finish(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const area = this.state?.area;
    const ok = await this.ctx.ws({ type: "hue_studio/bridges/move/finish" });
    this.busy = false;
    if (!ok) return;
    this.planKey = "";
    this.ctx.go(area || this.area ? `/room/${encodeURIComponent(`area.${area || this.area}`)}` : "/settings/bridges");
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-bridge-move-view": BridgeMoveView;
  }
}
