// "Add devices", the Hue app's flow: where (a room, by bridge), the QR code or another way
// (a bridge that takes install codes), what is added (Hue lights and smart plugs, switches
// and sensors, other brands' Zigbee lights), getting it ready (serial numbers on "Enter
// code"), the bridge's search (about a minute, a few rounds while nothing joined; devices
// show up as they join), what was found, naming it (and making a light breathe), and what
// was added. Every screen is a picker: a deep blue top (its art), the page a rounded panel,
// the buttons in a footer. A device goes into the room's HA area, so a light also moves into
// the Hue room of that area. Opened from Settings → Devices or from a room's "+" (`room`:
// its area picked, "Done" goes back there).

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import {
  type AddKind,
  areaOfRoom,
  deviceIcon,
  type FoundDevice,
  type InstallCode,
  newDevices,
  parseSerials,
  searchOver,
  SEARCH_ROUNDS,
  searchProgress,
  withCodes,
} from "../devices.ts";
import { haptic } from "../../../core/ha-internals.ts";
import type { StringKey } from "../../../i18n/index.ts";
import { findGroup } from "../../../core/model.ts";
import { bridgeRoomAreas } from "../../rooms/rooms.ts";
import type { DevicesMessage, HueDeviceInfo } from "../../../core/types.ts";
import { icon } from "../../../ds/ui.ts";
import { type FlowStep, flowRing, StudioView } from "../../../ds/base.ts";

type Step = "where" | "intro" | "benefits" | "kind" | "prepare" | "code" | "search" | "result" | "name" | "summary";

const NAME_MAX = 32;

const KIND_ICONS: Record<AddKind, string> = {
  light: "hue-studio:bulb-sultan-v2",
  accessory: "mdi:remote",
  other: "mdi:zigbee",
};

/** How to get each kind ready before the search. */
const STEPS: Record<AddKind, StringKey[]> = {
  light: ["add_device.light_1", "add_device.light_2", "add_device.light_3"],
  accessory: ["add_device.accessory_1", "add_device.accessory_2", "add_device.accessory_3"],
  other: ["add_device.other_1", "add_device.other_2", "add_device.other_3"],
};

/** The kind a device found counts as (its section on the last screen). */
const kindOf = (d: Pick<HueDeviceInfo, "kind">): AddKind => (d.kind === "light" ? "light" : d.kind === "other" ? "other" : "accessory");

/** A device set up in this flow. */
interface Done {
  name: string;
  kind: AddKind;
  icon: string;
}

@customElement("hue-studio-device-add-view")
export class DeviceAddView extends StudioView {
  /** The room (group key) it was opened from: its area is picked, "Done" goes back there. */
  @property() accessor room: string | null = null;

