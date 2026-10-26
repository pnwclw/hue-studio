// A Sync Box's settings, the Hue app's ("⋯" on the Sync tab, or the box's row in Settings →
// Bridges): a list of pages — Device (name, LED, updates at night, network and device info,
// restart, remove), Change Hue Bridge, Change Wi-Fi network, HDMI inputs (name and icon),
// TV remote control (learned buttons), Automatic control (what turns the box on and off,
// which inputs it switches to, which start syncing), Advanced (background lighting, audio
// pass-through), Software updates — and ours: Presets, and HDMI CEC by Hue Studio in
// Automatic control (its screen, and per input what a picture starts, sync_follow.py).
// Only a box paired directly has them; one used through `huesyncbox` shows what it is.

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import { wifiKey } from "../devices.ts";
import { haptic } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import { friendlyName } from "../model.ts";
import {
  defaultAction,
  FOLLOW_ACTIONS,
  GRID_TYPES,
  hasFeature,
  inputIcon,
  IR_ACTIONS,
  PORT_ICONS,
  type PortType,
  SCREEN_OFF_AFTER,
  SIGNAL_DOMAINS,
  signalChoices,
  statusKey,
  WAKE_DOMAINS,
} from "../sync.ts";
import type { BoxBridgeEvent, BridgesMessage, SyncBoxDevice, SyncBoxInfo, SyncInput, SyncIrCode } from "../types.ts";
import { icon, lockedToggle, toggle } from "../ui.ts";
import { StudioView } from "./base.ts";
import { type ChoiceOption, navRow, single } from "./choice.ts";

const NAME_MAX = 32;
/** The Sync Box's limit for an input's name (sync.INPUT_NAME_MAX). */
const INPUT_NAME_MAX = 18;
const PRESET_NAME_MAX = 24;
const LEDS = ["normal", "off", "dimmed"] as const;
/** Minutes without a picture before the box sleeps, as the Hue app turns it on (sync.INACTIVITY_MINUTES). */
const INACTIVITY_MINUTES = 20;
/** How long a change shows before the box's own state takes over again. */
const OPTIMISTIC_MS = 5000;
/** The "Other entity" option of an entity choice. */
const MORE = "__more__";
const ENTITY_ICONS: Record<string, string> = {
  media_player: "mdi:play-box-outline",
  sensor: "mdi:eye-outline",
  button: "mdi:gesture-tap-button",
  input_button: "mdi:gesture-tap-button",
  script: "mdi:script-text-outline",
  remote: "mdi:remote",
  binary_sensor: "mdi:checkbox-blank-circle-outline",
  input_boolean: "mdi:toggle-switch-outline",
  switch: "mdi:toggle-switch-outline",
};
const MODE_ICONS = { video: "mdi:monitor", game: "mdi:controller" } as const;

/** A page of the settings over the list (null: the list). */
type Page =
  | "device"
  | "inputs"
  | "remote"
  | "auto"
  | "auto_hpd"
  | "auto_cec"
  | "auto_start"
  | "advanced"
  | "updates"
  | "presets"
  | "screen"
  | `follow:${string}`;

/** A sheet over the page. */
type Sheet =
  | { kind: "network" | "info" | "bridge" | "wifi" }
  | { kind: "name"; name: string }
  | { kind: "input"; id: string; name: string; type: string }
  | { kind: "preset"; name: string }
  | { kind: "ir"; code: string; name: string; action: string; known: boolean };

/** A switch of the box's behavior: its key in the panel payload, and what the box is sent. */
type Switch = "cec_power" | "hpd_power" | "usb_power" | "inactivity" | "arc_bypass" | "bg_video" | "bg_game" | "auto_update";

@customElement("hue-studio-sync-settings-view")
export class SyncSettingsView extends StudioView {
  /** The box's config entry id. */
  @property() accessor box = "";
  /** Where closing the settings goes (the Sync tab, or Settings → Bridges). */
  @property() accessor back = "/settings/bridges";
  /** The pages over the list, the last one shown. */
  @state() private accessor pages: Page[] = [];
  @state() private accessor sheet: Sheet | null = null;
  @state() private accessor bridges: BridgesMessage | null = null;
  /** The bridge the box goes to, and how linking it goes (`until`: the button's deadline, ms). */
  @state() private accessor target: string | null = null;
  @state() private accessor link: { event: BoxBridgeEvent; until: number } | null = null;
  @state() private accessor now = Date.now();
  @state() private accessor busy = false;
  /** Switches just flipped, shown at once until the box says so (or 5 s pass). */
  @state() private accessor flipped: Record<string, { on: boolean; at: number }> = {};
  private stopBridges?: () => void;
  private stopLink?: () => void;
  private ticker?: ReturnType<typeof setInterval>;

  override connectedCallback(): void {
    super.connectedCallback();
    this.stopBridges = this.ctx.watch<BridgesMessage>("hue_studio/bridges/subscribe", (m) => (this.bridges = m));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopBridges?.();
    this.cancelLink();
  }

