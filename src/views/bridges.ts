// Settings → Bridges: the bridges and the Sync Boxes, one row each; each opens its own page,
// "Add a bridge" opens bridge-add.ts.
// A bridge: its name (renamed on the bridge), what it is, its devices, entertainment and (a
// Bridge Pro) MotionAware areas. A Sync Box: its name, LED, following the TV (paired
// directly), what it is, how it is connected, its sync controls.
// Settings → MotionAware areas (lights as motion sensors, only with a Hue Bridge Pro): each
// area with how it does and on/off, and "New area"; views/motion-area.ts sets one up and
// changes it.

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import { wifiKey } from "../devices.ts";
import { haptic } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import { friendlyName } from "../model.ts";
import { areaState } from "../motion.ts";
import { bridgeAreas, bridgeOf } from "../rooms.ts";
import { hasFeature, statusKey } from "../sync.ts";
import type { BoxBridgeEvent, BridgeInfo, BridgesMessage, MotionArea, MoveState, SyncBoxDevice, SyncBoxInfo } from "../types.ts";
import { icon, toggle } from "../ui.ts";
import { StudioView } from "./base.ts";
import { navRow, single } from "./choice.ts";

const NAME_MAX = 32;
const LEDS = ["off", "dimmed", "normal"] as const;

@customElement("hue-studio-bridges-view")
export class BridgesView extends StudioView {
  /** "bridges" or "motion" (MotionAware areas). */
  @property() accessor mode: "bridges" | "motion" = "bridges";
  /** A bridge (its native hue entry id) or a Sync Box (its entry id) to show; null: the list. */
  @property() accessor item: string | null = null;
  @state() private accessor bridges: BridgesMessage | null = null;
  /** A move to another bridge in progress or waiting (admins). */
  @state() private accessor move: MoveState | null = null;
  /** The name being typed (null: not renaming). */
  @state() private accessor name: string | null = null;
  @state() private accessor busy = false;
  /** A Sync Box's sheet: its bridge or its Wi-Fi. */
  @state() private accessor boxSheet: "bridge" | "wifi" | null = null;
  /** The bridge the box goes to, and how linking it goes (`until`: the button's deadline, ms). */
  @state() private accessor boxTarget: string | null = null;
  @state() private accessor boxLink: { event: BoxBridgeEvent; until: number } | null = null;
  @state() private accessor now = Date.now();
  private stop?: () => void;
  private stopMove?: () => void;
  private stopBoxLink?: () => void;
  private ticker?: ReturnType<typeof setInterval>;

