// "Add devices", like the Hue app's: what is added (Hue lights, accessories, other brands'
// Zigbee lights), how to get it ready, the bridge's search (about a minute; devices show up
// as they join), then every device found gets a name and a room: identify it, name it, pick
// an HA area (or create one); a light also moves into the Hue room of that area. Opened from
// Settings → Devices or from a room's "+" (`room`: the room it returns to, its area picked).

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import { type AddKind, areaOfRoom, type FoundDevice, MAX_SERIALS, newDevices, parseSerials, searchOver, searchProgress } from "../devices.ts";
import { haptic } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import { findGroup } from "../model.ts";
import type { DevicesMessage, HueDeviceInfo } from "../types.ts";
import { icon } from "../ui.ts";
import { StudioView } from "./base.ts";

type Step = "kind" | "prepare" | "search" | "results" | "setup";

const NAME_MAX = 32;

export const KIND_ICONS: Record<HueDeviceInfo["kind"], string> = {
  light: "mdi:lightbulb-on-outline",
  switch: "mdi:light-switch",
  sensor: "mdi:motion-sensor",
  other: "mdi:devices",
};

const ADD_KINDS: { kind: AddKind; icon: string }[] = [
  { kind: "light", icon: "mdi:lightbulb-on-outline" },
  { kind: "accessory", icon: "mdi:remote" },
  { kind: "other", icon: "mdi:zigbee" },
];

/** Instructions per kind: how to get the device ready before the search. */
const STEPS: Record<AddKind, StringKey[]> = {
  light: ["add_device.light_1", "add_device.light_2", "add_device.light_3"],
  accessory: ["add_device.accessory_1", "add_device.accessory_2", "add_device.accessory_3"],
  other: ["add_device.other_1", "add_device.other_2", "add_device.other_3"],
};

/** A device set up in this flow (it leaves the list of new ones). */
interface Done {
  name: string;
  area: string | null;
  kind: HueDeviceInfo["kind"];
}

@customElement("hue-studio-device-add-view")
export class DeviceAddView extends StudioView {
  /** The room (group key) it was opened from: its area is picked, "Done" goes back there. */
  @property() accessor room: string | null = null;

