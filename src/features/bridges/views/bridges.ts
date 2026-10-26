// Settings → Bridges: the bridges and the Sync Boxes, one row each; each opens its own page,
// "Add a bridge" opens bridge-add.ts.
// A bridge: its name (renamed on the bridge), what it is, its devices, entertainment and (a
// Bridge Pro) MotionAware areas. A Sync Box's row opens its settings (sync-settings.ts).
// Settings → MotionAware areas (lights as motion sensors, only with a Hue Bridge Pro): each
// area with how it does and on/off, and "New area"; views/motion-area.ts sets one up and
// changes it.

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import { haptic } from "../../../core/ha-internals.ts";
import type { StringKey } from "../../../i18n/index.ts";
import { friendlyName } from "../../../core/model.ts";
import { areaState } from "../motion.ts";
import { bridgeAreas, bridgeOf } from "../../rooms/rooms.ts";
import { hasFeature } from "../../sync/sync.ts";
import type { BridgeInfo, BridgesMessage, MotionArea, SyncBoxInfo } from "../../../core/types.ts";
import { icon, toggle } from "../../../ds/ui.ts";
import { StudioView } from "../../../ds/base.ts";

const NAME_MAX = 32;

@customElement("hue-studio-bridges-view")
export class BridgesView extends StudioView {
  /** "bridges" or "motion" (MotionAware areas). */
  @property() accessor mode: "bridges" | "motion" = "bridges";
  /** A bridge (its native hue entry id) or a Sync Box (its entry id) to show; null: the list. */
  @property() accessor item: string | null = null;
  @state() private accessor bridges: BridgesMessage | null = null;
  /** The name being typed (null: not renaming). */
  @state() private accessor name: string | null = null;
  @state() private accessor busy = false;
  private stop?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.stop = this.ctx.watch<BridgesMessage>("hue_studio/bridges/subscribe", (m) => (this.bridges = m));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop?.();
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
      const bridge = this.bridges?.[this.item];
      if (bridge) return this.bridgePage(this.item, bridge);
      return this.screen(
        this.subHead("", () => ctx.go("/settings/bridges")),
        html`<p class="empty">${t(this.bridges ? "bridges.not_found" : "rooms.loading")}</p>`,
        "settings-page",
      );
    }
    // Like the Hue app's: a new bridge is the header's "+".
    const add = ctx.hass.user?.is_admin
      ? html`<button class="round plus-blue" aria-label=${t("bridge_add.title")} @click=${() => ctx.go("/settings/bridges/add")}>${icon("plus")}</button>`
      : nothing;
    return this.screen(
      this.subHead(t("settings.bridges"), () => ctx.go("/settings"), add),
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
          row(id, "hue-studio:bridge", b.name, b.connected === false ? t("bridges.offline") : this.summary(b), b.connected === false),
        )}
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
  private hero(glyph: string, name: string, status: TemplateResult | string, canRename: boolean, max = NAME_MAX): TemplateResult {
    const { t } = this.ctx;
    return html`<div class="sensor-hero">
      <ha-icon class="pic" icon=${glyph}></ha-icon>
      <div class="name-row">
        ${this.name !== null
          ? html`<input class="name-input" .value=${this.name} maxlength=${max} aria-label=${t("bridges.rename")}
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
      this.subHead(
        t("bridges.bridge_settings"),
        () => ctx.go("/settings/bridges"),
        this.saveButton(b.name, (name) => ctx.ws({ type: "hue_studio/bridges/rename", hue_entry_id: id, name })),
        nothing,
        true,
      ),
      html`${this.hero("hue-studio:bridge", b.name, status, online)}
        ${online
          ? html`<div class="rows">
              ${this.link("hue-studio:devices", t("settings.devices"), t("bridges.devices_count", { devices: b.devices ?? 0, lights: b.lights ?? 0 }), () =>
                ctx.go(`/settings/devices?bridge=${encodeURIComponent(id)}`),
              )}
              ${this.link("hue-studio:sync", t("settings.entertainment"), "", () => ctx.go("/settings/entertainment"))}
              ${areas
                ? this.link("hue-studio:motionaware", t("settings.motionaware"), t("bridges.motion_count", { count: areas.length }), () =>
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