  override connectedCallback(): void {
    super.connectedCallback();
    this.stop = this.ctx.watch<BridgesMessage>("hue_studio/bridges/subscribe", (m) => (this.bridges = m));
    if (this.ctx.hass.user?.is_admin) {
      this.stopMove = this.ctx.watch<MoveState | null>("hue_studio/bridges/move/subscribe", (m) => (this.move = m));
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop?.();
    this.stopMove?.();
    this.cancelBoxLink();
  }

  protected override renderPage() {
    const { ctx } = this;
    const { t } = ctx;
    if (this.mode === "motion") {
      const back = this.item ? `/settings/bridges/${encodeURIComponent(this.item)}` : "/settings";
      return this.screen(
        this.subHead(t("settings.motionaware"), () => ctx.go(back)),
        !this.bridges ? html`<p class="empty">${t("rooms.loading")}</p>` : this.motionAreas(this.bridges),
        "settings-page",
      );
    }
    if (this.item) {
      const box = ctx.boxes[this.item];
      // The box's sheets sit outside the scrolling body: a scroller (iOS) would clip them.
      if (box) return html`${this.boxPage(this.item, box)}${this.boxSheet ? this.renderBoxSheet(this.item, box) : nothing}`;
      const bridge = this.bridges?.[this.item];
      if (bridge) return this.bridgePage(this.item, bridge);
      return this.screen(
        this.subHead("", () => ctx.go("/settings/bridges")),
        html`<p class="empty">${t(this.bridges ? "bridges.not_found" : "rooms.loading")}</p>`,
        "settings-page",
      );
    }
    return this.screen(
      this.subHead(t("settings.bridges"), () => ctx.go("/settings")),
      !this.bridges ? html`<p class="empty">${t("rooms.loading")}</p>` : this.list(this.bridges),
      "settings-page",
    );
  }

  /** The bridges, then the Sync Boxes, each a row opening its page. */
  private list(bridges: BridgesMessage): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const boxes = Object.entries(ctx.boxes);
    const row = (id: string, glyph: string, title: string, sub: string, warn = false) =>
      html`<button class="item" @click=${() => ctx.go(`/settings/bridges/${encodeURIComponent(id)}`)}>
        <ha-icon icon=${glyph}></ha-icon>
        <div class="grow">${title}<div class=${classMap({ "dim small": true, warn })}>${sub}</div></div>
        <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
      </button>`;
    return html`<h2 class="label">${t("settings.bridges")}</h2>
      <div class="rows">
        ${Object.entries(bridges).map(([id, b]) =>
          row(id, "mdi:router-wireless", b.name, b.connected === false ? t("bridges.offline") : this.summary(b), b.connected === false),
        )}
        ${ctx.hass.user?.is_admin
          ? html`<button class="item" @click=${() => ctx.go("/settings/bridges/add")}>
              <ha-icon icon="mdi:plus"></ha-icon>
              <div class="grow">${t("bridge_add.title")}<div class="dim small">${t("bridge_add.row_sub")}</div></div>
              <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
            </button>`
          : nothing}
      </div>
      <h2 class="label">${t("bridges.sync_boxes")}</h2>
      <div class="rows">
        ${boxes.map(([id, box]) =>
          row(
            id,
            "mdi:television-box",
            box.name || "Sync Box",
            box.available ? `${box.model || "Sync Box"} · ${t(this.direct(box) ? "bridges.box_direct" : "bridges.box_link")}` : t("bridges.box_offline"),
            !box.available,
          ),
        )}
        <button class="item" @click=${() => ctx.openSettings()}>
          <ha-icon icon="mdi:plus"></ha-icon>
          <div class="grow">${t("bridges.add_box")}<div class="dim small">${t("bridges.add_box_sub")}</div></div>
          <ha-icon class="chevron" icon="mdi:open-in-new"></ha-icon>
        </button>
      </div>
      <p class="lead small">${t("bridges.hint")}</p>`;
  }

  /** "Move everything to another bridge" (admins, with another bridge connected). */
  private moveAllLink(id: string, b: BridgeInfo): TemplateResult | typeof nothing {
    const { ctx } = this;
    const others = Object.entries(this.bridges || {}).filter(([other, o]) => other !== id && o.connected !== false);
    if (!ctx.hass.user?.is_admin || !others.length || !b.devices) return nothing;
    return this.link("mdi:swap-horizontal", ctx.t("move.all_row", { to: others.length === 1 ? others[0][1].name : ctx.t("move.all_another") }), ctx.t("move.all_row_sub"), () =>
      ctx.go(`/settings/bridges/move?bridge=${encodeURIComponent(id)}`),
    );
  }