  @state() private accessor devices: DevicesMessage | null = null;
  @state() private accessor step: Step = "where";
  /** Steps gone through, for "back". */
  private trail: Step[] = [];
  @state() private accessor kind: AddKind = "light";
  @state() private accessor bridge: string | null = null;
  /** The HA area the devices go into. */
  @state() private accessor area: string | null = null;
  @state() private accessor serials = "";
  /** Devices' QR codes read (their install codes), and whether the scanner is open. */
  @state() private accessor qr: InstallCode[] = [];
  @state() private accessor scanning = false;
  /** When the search started (ms) and whether the bridge reported it running since. */
  @state() private accessor started = 0;
  /** Searches in a row (another starts while nothing joined) and when the first started (ms). */
  @state() private accessor round = 1;
  private firstStarted = 0;
  private searchMsg: ({ type: string } & Record<string, unknown>) | null = null;
  private seenActive = false;
  @state() private accessor now = Date.now();
  /** Names typed for the devices found (by device id), the one being named, set up ones. */
  @state() private accessor names: Record<string, string> = {};
  @state() private accessor naming: { device: FoundDevice; name: string } | null = null;
  @state() private accessor done: Record<string, Done> = {};
  @state() private accessor help = false;
  /** A new room's name being typed (null: not asked). */
  @state() private accessor newRoom: string | null = null;
  @state() private accessor busy = false;
  /** Areas created here, until HA's `hass` has them. */
  private created: Record<string, string> = {};
  private timer?: ReturnType<typeof setInterval>;
  private stop?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.area = areaOfRoom(this.room);
    let first = true;
    this.stop = this.ctx.watch<DevicesMessage>("hue_studio/devices/subscribe", (msg) => {
      this.devices = msg;
      if (first) {
        first = false;
        if (!this.resume(msg) && this.area) this.step = this.qrBridge ? "intro" : "kind";
      }
      this.watchSearch();
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop?.();
    clearInterval(this.timer);
  }

  /** Opened while a bridge searches (a search started elsewhere): show that search. */
  private resume(msg: DevicesMessage): boolean {
    const searching = Object.entries(msg).find(([, b]) => b.searching);
    if (!searching) return false;
    this.bridge = searching[0];
    this.seenActive = true;
    this.started = (searching[1].search_started ?? Date.now() / 1000) * 1000;
    this.firstStarted = this.started;
    this.go("search");
    return true;
  }

  private get bridges(): [string, DevicesMessage[string]][] {
    return Object.entries(this.devices || {});
  }

  /** The bridge to search on: the one picked, else the room's, else the first that can search. */
  private get bridgeId(): string | null {
    const all = this.bridges;
    if (this.bridge && this.devices?.[this.bridge]) return this.bridge;
    const areas = this.ctx.hass.areas || {};
    const own = this.area ? all.find(([id]) => bridgeRoomAreas(this.ctx.rooms, id, areas).includes(this.area!))?.[0] : undefined;
    if (own) return own;
    return (all.find(([, b]) => b.searching !== null) ?? all[0])?.[0] ?? null;
  }

  /** Whether the bridge takes devices by their QR codes (install codes: a Bridge Pro). */
  private get qrBridge(): boolean {
    return !!this.devices?.[this.bridgeId ?? ""]?.install_codes;
  }

  private get exitPath(): string {
    return this.room && findGroup(this.ctx.home, this.room) ? `/room/${encodeURIComponent(this.room)}` : "/settings/devices";
  }

  private get roomName(): string {
    return this.areaName(this.area) ?? (this.room ? findGroup(this.ctx.home, this.room)?.name : null) ?? "";
  }

  /** The devices this search found that are not set up yet. */
  private get found(): FoundDevice[] {
    return newDevices(this.devices, (this.firstStarted || this.started) - 5000).filter((d) => !this.done[d.id]);
  }

  private go(step: Step, remember = true): void {
    if (remember && this.step !== step && this.step !== "search") this.trail.push(this.step);
    this.step = step;
    clearInterval(this.timer);
    if (step === "search") this.timer = setInterval(() => (this.now = Date.now()), 500);
    this.querySelector(".screen-body")?.scrollTo({ top: 0 });
  }

  private back(): void {
    const prev = this.trail.pop();
    if (prev) this.go(prev, false);
    else this.ctx.go(this.exitPath);
  }

  /** The search is over: on to what it found. */
  private watchSearch(): void {
    if (this.step !== "search") return;
    const bridge = this.devices?.[this.bridgeId ?? ""];
    if (bridge?.searching) this.seenActive = true;
    if (searchOver(bridge, this.started, Date.now(), this.seenActive)) {
      // Nothing joined yet: search again, a few times (a light may come on meanwhile).
      if (this.searchMsg && this.round < SEARCH_ROUNDS && !this.found.length) {
        void this.searchAgain();
        return;
      }
      haptic(this.found.length ? "success" : "warning");
      this.help = false;
      this.go("result");
    }
  }

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    super.updated(changed);
    if (changed.has("now")) this.watchSearch();
    const field = this.querySelector<HTMLInputElement>(".name-sheet input");
    if (field && field.dataset.focused !== "1") {
      field.dataset.focused = "1";
      field.focus();
      field.select();
    }
  }

