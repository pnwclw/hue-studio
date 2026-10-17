// Moving to another bridge (custom_components/hue_studio/migration.py): a whole bridge
// (its page → "Move everything"), a room (its bridge next to "Lights") or lights going to
// a room on another bridge. First what moves (lights, switches and sensors, rooms, scenes
// copied, zones and entertainment areas moved or split) and how each device will be
// found: its serial number (found first, while the old bridge still has it), its QR code
// (where the new bridge takes install codes), switched off and on while the new bridge
// searches, or a switch's or sensor's setup button. Then the move as it goes, one device
// at a time, with its journal; a device not found leaves it waiting: search again (a
// serial number or QR code given now), let it go first, skip it, put everything back on
// the old bridge, or stop. The move runs in Home Assistant: this screen only watches it
// (Settings → Bridges shows it too).

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import { type InstallCode, parseSerials } from "../devices.ts";
import { haptic } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import { friendlyName } from "../model.ts";
import { bridgeName, bridgeOf, groupBridge } from "../rooms.ts";
import type { MoveLogEntry, MoveMethod, MovePlan, MoveState, MoveStep } from "../types.ts";
import { icon } from "../ui.ts";
import { StudioView } from "./base.ts";
import "./qr-scan.ts";

/** The steps shown while a move goes: the devices one by one, rooms, the rest. */
const STEPS = ["devices", "rooms", "scenes"] as const;
const STEP_OF: Partial<Record<MoveStep, (typeof STEPS)[number]>> = {
  saving: "devices",
  removing: "devices",
  searching: "devices",
  restoring: "devices",
  rooms: "rooms",
  scenes: "scenes",
};
const ERRORS = ["not_found", "interrupted", "bridge", "target_offline", "source_offline"];

/** What is given for a device before the search: serial number, QR code's install code. */
interface Prep {
  serial?: string;
  code?: string;
}