  /** What a connected bridge is and holds: "Hue Bridge Pro · 9 lights · 6 rooms". */
  private summary(b: BridgeInfo): string {
    const { t } = this.ctx;
    return [
      b.model,
      b.lights != null ? this.lightsCount(b.lights) : null,
      b.rooms != null ? (b.rooms === 1 ? t("bridges.one_room") : t("bridges.rooms_count", { count: b.rooms })) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  private lightsCount(n: number): string {
    return n === 1 ? this.ctx.t("rooms.one_light") : this.ctx.t("rooms.lights_count", { count: n });
  }

  /** A bridge's rooms (the HA areas whose lights it has), each opening the room. */
  private rooms(id: string): TemplateResult | typeof nothing {
    const { ctx } = this;
    const { t } = ctx;
    const areas = bridgeAreas(ctx.rooms, id);
    const split = ctx.rooms?.split_areas || {};
    if (!areas.length) return nothing;
    return html`<h2 class="label">${t("bridges.rooms")}</h2>
      <div class="rows">
        ${areas.map((area) => {
          const lights = ctx.home.rooms.find((r) => r.key === `area.${area}`)?.lights.filter((l) => bridgeOf(ctx.rooms, l) === id) || [];
          const sub = split[area] ? t("bridges.room_split") : this.lightsCount(lights.length);
          return html`<button class="item" @click=${() => ctx.go(`/room/${encodeURIComponent(`area.${area}`)}`)}>
            <ha-icon icon=${ctx.hass.areas?.[area]?.icon || "mdi:sofa-outline"}></ha-icon>
            <div class="grow">${ctx.hass.areas?.[area]?.name || area}<div class=${classMap({ "dim small": true, warn: !!split[area] })}>${sub}</div></div>
            <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
          </button>`;
        })}
      </div>`;
  }

  /** A box paired with Hue Studio (not one used through HACS huesyncbox). */
  private direct(box: SyncBoxInfo): boolean {
    return hasFeature(box, "settings") || !!box.features?.length;
  }

  /** The top of a bridge's or box's page: picture, name (pencil: rename), status. */
  private hero(glyph: string, name: string, status: TemplateResult | string, canRename: boolean): TemplateResult {
    const { t } = this.ctx;
    return html`<div class="sensor-hero">
      <ha-icon class="pic" icon=${glyph}></ha-icon>
      <div class="name-row">
        ${this.name !== null
          ? html`<input class="name-input" .value=${this.name} maxlength=${NAME_MAX} aria-label=${t("bridges.rename")}
              @input=${(e: InputEvent) => (this.name = (e.target as HTMLInputElement).value)} />`
          : html`<h1 class="big">${name}</h1>`}
        ${canRename
          ? html`<button class="round rename" aria-label=${t("bridges.rename")} @click=${() => {
              this.name = this.name === null ? name : null;
              if (this.name !== null) this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".name-input")?.focus());
            }}>${icon("pencil")}</button>`
          : nothing}
      </div>
      <div class="dim">${status}</div>
    </div>`;
  }

  /** "Save" in the bar while a new name is typed. */
  private saveButton(current: string, save: (name: string) => Promise<boolean>): TemplateResult | typeof nothing {
    const name = this.name?.trim();
    if (this.name === null) return nothing;
    return html`<button class="pill save" ?disabled=${!name || name === current || this.busy} @click=${async () => {
      this.busy = true;
      const ok = await save(name!);
      this.busy = false;
      if (ok) {
        haptic("success");
        this.name = null;
      }
    }}>${this.ctx.t("scene.save")}</button>`;
  }

  private fact(label: StringKey, value: string | number | null | undefined): TemplateResult | typeof nothing {
    return value || value === 0 ? html`<div class="item"><div class="grow">${this.ctx.t(label)}</div><span class="dim value-text">${value}</span></div>` : nothing;
  }

  private link(glyph: string, title: string, sub: string, act: () => void, external = false): TemplateResult {
    return html`<button class="item" @click=${act}>
      <ha-icon icon=${glyph}></ha-icon>
      <div class="grow">${title}${sub ? html`<div class="dim small">${sub}</div>` : nothing}</div>
      <ha-icon class="chevron" icon=${external ? "mdi:open-in-new" : "mdi:chevron-right"}></ha-icon>
    </button>`;
  }

