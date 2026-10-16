// Moving to another bridge (custom_components/hue_studio/migration.py): a whole bridge
// (its page → "Move everything"), a room (its bridge next to "Lights") or lights going to
// a room on another bridge. First what moves: lights, switches and sensors, rooms, scenes
// copied, zones and entertainment areas moved or split. Then the move as it goes: the old
// bridge lets the devices go, the user switches the lights off and on (and resets switches
// and sensors) and continues, the new bridge finds them, and names, rooms, scenes and
// their Home Assistant entities come back. Devices not found leave it waiting: search
// again (serial numbers), put them back on the old bridge, or stop waiting. The move runs
// in Home Assistant: this screen only watches it (Settings → Bridges shows it too).

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

/** The steps shown while a move goes, in order (a whole bridge has no power-cycle pause). */
const STEPS: MoveStep[] = ["removing", "power_cycle", "searching", "restoring", "rooms", "scenes"];
const STEPS_ALL = STEPS.filter((step) => step !== "power_cycle");
const ERRORS = ["not_found", "interrupted", "bridge", "target_offline", "source_offline"];

@customElement("hue-studio-bridge-move-view")
export class BridgeMoveView extends StudioView {
  /** A whole bridge that moves (its native hue entry id). */
  @property() accessor bridge: string | null = null;
  /** Or an area whose Hue room moves. */
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
      if (m && was && was !== m.step) {
        haptic(m.step === "done" ? "success" : m.step === "waiting" || m.step === "failed" ? "failure" : m.step === "power_cycle" ? "warning" : "light");
      }
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

  /** The bridge the asked-for devices are on. */
  private get source(): string | null {
    if (this.bridge) return this.bridge;
    const plan = this.ctx.rooms;
    if (this.lights?.length) return this.lights.map((l) => bridgeOf(plan, l)).find(Boolean) ?? null;
    const room = this.ctx.home.rooms.find((r) => r.key === `area.${this.area}`);
    return room ? groupBridge(plan, room) : null;
  }

  /** The bridges they can go to: every other one. */
  private get targets(): [string, string][] {
    const source = this.source;
    return Object.entries(this.ctx.rooms?.bridges || {}).filter(([id]) => id !== source);
  }

  private get request(): Record<string, unknown> | null {
    const target = this.target ?? this.to ?? this.targets[0]?.[0] ?? null;
    if (!target) return null;
    if (this.bridge) return { target, bridge: this.bridge };
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
    const title = t(this.bridge || state?.whole_bridge ? "move.title_all" : "move.title");
    return this.screen(this.subHead(title, () => this.leave()), body, "settings-page bridge-move");
  }

  private leave(): void {
    const area = this.state?.area ?? this.toArea ?? this.area;
    const bridge = this.state?.source ?? this.bridge;
    if (area && this.ctx.home.rooms.some((r) => r.key === `area.${area}`)) this.ctx.go(`/room/${encodeURIComponent(`area.${area}`)}`);
    else this.ctx.go(bridge ? `/settings/bridges/${encodeURIComponent(bridge)}` : "/settings/bridges");
  }

  private row(glyph: string, text: string, sub = ""): TemplateResult {
    return html`<div class="item"><ha-icon icon=${glyph}></ha-icon><div class="grow">${text}${sub ? html`<div class="dim small">${sub}</div>` : nothing}</div></div>`;
  }

  private steps(keys: StringKey[], params: Record<string, string>): TemplateResult {
    const { t } = this.ctx;
    return html`<ol class="rows steps-list">
      ${keys.map((key, i) => html`<li class="item"><span class="step-no">${i + 1}</span><div class="grow">${t(key, params)}</div></li>`)}
    </ol>`;
  }

  // ---------- before: what the move does ----------