  protected override renderPage(): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const box = ctx.boxes[this.box];
    if (!box) {
      return this.screen(this.subHead("", () => ctx.go(this.back), nothing, nothing, true), html`<p class="empty">${t("sync.not_found")}</p>`, "settings-page");
    }
    const page = this.pages.at(-1) ?? null;
    let body: TemplateResult;
    if (!this.direct(box)) body = this.linkedPage(box);
    else if (page === null) body = this.listPage(box);
    else if (page === "device") body = this.devicePage(box);
    else if (page === "inputs") body = this.inputsPage(box);
    else if (page === "remote") body = this.remotePage(box);
    else if (page === "auto") body = this.autoPage(box);
    else if (page === "auto_hpd" || page === "auto_cec" || page === "auto_start") body = this.perInputPage(box, page);
    else if (page === "advanced") body = this.advancedPage(box);
    else if (page === "updates") body = this.updatesPage(box);
    else if (page === "presets") body = this.presetsPage(box);
    else if (page === "screen") body = this.screenPage(box);
    else body = this.followPage(box, page.slice("follow:".length));
    // The sheets sit outside the scrolling body: a scroller (iOS) would clip them.
    return html`${body}${this.sheet ? this.renderSheet(box, this.sheet) : nothing}`;
  }

  // ---- frame ----

  /** A page's header: the list closes the settings, a page goes back to the one under it. */
  private head(title: string, end: TemplateResult | typeof nothing = nothing): TemplateResult {
    const first = !this.pages.length;
    return this.subHead(title, () => (first ? this.ctx.go(this.back) : this.pop()), end, nothing, first);
  }

  private open(page: Page): void {
    haptic("selection");
    this.pushPage();
    this.pages = [...this.pages, page];
  }

  private pop(): void {
    this.pages = this.pages.slice(0, -1);
    this.popPage();
  }

  /** A box paired directly (not one used through HACS huesyncbox). */
  private direct(box: SyncBoxInfo): boolean {
    return hasFeature(box, "settings");
  }

  private configure(change: Record<string, unknown>): Promise<boolean> {
    return this.ctx.ws({ type: "hue_studio/sync/configure", entry_id: this.box, ...change });
  }

  private behave(change: Record<string, unknown>): Promise<boolean> {
    return this.ctx.ws({ type: "hue_studio/sync/behavior", entry_id: this.box, ...change });
  }

  /** A switch as just flipped (for 5 s), else as the box has it. */
  private shown(key: string, actual: boolean | null | undefined): boolean {
    const flip = this.flipped[key];
    if (flip && Date.now() - flip.at < OPTIMISTIC_MS && flip.on !== !!actual) return flip.on;
    return !!actual;
  }

  private flip(key: string, on: boolean, send: () => Promise<boolean>): void {
    haptic("selection");
    this.flipped = { ...this.flipped, [key]: { on, at: Date.now() } };
    setTimeout(() => this.requestUpdate(), OPTIMISTIC_MS + 50);
    void send().then((ok) => {
      if (!ok) {
        const { [key]: _, ...rest } = this.flipped;
        this.flipped = rest;
      }
    });
  }

  /** A row with a switch: the glyph (or none), the title, the switch (locked: off, refused). */
  private switchRow(glyph: string | null, title: string, key: string, actual: boolean | null | undefined, send: (on: boolean) => Promise<boolean>, locked = false): TemplateResult {
    const on = this.shown(key, actual);
    return html`<div class="item">
      ${glyph ? html`<ha-icon icon=${glyph}></ha-icon>` : nothing}
      <div class="grow">${title}</div>
      ${locked ? lockedToggle(title) : toggle(on, title, () => this.flip(key, !on, () => send(!on)))}
    </div>`;
  }

  /** A switch on its own, its hint under it (the Hue app's Automatic control and Device). */
  private switchGroup(title: string, hint: string, key: Switch, actual: boolean | null | undefined, send: (on: boolean) => Promise<boolean>, locked = false): TemplateResult {
    return html`<div class="rows">${this.switchRow(null, title, key, actual, send, locked)}</div>
      <p class="hint">${hint}</p>`;
  }

  private factRow(title: string, value: string | number | null | undefined): TemplateResult | typeof nothing {
    return value || value === 0 ? html`<div class="item"><div class="grow">${title}<div class="dim small">${value}</div></div></div>` : nothing;
  }

  // ---- the list ----

  private listPage(box: SyncBoxInfo): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const device: Partial<SyncBoxDevice> = box.device ?? {};
    const update = device.update;
    const fromSync = this.back.startsWith("/sync");
    return this.screen(
      this.head(fromSync ? t("box.settings") : box.name || "Sync Box"),
      html`<div class="rows">
          ${navRow({ icon: "hue-studio:syncbox", title: t("box.device"), bare: true }, () => this.open("device"))}
          ${navRow({ icon: "hue-studio:bridge", title: t("box.change_bridge"), bare: true }, () => this.openSheet({ kind: "bridge" }, box))}
          ${navRow({ icon: "mdi:wifi", title: t("box.change_wifi"), bare: true }, () => this.openSheet({ kind: "wifi" }, box))}
          ${navRow({ icon: "mdi:video-input-hdmi", title: t("box.inputs"), bare: true }, () => this.open("inputs"))}
          ${hasFeature(box, "ir") && ctx.hass.user?.is_admin ? navRow({ icon: "mdi:remote-tv", title: t("box.remote"), bare: true }, () => this.open("remote")) : nothing}
          ${box.behavior ? navRow({ icon: "hue-studio:bolt", title: t("box.auto"), bare: true }, () => this.open("auto")) : nothing}
          ${navRow({ icon: "mdi:cog", title: t("box.advanced"), bare: true }, () => this.open("advanced"))}
          ${navRow({ icon: "mdi:restore", title: t("box.updates"), value: update ? t("box.update_ready") : "", bare: true }, () => this.open("updates"))}
          ${hasFeature(box, "presets") ? navRow({ icon: "mdi:bookmark-outline", title: t("sync.presets"), bare: true }, () => this.open("presets")) : nothing}
        </div>
        ${fromSync
          ? nothing
          : html`<div class="rows">
              ${navRow({ icon: "hue-studio:sync", title: t("bridges.sync_controls"), sub: t("bridges.sync_controls_sub") }, () =>
                ctx.go(`/sync?box=${encodeURIComponent(this.box)}`),
              )}
            </div>`}`,
      "settings-page",
    );
  }

  /** A box used through HACS huesyncbox: what it is, and the way to pair it directly. */
  private linkedPage(box: SyncBoxInfo): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    return this.screen(
      this.head(box.name || "Sync Box"),
      html`<div class="sensor-hero">
          <ha-icon class="pic" icon="hue-studio:syncbox"></ha-icon>
          <div class="name-row"><h1 class="big">${box.name || "Sync Box"}</h1></div>
          <div class="dim">${box.available ? t(statusKey(box)) : t("bridges.box_offline")}</div>
        </div>
        <div class="rows">
          ${navRow({ icon: "hue-studio:sync", title: t("bridges.sync_controls"), sub: t("bridges.sync_controls_sub") }, () =>
            ctx.go(`/sync?box=${encodeURIComponent(this.box)}`),
          )}
        </div>
        <h2 class="label">${t("bridges.connection")}</h2>
        <div class="rows">
          <div class="item">
            <ha-icon icon="mdi:puzzle-outline"></ha-icon>
            <div class="grow">${t("bridges.box_compat")}<div class="dim small">${t("bridges.box_compat_sub")}</div></div>
          </div>
          <button class="item" @click=${() => ctx.openSettings()}>
            <ha-icon icon="mdi:link-plus"></ha-icon>
            <div class="grow">${t("bridges.box_pair")}<div class="dim small">${t("bridges.box_pair_sub")}</div></div>
            <ha-icon class="chevron" icon="mdi:open-in-new"></ha-icon>
          </button>
        </div>
        <div class="rows facts">${this.factRow(t("bridges.model"), box.model)}</div>`,
      "settings-page",
    );
  }

  // ---- Device ----

  private devicePage(box: SyncBoxInfo): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const device: Partial<SyncBoxDevice> = box.device ?? {};
    const name = box.name || "Sync Box";
    const restart = async () => {
      if (await this.configure({ action: "restart" })) ctx.toast(t("box.restarting"));
    };
    const remove = async () => {
      if (!(await ctx.deleteEntry(this.box))) return;
      ctx.toast(t("box.removed", { name }));
      ctx.go(this.back.startsWith("/sync") ? "/sync" : "/settings/bridges");
    };
    return this.screen(
      this.head(t("box.device")),
      html`<div class="sensor-hero">
          <ha-icon class="pic" icon="hue-studio:syncbox"></ha-icon>
          <div class="name-row">
            <h1 class="big">${name}</h1>
            <button class="round rename" aria-label=${t("bridges.rename")} @click=${() => this.openSheet({ kind: "name", name }, box)}>${icon("pencil")}</button>
          </div>
        </div>
        <div class="rows">
          ${navRow({ title: t("box.led"), value: device.led ? t(`bridges.led_${device.led}` as StringKey) : "" }, () =>
            this.choose(single(t("box.led"), LEDS.map((led) => ({ value: led, label: t(`bridges.led_${led}` as StringKey) })), device.led ?? "", (led) => void this.configure({ led }))),
          )}
          ${device.auto_update != null ? this.switchRow(null, t("box.auto_update"), "auto_update", device.auto_update, (on) => this.configure({ auto_update: on })) : nothing}
        </div>
        ${device.auto_update != null ? html`<p class="hint">${t("box.auto_update_hint")}</p>` : nothing}
        <div class="rows">
          ${navRow({ title: t("box.network_info"), bare: true }, () => this.openSheet({ kind: "network" }, box))}
          ${navRow({ title: t("box.device_info"), bare: true }, () => this.openSheet({ kind: "info" }, box))}
          ${device.ha_device
            ? html`<button class="item" @click=${() => ctx.openHa(`/config/devices/device/${encodeURIComponent(device.ha_device!)}`)}>
                <div class="grow">${t("sensor.in_ha")}</div><ha-icon class="chevron" icon="mdi:open-in-new"></ha-icon>
              </button>`
            : nothing}
        </div>
        <div class="delete-area">
          <button class="pill" ?disabled=${!box.available} @click=${restart}>${t("box.restart")}</button>
          ${ctx.hass.user?.is_admin
            ? html`<button class="delete-btn" @click=${() => this.askDelete(t("box.remove_note"), t("box.remove"), () => void remove())}>${t("box.remove")}</button>`
            : nothing}
        </div>`,
      "settings-page",
    );
  }

  // ---- HDMI inputs ----

  private inputsPage(box: SyncBoxInfo): TemplateResult {
    const { t } = this.ctx;
    return this.screen(
      this.head(t("box.inputs")),
      html`<p class="lead">${t("box.inputs_lead")}</p>
        <div class="rows">
          ${(box.inputs ?? []).map(
            (input) => html`<button class="item" @click=${() =>
                this.openSheet({ kind: "input", id: input.id, name: input.name, type: input.type || "generic" }, box)}>
              <span class="row-art disc"><ha-icon icon=${inputIcon(input)}></ha-icon></span>
              <div class="grow">${input.name}<div class="dim small">${t("box.input_port", { n: input.id.replace("input", "") })}</div></div>
            </button>`,
          )}
        </div>`,
      "settings-page",
    );
  }

  // ---- TV remote control ----

  private remotePage(box: SyncBoxInfo): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const ir = box.ir ?? { scanning: false, scanned: [], codes: [] };
    const known = new Set(ir.codes.map((c) => c.code));
    const fresh = ir.scanned.filter((c) => !known.has(c));
    const learn = () => void ctx.call("hue_studio", "learn_sync_ir_code", { entity_id: box.entity_id! }, { optimistic: false });
    if (!ir.codes.length && !fresh.length && !ir.scanning) {
      return html`${this.screen(
          this.head(t("box.remote")),
          html`<div class="empty-state">
            <h1 class="big">${t("box.remote_empty")}</h1>
            <p class="lead">${t("box.remote_empty_text")}</p>
            <div class="empty-art"><ha-icon icon="mdi:remote-tv"></ha-icon></div>
          </div>`,
          "settings-page",
        )}
        <div class="screen-foot"><button class="pill apply" @click=${learn}>${t("box.remote_next")}</button></div>`;
    }
    return this.screen(
      this.head(t("box.remote")),
      html`<p class="lead">${t("sync.remote_hint")}</p>
        <div class="rows">
          ${ir.codes.map((c) =>
            navRow({ icon: "mdi:remote", title: c.name, sub: this.actionLabel(box, c) }, () =>
              this.openSheet({ kind: "ir", code: c.code, name: c.name, action: c.action || "toggle_sync", known: true }, box),
            ),
          )}
          ${fresh.map((code) =>
            navRow({ icon: "mdi:remote-tv", title: t("sync.remote_new", { code }), sub: t("sync.remote_assign") }, () =>
              this.openSheet({ kind: "ir", code, name: "", action: "toggle_sync", known: false }, box),
            ),
          )}
          <button class="item" ?disabled=${ir.scanning} @click=${learn}>
            <ha-icon icon=${ir.scanning ? "mdi:access-point" : "mdi:plus"}></ha-icon>
            <div class="grow">${ir.scanning ? t("sync.remote_listening") : t("sync.remote_learn")}</div>
          </button>
        </div>`,
      "settings-page",
    );
  }

  private actionLabel(box: SyncBoxInfo, c: Pick<SyncIrCode, "action">): string {
    const { t } = this.ctx;
    const action = c.action;
    if (!action) return t("sync.action_other");
    const [kind, value] = action.split(":");
    if (kind === "input") return t("sync.action_input", { name: box.inputs?.find((i) => i.id === value)?.name || value });
    if (kind === "preset") return t("sync.action_preset", { name: box.presets?.find((p) => p.id === value)?.name || value });
    return t(`sync.action_${action}` as StringKey);
  }

  // ---- Automatic control ----

  /** Who does HDMI CEC: the box itself, or Hue Studio from Home Assistant's entities. */
  private studioCec(box: SyncBoxInfo): boolean {
    return hasFeature(box, "follow") && !box.device?.tv_power;
  }

  private autoPage(box: SyncBoxInfo): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const b = box.behavior!;
    const studio = this.studioCec(box);
    const cecOptions: ChoiceOption[] = [
      { value: "box", label: t("bridges.cec_box"), sub: t("bridges.cec_box_sub"), icon: "hue-studio:syncbox" },
      ...(hasFeature(box, "follow") ? [{ value: "studio", label: t("bridges.cec_studio"), sub: t("bridges.cec_studio_sub"), icon: "mdi:home-assistant" }] : []),
    ];
    const followed = Object.keys(box.follow ?? {}).length > 0;
    const screen = box.screen;
    return this.screen(
      this.head(t("box.auto")),
      html`<div class="rows">
          ${navRow({ icon: "mdi:hdmi-port", title: t("bridges.cec"), sub: t(studio ? "bridges.cec_studio_row" : "bridges.cec_box_row"), value: t(studio ? "bridges.cec_studio" : "bridges.cec_box") }, () =>
            this.choose(single(t("bridges.cec"), cecOptions, studio ? "studio" : "box", (who) => void this.configure({ tv_power: who === "box" }))),
          )}
        </div>
        ${studio
          ? html`<p class="hint">${t("box.studio_cec_hint")}</p>
              <h2 class="label">${t("bridges.follow")}</h2>
              <div class="rows">
                ${navRow(
                  {
                    icon: "mdi:television",
                    title: t("bridges.screen"),
                    sub: t(followed || !screen ? "bridges.screen_sub" : "bridges.screen_needs_follow"),
                    warn: !!screen && !followed,
                    value: screen ? friendlyName(ctx.hass, screen.entity_id) : t("bridges.screen_none"),
                  },
                  () => this.open("screen"),
                )}
                ${(box.inputs ?? []).map((input) => {
                  const rule = box.follow?.[input.id];
                  return navRow(
                    {
                      icon: inputIcon(input),
                      title: input.name,
                      sub: !rule ? this.inputStatus(input) : rule.signal ? friendlyName(ctx.hass, rule.signal) : t("bridges.follow_signal_missing"),
                      warn: !!rule && !rule.signal,
                      value: t(`bridges.follow_short_${rule?.action ?? "off"}`),
                    },
                    () => this.open(`follow:${input.id}`),
                  );
                })}
              </div>
              <p class="hint">${t("bridges.follow_hint")}</p>`
          : nothing}
        <h2 class="label">${t("box.power_detection")}</h2>
        ${this.switchGroup(t("box.cec_power"), t("box.cec_power_hint"), "cec_power", b.cec_power, (on) => this.configure({ tv_power: on }), studio)}
        ${b.hpd_power != null ? this.switchGroup(t("box.hpd_power"), t("box.hpd_power_hint"), "hpd_power", b.hpd_power, (on) => this.behave({ hpd_power: on })) : nothing}
        ${b.usb_power != null ? this.switchGroup(t("box.usb_power"), t("box.usb_power_hint"), "usb_power", b.usb_power, (on) => this.behave({ usb_power: on })) : nothing}
        ${this.switchGroup(t("box.inactivity"), t("box.inactivity_hint", { minutes: INACTIVITY_MINUTES }), "inactivity", b.inactivity > 0, (on) =>
          this.behave({ inactivity: on ? INACTIVITY_MINUTES : 0 }),
        )}
        <h2 class="label">${t("box.switching")}</h2>
        <div class="rows">
          ${navRow({ title: t("box.hpd_switch") }, () => this.open("auto_hpd"))}
          ${navRow({ title: t("box.cec_switch") }, () => this.open("auto_cec"))}
        </div>
        <h2 class="label">${t("box.start_sync")}</h2>
        <div class="rows">${navRow({ title: t("box.auto_sync") }, () => this.open("auto_start"))}</div>`,
      "settings-page",
    );
  }

  /** A switch per input: switching to it when it is plugged in (HPD) or turns on (CEC), or
   *  starting to sync when it sends a picture. Hue Studio's CEC keeps the first two off. */
  private perInputPage(box: SyncBoxInfo, page: "auto_hpd" | "auto_cec" | "auto_start"): TemplateResult {
    const { t } = this.ctx;
    const field = page === "auto_hpd" ? "hpd_switch" : page === "auto_cec" ? "cec_switch" : "auto_sync";
    const locked = page !== "auto_start" && this.studioCec(box);
    const inputs = box.behavior?.inputs ?? {};
    return this.screen(
      this.head(t(`box.${field}` as StringKey)),
      html`<p class="lead">${t(`box.${field}_lead` as StringKey)}</p>
        ${locked ? html`<p class="hint">${t("box.studio_cec_hint")}</p>` : nothing}
        <h2 class="label">${t("box.inputs_label")}</h2>
        <div class="rows">
          ${(box.inputs ?? [])
            .filter((input) => inputs[input.id]?.[field] != null)
            .map((input) =>
              this.switchRow(inputIcon(input), input.name, `${field}:${input.id}`, inputs[input.id][field], (on) => this.behave({ inputs: { [input.id]: { [field]: on } } }), locked),
            )}
        </div>
        ${page !== "auto_start" ? html`<p class="hint">${t(`box.${field}_hint` as StringKey)}</p>` : nothing}`,
      "settings-page",
    );
  }

  private inputStatus(input: SyncInput): string {
    return input.status === "linked" || input.status === "plugged" || input.status === "unplugged" ? this.ctx.t(`sync.input_${input.status}`) : "";
  }

  /** One input under Hue Studio's CEC: what its picture starts, where the picture comes
   *  from, and what turns its source on. */
  private followPage(box: SyncBoxInfo, id: string): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const input = box.inputs?.find((i) => i.id === id);
    if (!input) return this.screen(this.head(""), nothing, "settings-page");
    const rule = box.follow?.[input.id];
    const set = (change: Record<string, unknown> | null) => void ctx.ws({ type: "hue_studio/sync/follow", entry_id: this.box, follow: { [input.id]: change } });
    const actions: ChoiceOption[] = [
      { value: "off", label: t("bridges.follow_off"), sub: t("bridges.follow_off_sub") },
      ...FOLLOW_ACTIONS.map((action) => ({
        value: action,
        label: t(`bridges.follow_${action}`),
        sub: action === "passthrough" ? t("bridges.follow_passthrough_sub") : undefined,
      })),
    ];
    const hass = ctx.hass;
    const areaOf = (e: string) => {
      const entry = hass.entities?.[e];
      return entry?.area_id ?? (entry?.device_id ? hass.devices?.[entry.device_id]?.area_id : null) ?? null;
    };
    const boxArea = box.device?.ha_device ? (hass.devices?.[box.device.ha_device]?.area_id ?? null) : null;
    /** A choice of an entity: suggested and near ones, the rest behind "Other entity". */
    const pickEntity = (title: string, domains: readonly string[], first: ChoiceOption, current: string, pick: (e: string) => void) => {
      const groups = signalChoices(
        input,
        Object.keys(hass.states).map((e) => ({
          entity_id: e,
          name: friendlyName(hass, e),
          platform: hass.entities?.[e]?.platform,
          area: areaOf(e),
          category: hass.entities?.[e]?.entity_category,
          hidden: hass.entities?.[e]?.hidden,
        })),
        domains,
        // Not the box's own screen: it shows every source.
        { area: boxArea, exclude: [box.screen?.entity_id] },
      );
      const option = (e: string, top = false): ChoiceOption => ({
        value: e,
        label: friendlyName(hass, e),
        sub: top ? `${t("bridges.suggested")} · ${e}` : e,
        icon: ENTITY_ICONS[e.split(".")[0]],
      });
      const shown = [...groups.suggested, ...groups.near];
      // The current one stays in view, even from the rest.
      if (current && !shown.includes(current) && groups.rest.includes(current)) groups.near.unshift(current);
      const rest = groups.rest.filter((e) => e !== current);
      const more: ChoiceOption[] = rest.length
        ? [{ value: MORE, label: t("bridges.entity_more"), sub: t("bridges.entity_more_sub", { count: rest.length }), icon: "mdi:dots-horizontal" }]
        : [];
      this.choose(
        single(title, [first, ...groups.suggested.map((e) => option(e, true)), ...groups.near.map((e) => option(e)), ...more], current, (e) => {
          if (e !== MORE) return pick(e);
          // After this sheet closes: every other entity.
          queueMicrotask(() => this.choose(single(t("bridges.entity_more"), rest.map((r) => option(r)), current, pick)));
        }),
      );
    };
    return this.screen(
      this.head(input.name),
      html`<div class="rows">
          ${navRow({ icon: "mdi:play-circle-outline", title: t("bridges.follow_action"), value: t(`bridges.follow_short_${rule?.action ?? "off"}`) }, () =>
            this.choose(single(t("bridges.follow_action"), actions, rule?.action ?? "off", (action) => set(action === "off" ? null : { action }))),
          )}
          ${navRow(
            {
              icon: "mdi:eye-outline",
              title: t("bridges.follow_signal"),
              sub: rule?.signal ? rule.signal : rule ? t("bridges.follow_signal_missing") : t("bridges.follow_signal_box_sub"),
              warn: !!rule && !rule.signal,
              value: rule?.signal ? friendlyName(ctx.hass, rule.signal) : t("bridges.follow_signal_box"),
            },
            () =>
              pickEntity(
                t("bridges.follow_signal"),
                SIGNAL_DOMAINS,
                { value: "", label: t("bridges.follow_signal_box"), sub: t("bridges.follow_signal_box_sub"), icon: "mdi:hdmi-port" },
                rule?.signal ?? "",
                // A signal follows the input: in its mode, by its type, unless one is chosen.
                (signal) => set({ signal: signal || null, ...(rule ? {} : signal ? { action: defaultAction(input.type) } : {}) }),
              ),
          )}
          ${navRow(
            {
              icon: "mdi:power",
              title: t("bridges.follow_wake"),
              sub: rule?.wake ? rule.wake : t("bridges.follow_wake_sub"),
              value: rule?.wake ? friendlyName(ctx.hass, rule.wake) : t("bridges.follow_wake_none"),
              disabled: !rule,
            },
            () =>
              pickEntity(t("bridges.follow_wake"), WAKE_DOMAINS, { value: "", label: t("bridges.follow_wake_none") }, rule?.wake ?? "", (wake) =>
                set({ wake: wake || null }),
              ),
          )}
        </div>
        <p class="hint">${t("bridges.input_hint")}</p>`,
      "settings-page",
    );
  }

  /** The screen linked with a box under Hue Studio's CEC: which one, its input, when it turns off. */
  private screenPage(box: SyncBoxInfo): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const screen = box.screen;
    const set = (change: Record<string, unknown> | null) => void ctx.ws({ type: "hue_studio/sync/follow", entry_id: this.box, screen: change });
    const players = Object.keys(ctx.hass.states)
      .filter((e) => e.startsWith("media_player."))
      .map((e) => ({ value: e, label: friendlyName(ctx.hass, e), icon: "mdi:television" }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const sources: string[] = (screen && ctx.hass.states[screen.entity_id]?.attributes.source_list) || [];
    const offLabel = (s: number) =>
      s === 0 ? t("bridges.screen_off_never") : s < 60 ? t("bridges.screen_off_seconds", { count: s }) : s < 3600 ? t("bridges.screen_off_minutes", { count: s / 60 }) : t("bridges.screen_off_hours", { count: s / 3600 });
    return this.screen(
      this.head(t("bridges.screen")),
      html`<div class="rows">
          ${navRow({ icon: "mdi:television", title: t("bridges.screen"), value: screen ? friendlyName(ctx.hass, screen.entity_id) : t("bridges.screen_none") }, () =>
            this.choose(
              single(t("bridges.screen"), [{ value: "", label: t("bridges.screen_none") }, ...players], screen?.entity_id ?? "", (e) =>
                set(e ? { entity_id: e, ...(e !== screen?.entity_id ? { source: null } : {}) } : null),
              ),
            ),
          )}
          ${navRow({ icon: "mdi:video-input-hdmi", title: t("bridges.screen_source"), value: screen?.source || t("bridges.screen_source_keep"), disabled: !screen }, () =>
            this.choose(
              single(
                t("bridges.screen_source"),
                [{ value: "", label: t("bridges.screen_source_keep") }, ...[...new Set([...sources, ...(screen?.source ? [screen.source] : [])])].map((v) => ({ value: v, label: v }))],
                screen?.source ?? "",
                (v) => set({ source: v || null }),
              ),
            ),
          )}
          ${navRow({ icon: "mdi:timer-outline", title: t("bridges.screen_off"), sub: t("bridges.screen_off_sub"), value: screen ? offLabel(screen.off_after) : "", disabled: !screen }, () =>
            this.choose(
              single(
                t("bridges.screen_off"),
                SCREEN_OFF_AFTER.map((v) => ({ value: String(v), label: offLabel(v) })),
                String(screen?.off_after ?? ""),
                (v) => set({ off_after: Number(v) }),
              ),
            ),
          )}
        </div>
        <p class="hint">${t("bridges.screen_hint")}</p>`,
      "settings-page",
    );
  }

  // ---- Advanced ----

  private advancedPage(box: SyncBoxInfo): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const bg = box.background_lighting;
    const background = (mode: "video" | "game") =>
      this.switchRow(MODE_ICONS[mode], t(`box.background_${mode}`), `bg_${mode}`, bg?.[mode], (on) => this.configure({ background: { [mode]: on } }));
    return this.screen(
      this.head(t("box.advanced")),
      html`${hasFeature(box, "background_lighting") && bg
          ? html`<h2 class="label">${t("box.background")}</h2>
              <div class="rows">${background("video")} ${background("game")}</div>
              <p class="hint">${t("box.background_hint")}</p>`
          : nothing}
        ${box.behavior?.arc_bypass != null
          ? html`<h2 class="label">${t("box.audio")}</h2>
              ${this.switchGroup(t("box.arc"), t("box.arc_hint"), "arc_bypass", box.behavior.arc_bypass, (on) => this.behave({ arc_bypass: on }))}`
          : nothing}`,
      "settings-page",
    );
  }

  // ---- Software updates ----

  private updatesPage(box: SyncBoxInfo): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const device: Partial<SyncBoxDevice> = box.device ?? {};
    const act = async (action: "check_update" | "update") => {
      haptic("selection");
      this.busy = true;
      if (await this.configure({ action })) ctx.toast(t(action === "update" ? "box.installing" : "box.checking"));
      this.busy = false;
    };
    return this.screen(
      this.head(t("box.updates")),
      html`<div class="rows facts">
          ${this.factRow(t("box.firmware"), device.firmware)}
          ${this.factRow(t("box.update_state"), device.update ? t("box.update_found", { version: device.update }) : t("box.up_to_date"))}
        </div>
        ${device.auto_update != null
          ? html`<div class="rows">${this.switchRow(null, t("box.auto_update"), "auto_update", device.auto_update, (on) => this.configure({ auto_update: on }))}</div>
              <p class="hint">${t("box.auto_update_hint")}</p>`
          : nothing}
        <div class="delete-area">
          ${device.update
            ? html`<button class="pill apply" ?disabled=${this.busy || !box.available} @click=${() => act("update")}>${t("box.install")}</button>`
            : html`<button class="pill" ?disabled=${this.busy || !box.available} @click=${() => act("check_update")}>${t("box.check")}</button>`}
        </div>`,
      "settings-page",
    );
  }

  // ---- Presets (ours) ----

  private presetsPage(box: SyncBoxInfo): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const remove = (preset: string, name: string) =>
      this.askDelete(t("sync.preset_delete_note", { name }), t("sync.preset_delete"), () =>
        void ctx.call("hue_studio", "delete_sync_preset", { entity_id: box.entity_id!, preset }, { optimistic: false }),
      );
    return this.screen(
      this.head(t("sync.presets")),
      html`<p class="lead">${t("box.presets_lead")}</p>
        <div class="rows">
          ${(box.presets || []).map(
            (p) => html`<div class="item">
              <ha-icon icon="mdi:bookmark-outline"></ha-icon>
              <button class="grow plain" @click=${() => ctx.setSync(this.box, { preset: p.id })}>${p.name}</button>
              ${ctx.hass.user?.is_admin
                ? html`<button class="round mini-step" aria-label=${t("sync.preset_delete")} @click=${() => remove(p.id, p.name)}>
                    <ha-icon icon="mdi:delete-outline"></ha-icon>
                  </button>`
                : nothing}
            </div>`,
          )}
          <button class="item" @click=${() => this.openSheet({ kind: "preset", name: "" }, box)}>
            <ha-icon icon="mdi:plus"></ha-icon><div class="grow">${t("sync.preset_save")}<div class="dim small">${t("sync.preset_save_sub")}</div></div>
          </button>
        </div>`,
      "settings-page",
    );
  }

  // ---- sheets ----

  private openSheet(sheet: Sheet, box: SyncBoxInfo): void {
    haptic("selection");
    if (sheet.kind === "bridge") {
      this.cancelLink();
      this.target = Object.keys(this.bridges ?? {}).find((id) => id !== box.bridge) ?? null;
    }
    this.sheet = sheet;
    if (sheet.kind === "name" || sheet.kind === "preset" || sheet.kind === "ir") {
      void this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".sheet .field")?.focus());
    }
  }

  private closeSheet(): void {
    this.cancelLink();
    this.sheet = null;
  }

  /** A sheet: its bar (close, title, an action) over the body; `tall` fills the screen. */
  private frame(title: string, body: unknown, { end = nothing as TemplateResult | typeof nothing, tall = false, cls = "" } = {}): TemplateResult {
    const { ctx } = this;
    const close = () => this.closeSheet();
    return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow, tall })} @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="box form sensor-sheet ${cls}" role="dialog" aria-label=${title}>
        <div class="sheet-bar">
          <button class="round close" aria-label=${ctx.t("common.close")} @click=${close}>${icon("close")}</button>
          <div class="grow">${title}</div>
          ${end}
        </div>
        <div class="form-body">${body}</div>
      </div>
    </div>`;
  }

  private renderSheet(box: SyncBoxInfo, sheet: Sheet): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const device: Partial<SyncBoxDevice> = box.device ?? {};
    switch (sheet.kind) {
      case "network": {
        const wifi = wifiKey(device.wifi);
        return this.frame(
          t("box.network_info"),
          html`<div class="rows facts">
            ${this.factRow(t("box.ssid"), device.wifi_name)} ${this.factRow(t("box.ip"), device.host)}
            ${this.factRow(t("box.signal"), wifi ? t(`bridges.wifi_${wifi}` as StringKey) : null)}
            ${this.factRow(t("box.network"), device.network ? t(device.network === "wan" ? "box.network_wan" : "box.network_lan") : null)}
            ${this.factRow(t("bridges.bridge_link"), box.connection ? t(box.connection === "connected" ? "bridges.bridge_connected" : "bridges.bridge_not_connected") : null)}
          </div>`,
          { tall: true },
        );
      }
      case "info":
        return this.frame(
          t("box.device_info"),
          html`<div class="rows facts">
            ${this.factRow(t("box.model"), device.code || box.model)} ${this.factRow(t("box.manufacturer"), "Signify")}
            ${this.factRow(t("box.identifier"), device.id)} ${this.factRow(t("box.firmware"), device.firmware)}
            ${this.factRow(t("bridges.connection"), t("bridges.box_paired"))}
          </div>`,
          { tall: true },
        );
      case "name": {
        const name = sheet.name.trim();
        const save = async () => {
          if (!name || name === box.name) return this.closeSheet();
          if (await this.configure({ name })) this.closeSheet();
        };
        return this.frame(
          t("bridges.rename"),
          this.nameField(sheet.name, NAME_MAX, t("bridges.rename"), (v) => (this.sheet = { ...sheet, name: v }), save),
          { end: html`<button class="pill save" ?disabled=${!name} @click=${save}>${t("color.done")}</button>`, cls: "name-sheet" },
        );
      }
      case "input":
        return this.inputSheet(box, sheet);
      case "preset": {
        const name = sheet.name.trim();
        const save = async () => {
          if (!name) return;
          if (await ctx.call("hue_studio", "save_sync_preset", { entity_id: box.entity_id!, name }, { optimistic: false })) {
            this.closeSheet();
            ctx.toast(t("sync.preset_saved", { name }));
          }
        };
        return this.frame(
          t("sync.preset_save"),
          html`${this.nameField(sheet.name, PRESET_NAME_MAX, t("sync.preset_name"), (v) => (this.sheet = { ...sheet, name: v }), save)}
            <p class="hint">${t("sync.preset_save_sub")}</p>`,
          { end: html`<button class="pill save" ?disabled=${!name} @click=${save}>${t("scene.save")}</button>`, cls: "name-sheet" },
        );
      }
      case "ir":
        return this.irSheet(box, sheet);
      case "wifi":
        return this.frame(
          t("bridges.box_wifi_title"),
          html`<p class="hint">${t("bridges.box_wifi_text", { network: device.wifi_name || t("bridges.wifi_none") })}</p>
            <div class="rows">
              ${this.switchRow("mdi:bluetooth", t("bridges.box_bluetooth"), "bluetooth", device.bluetooth, (on) => this.configure({ bluetooth: on }))}
            </div>
            <p class="hint">${t("bridges.box_wifi_follow")}</p>`,
        );
      default:
        return this.bridgeSheet(box);
    }
  }

  /** A name in the filled field, "Enter" keeps it. */
  private nameField(value: string, max: number, label: string, change: (v: string) => void, done: () => void): TemplateResult {
    return html`<input class="field filled" maxlength=${max} placeholder=${label} aria-label=${label} .value=${value}
      @input=${(e: InputEvent) => change((e.target as HTMLInputElement).value)} @keydown=${(e: KeyboardEvent) => e.key === "Enter" && done()} />`;
  }

  /** "Edit name and icon", the Hue app's: the glyph, the name, the types as an icon grid. */
  private inputSheet(box: SyncBoxInfo, sheet: Extract<Sheet, { kind: "input" }>): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const input = box.inputs?.find((i) => i.id === sheet.id);
    const name = sheet.name.trim();
    const save = async () => {
      if (!input || !name) return;
      const change: Record<string, unknown> = {};
      if (name !== input.name) change.name = name;
      if (sheet.type !== (input.type || "generic")) change.port_type = sheet.type;
      if (Object.keys(change).length && !(await ctx.ws({ type: "hue_studio/sync/input", entry_id: this.box, input: sheet.id, ...change }))) return;
      haptic("success");
      this.closeSheet();
    };
    const types: string[] = GRID_TYPES.includes(sheet.type as PortType) ? [...GRID_TYPES] : [...GRID_TYPES, sheet.type];
    return this.frame(
      t("box.edit_input"),
      html`<div class="input-edit">
          <ha-icon icon=${PORT_ICONS[sheet.type as PortType] || "mdi:hdmi-port"}></ha-icon>
          ${this.nameField(sheet.name, INPUT_NAME_MAX, t("box.input_name"), (v) => (this.sheet = { ...sheet, name: v }), save)}
        </div>
        <div class="icon-grid" role="radiogroup" aria-label=${t("bridges.port_type")}>
          ${types.map((type) => {
            const on = type === sheet.type;
            return html`<button class=${classMap({ "icon-opt": true, on })} role="radio" aria-checked=${on} @click=${() => {
              haptic("selection");
              this.sheet = { ...sheet, type };
            }}>
              <span class="disc"><ha-icon icon=${PORT_ICONS[type as PortType] || "mdi:hdmi-port"}></ha-icon></span>
              <span>${t(`sync.port_${type}` as StringKey)}</span>
            </button>`;
          })}
        </div>`,
      { end: html`<button class="pill save" ?disabled=${!name} @click=${save}>${t("color.done")}</button>`, tall: true, cls: "input-sheet" },
    );
  }

  /** A remote button: its name and what it does; "Forget" for one learned before. */
  private irSheet(box: SyncBoxInfo, draft: Extract<Sheet, { kind: "ir" }>): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const actions = [...IR_ACTIONS, ...(box.inputs || []).map((i) => `input:${i.id}`), ...(box.presets || []).map((p) => `preset:${p.id}`)];
    const name = draft.name.trim();
    const save = async () => {
      if (!name) return;
      const data = { entity_id: box.entity_id!, code: draft.code, name, action: draft.action };
      if (await ctx.call("hue_studio", "set_sync_ir_code", data, { optimistic: false })) this.closeSheet();
    };
    const forget = async () => {
      if (await ctx.call("hue_studio", "delete_sync_ir_code", { entity_id: box.entity_id!, code: draft.code }, { optimistic: false })) this.closeSheet();
    };
    return this.frame(
      draft.known ? draft.name : t("sync.remote_new", { code: draft.code }),
      html`${this.nameField(draft.name, PRESET_NAME_MAX, t("sync.remote_name"), (v) => (this.sheet = { ...draft, name: v }), save)}
        <div class="rows">
          ${navRow({ title: t("sync.remote_action"), value: this.actionLabel(box, draft) }, () =>
            this.choose(
              single(
                t("sync.remote_action"),
                actions.map((a) => ({ value: a, label: this.actionLabel(box, { action: a }) })),
                draft.action,
                (action) => (this.sheet = { ...draft, action }),
              ),
            ),
          )}
        </div>
        <p class="hint">${t("sync.remote_code", { code: draft.code })}</p>
        ${draft.known ? html`<div class="delete-area"><button class="delete-btn" @click=${forget}>${t("sync.remote_forget")}</button></div>` : nothing}`,
      { end: html`<button class="pill save" ?disabled=${!name} @click=${save}>${t("scene.save")}</button>`, cls: "name-sheet" },
    );
  }

  private bridgeName(id: string | null | undefined): string {
    return (id && (this.bridges?.[id]?.name ?? this.ctx.rooms?.bridges?.[id])) || this.ctx.t("bridges.box_bridge_unknown");
  }

  /** "Change Hue Bridge": the other bridges with a tick, then its button, then the box connects. */
  private bridgeSheet(box: SyncBoxInfo): TemplateResult {
    const { t } = this.ctx;
    const others = Object.entries(this.bridges ?? {}).filter(([bid]) => bid !== box.bridge);
    const target = this.target;
    const link = this.link;
    const name = this.bridgeName(target);
    const left = link?.event.step === "press" ? Math.max(0, Math.ceil((link.until - this.now) / 1000)) : 0;
    const content = link
      ? html`<div class="link-state">
          ${link.event.step === "done"
            ? html`<div class="link-icon ok">${icon("check")}</div>
                <p class="lead center-text">${t("bridges.box_moved", { bridge: name, area: link.event.area ?? "" })}</p>
                <div class="link-actions"><button class="pill apply" @click=${() => this.closeSheet()}>${t("qr.done")}</button></div>`
            : link.event.step === "failed"
              ? html`<p class="lead center-text error">${t(`bridges.box_link_${link.event.reason}` as StringKey, { bridge: name })}</p>
                  <div class="link-actions"><button class="pill apply" @click=${() => target && this.linkBox(target)}>${t("bridges.box_link_again")}</button></div>`
              : html`<span class="spinner big"></span>
                  <p class="lead center-text">${link.event.step === "press" ? t("bridges.box_press", { bridge: name, seconds: left }) : t("bridges.box_connecting", { bridge: name })}</p>
                  <div class="link-actions"><button class="pill" @click=${() => this.cancelLink()}>${t("bridge_add.cancel")}</button></div>`}
        </div>`
      : html`<p class="hint">${t("bridges.box_bridge_text", { bridge: this.bridgeName(box.bridge) })}</p>
          ${others.length
            ? html`<div class="rows choice-list" role="radiogroup">
                  ${others.map(
                    ([bid, b]) => html`<button class=${classMap({ item: true, on: bid === target })} role="radio" aria-checked=${bid === target} @click=${() => {
                      haptic("selection");
                      this.target = bid;
                    }}>
                      <ha-icon icon="hue-studio:bridge"></ha-icon><div class="grow">${b.name}</div>
                      ${bid === target ? html`<span class="tick">${icon("check")}</span>` : nothing}
                    </button>`,
                  )}
                </div>
                <div class="center sheet-actions">
                  <button class="pill apply" ?disabled=${!target} @click=${() => target && this.linkBox(target)}>${t("bridges.box_move", { bridge: name })}</button>
                </div>`
            : html`<p class="hint">${t("bridges.box_no_other")}</p>`}`;
    return this.frame(t("box.change_bridge"), content);
  }

  private cancelLink(): void {
    clearInterval(this.ticker);
    this.stopLink?.();
    this.stopLink = undefined;
    this.link = null;
  }

  /** Move the box to the bridge picked: its button, then the box connects. */
  private linkBox(target: string): void {
    haptic("light");
    this.cancelLink();
    this.link = { event: { step: "connecting" }, until: 0 };
    this.ticker = setInterval(() => (this.now = Date.now()), 500);
    this.stopLink = this.ctx.watch<BoxBridgeEvent>(
      "hue_studio/sync/link_bridge",
      (event) => {
        if (!this.link) return;
        const until = event.step === "press" ? Date.now() + event.timeout * 1000 : this.link.until;
        this.link = { event, until };
        if (event.step === "done" || event.step === "failed") {
          clearInterval(this.ticker);
          this.stopLink?.();
          this.stopLink = undefined;
          haptic(event.step === "done" ? "success" : "failure");
        }
      },
      { entry_id: this.box, hue_entry_id: target },
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-sync-settings-view": SyncSettingsView;
  }
}