  protected override renderPage() {
    const { ctx } = this;
    const { t } = ctx;
    const step: FlowStep = !this.devices
      ? { panel: html`<p class="empty">${t("rooms.loading")}</p>` }
      : !this.bridges.length
        ? { panel: html`<p class="empty">${t("add_device.no_bridge")}</p>` }
        : this.screenOf(this.step);
    // The scanner's and the name's sheets sit outside the scrolling body: a scroller (iOS) would clip them.
    return html`${this.flow(!this.trail.length, () => this.back(), step)}
      ${this.naming ? this.nameSheet(this.naming) : nothing}
      ${this.newRoom !== null ? this.roomSheet() : nothing}
      <hue-studio-qr-scan .ctx=${ctx} .open=${this.scanning} @qr-code=${(e: CustomEvent<InstallCode>) => this.scanned(e.detail)}
        @close=${() => (this.scanning = false)}></hue-studio-qr-scan>`;
  }

  private screenOf(step: Step): FlowStep {
    switch (step) {
      case "where":
        return this.where();
      case "intro":
        return this.intro();
      case "benefits":
        return this.benefits();
      case "prepare":
        return this.prepare();
      case "code":
        return this.code();
      case "search":
        return this.searching();
      case "result":
        return this.result();
      case "name":
        return this.nameStep();
      case "summary":
        return this.summary();
      default:
        return this.kinds();
    }
  }



  /** Where the devices go: the HA areas, by bridge, and a new one. */
  private where() {
    const { ctx } = this;
    const { t } = ctx;
    const areas = ctx.hass.areas || {};
    const of = new Map(this.bridges.map(([id]) => [id, bridgeRoomAreas(ctx.rooms, id, areas)]));
    const placed = new Set([...of.values()].flat());
    // Areas without a Hue room yet: under the bridge with most rooms (each area on one bridge, the Hue app's).
    const main = [...of].sort(([, a], [, b]) => b.length - a.length)[0]?.[0];
    const loose = Object.keys(areas).filter((id) => !placed.has(id));
    const byName = (a: string, b: string) => (areas[a]?.name ?? a).localeCompare(areas[b]?.name ?? b);
    const pick = (bridge: string, area: string) => {
      haptic("selection");
      this.bridge = bridge;
      this.area = area;
      this.go(this.qrBridge ? "intro" : "kind");
    };
    return {
      panel: html`${this.flowTitle(t("add_device.where"))}
        ${this.bridges.map(
          ([id, b]) => html`<h2 class="label">${b.name}</h2>
            <div class="rows inset">
              ${[...(of.get(id) ?? []), ...(id === main ? loose : [])].sort(byName).map(
                (area) => html`<button class="item" @click=${() => pick(id, area)}>
                  <ha-icon icon=${areas[area]?.icon || "mdi:texture-box"}></ha-icon><div class="grow">${areas[area]?.name ?? area}</div>
                </button>`,
              )}
              <button class="item" @click=${() => {
                this.bridge = id;
                this.newRoom = "";
              }}>
                <span class="round plus-blue">${icon("plus")}</span><div class="grow">${t("add_device.new_room")}</div>
              </button>
            </div>`,
        )}`,
    };
  }

  /** A bridge that takes QR codes: scan one, or go another way. */
  private intro() {
    const { t } = this.ctx;
    return {
      art: html`<ha-icon class="art-icon" icon="hue-studio:devices"></ha-icon>`,
      panel: this.flowTitle(t("add_device.add_to", { room: this.roomName }), t("add_device.qr_lead")),
      foot: html`<button class="pill" @click=${() => this.go("benefits")}>${t("add_device.alternative")}</button>
        <button class="pill apply" @click=${() => (this.scanning = true)}>${t("add_device.scan_qr")}</button>`,
    };
  }