  private bridgePage(id: string, b: BridgeInfo): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const online = b.connected !== false;
    const areas = b.motion_areas;
    const status = online ? t(b.pro ? "bridges.connected_pro" : "bridges.connected") : t("bridges.offline");
    return this.screen(
      this.subHead(t("bridges.bridge_settings"), () => ctx.go("/settings/bridges"), this.saveButton(b.name, (name) => ctx.ws({ type: "hue_studio/bridges/rename", hue_entry_id: id, name }))),
      html`${this.hero("mdi:router-wireless", b.name, status, online)}
        ${online
          ? html`<div class="rows">
              ${this.link("mdi:lightbulb-group-outline", t("settings.devices"), t("bridges.devices_count", { devices: b.devices ?? 0, lights: b.lights ?? 0 }), () =>
                ctx.go(`/settings/devices?bridge=${encodeURIComponent(id)}`),
              )}
              ${this.link("mdi:television-ambient-light", t("settings.entertainment"), "", () => ctx.go("/settings/entertainment"))}
              ${areas
                ? this.link("mdi:motion-sensor", t("settings.motionaware"), t("bridges.motion_count", { count: areas.length }), () =>
                    ctx.go(`/settings/motionaware?bridge=${encodeURIComponent(id)}`),
                  )
                : nothing}
            </div>`
          : html`<p class="lead">${t("bridges.offline_hint")}</p>`}
        ${online ? this.rooms(id) : nothing}
        <h2 class="label">${t("bridges.about")}</h2>
        <div class="rows">
          ${this.fact("bridges.model", b.model)} ${this.fact("bridges.address", b.host)} ${this.fact("bridges.software", b.software)} ${this.fact("bridges.id", b.id)}
        </div>
        <div class="rows">
          ${b.ha_device
            ? this.link("mdi:home-assistant", t("sensor.in_ha"), "", () => ctx.openHa(`/config/devices/device/${encodeURIComponent(b.ha_device!)}`), true)
            : this.link("mdi:home-assistant", t("bridges.hue_integration"), "", () => ctx.openHa("/config/integrations/integration/hue"), true)}
        </div>`,
      "settings-page",
    );
  }

  private boxPage(id: string, box: SyncBoxInfo): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const device: Partial<SyncBoxDevice> = box.device ?? {};
    const settings = hasFeature(box, "settings") && box.available;
    const name = box.name || "Sync Box";
    const configure = (change: Record<string, unknown>) => ctx.ws({ type: "hue_studio/sync/configure", entry_id: id, ...change });
    const wifi = wifiKey(device.wifi);
    return this.screen(
      this.subHead(t("bridges.box_page"), () => ctx.go("/settings/bridges"), this.saveButton(name, (n) => configure({ name: n }))),
      html`${this.hero("mdi:television-box", name, box.available ? t(statusKey(box)) : t("bridges.box_offline"), settings)}
        <div class="rows">
          ${this.link("mdi:sync", t("bridges.sync_controls"), t("bridges.sync_controls_sub"), () => ctx.go(`/sync?box=${encodeURIComponent(id)}`))}
        </div>
        ${settings
          ? html`<h2 class="label">${t("bridges.box_settings")}</h2>
              <div class="rows">
                ${navRow({ icon: "mdi:led-on", title: t("bridges.led"), value: device.led ? t(`bridges.led_${device.led}` as StringKey) : "" }, () =>
                  this.choose(single(t("bridges.led"), LEDS.map((led) => ({ value: led, label: t(`bridges.led_${led}` as StringKey) })), device.led ?? "", (led) => void configure({ led }))),
                )}
                ${device.tv_power != null
                  ? html`<div class="item">
                      <ha-icon icon="mdi:television"></ha-icon>
                      <div class="grow">${t("bridges.tv_power")}<div class="dim small">${t("bridges.tv_power_sub")}</div></div>
                      ${toggle(!!device.tv_power, t("bridges.tv_power"), () => {
                        haptic("selection");
                        void configure({ tv_power: !device.tv_power });
                      })}
                    </div>`
                  : nothing}
              </div>`
          : nothing}
        <h2 class="label">${t("bridges.connection")}</h2>
        <div class="rows">
          <div class="item">
            <ha-icon icon=${this.direct(box) ? "mdi:link-variant" : "mdi:puzzle-outline"}></ha-icon>
            <div class="grow">${t(this.direct(box) ? "bridges.box_paired" : "bridges.box_compat")}
              <div class="dim small">${t(this.direct(box) ? "bridges.box_paired_sub" : "bridges.box_compat_sub")}</div>
            </div>
          </div>
          ${!this.direct(box) ? this.link("mdi:link-plus", t("bridges.box_pair"), t("bridges.box_pair_sub"), () => ctx.openSettings(), true) : nothing}
          ${settings
            ? html`<div class="item">
                <ha-icon icon="mdi:router-wireless"></ha-icon>
                <div class="grow">${t("bridges.box_bridge", { bridge: this.bridgeLabel(box.bridge) })}
                  <div class="dim small">${t("bridges.box_bridge_sub")}</div>
                </div>
              </div>
              ${this.link(
                "mdi:wifi",
                t("bridges.box_wifi", { network: device.wifi_name || t("bridges.wifi_none") }),
                wifi ? t(`bridges.wifi_${wifi}` as StringKey) : "",
                () => this.openBoxSheet("wifi", box),
              )}`
            : nothing}
        </div>
        <h2 class="label">${t("bridges.about")}</h2>
        <div class="rows">
          ${this.fact("bridges.model", box.model)} ${this.fact("bridges.address", device.host)}
          ${this.fact("bridges.firmware", device.firmware)}
          ${device.update ? this.fact("bridges.update", device.update) : nothing}
          ${wifi ? this.fact("bridges.wifi", t(`bridges.wifi_${wifi}` as StringKey)) : nothing}
          ${box.connection ? this.fact("bridges.bridge_link", t(box.connection === "connected" ? "bridges.bridge_connected" : "bridges.bridge_not_connected")) : nothing}
          ${this.fact("bridges.box_id", device.id)}
        </div>
        ${device.ha_device
          ? html`<div class="rows">
              ${this.link("mdi:home-assistant", t("sensor.in_ha"), "", () => ctx.openHa(`/config/devices/device/${encodeURIComponent(device.ha_device!)}`), true)}
            </div>`
          : nothing}`,
      "settings-page",
    );
  }

  private bridgeLabel(id: string | null | undefined): string {
    return (id && (this.bridges?.[id]?.name ?? this.ctx.rooms?.bridges?.[id])) || this.ctx.t("bridges.box_bridge_unknown");
  }

  private openBoxSheet(sheet: "bridge" | "wifi", box: SyncBoxInfo): void {
    haptic("selection");
    this.cancelBoxLink();
    this.boxSheet = sheet;
    this.boxTarget = Object.keys(this.bridges ?? {}).find((id) => id !== box.bridge) ?? null;
  }

  private closeBoxSheet(): void {
    this.cancelBoxLink();
    this.boxSheet = null;
  }

  private cancelBoxLink(): void {
    clearInterval(this.ticker);
    this.stopBoxLink?.();
    this.stopBoxLink = undefined;
    this.boxLink = null;
  }

  /** Move the box to the bridge picked: its button, then the box connects. */
  private linkBox(entryId: string, target: string): void {
    haptic("light");
    this.cancelBoxLink();
    this.boxLink = { event: { step: "connecting" }, until: 0 };
    this.ticker = setInterval(() => (this.now = Date.now()), 500);
    this.stopBoxLink = this.ctx.watch<BoxBridgeEvent>(
      "hue_studio/sync/link_bridge",
      (event) => {
        if (!this.boxLink) return;
        const until = event.step === "press" ? Date.now() + event.timeout * 1000 : this.boxLink.until;
        this.boxLink = { event, until };
        if (event.step === "done" || event.step === "failed") {
          clearInterval(this.ticker);
          this.stopBoxLink?.();
          this.stopBoxLink = undefined;
          haptic(event.step === "done" ? "success" : "failure");
        }
      },
      { entry_id: entryId, hue_entry_id: target },
    );
  }

  private renderBoxSheet(id: string, box: SyncBoxInfo): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const device: Partial<SyncBoxDevice> = box.device ?? {};
    const title = t(this.boxSheet === "bridge" ? "bridges.box_bridge_title" : "bridges.box_wifi_title");
    let content: TemplateResult;
    if (this.boxSheet === "wifi") {
      content = html`<p class="hint">${t("bridges.box_wifi_text", { network: device.wifi_name || t("bridges.wifi_none") })}</p>
        <div class="rows">
          <div class="item">
            <ha-icon icon="mdi:bluetooth"></ha-icon>
            <div class="grow">${t("bridges.box_bluetooth")}<div class="dim small">${t("bridges.box_bluetooth_sub")}</div></div>
            ${toggle(!!device.bluetooth, t("bridges.box_bluetooth"), () => {
              haptic("selection");
              void ctx.ws({ type: "hue_studio/sync/configure", entry_id: id, bluetooth: !device.bluetooth });
            })}
          </div>
        </div>
        <p class="hint">${t("bridges.box_wifi_follow")}</p>`;
    } else {
      const others = Object.entries(this.bridges ?? {}).filter(([bid]) => bid !== box.bridge);
      const target = this.boxTarget;
      const link = this.boxLink;
      const name = this.bridgeLabel(target);
      const left = link?.event.step === "press" ? Math.max(0, Math.ceil((link.until - this.now) / 1000)) : 0;
      content = link
        ? html`<div class="link-state">
            ${link.event.step === "done"
              ? html`<div class="link-icon ok">${icon("check")}</div>
                  <p class="lead center-text">${t("bridges.box_moved", { bridge: name, area: link.event.area ?? "" })}</p>
                  <div class="link-actions"><button class="pill go" @click=${() => this.closeBoxSheet()}>${t("qr.done")}</button></div>`
              : link.event.step === "failed"
                ? html`<p class="lead center-text error">${t(`bridges.box_link_${link.event.reason}` as StringKey, { bridge: name })}</p>
                    <div class="link-actions"><button class="pill go" @click=${() => target && this.linkBox(id, target)}>${t("bridges.box_link_again")}</button></div>`
                : html`<span class="spinner big"></span>
                    <p class="lead center-text">${link.event.step === "press" ? t("bridges.box_press", { bridge: name, seconds: left }) : t("bridges.box_connecting", { bridge: name })}</p>
                    <div class="link-actions"><button class="pill" @click=${() => this.cancelBoxLink()}>${t("bridge_add.cancel")}</button></div>`}
          </div>`
        : html`<p class="hint">${t("bridges.box_bridge_text", { bridge: this.bridgeLabel(box.bridge) })}</p>
            ${others.length
              ? html`<div class="rows choice-list" role="radiogroup">
                    ${others.map(
                      ([bid, b]) => html`<button class=${classMap({ item: true, on: bid === target })} role="radio" aria-checked=${bid === target} @click=${() => {
                        haptic("selection");
                        this.boxTarget = bid;
                      }}>
                        <ha-icon icon="mdi:router-wireless"></ha-icon><div class="grow">${b.name}</div>
                        ${bid === target ? html`<span class="tick">${icon("check")}</span>` : nothing}
                      </button>`,
                    )}
                  </div>
                  <div class="center sheet-actions">
                    <button class="pill go" ?disabled=${!target} @click=${() => target && this.linkBox(id, target)}>${t("bridges.box_move", { bridge: name })}</button>
                  </div>`
              : html`<p class="hint">${t("bridges.box_no_other")}</p>`}`;
    }
    return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && this.closeBoxSheet()}>
      <div class="box form sensor-sheet" role="dialog" aria-label=${title}>
        <div class="sheet-bar">
          <button class="round close" aria-label=${t("common.close")} @click=${() => this.closeBoxSheet()}>${icon("close")}</button>
          <div class="grow">${title}</div>
        </div>
        <div class="form-body">${content}</div>
      </div>
    </div>`;
  }

  private motionAreas(bridges: BridgesMessage): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const shown = Object.entries(bridges).filter(([id, b]) => b.motion_areas !== null && (!this.item || id === this.item));
    const several = shown.length > 1;
    return html`<p class="lead">${t("motion.intro")}</p>
      ${!shown.length ? html`<p class="lead small center-text">${t("motion.unsupported")}</p>` : nothing}
      ${shown.map(
        ([id, b]) => html`${several ? html`<h2 class="label">${b.name}</h2>` : nothing}
          <div class="rows">
            ${b.motion_areas!.map((a) => this.motionArea(a))}
            <button class="item" @click=${() => ctx.go(`/settings/motionaware/new?bridge=${encodeURIComponent(id)}`)}>
              <ha-icon icon="mdi:plus"></ha-icon><div class="grow">${t("ma.new")}</div>
            </button>
          </div>
          ${b.motion_areas!.length ? nothing : html`<p class="lead small center-text">${t("motion.none")}</p>`}`,
      )}`;
  }

  private motionArea(a: MotionArea): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const lights = a.lights.map((l) => (l.entity_id ? friendlyName(ctx.hass, l.entity_id) : "?")).join(", ");
    const state = areaState(a);
    return html`<div class="item">
      <button class="grow plain row-link" @click=${() => ctx.go(`/settings/motionaware/${encodeURIComponent(a.id)}`)}>
        <ha-icon icon=${a.enabled ? "mdi:motion-sensor" : "mdi:motion-sensor-off"}></ha-icon>
        <div class="grow">${a.name}
          <div class=${classMap({ "dim small": true, warn: state === "problem" })}>${[a.group ?? t("ma.whole_home"), t(`ma.state_${state}` as StringKey), lights].filter(Boolean).join(" · ")}</div>
        </div>
      </button>
      ${toggle(a.enabled, a.name, () => ctx.ws({ type: "hue_studio/motion_areas/update", area_id: a.id, enabled: !a.enabled }))}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-bridges-view": BridgesView;
  }
}