/** A device as both pages show it. */
interface Row {
  mac: string | null;
  name: string;
  light: boolean;
  entity_id: string | null;
}

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
  /** Serial numbers and QR codes given, by MAC (`AA:BB:…`). */
  @state() private accessor prep: Record<string, Prep> = {};
  /** The device whose serial number / QR code is being given (its MAC), and the draft. */
  @state() private accessor editing: string | null = null;
  @state() private accessor draft = "";
  /** The scanner, and the one device it is for (else any moving one). */
  @state() private accessor scanning = false;
  @state() private accessor scanFor: string | null = null;
  @state() private accessor showLog = false;
  @state() private accessor busy = false;
  @state() private accessor now = Date.now();
  private planKey = "";
  private stop?: () => void;
  private ticker?: ReturnType<typeof setInterval>;

  override connectedCallback(): void {
    super.connectedCallback();
    this.stop = this.ctx.watch<MoveState | null>("hue_studio/bridges/move/subscribe", (m) => {
      const was = this.state;
      this.state = m;
      if (!m || !was) return;
      if (was.step !== m.step && (m.step === "done" || m.step === "waiting" || m.step === "failed")) {
        haptic(m.step === "done" ? "success" : "failure");
      } else if (was.current !== m.current && m.current) haptic("warning");
      else if (m.devices.filter((d) => d.found).length > was.devices.filter((d) => d.found).length) haptic("success");
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
    // Sheets sit outside the scrolling body: a scroller (iOS) would clip them.
    return html`${this.screen(this.subHead(title, () => this.leave()), body, "settings-page bridge-move")}
      ${this.editing !== null ? this.prepSheet(this.editing) : nothing}
      <hue-studio-qr-scan .ctx=${ctx} .open=${this.scanning} .names=${this.qrNames}
        @qr-code=${(e: CustomEvent<InstallCode>) => this.give(e.detail.mac, { code: e.detail.code })}
        @close=${() => ((this.scanning = false), (this.scanFor = null))}></hue-studio-qr-scan>`;
  }

  // ---------- the devices and how each is found ----------

  /** The devices this page is about: the plan's, or the move's. */
  private get rows(): Row[] {
    return this.state ? this.state.devices : (this.plan?.devices ?? []);
  }

  private nameOf(d: Row): string {
    const { hass } = this.ctx;
    return d.entity_id && d.light && hass.states[d.entity_id] ? friendlyName(hass, d.entity_id) : d.name;
  }

  /** Names of the devices whose QR codes may be read, by MAC (the one asked for, or every one still to find). */
  private get qrNames(): Record<string, string> {
    const rows = this.rows.filter((d) => d.mac && (this.scanFor ? d.mac === this.scanFor : !(d as { found?: boolean }).found));
    return Object.fromEntries(rows.map((d) => [d.mac!, this.nameOf(d)]));
  }

  private give(mac: string, change: Prep): void {
    this.prep = { ...this.prep, [mac]: { ...this.prep[mac], ...change } };
  }

  /** What goes to the move: per device, its serial number and install code. */
  private get prepared(): { mac: string; serial?: string; code?: string }[] {
    return Object.entries(this.prep)
      .filter(([, p]) => p.serial || p.code)
      .map(([mac, p]) => ({ mac, ...(p.serial ? { serial: p.serial } : {}), ...(p.code ? { code: p.code } : {}) }));
  }

  /** How a device will be found (as migration._method decides). */
  private methodOf(d: Row, prep: Prep, takes: boolean, removed = false): MoveMethod {
    if (!d.light) return "button";
    if (prep.serial && !removed) return "serial";
    if (prep.code && takes) return "qr";
    return "power";
  }

  private methodText(method: MoveMethod, prep: Prep, params: Record<string, string>, whole: boolean): string {
    const { t } = this.ctx;
    if (method === "serial") return t("move.method_serial", { ...params, serial: prep.serial ?? "" });
    if (method === "qr") return t(whole ? "move.method_qr_all" : "move.method_qr", params);
    if (method === "button") return t("move.method_button");
    return t(whole ? "move.method_plain" : "move.method_power", params);
  }

  /** The sheet of one device: its QR code, its serial number. */
  private prepSheet(mac: string): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const d = this.rows.find((r) => r.mac === mac);
    const takes = this.state?.install_codes ?? this.plan?.install_codes ?? false;
    const prep = this.prep[mac] ?? {};
    const parsed = parseSerials(this.draft);
    const serial = parsed.codes[0];
    const bad = !!this.draft.trim() && (!serial || parsed.codes.length > 1 || parsed.invalid.length > 0);
    const done = () => {
      if (bad) return;
      this.give(mac, { serial: serial ?? undefined });
      this.editing = null;
    };
    return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && (this.editing = null)}>
      <div class="box form sensor-sheet" role="dialog" aria-label=${d ? this.nameOf(d) : mac}>
        <div class="sheet-bar">
          <button class="round close" aria-label=${t("common.close")} @click=${() => (this.editing = null)}>${icon("close")}</button>
          <div class="grow">${d ? this.nameOf(d) : mac}</div>
        </div>
        <div class="form-body">
          <p class="hint">${t("move.prep_hint")}</p>
          <div class="rows">
            ${takes
              ? html`<button class="item" @click=${() => ((this.scanFor = mac), (this.scanning = true))}>
                  <ha-icon icon=${prep.code ? "mdi:qrcode" : "mdi:qrcode-scan"}></ha-icon>
                  <div class="grow">${t(prep.code ? "qr.scanned" : "move.prep_scan")}</div>
                  ${prep.code
                    ? html`<button class="round" aria-label=${t("qr.remove")} @click=${(e: Event) => (e.stopPropagation(), this.give(mac, { code: undefined }))}>${icon("close")}</button>`
                    : html`<ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>`}
                </button>`
              : nothing}
            <div class="item col">
              <div class="line"><span>${t("move.serial")}</span></div>
              <input class="field" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="A1B2C3" maxlength="6"
                aria-label=${t("move.serial")} .value=${this.draft} @input=${(e: InputEvent) => (this.draft = (e.target as HTMLInputElement).value)}
                @keydown=${(e: KeyboardEvent) => e.key === "Enter" && done()} />
              <div class=${classMap({ "dim small": true, error: bad })}>${bad ? t("move.serial_bad") : t("move.serial_hint")}</div>
            </div>
          </div>
          <div class="center sheet-actions"><button class="pill go" ?disabled=${bad} @click=${done}>${t("qr.done")}</button></div>
        </div>
      </div>
    </div>`;
  }

  private openPrep(mac: string | null): void {
    if (!mac) return;
    haptic("selection");
    this.draft = this.prep[mac]?.serial ?? "";
    this.editing = mac;
  }

  // ---------- before: what the move does ----------

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

  private planPage(): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const plan = this.plan;
    const current = this.request!.target as string;
    const names = (ids: string[]) => ids.map((l) => friendlyName(ctx.hass, l)).join(", ");
    const what = this.area && !this.lights?.length ? ctx.hass.areas?.[this.area]?.name || this.area : names(this.moving);
    const params = { from: plan?.source_name ?? "", to: plan?.target_name ?? bridgeName(ctx.rooms, current) ?? "" };
    const whole = !!this.bridge;
    return html`<p class="lead">${whole ? t("move.intro_all", params) : t("move.intro", { ...params, what })}</p>
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
            ${this.steps(["move.how_1", "move.how_2", "move.how_3"], params)}
            <h2 class="label">${t("move.found_how")}</h2>
            <p class="lead small">${t(plan.install_codes ? "move.found_how_qr" : "move.found_how_serial", params)}</p>
            <div class="rows">
              ${plan.install_codes
                ? html`<button class="item" @click=${() => ((this.scanFor = null), (this.scanning = true))}>
                    <ha-icon icon="mdi:qrcode-scan"></ha-icon>
                    <div class="grow">${t("qr.scan")}<div class="dim small">${t("qr.scan_sub_move", params)}</div></div>
                    <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
                  </button>`
                : nothing}
              ${plan.devices.map((d) => {
                const prep = (d.mac && this.prep[d.mac]) || {};
                const method = this.methodOf(d, prep, plan.install_codes);
                return html`<button class="item" ?disabled=${!d.light || !d.mac} @click=${() => this.openPrep(d.mac)}>
                  <ha-icon icon=${method === "qr" ? "mdi:qrcode" : method === "serial" ? "mdi:numeric" : d.light ? "mdi:lightbulb-outline" : "mdi:gesture-tap-button"}></ha-icon>
                  <div class="grow">${this.nameOf(d)}<div class="dim small">${this.methodText(method, prep, params, whole)}</div></div>
                  ${d.light && d.mac ? html`<ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>` : nothing}
                </button>`;
              })}
            </div>
            <p class="lead small">${t("move.meanwhile", params)}</p>
            <div class="center">
              <button class="pill go" ?disabled=${this.busy} @click=${() => this.send({ type: "hue_studio/bridges/move", ...this.request, prepared: this.prepared })}>
                ${t("move.start", { bridge: plan.target_name })}
              </button>
            </div>`
        : nothing}`;
  }

  private async send(msg: { type: string } & Record<string, unknown>): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    haptic("light");
    const ok = await this.ctx.ws(msg);
    this.busy = false;
    if (ok) this.prep = {};
    return ok;
  }

  // ---------- during and after ----------

  private progress(s: MoveState): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const params = { from: s.source_name, to: s.target_name };
    const what = s.whole_bridge ? s.source_name : s.rooms.join(", ") || s.devices.map((d) => this.nameOf(d)).join(", ");
    const found = s.devices.filter((d) => d.found).length;
    const current = s.devices.find((d) => d.id === s.current) ?? null;
    if (s.step === "done") return this.donePage(s, what);
    const stuck = s.step === "waiting" || s.step === "failed";
    const reached = stuck ? -1 : STEPS.indexOf(STEP_OF[s.step] ?? "devices");
    const left = s.searching_until ? Math.max(0, Math.round(s.searching_until - this.now / 1000)) : 0;
    const reason = ERRORS.includes(s.error || "") ? s.error! : "bridge";
    const counted = s.devices.filter((d) => !d.skipped).length;
    return html`<p class="lead">${s.whole_bridge ? t("move.going_all", params) : t("move.going", { ...params, what })}</p>
      ${stuck
        ? html`<div class="mismatch"><p>${t(`move.error_${reason}` as StringKey, { ...params, name: current ? this.nameOf(current) : "" })}</p></div>`
        : html`<ol class="rows steps-list move-steps">
            ${STEPS.map((step, i) => {
              const done = i < reached;
              const now = i === reached;
              return html`<li class=${classMap({ item: true, dim: !done && !now })}>
                <span class="step-no">${done ? icon("check") : now ? html`<span class="spinner"></span>` : i + 1}</span>
                <div class="grow">${t(`move.step_${step}` as StringKey, params)}
                  ${now && step === "devices" ? html`<div class="dim small">${t("move.devices_progress", { found, count: counted })}</div>` : nothing}
                </div>
              </li>`;
            })}
          </ol>`}
      ${!stuck && current && !current.found ? this.nowCard(s, current, left) : nothing}
      ${stuck && reason === "not_found" && current ? this.notFound(s, current) : nothing}
      <h2 class="label">${t("move.devices")}</h2>
      <div class="rows">${s.devices.map((d) => this.deviceRow(s, d))}</div>
      ${stuck && reason !== "not_found"
        ? html`<div class="link-actions">
            <button class="pill go" ?disabled=${this.busy || s.running} @click=${() => this.send({ type: "hue_studio/bridges/move/retry" })}>${t("move.again", { bridge: s.target_name })}</button>
            <button class="pill" ?disabled=${this.busy || s.running} @click=${() => this.finish()}>${t("move.stop")}</button>
          </div>`
        : nothing}
      ${this.journal(s)}`;
  }

  /** The device being moved now and what to do for it. */
  private nowCard(s: MoveState, d: MoveState["devices"][number], left: number): TemplateResult {
    const { t } = this.ctx;
    const params = { from: s.source_name, to: s.target_name, name: this.nameOf(d) };
    const searching = s.step === "searching";
    const method = d.method ?? "power";
    const act = searching && (method === "button" || ((method === "power" || method === "qr") && !s.whole_bridge));
    const text =
      s.step === "removing"
        ? t("move.now_removing", params)
        : s.step === "restoring"
          ? t("move.now_restoring", params)
          : method === "serial"
            ? t("move.now_serial", params)
            : method === "button"
              ? t("move.now_button", params)
              : s.whole_bridge
                ? t("move.now_searching", params)
                : t("move.now_power", params);
    return html`<div class=${classMap({ "power-cycle": true, calm: !act })}>
      <ha-icon icon=${act ? (method === "button" ? "mdi:gesture-tap-button" : "mdi:power-cycle") : "mdi:magnify"}></ha-icon>
      <h2 class="link-title">${this.nameOf(d)}</h2>
      <p class="lead center-text">${text}</p>
      ${searching && left ? html`<p class="lead small center-text dim">${t("move.seconds_left", { seconds: left })}</p>` : nothing}
    </div>`;
  }

  /** The device not found: what to try, its serial number / QR code, and the ways on. */
  private notFound(s: MoveState, d: MoveState["devices"][number]): TemplateResult {
    const { t } = this.ctx;
    const params = { from: s.source_name, to: s.target_name, name: this.nameOf(d) };
    const found = s.devices.filter((x) => x.found).length;
    const prep = (d.mac && this.prep[d.mac]) || {};
    const onSource = !d.removed;
    const tips: StringKey[] = !d.light
      ? ["move.tip_accessories"]
      : onSource
        ? ["move.tip_serial_close", "move.tip_release"]
        : ["move.tip_power", ...(s.install_codes ? (["move.tip_qr"] as StringKey[]) : []), "move.tip_close"];
    const retry = (extra: Record<string, unknown> = {}) =>
      this.send({ type: "hue_studio/bridges/move/retry", prepared: this.prepared.filter((p) => p.mac === d.mac), ...extra });
    return html`${this.steps(tips, params)}
      ${d.light && d.mac
        ? html`<div class="rows">
            <button class="item" @click=${() => this.openPrep(d.mac)}>
              <ha-icon icon="mdi:numeric"></ha-icon>
              <div class="grow">${t("move.prep_this", params)}
                <div class="dim small">${[prep.serial ?? d.serial, prep.code || d.qr ? t("qr.scanned") : ""].filter(Boolean).join(" · ") || t("move.prep_none")}</div>
              </div>
              <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
            </button>
          </div>`
        : nothing}
      <div class="link-actions">
        <button class="pill go" ?disabled=${this.busy || s.running} @click=${() => retry()}>${t("move.again", { bridge: s.target_name })}</button>
        ${onSource && d.light
          ? html`<button class="pill" ?disabled=${this.busy || s.running} @click=${() => retry({ release: true })}>${t("move.release", params)}</button>`
          : nothing}
        <button class="pill" ?disabled=${this.busy || s.running} @click=${() => this.send({ type: "hue_studio/bridges/move/skip" })}>
          ${t(onSource ? "move.skip_stays" : "move.skip_lost", params)}
        </button>
        ${found === 0 && s.source !== s.target
          ? html`<button class="pill" ?disabled=${this.busy || s.running} @click=${() => this.send({ type: "hue_studio/bridges/move/retry", target: s.source })}>
              ${t("move.back", { bridge: s.source_name })}
            </button>`
          : nothing}
        <button class="pill" ?disabled=${this.busy || s.running} @click=${() => this.finish()}>${t("move.stop")}</button>
      </div>`;
  }

  private deviceRow(s: MoveState, d: MoveState["devices"][number]): TemplateResult {
    const { t } = this.ctx;
    const params = { from: s.source_name, to: s.target_name };
    const now = d.id === s.current && !d.found;
    const status = d.found
      ? t("move.found_on", { bridge: s.target_name })
      : d.skipped
        ? t(d.removed ? "move.skipped_lost" : "move.skipped_stays", params)
        : now
          ? t("move.now")
          : t("move.not_yet");
    const how = d.method ? this.methodText(d.method, { serial: d.serial ?? undefined }, params, s.whole_bridge) : "";
    return html`<div class=${classMap({ item: true, current: now })}>
      ${now && s.running ? html`<span class="spinner"></span>` : html`<ha-icon icon=${d.found ? "mdi:check-circle-outline" : d.skipped ? "mdi:debug-step-over" : d.light ? "mdi:lightbulb-outline" : "mdi:gesture-tap-button"}></ha-icon>`}
      <div class="grow">${this.nameOf(d)}<div class="dim small">${[status, d.found ? "" : how].filter(Boolean).join(" · ")}</div></div>
    </div>`;
  }

  /** What happened, line by line (it is in Home Assistant's log too). */
  private journal(s: MoveState): TemplateResult | typeof nothing {
    const { ctx } = this;
    const { t } = ctx;
    if (!s.log.length) return nothing;
    const time = (at: number) => new Date(at * 1000).toLocaleTimeString(ctx.hass.language, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const line = (e: MoveLogEntry) =>
      t(`move.log_${e.event}` as StringKey, {
        name: e.name ?? "",
        seconds: e.seconds ?? 0,
        round: e.round ?? 1,
        count: e.count ?? 0,
        reason: e.reason ?? "",
        method: e.method ? t(`move.by_${e.method}` as StringKey) : "",
        from: s.source_name,
        to: s.target_name,
      });
    return html`<div class="rows">
        <button class="item" @click=${() => (this.showLog = !this.showLog)}>
          <ha-icon icon="mdi:text-box-outline"></ha-icon>
          <div class="grow">${t("move.log")}<div class="dim small">${t("move.log_sub", { count: s.log.length })}</div></div>
          <ha-icon class="chevron" icon=${this.showLog ? "mdi:chevron-up" : "mdi:chevron-down"}></ha-icon>
        </button>
      </div>
      ${this.showLog
        ? html`<ol class="move-log">
            ${s.log.map((e) => html`<li><time>${time(e.at)}</time><span>${line(e)}</span></li>`)}
          </ol>`
        : nothing}`;
  }

  private donePage(s: MoveState, what: string): TemplateResult {
    const { t } = this.ctx;
    const lost = s.devices.filter((d) => d.skipped && d.removed && !d.found);
    const stayed = s.devices.filter((d) => d.skipped && !d.removed && !d.found);
    // Sync Boxes still syncing with the old bridge: their entertainment areas moved.
    const boxes = Object.entries(this.ctx.boxes).filter(([, box]) => box.bridge === s.source && s.source !== s.target);
    return html`<div class="link-state">
        <div class="link-icon ok">${icon("check")}</div>
        <h2 class="link-title">${t(s.whole_bridge ? "move.done_all" : "move.done", { what, bridge: s.target_name, from: s.source_name })}</h2>
        <p class="lead center-text">${t("move.done_sub")}</p>
        ${stayed.length ? html`<p class="lead small center-text">${t("move.done_stayed", { names: stayed.map((d) => this.nameOf(d)).join(", "), from: s.source_name })}</p>` : nothing}
        ${lost.length ? html`<p class="lead small center-text warn">${t("move.done_lost", { names: lost.map((d) => this.nameOf(d)).join(", ") })}</p>` : nothing}
        ${boxes.map(
          ([id, box]) => html`<button class="notice" @click=${() => this.finish(`/settings/bridges/${encodeURIComponent(id)}`)}>
            <ha-icon icon="mdi:television-box"></ha-icon><span class="grow">${t("move.box_follow", { box: box.name || "Sync Box", from: s.source_name, to: s.target_name })}</span>
            <ha-icon class="go" icon="mdi:chevron-right"></ha-icon>
          </button>`,
        )}
        <div class="link-actions">
          <button class="pill go" @click=${() => this.finish()}>${t("move.finish")}</button>
          ${lost.length ? html`<button class="pill" @click=${() => this.finish("/settings/devices/lost")}>${t("lost.title")}</button>` : nothing}
        </div>
      </div>
      ${this.journal(s)}`;
  }

  private async finish(to?: string): Promise<void> {
    if (this.busy) return;
    const s = this.state;
    if (!(await this.send({ type: "hue_studio/bridges/move/finish" }))) return;
    this.planKey = "";
    const area = s?.area || this.area;
    if (to) this.ctx.go(to);
    else if (area) this.ctx.go(`/room/${encodeURIComponent(`area.${area}`)}`);
    else this.ctx.go(s ? `/settings/bridges/${encodeURIComponent(s.target)}` : "/settings/bridges");
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-bridge-move-view": BridgeMoveView;
  }
}