  private benefits() {
    const { t } = this.ctx;
    return {
      panel: html`${this.flowTitle(t("add_device.benefits"), t("add_device.benefits_1"))}<p class="lead flow-lead">${t("add_device.benefits_2")}</p>`,
      foot: html`<button class="pill" @click=${() => this.go("kind")}>${t("add_device.without_qr")}</button>
        <button class="pill apply" @click=${() => (this.scanning = true)}>${t("add_device.scan_qr")}</button>`,
    };
  }

  /** What is added; and devices that joined earlier and wait to be named. */
  private kinds() {
    const { ctx } = this;
    const { t } = ctx;
    const bridge = this.devices?.[this.bridgeId ?? ""];
    const waiting = newDevices(this.devices).filter((d) => !this.done[d.id]);
    const pick = (kind: AddKind) => {
      haptic("selection");
      this.kind = kind;
      this.go("prepare");
    };
    const tile = (kind: AddKind, wide = false) =>
      html`<button class=${classMap({ "pick-tile": true, plain: true, wide })} @click=${() => pick(kind)}>
        <ha-icon icon=${KIND_ICONS[kind]}></ha-icon><span class="name">${t(`add_device.kind_${kind}` as StringKey)}</span>
      </button>`;
    return {
      panel: html`${this.flowTitle(t("add_device.which"))}
        ${bridge?.searching === null
          ? html`<p class="lead flow-lead">${t("devices.unsupported")}</p>`
          : html`<h2 class="label">${t("add_device.section_light")}</h2>
              <div class="pick-tiles">${tile("light", true)}</div>
              <h2 class="label">${t("add_device.section_accessory")}</h2>
              <div class="pick-tiles">${tile("accessory", true)}</div>
              ${bridge?.other_brands ? html`<h2 class="label">${t("add_device.section_other")}</h2><div class="pick-tiles">${tile("other", true)}</div>` : nothing}`}
        ${waiting.length
          ? html`<h2 class="label">${t("add_device.waiting")}</h2>
              <div class="dev-tiles">${waiting.map((d) => this.devTile(d, () => this.nameNow(d)))}</div>`
          : nothing}`,
    };
  }

  /** Get it ready: what to do, then search (or by serial number: "Enter code"). */
  private prepare() {
    const { t } = this.ctx;
    return {
      art: html`<ha-icon class="art-icon" icon=${KIND_ICONS[this.kind]}></ha-icon>`,
      panel: html`${this.flowTitle(t(`add_device.add_${this.kind}` as StringKey, { room: this.roomName }), STEPS[this.kind].map((key) => t(key)).join(" "))}
        ${this.kind === "other" ? html`<p class="lead flow-lead">${t("add_device.other_note")}</p>` : nothing}`,
      foot: html`${this.kind === "accessory" ? nothing : html`<button class="pill" @click=${() => this.go("code")}>${t("add_device.enter_code")}</button>`}
        <button class="pill apply" ?disabled=${this.busy} @click=${() => this.search()}>${t("add_device.next")}</button>`,
    };
  }

  /** Serial numbers (setup codes): the bridge takes those devices even from another bridge. */
  private code() {
    const { t } = this.ctx;
    const parsed = parseSerials(this.serials);
    const bad = parsed.invalid.length > 0 || parsed.tooMany;
    const empty = !parsed.codes.length && !parsed.qr.length;
    return {
      panel: html`${this.flowTitle(t("add_device.code_title"), t("add_device.code_lead"))}
        <input class="field outlined" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder=${t("add_device.code_placeholder")}
          aria-label=${t("devices.serials")} .value=${this.serials} @input=${(e: InputEvent) => (this.serials = (e.target as HTMLInputElement).value)} />
        ${bad
          ? html`<p class="hint error">${t(parsed.tooMany ? "add_device.serials_many" : "add_device.serials_bad", { codes: parsed.invalid.join(", ") })}</p>`
          : nothing}`,
      foot: html`<button class="pill apply" ?disabled=${this.busy || bad || empty} @click=${() => this.search()}>${t("add_device.search")}</button>`,
    };
  }