  @state() private accessor devices: DevicesMessage | null = null;
  @state() private accessor step: Step = "kind";
  @state() private accessor kind: AddKind = "light";
  @state() private accessor bridge: string | null = null;
  @state() private accessor serials = "";
  @state() private accessor showSerials = false;
  /** When the search started (ms) and whether the bridge reported it running since. */
  @state() private accessor started = 0;
  private seenActive = false;
  @state() private accessor now = Date.now();
  /** The device being set up, its draft and the devices set up so far. */
  @state() private accessor current: FoundDevice | null = null;
  @state() private accessor name = "";
  @state() private accessor area: string | null = null;
  @state() private accessor newArea: string | null = null;
  @state() private accessor done: Record<string, Done> = {};
  @state() private accessor busy = false;
  /** Areas created here, until HA's `hass` has them. */
  private created: Record<string, string> = {};
  private timer?: ReturnType<typeof setInterval>;
  private stop?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    let first = true;
    this.stop = this.ctx.watch<DevicesMessage>("hue_studio/devices/subscribe", (msg) => {
      this.devices = msg;
      if (first) {
        first = false;
        this.resume(msg);
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
  private resume(msg: DevicesMessage): void {
    const searching = Object.entries(msg).find(([, b]) => b.searching);
    if (!searching) return;
    this.bridge = searching[0];
    this.seenActive = true;
    this.started = (searching[1].search_started ?? Date.now() / 1000) * 1000;
    this.go("search");
  }

  private get bridges(): [string, DevicesMessage[string]][] {
    return Object.entries(this.devices || {});
  }

  /** The bridge to search on: the one picked, else the first that can search. */
  private get bridgeId(): string | null {
    const all = this.bridges;
    if (this.bridge && this.devices?.[this.bridge]) return this.bridge;
    return (all.find(([, b]) => b.searching !== null) ?? all[0])?.[0] ?? null;
  }

  private get exitPath(): string {
    return this.room && findGroup(this.ctx.home, this.room) ? `/room/${encodeURIComponent(this.room)}` : "/settings/devices";
  }

  private go(step: Step): void {
    this.step = step;
    clearInterval(this.timer);
    if (step === "search") this.timer = setInterval(() => (this.now = Date.now()), 500);
    this.querySelector(".screen-body")?.scrollTo({ top: 0 });
  }

  /** The search is over: on to what it found. */
  private watchSearch(): void {
    if (this.step !== "search") return;
    const bridge = this.devices?.[this.bridgeId ?? ""];
    if (bridge?.searching) this.seenActive = true;
    if (searchOver(bridge, this.started, Date.now(), this.seenActive)) {
      haptic("success");
      this.go("results");
    }
  }

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    super.updated(changed);
    if (changed.has("now")) this.watchSearch();
  }

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const back = (): void => {
      if (this.step === "prepare") this.go("kind");
      else if (this.step === "setup") this.go("results");
      else if (this.step === "results" || this.step === "search") this.go(this.step === "search" ? "kind" : "prepare");
      else ctx.go(this.exitPath);
    };
    const titles: Record<Step, string> = {
      kind: t("devices.title"),
      prepare: t(`add_device.kind_${this.kind}` as StringKey),
      search: t("add_device.searching"),
      results: t("add_device.results"),
      setup: t("add_device.setup"),
    };
    const end =
      this.step === "results"
        ? html`<button class="pill save" @click=${() => ctx.go(this.exitPath)}>${t("add_device.done")}</button>`
        : this.step === "setup" && this.current
          ? html`<button class="pill save" ?disabled=${this.busy || !this.area} @click=${() => this.save(this.current!)}>${t("scene.save")}</button>`
          : nothing;
    let body: TemplateResult;
    if (!this.devices) body = html`<p class="empty">${t("rooms.loading")}</p>`;
    else if (!this.bridges.length) body = html`<p class="empty">${t("add_device.no_bridge")}</p>`;
    else if (this.step === "prepare") body = this.prepare();
    else if (this.step === "search") body = this.searching();
    else if (this.step === "results") body = this.results();
    else if (this.step === "setup" && this.current) body = this.setup(this.current);
    else body = this.kinds();
    return this.screen(this.subHead(titles[this.step], back, end), body, "settings-page add-device");
  }

  /** Step 1: what is added (and on which bridge). */
  private kinds(): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const id = this.bridgeId;
    const bridge = id ? this.devices?.[id] : undefined;
    const waiting = newDevices(this.devices);
    const pick = (kind: AddKind) => {
      haptic("selection");
      this.kind = kind;
      this.go("prepare");
    };
    return html`<p class="lead">${t("add_device.intro")}</p>
      ${this.bridges.length > 1
        ? html`<h2 class="label">${t("add_device.bridge")}</h2>
            <div class="chips wrap">
              ${this.bridges.map(
                ([bid, b]) => html`<button class=${classMap({ chip: true, on: bid === id })} @click=${() => (this.bridge = bid)}>
                  <ha-icon icon="mdi:router-wireless"></ha-icon>${b.name}
                </button>`,
              )}
            </div>`
        : nothing}
      ${bridge?.searching === null
        ? html`<div class="rows"><div class="item"><ha-icon icon="mdi:alert-circle-outline"></ha-icon><div class="grow">${t("devices.unsupported")}</div></div></div>`
        : html`<div class="kind-tiles">
            ${ADD_KINDS.filter((k) => k.kind !== "other" || bridge?.other_brands).map(
              (k) => html`<button class="kind-tile" @click=${() => pick(k.kind)}>
                <ha-icon icon=${k.icon}></ha-icon>
                <span class="name">${t(`add_device.kind_${k.kind}` as StringKey)}</span>
                <span class="dim small">${t(`add_device.kind_${k.kind}_sub` as StringKey)}</span>
              </button>`,
            )}
          </div>`}
      ${waiting.length
        ? html`<h2 class="label">${t("add_device.waiting")}</h2>
            <div class="rows">${waiting.map((d) => this.deviceRow(d))}</div>`
        : nothing}`;
  }