  private planPage(): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const plan = this.plan;
    const current = this.request!.target as string;
    const parsed = parseSerials(this.serials);
    const bad = parsed.invalid.length > 0 || parsed.tooMany;
    const names = (ids: string[]) => ids.map((l) => friendlyName(ctx.hass, l)).join(", ");
    const what = this.area && !this.lights?.length ? ctx.hass.areas?.[this.area]?.name || this.area : names(this.moving);
    const params = { from: plan?.source_name ?? "", to: plan?.target_name ?? bridgeName(ctx.rooms, current) ?? "" };
    return html`<p class="lead">${this.bridge ? t("move.intro_all", params) : t("move.intro", { ...params, what })}</p>
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
              ${plan.lights.length
                ? this.row("mdi:lightbulb-group-outline", plan.lights.length === 1 ? t("rooms.one_light") : t("rooms.lights_count", { count: plan.lights.length }), names(plan.lights))
                : nothing}
              ${plan.accessories.length ? this.row("mdi:gesture-tap-button", t("move.accessories", { count: plan.accessories.length }), plan.accessories.join(", ")) : nothing}
              ${plan.rooms.length ? this.row("mdi:sofa-outline", t("move.rooms", { count: plan.rooms.length }), plan.rooms.join(", ")) : nothing}
              ${plan.scenes ? this.row("mdi:palette-outline", t("move.scenes", { count: plan.scenes })) : nothing}
              ${plan.zones.map((z) => this.row("mdi:texture-box", t(z.whole ? "move.zone_moves" : "move.zone_split", { name: z.name })))}
              ${plan.entertainment.map((e) => this.row("mdi:television-ambient-light", t(e.whole ? "move.ent_moves" : "move.ent_split", { name: e.name })))}
            </div>
            ${plan.over_limit ? html`<div class="rows conflicts">${this.row("mdi:alert-outline", t("move.over_limit", { bridge: plan.target_name }))}</div>` : nothing}
            <h2 class="label">${t("move.how")}</h2>
            ${this.steps(this.bridge ? ["move.how_1", "move.how_all_2", "move.how_3", "move.how_4"] : ["move.how_1", "move.how_2", "move.how_3", "move.how_4"], params)}
            <p class="lead small">${t("move.meanwhile", params)}</p>
            <div class="rows">${this.serialField(parsed, bad, t("move.serials_sub", params))}</div>
            <div class="center">
              <button class="pill go" ?disabled=${this.busy || bad} @click=${() => this.send({ type: "hue_studio/bridges/move", ...this.request, serials: parsed.codes })}>
                ${t("move.start", { bridge: plan.target_name })}
              </button>
            </div>`
        : nothing}`;
  }

  private serialField(parsed: ReturnType<typeof parseSerials>, bad: boolean, sub: string): TemplateResult {
    const { t } = this.ctx;
    return this.showSerials
      ? html`<div class="item col">
          <div class="line"><span>${t("move.serials")}</span><span class="dim">${parsed.codes.length}/${MAX_SERIALS}</span></div>
          <input class="field" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="A1B2C3, D4E5F6"
            aria-label=${t("move.serials")} .value=${this.serials} @input=${(e: InputEvent) => (this.serials = (e.target as HTMLInputElement).value)} />
          <div class=${classMap({ "dim small": true, error: bad })}>
            ${bad ? t(parsed.tooMany ? "add_device.serials_many" : "add_device.serials_bad", { codes: parsed.invalid.join(", ") }) : t("move.serials_hint")}
          </div>
        </div>`
      : html`<button class="item" @click=${() => (this.showSerials = true)}>
          <ha-icon icon="mdi:numeric"></ha-icon>
          <div class="grow">${t("add_device.add_serials")}<div class="dim small">${sub}</div></div>
          <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
        </button>`;
  }

  private async send(msg: { type: string } & Record<string, unknown>): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    haptic("light");
    const ok = await this.ctx.ws(msg);
    this.busy = false;
    if (ok) {
      this.serials = "";
      this.showSerials = false;
    }
    return ok;
  }

  // ---------- during and after ----------

  private progress(s: MoveState): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const params = { from: s.source_name, to: s.target_name };
    const what = s.whole_bridge ? s.source_name : s.rooms.join(", ") || s.devices.map((d) => d.name).join(", ");
    const found = s.devices.filter((d) => d.found).length;
    if (s.step === "done") {
      return html`<div class="link-state">
        <div class="link-icon ok">${icon("check")}</div>
        <h2 class="link-title">${t(s.whole_bridge ? "move.done_all" : "move.done", { what, bridge: s.target_name, from: s.source_name })}</h2>
        <p class="lead center-text">${t("move.done_sub")}</p>
        <div class="link-actions"><button class="pill go" @click=${() => this.finish()}>${t("move.finish")}</button></div>
      </div>`;
    }
    const stuck = s.step === "waiting" || s.step === "failed";
    const steps = s.whole_bridge ? STEPS_ALL : STEPS;
    const reached = stuck ? -1 : steps.indexOf(s.step);
    const left = s.searching_until ? Math.max(0, Math.round(s.searching_until - this.now / 1000)) : 0;
    const parsed = parseSerials(this.serials);
    const bad = parsed.invalid.length > 0 || parsed.tooMany;
    const reason = ERRORS.includes(s.error || "") ? s.error! : "bridge";
    const accessories = s.devices.some((d) => !d.light);
    return html`<p class="lead">${s.whole_bridge ? t("move.going_all", params) : t("move.going", { ...params, what })}</p>
      ${stuck
        ? html`<div class="mismatch"><p>${t(`move.error_${reason}` as StringKey, params)}</p></div>`
        : html`<ol class="rows steps-list move-steps">
            ${steps.map((step, i) => {
              const done = i < reached;
              const now = i === reached;
              return html`<li class=${classMap({ item: true, dim: !done && !now })}>
                <span class="step-no">${done ? icon("check") : now && step !== "power_cycle" ? html`<span class="spinner"></span>` : i + 1}</span>
                <div class="grow">${t(`move.step_${step}` as StringKey, params)}
                  ${now && step === "searching" ? html`<div class="dim small">${t("move.searching", { found, count: s.devices.length, seconds: left })}</div>` : nothing}
                </div>
              </li>`;
            })}
          </ol>`}
      ${s.step === "power_cycle" ? this.powerCycle(s, parsed, bad, accessories) : nothing}
      <h2 class="label">${t("move.devices")}</h2>
      <div class="rows">
        ${s.devices.map(
          (d) => html`<div class="item">
            <ha-icon icon=${d.found ? "mdi:check-circle-outline" : d.light ? "mdi:lightbulb-question-outline" : "mdi:help-circle-outline"}></ha-icon>
            <div class="grow">${d.entity_id && d.light && ctx.hass.states[d.entity_id] ? friendlyName(ctx.hass, d.entity_id) : d.name}
              <div class="dim small">${d.found ? t("move.found_on", { bridge: s.target_name }) : t("move.not_yet")}</div>
            </div>
          </div>`,
        )}
      </div>
      ${stuck
        ? html`${this.steps(
              [...(s.whole_bridge ? [] : ["move.tip_power" as const]), ...(accessories ? ["move.tip_accessories" as const] : []), "move.tip_close" as const],
              params,
            )}
            <div class="rows">${this.serialField(parsed, bad, t("move.serials_sub", params))}</div>
            <div class="link-actions">
              <button class="pill go" ?disabled=${this.busy || bad || s.running} @click=${() => this.send({ type: "hue_studio/bridges/move/retry", serials: parsed.codes })}>
                ${t("move.again", { bridge: s.target_name })}
              </button>
              ${found === 0 && s.source !== s.target
                ? html`<button class="pill" ?disabled=${this.busy || s.running} @click=${() => this.send({ type: "hue_studio/bridges/move/retry", serials: parsed.codes, target: s.source })}>
                    ${t("move.back", { bridge: s.source_name })}
                  </button>`
                : nothing}
              <button class="pill" ?disabled=${this.busy || s.running} @click=${() => this.finish()}>${t("move.stop")}</button>
            </div>`
        : nothing}`;
  }

  /** The pause after the old bridge let go: switch the lights off and on, then continue. */
  private powerCycle(s: MoveState, parsed: ReturnType<typeof parseSerials>, bad: boolean, accessories: boolean): TemplateResult {
    const { t } = this.ctx;
    const params = { from: s.source_name, to: s.target_name };
    return html`<div class="power-cycle">
        <ha-icon icon="mdi:power-cycle"></ha-icon>
        <h2 class="link-title">${t("move.power_title")}</h2>
        <p class="lead center-text">${t("move.power_text", params)}</p>
        ${accessories ? html`<p class="lead small center-text">${t("move.power_accessories")}</p>` : nothing}
      </div>
      <div class="rows">${this.serialField(parsed, bad, t("move.serials_sub", params))}</div>
      <div class="center">
        <button class="pill go" ?disabled=${this.busy || bad || s.running} @click=${() => this.send({ type: "hue_studio/bridges/move/continue", serials: parsed.codes })}>
          ${t("move.continue", { bridge: s.target_name })}
        </button>
      </div>`;
  }

  private async finish(): Promise<void> {
    if (this.busy) return;
    const s = this.state;
    if (!(await this.send({ type: "hue_studio/bridges/move/finish" }))) return;
    this.planKey = "";
    const area = s?.area || this.area;
    if (area) this.ctx.go(`/room/${encodeURIComponent(`area.${area}`)}`);
    else this.ctx.go(s ? `/settings/bridges/${encodeURIComponent(s.target)}` : "/settings/bridges");
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-bridge-move-view": BridgeMoveView;
  }
}