  /** The search ring around the kind's picture; a badge once it is over. */
  private ring(badge: "ok" | "fail" | null): TemplateResult {
    const art = html`<ha-icon class="art-icon" icon=${KIND_ICONS[this.kind]}></ha-icon>`;
    return flowRing(art, badge ? null : searchProgress(this.started, this.now), badge);
  }

  /** The bridge searches; what joined shows up as it does. */
  private searching() {
    const { t } = this.ctx;
    const found = this.found;
    return {
      art: this.ring(null),
      panel: html`${this.flowTitle(t(`add_device.searching_${this.kind}` as StringKey), t(`add_device.ready_${this.kind}` as StringKey))}
        ${this.round > 1 ? html`<p class="lead flow-lead small">${t("add_device.round", { round: this.round, rounds: SEARCH_ROUNDS })}</p>` : nothing}
        ${found.length
          ? html`<p class="lead flow-lead">${t("add_device.found_these")}</p><div class="dev-tiles">${found.map((d) => this.devTile(d))}</div>`
          : nothing}`,
      foot: html`<button class="pill apply" ?disabled=${!found.length} @click=${() => this.go("result")}>${t("add_device.next")}</button>`,
    };
  }

  /** What the search found: on to naming it; or what to try when nothing joined. */
  private result() {
    const { t } = this.ctx;
    const found = this.found;
    if (found.length)
      return {
        art: this.ring("ok"),
        panel: html`${this.flowTitle(t("add_device.success"), t("add_device.success_lead", { room: this.roomName }))}
          <div class="dev-tiles">${found.map((d) => this.devTile(d, null, true))}</div>`,
        foot: html`<button class="pill apply" @click=${() => this.go("name")}>${t("add_device.next")}</button>`,
      };
    return {
      art: this.ring("fail"),
      panel: html`${this.flowTitle(t(`add_device.none_${this.kind}` as StringKey), t(`add_device.ready_${this.kind}` as StringKey))}
        ${this.help
          ? html`<h2 class="label">${t("add_device.tips")}</h2>
              <ul class="add-steps tips">
                ${(["add_device.tip_power", "add_device.tip_close", "add_device.tip_reset", "add_device.tip_serial"] as StringKey[]).map((key) => html`<li>${t(key)}</li>`)}
              </ul>`
          : nothing}`,
      foot: html`<button class="pill outline" @click=${() => (this.help = !this.help)}>${t("add_device.help")}</button>
        <button class="pill outline" @click=${() => this.go("summary")}>${t("add_device.skip")}</button>
        ${this.kind === "accessory" ? nothing : html`<button class="pill" @click=${() => this.go("code")}>${t("add_device.enter_code")}</button>`}
        <button class="pill apply" ?disabled=${this.busy} @click=${() => this.search()}>${t("add_device.try_again")}</button>`,
    };
  }

  /** Name what was found (a tap opens its name; a light breathes meanwhile), then it is set up. */
  private nameStep() {
    const { t } = this.ctx;
    const found = this.found;
    const renamed = found.some((d) => this.names[d.id] !== undefined);
    return {
      panel: html`${this.flowTitle(t(`add_device.name_${this.kind}` as StringKey), t("add_device.name_lead"))}
        <div class="dev-tiles">${found.map((d) => this.devTile(d, () => this.openName(d)))}</div>`,
      foot: html`<button class=${classMap({ pill: true, outline: !renamed, apply: renamed })} ?disabled=${this.busy} @click=${() => this.saveAll(found)}>
        ${t(renamed ? "add_device.next" : "add_device.skip")}
      </button>`,
    };
  }