  /** Step 2: get the device ready, serial numbers if needed, search. */
  private prepare(): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const parsed = parseSerials(this.serials);
    const bad = parsed.invalid.length > 0 || parsed.tooMany;
    return html`<div class="add-art"><ha-icon icon=${ADD_KINDS.find((k) => k.kind === this.kind)!.icon}></ha-icon></div>
      <ol class="add-steps">
        ${STEPS[this.kind].map((key) => html`<li>${t(key)}</li>`)}
      </ol>
      ${this.kind === "other" ? html`<p class="lead small">${t("add_device.other_note")}</p>` : nothing}
      <div class="rows">
        ${this.showSerials
          ? html`<div class="item col">
              <div class="line"><span>${t("devices.serials")}</span><span class="dim">${parsed.codes.length}/${MAX_SERIALS}</span></div>
              <input class="field" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="A1B2C3, D4E5F6"
                aria-label=${t("devices.serials")} .value=${this.serials}
                @input=${(e: InputEvent) => (this.serials = (e.target as HTMLInputElement).value)} />
              <div class=${classMap({ "dim small": true, error: bad })}>
                ${bad ? t(parsed.tooMany ? "add_device.serials_many" : "add_device.serials_bad", { codes: parsed.invalid.join(", ") }) : t("devices.serials_hint")}
              </div>
            </div>`
          : html`<button class="item" @click=${() => (this.showSerials = true)}>
              <ha-icon icon="mdi:numeric"></ha-icon>
              <div class="grow">${t("add_device.add_serials")}<div class="dim small">${t("add_device.add_serials_sub")}</div></div>
              <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
            </button>`}
      </div>
      <div class="add-actions">
        <button class="pill go" ?disabled=${this.busy || bad} @click=${() => this.search()}>${icon("search")}${t("devices.search_button")}</button>
      </div>`;
  }

  /** Step 3: the bridge searches; devices show up as they join. */
  private searching(): TemplateResult {
    const { t } = this.ctx;
    const progress = searchProgress(this.started, this.now);
    const left = Math.max(0, Math.ceil((60_000 - (this.now - this.started)) / 1000));
    const found = newDevices(this.devices, this.started - 5000);
    const r = 54;
    const c = 2 * Math.PI * r;
    return html`<div class="search-ring" role="status" aria-live="polite">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="track" cx="60" cy="60" r=${r}></circle>
          <circle class="bar" cx="60" cy="60" r=${r} stroke-dasharray=${c} stroke-dashoffset=${c * (1 - progress)}></circle>
        </svg>
        <div class="ring-text">
          <ha-icon icon=${ADD_KINDS.find((k) => k.kind === this.kind)!.icon}></ha-icon>
          <span>${left ? t("add_device.seconds", { n: left }) : t("add_device.almost")}</span>
        </div>
      </div>
      <p class="lead center-text">${t("add_device.searching_hint")}</p>
      ${found.length
        ? html`<h2 class="label">${t("add_device.found_count", { count: found.length })}</h2>
            <div class="rows">${found.map((d) => this.deviceRow(d, false))}</div>
            <div class="add-actions"><button class="pill go" @click=${() => this.go("results")}>${t("add_device.continue")}</button></div>`
        : nothing}`;
  }

  /** Step 4: what was found, set up each; or what to try when nothing joined. */
  private results(): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const waiting = newDevices(this.devices);
    const done = Object.entries(this.done);
    const nothingFound = !waiting.length && !done.length;
    return html`${nothingFound
        ? html`<div class="add-art dim"><ha-icon icon="mdi:magnify-close"></ha-icon></div>
            <p class="lead center-text">${t("add_device.none")}</p>
            <h2 class="label">${t("add_device.tips")}</h2>
            <ul class="add-steps tips">
              ${(["add_device.tip_power", "add_device.tip_close", "add_device.tip_reset", "add_device.tip_serial"] as StringKey[]).map((key) => html`<li>${t(key)}</li>`)}
            </ul>`
        : html`<p class="lead">${t(waiting.length ? "add_device.results_intro" : "add_device.all_done")}</p>`}
      ${waiting.length ? html`<h2 class="label">${t("add_device.to_set_up")}</h2><div class="rows">${waiting.map((d) => this.deviceRow(d))}</div>` : nothing}
      ${done.length
        ? html`<h2 class="label">${t("add_device.set_up")}</h2>
            <div class="rows">
              ${done.map(
                ([, d]) => html`<div class="item">
                  <ha-icon icon=${KIND_ICONS[d.kind]}></ha-icon>
                  <div class="grow">${d.name}<div class="dim small">${this.areaName(d.area) ?? ""}</div></div>
                  <span class="check on">${icon("check")}</span>
                </div>`,
              )}
            </div>`
        : nothing}
      <div class="add-actions">
        <button class="pill" @click=${() => this.go("prepare")}>${t("add_device.search_again")}</button>
      </div>`;
  }

  /** Step 5: one device: identify it, its name and room. */
  private setup(d: FoundDevice): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const areas = Object.entries(ctx.hass.areas || {})
      .map(([id, a]) => [id, a.name] as const)
      .concat(Object.entries(this.created).filter(([id]) => !ctx.hass.areas?.[id]))
      .sort(([, a], [, b]) => a.localeCompare(b));
    const pick = (id: string) => {
      haptic("selection");
      this.area = id;
    };
    return html`<div class="sensor-hero">
        <ha-icon class="pic" icon=${KIND_ICONS[d.kind]}></ha-icon>
        <div class="dim">${d.product}</div>
      </div>
      <div class="rows">
        <div class="item col">
          <div class="line"><span>${t("devices.name")}</span></div>
          <input class="field" maxlength=${NAME_MAX} aria-label=${t("devices.name")} .value=${this.name}
            @input=${(e: InputEvent) => (this.name = (e.target as HTMLInputElement).value)} />
        </div>
        <button class="item" @click=${() => this.identify(d)}>
          <ha-icon icon="mdi:lightbulb-alert-outline"></ha-icon>
          <div class="grow">${t("devices.identify")}<div class="dim small">${t(d.kind === "light" ? "add_device.identify_light" : "add_device.identify_other")}</div></div>
        </button>
      </div>
      <h2 class="label">${t("add_device.room")}</h2>
      <div class="rows areas">
        ${areas.map(
          ([id, name]) => html`<button class=${classMap({ item: true, on: this.area === id })} role="radio" aria-checked=${this.area === id} @click=${() => pick(id)}>
            <ha-icon icon=${ctx.hass.areas?.[id]?.icon || "mdi:texture-box"}></ha-icon>
            <div class="grow">${name}</div>
            <span class="radio"></span>
          </button>`,
        )}
        ${this.newArea === null
          ? html`<button class="item" @click=${() => (this.newArea = "")}>
              <ha-icon icon="mdi:plus"></ha-icon><div class="grow">${t("add_device.new_area")}</div>
            </button>`
          : html`<div class="item col">
              <input class="field" maxlength="50" placeholder=${t("add_device.new_area_name")} aria-label=${t("add_device.new_area_name")} .value=${this.newArea}
                @input=${(e: InputEvent) => (this.newArea = (e.target as HTMLInputElement).value)}
                @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this.createArea()} />
              <div class="actions-row">
                <button class="pill" @click=${() => (this.newArea = null)}>${t("common.cancel")}</button>
                <button class="pill apply" ?disabled=${!this.newArea.trim() || this.busy} @click=${() => this.createArea()}>${t("add_device.create")}</button>
              </div>
            </div>`}
      </div>
      <p class="lead small">${t(d.kind === "light" ? "devices.room_hint" : "devices.area_hint")}</p>`;
  }

  /** A device found (and not set up yet): opens its setup. */
  private deviceRow(d: FoundDevice, open = true): TemplateResult {
    const { t } = this.ctx;
    const content = html`<ha-icon icon=${KIND_ICONS[d.kind]}></ha-icon>
      <div class="grow">${d.name}<div class="dim small">${d.product} · ${t(`devices.kind_${d.kind}` as StringKey)}</div></div>`;
    if (!open) return html`<div class="item fresh">${content}</div>`;
    return html`<button class="item" @click=${() => this.open(d)}>
      ${content}<span class="dim small">${t("add_device.set_up_one")}</span><ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
    </button>`;
  }

  private areaName(id: string | null): string | null {
    return id ? this.ctx.hass.areas?.[id]?.name ?? this.created[id] ?? id : null;
  }

  private open(d: FoundDevice): void {
    haptic("selection");
    this.current = d;
    this.name = d.name;
    this.area = d.area ?? areaOfRoom(this.room);
    this.newArea = null;
    this.go("setup");
    // The Hue app makes a light breathe as soon as it is picked.
    if (d.kind === "light") void this.identify(d, true);
  }

  private async identify(d: FoundDevice, quiet = false): Promise<void> {
    if (!quiet) haptic("selection");
    await this.ctx.ws({ type: "hue_studio/devices/identify", device: d.id });
  }

  private async createArea(): Promise<void> {
    const name = this.newArea?.trim();
    if (!name) return;
    this.busy = true;
    const area = await this.ctx.query<{ area_id: string; name: string }>({ type: "config/area_registry/create", name });
    this.busy = false;
    if (!area) return;
    haptic("success");
    this.created = { ...this.created, [area.area_id]: area.name };
    this.area = area.area_id;
    this.newArea = null;
  }

  private async search(): Promise<void> {
    const { ctx } = this;
    const bridge = this.bridgeId;
    if (!bridge) return;
    this.busy = true;
    const ok = await ctx.ws({
      type: "hue_studio/devices/search",
      hue_entry_id: bridge,
      serials: parseSerials(this.serials).codes,
      other_brands: this.kind === "other",
    });
    this.busy = false;
    if (!ok) return;
    haptic("success");
    this.bridge = bridge;
    this.started = Date.now();
    this.now = this.started;
    this.seenActive = false;
    this.go("search");
  }

  private async save(d: FoundDevice): Promise<void> {
    const { ctx } = this;
    const name = this.name.trim() || d.name;
    this.busy = true;
    const ok = await ctx.ws({ type: "hue_studio/devices/setup", device: d.id, name, area_id: this.area });
    this.busy = false;
    if (!ok) return;
    haptic("success");
    ctx.toast(ctx.t("devices.saved", { name }));
    this.done = { ...this.done, [d.id]: { name, area: this.area, kind: d.kind } };
    this.current = null;
    this.go("results");
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-device-add-view": DeviceAddView;
  }
}
