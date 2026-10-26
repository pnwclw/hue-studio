// A Hue zone's editor (Settings → Rooms and zones), like the Hue app's entertainment area
// editor: its icon and name (renamed in place with the pencil), its lights as a "Lights" card
// ("+" opens "Add lights to …", a card's "−" takes one out; ds/lights.ts), "Delete" at the
// bottom. "SAVE" stores the name and lights on the bridge (create_zone / update_zone) and goes back.

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { StudioContext } from "../../../core/context.ts";
import { hueGroupIcon } from "../../../core/model.ts";
import { haptic } from "../../../core/ha-internals.ts";
import { bridgeName, bridgeOf, groupBridge, hueZones, lightsByArea, severalBridges, type Zone } from "../rooms.ts";
import { icon } from "../../../ds/ui.ts";
import { StudioView } from "../../../ds/base.ts";
import { bridgeRow } from "../../../ds/choice.ts";
import { addLightsSheet, type LightRoom, lightsCard } from "../../../ds/lights.ts";

/** The path of a zone's editor; `new` for a new zone. */
export const NEW_ZONE = "new";
const NAME_MAX = 32;

export const scenesCount = (ctx: StudioContext, n: number): string =>
  n === 1 ? ctx.t("rooms.one_scene") : ctx.t("rooms.scenes_count", { count: n });

@customElement("hue-studio-zone-view")
export class ZoneView extends StudioView {
  /** The zone's light entity, or NEW_ZONE. */
  @property() accessor zone = NEW_ZONE;