  /** What was added (or that nothing was); more, or done. */
  private summary() {
    const { ctx } = this;
    const { t } = ctx;
    const done = Object.entries(this.done);
    const sections = (["light", "accessory", "other"] as AddKind[])
      .map((kind) => [kind, done.filter(([, d]) => d.kind === kind)] as const)
      .filter(([, list]) => list.length);
    return {
      panel: done.length
        ? html`${this.flowTitle(t("add_device.added", { room: this.roomName }), t("add_device.added_lead"))}
            ${sections.map(
              ([kind, list]) => html`<h2 class="label">${t(`add_device.section_${kind}` as StringKey)}</h2>
                <div class="dev-tiles">${list.map(([, d]) => html`<div class="dev-tile"><ha-icon icon=${d.icon}></ha-icon><span class="name">${d.name}</span></div>`)}</div>`,
            )}`
        : this.flowTitle(t("add_device.none_added"), t("add_device.none_added_lead")),
      foot: html`<button class="pill" @click=${() => this.go("kind")}>${t("add_device.add_more")}</button>
        <button class="pill apply" @click=${() => ctx.go(this.exitPath)}>${t("add_device.done")}</button>`,
    };
  }

  /** A device as a tile: its picture, its name; ticked once found. */
  private devTile(d: FoundDevice, open: (() => void) | null = null, ticked = false): TemplateResult {
    const content = html`<ha-icon icon=${deviceIcon(this.ctx.hass, d)}></ha-icon><span class="name">${this.names[d.id] ?? d.name}</span>
      ${ticked ? html`<span class="tick">${icon("check")}</span>` : nothing}`;
    return open ? html`<button class="dev-tile" @click=${open}>${content}</button>` : html`<div class="dev-tile">${content}</div>`;
  }