  /** What was changed; null: as the zone has it. */
  @state() private accessor name: string | null = null;
  @state() private accessor lights: string[] | null = null;
  @state() private accessor bridge: string | null = null;
  @state() private accessor editingName = false;
  @state() private accessor saving = false;
  /** "Add lights to …" is open: what is checked there, the rooms open. */
  @state() private accessor adding: { picked: string[]; open: string[] } | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    // A new zone starts with its name: the field open, the keyboard up.
    if (this.zone === NEW_ZONE) {
      this.editingName = true;
      this.bridge = Object.keys(this.ctx.rooms?.bridges || {})[0] ?? null;
      void this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".name-input")?.focus());
    }
  }

  private get current(): Zone | null {
    return this.zone === NEW_ZONE ? null : (hueZones(this.ctx.hass).find((z) => z.entity_id === this.zone) ?? null);
  }

  private dirty(zone: Zone | null): boolean {
    const name = (this.name ?? zone?.name ?? "").trim();
    const lights = this.lights ?? zone?.lights ?? [];
    if (!zone) return !!name || lights.length > 0;
    return name !== zone.name || lights.length !== zone.lights.length || lights.some((l) => !zone.lights.includes(l));
  }

  private back(): void {
    this.ctx.go("/rooms");
  }

  protected override renderPage() {
    const { ctx } = this;
    const { t } = ctx;
    const zone = this.current;
    const isNew = this.zone === NEW_ZONE;
    if (!isNew && !zone) {
      return this.screen(this.subHead("", () => this.back(), nothing, nothing, true), html`<p class="empty">${t("rooms.loading")}</p>`, "sensor-edit");
    }
    const name = this.name ?? zone?.name ?? "";
    const lights = this.lights ?? zone?.lights ?? [];
    const bridge = zone ? groupBridge(ctx.rooms, { lights: zone.lights, group: zone.entity_id }) : this.bridge;
    const valid = !!name.trim() && lights.length > 0;
    const title = t(isNew ? "zone.title_new" : "zone.title_edit");
    const save = html`<button class="pill save" ?disabled=${!valid || !this.dirty(zone) || this.saving} @click=${() => this.save(zone, name.trim(), lights)}>${t("scene.save")}</button>`;
    const rooms = this.rooms(bridge, lights);
    const body = html`<div class="sensor-hero">
        <ha-icon class="pic" icon=${zone ? hueGroupIcon(ctx.hass, ctx.config, zone.entity_id) : "mdi:texture-box"}></ha-icon>
        <div class="name-row">
          ${this.editingName
            ? html`<input
                class="name-input"
                .value=${name}
                maxlength=${NAME_MAX}
                placeholder=${t("zone.name")}
                aria-label=${t("zone.name")}
                @input=${(e: InputEvent) => (this.name = (e.target as HTMLInputElement).value)}
                @keydown=${(e: KeyboardEvent) => e.key === "Enter" && name.trim() && (this.editingName = false)}
              />`
            : html`<h1 class="big">${name}</h1>`}
          <button
            class="round rename"
            aria-label=${t("zone.name")}
            @click=${() => {
              this.editingName = !this.editingName;
              if (this.editingName) void this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".name-input")?.focus());
            }}
          >${icon("pencil")}</button>
        </div>
        ${zone ? html`<div class="dim small">${scenesCount(ctx, zone.scenes)}</div>` : nothing}
      </div>
      ${severalBridges(ctx.rooms)
        ? isNew
          ? html`<div class="rows">
              ${bridgeRow(t("add_device.bridge"), Object.entries(ctx.rooms!.bridges!), bridge, (c) => this.choose(c), (id) => {
                if (id === this.bridge) return;
                this.bridge = id;
                this.lights = [];
              })}
            </div>`
          : html`<p class="hint">${t("zone.on_bridge", { bridge: bridgeName(ctx.rooms, bridge) ?? "" })}</p>`
        : nothing}
      ${lightsCard(ctx, {
        lights,
        add: () => (this.adding = { picked: [], open: rooms.map((r) => r.key) }),
        remove: (id) => (this.lights = (this.lights ?? zone?.lights ?? []).filter((l) => l !== id)),
      })}
      ${zone
        ? html`<div class="delete-area">
            <button class="delete-btn" ?disabled=${this.saving} @click=${() =>
              this.askDelete(
                [t("zone.delete_note"), zone.scenes ? t("zone.delete_hint", { count: zone.scenes }) : ""].filter(Boolean).join(" "),
                t("zone.delete"),
                () => void this.deleteZone(zone),
              )}>${t("zone.delete")}</button>
          </div>`
        : nothing}`;
    return html`${this.screen(
        this.subHead(title, () => this.confirmLeave(this.dirty(zone), () => this.back()), save, nothing, true),
        body,
        "sensor-edit zone-edit",
      )}
      ${this.adding ? this.addSheet(name || title, rooms) : nothing}`;
  }

  /** The rooms (HA areas) with lights that may join: the zone's bridge's, not in it yet. */
  private rooms(bridge: string | null, lights: string[]): LightRoom[] {
    const { ctx } = this;
    return lightsByArea(ctx.hass)
      .map(([area, ids]): LightRoom => ({
        key: area ?? "",
        name: area ? ctx.hass.areas?.[area]?.name || area : ctx.t("home.no_room"),
        icon: (area && ctx.hass.areas?.[area]?.icon) || (area ? "mdi:sofa-outline" : "mdi:home-off-outline"),
        lights: ids.filter((l) => !lights.includes(l) && (!bridge || !bridgeOf(ctx.rooms, l) || bridgeOf(ctx.rooms, l) === bridge)),
      }))
      .filter((r) => r.lights.length);
  }

  private addSheet(name: string, rooms: LightRoom[]) {
    const { ctx } = this;
    const adding = this.adding!;
    return addLightsSheet(ctx, {
      title: ctx.t("lights.add_to", { name }),
      rooms,
      picked: adding.picked,
      open: adding.open,
      flip: (id) => (this.adding = { ...adding, picked: adding.picked.includes(id) ? adding.picked.filter((l) => l !== id) : [...adding.picked, id] }),
      fold: (key) => (this.adding = { ...adding, open: adding.open.includes(key) ? adding.open.filter((k) => k !== key) : [...adding.open, key] }),
      close: () => (this.adding = null),
      done: () => {
        this.lights = [...(this.lights ?? this.current?.lights ?? []), ...adding.picked];
        this.adding = null;
      },
    });
  }

  private async save(zone: Zone | null, name: string, lights: string[]): Promise<void> {
    const { ctx } = this;
    if (this.saving) return;
    this.saving = true;
    const ok = zone
      ? await ctx.call("hue_studio", "update_zone", { entity_id: zone.entity_id, name, lights }, { optimistic: false })
      : await ctx.call("hue_studio", "create_zone", { entity_id: lights, name }, { optimistic: false });
    this.saving = false;
    if (!ok) return;
    haptic("success");
    ctx.toast(ctx.t("zone.saved", { name }));
    this.back();
  }

  private async deleteZone(zone: Zone): Promise<void> {
    const { ctx } = this;
    this.saving = true;
    const ok = await ctx.call("hue_studio", "delete_zone", { entity_id: zone.entity_id }, { optimistic: false });
    this.saving = false;
    if (!ok) return;
    haptic("success");
    ctx.toast(ctx.t("zone.deleted", { name: zone.name }));
    this.back();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-zone-view": ZoneView;
  }
}