  /** "Edit name": the device's name, and a way to tell which one it is. */
  private nameSheet(n: { device: FoundDevice; name: string }): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const d = n.device;
    const done = () => {
      const name = n.name.trim();
      this.names = { ...this.names, [d.id]: name || d.name };
      this.naming = null;
    };
    return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && (this.naming = null)}>
      <div class="box form name-sheet" role="dialog" aria-label=${t("add_device.edit_name")}>
        <div class="sheet-bar">
          <button class="round close" aria-label=${t("common.close")} @click=${() => (this.naming = null)}>${icon("close")}</button>
          <div class="grow">${t("add_device.edit_name")}</div>
          <button class="pill" @click=${done}>${t("common.done")}</button>
        </div>
        <div class="form-body">
          <div class="name-pic"><ha-icon icon=${deviceIcon(ctx.hass, d)}></ha-icon></div>
          <label class="name-field">
            <input class="field outlined" maxlength=${NAME_MAX} aria-label=${t("devices.name")} .value=${n.name}
              @input=${(e: InputEvent) => (this.naming = { device: d, name: (e.target as HTMLInputElement).value })}
              @keydown=${(e: KeyboardEvent) => e.key === "Enter" && done()} />
            ${n.name
              ? html`<button class="round mini" aria-label=${t("common.clear")} @click=${(e: Event) => {
                  e.preventDefault();
                  this.naming = { device: d, name: "" };
                }}>${icon("close")}</button>`
              : nothing}
          </label>
        </div>
        <div class="rows">
          <button class="item" @click=${() => this.identify(d)}>
            <ha-icon icon="mdi:lightbulb-alert-outline"></ha-icon>
            <div class="grow">${t("devices.identify")}<div class="dim small">${t(d.kind === "light" ? "add_device.identify_light" : "add_device.identify_other")}</div></div>
          </button>
        </div>
      </div>
    </div>`;
  }

  /** "Create new room": an HA area of that name (the light's Hue room follows it). */
  private roomSheet(): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const name = this.newRoom ?? "";
    return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && (this.newRoom = null)}>
      <div class="box form name-sheet" role="dialog" aria-label=${t("add_device.new_room")}>
        <div class="sheet-bar">
          <button class="round close" aria-label=${t("common.close")} @click=${() => (this.newRoom = null)}>${icon("close")}</button>
          <div class="grow">${t("add_device.new_room")}</div>
          <button class="pill" ?disabled=${!name.trim() || this.busy} @click=${() => this.createArea()}>${t("common.done")}</button>
        </div>
        <div class="form-body">
          <label class="name-field">
            <input class="field outlined" maxlength="50" placeholder=${t("add_device.new_room_name")} aria-label=${t("add_device.new_room_name")} .value=${name}
              @input=${(e: InputEvent) => (this.newRoom = (e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this.createArea()} />
          </label>
        </div>
      </div>
    </div>`;
  }

  private areaName(id: string | null): string | null {
    return id ? (this.ctx.hass.areas?.[id]?.name ?? this.created[id] ?? id) : null;
  }

  /** A device that joined earlier: straight to naming it. */
  private nameNow(d: FoundDevice): void {
    this.firstStarted = ((d.found ?? Date.now() / 1000) - 1) * 1000;
    this.kind = kindOf(d);
    this.go("name");
  }

  private openName(d: FoundDevice): void {
    haptic("selection");
    this.naming = { device: d, name: this.names[d.id] ?? d.name };
    // The Hue app makes a light breathe as soon as it is picked.
    if (d.kind === "light") void this.identify(d, true);
  }

  private async identify(d: FoundDevice, quiet = false): Promise<void> {
    if (!quiet) haptic("selection");
    await this.ctx.ws({ type: "hue_studio/devices/identify", device: d.id });
  }

  private async createArea(): Promise<void> {
    const name = this.newRoom?.trim();
    if (!name || this.busy) return;
    this.busy = true;
    const area = await this.ctx.query<{ area_id: string; name: string }>({ type: "config/area_registry/create", name });
    this.busy = false;
    if (!area) return;
    haptic("success");
    this.created = { ...this.created, [area.area_id]: area.name };
    this.area = area.area_id;
    this.newRoom = null;
    this.go(this.qrBridge ? "intro" : "kind");
  }

  /** A QR code read: the bridge searches for that device. */
  private scanned(code: InstallCode): void {
    this.qr = withCodes(this.qr, [code]);
    this.scanning = false;
    void this.search();
  }

  private async search(): Promise<void> {
    const { ctx } = this;
    const bridge = this.bridgeId;
    if (!bridge || this.busy) return;
    this.busy = true;
    const parsed = parseSerials(this.serials);
    const msg = {
      type: "hue_studio/devices/search",
      hue_entry_id: bridge,
      serials: parsed.codes,
      install_codes: withCodes(this.qr, parsed.qr),
      other_brands: this.kind === "other",
    };
    const ok = await ctx.ws(msg);
    this.busy = false;
    if (!ok) return;
    haptic("success");
    this.bridge = bridge;
    this.searchMsg = msg;
    this.round = 1;
    this.started = Date.now();
    this.firstStarted = this.started;
    this.now = this.started;
    this.seenActive = false;
    this.go("search");
  }

  /** The next search of a few in a row. */
  private async searchAgain(): Promise<void> {
    if (!this.searchMsg || this.busy) return;
    this.busy = true;
    this.round += 1;
    this.started = Date.now();
    this.seenActive = false;
    const ok = await this.ctx.ws(this.searchMsg);
    this.busy = false;
    if (!ok) this.go("result");
  }

  /** Every device found gets its name and the room's area; then what was added. */
  private async saveAll(found: FoundDevice[]): Promise<void> {
    const { ctx } = this;
    this.busy = true;
    const done = { ...this.done };
    for (const d of found) {
      const name = (this.names[d.id] ?? d.name).trim() || d.name;
      const ok = await ctx.ws({ type: "hue_studio/devices/setup", device: d.id, name, area_id: this.area });
      if (ok) done[d.id] = { name, kind: kindOf(d), icon: deviceIcon(ctx.hass, d) };
    }
    this.busy = false;
    this.done = done;
    haptic("success");
    this.go("summary");
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-device-add-view": DeviceAddView;
  }
}
