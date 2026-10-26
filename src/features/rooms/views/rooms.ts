// Rooms and zones (opened from Settings): how the Hue rooms on the bridge differ from the HA areas (and aligning
// them), the Hue zones (each opens its editor, zone.ts), and Hue lights that have no area yet.
// Areas are Home Assistant's truth; rooms on the bridge follow them (hue_studio.align_rooms).

import { html, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { StudioContext } from "../../../core/context.ts";
import { friendlyName, hueGroupIcon, lightIcon } from "../../../core/model.ts";
import { bridgeName, groupBridge, hueZones, lightsByBridge, lightsWithoutArea, severalBridges, type Zone } from "../rooms.ts";
import { banner } from "../../../ds/controls.ts";
import type { RoomsPlan, ZoneNote } from "../../../core/types.ts";
import { toggle } from "../../../ds/ui.ts";
import { StudioView } from "../../../ds/base.ts";
import { type Choice, navRow, single } from "../../../ds/choice.ts";
import { NEW_ZONE, scenesCount } from "./zone.ts";

const names = (ctx: StudioContext, ids: string[]): string => ids.map((id) => friendlyName(ctx.hass, id)).join(", ");
const areaName = (ctx: StudioContext, id: string | null): string => (id && ctx.hass.areas?.[id]?.name) || id || "";
const lightsCount = (ctx: StudioContext, n: number): string =>
  n === 1 ? ctx.t("rooms.one_light") : ctx.t("rooms.lights_count", { count: n });

const row = (iconName: string, text: string | TemplateResult, sub?: string | TemplateResult | typeof nothing, end?: TemplateResult) =>
  html`<div class="item"><ha-icon icon=${iconName}></ha-icon><div class="grow">${text}${sub ? html`<div class="dim small">${sub}</div>` : nothing}</div>${end ?? nothing}</div>`;

/**
 * Hue lights without an HA area, each with an area picker. Also shown on the home screen.
 * Picking an area moves the light's device there (hue_studio/lights/set_area).
 */
export function noRoomRows(ctx: StudioContext, choose: (choice: Choice) => void): TemplateResult | typeof nothing {
  const lights = lightsWithoutArea(ctx.hass);
  if (!lights.length) return nothing;
  const areas = Object.entries(ctx.hass.areas || {}).sort(([, a], [, b]) => a.name.localeCompare(b.name));
  const pick = async (light: string, area: string) => {
    if (area && (await ctx.setArea(light, area))) {
      ctx.toast(ctx.t("rooms.area_set", { light: friendlyName(ctx.hass, light), area: areaName(ctx, area) }));
    }
  };
  const options = areas.map(([id, area]) => ({ value: id, label: area.name, icon: area.icon || "mdi:sofa-outline" }));
  return html`<div class="rows no-room">
    ${lights.map((light) => {
      const hueRoom = ctx.rooms?.hue_rooms[light];
      const name = friendlyName(ctx.hass, light);
      return navRow(
        { icon: lightIcon(ctx.hass, light, ctx.lightInfo[light]), title: name, sub: hueRoom ? ctx.t("rooms.in_hue", { room: hueRoom }) : undefined, value: ctx.t("rooms.pick_area") },
        () => choose(single(name, options, "", (area) => void pick(light, area))),
      );
    })}
  </div>`;
}

@customElement("hue-studio-rooms-view")
export class RoomsView extends StudioView {
  @state() private accessor completeScenes = true;
  @state() private accessor deleteEmpty = false;
  @state() private accessor keepSplit = false;
  @state() private accessor busy = false;
  @state() private accessor notes: ZoneNote[] = [];
  private stopNotes?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.stopNotes = this.ctx.watch<{ notes: ZoneNote[] }>("hue_studio/zones/subscribe", (m) => (this.notes = m.notes));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopNotes?.();
  }

  protected override renderPage() {
    const { ctx } = this;
    const { t } = ctx;
    const zones = hueZones(ctx.hass);
    const loose = noRoomRows(ctx, (c) => this.choose(c));
    return html`${this.screen(
        this.subHead(t("rooms.title"), () => ctx.go("/settings")),
        html`<h2 class="label">${t(severalBridges(ctx.rooms) ? "rooms.bridges" : "rooms.bridge")}</h2>
        ${this.plan(ctx.rooms)}
        ${this.splitAreas(ctx.rooms)}
        <h2 class="label">${t("rooms.zones")}</h2>
        <p class="lead">${t(ctx.config.zone_labels ? "rooms.zones_hint_labels" : "rooms.zones_hint")}</p>
        ${this.notes.map((n) => this.zoneNote(n))}
        <div class="rows zones">
          ${zones.map((z) => this.zoneRow(z))}
          <button class="item" @click=${() => ctx.go(`/rooms/zone/${NEW_ZONE}`)}>
            <ha-icon icon="mdi:plus"></ha-icon><div class="grow">${t("rooms.new_zone")}</div>
          </button>
        </div>
        ${loose === nothing
          ? nothing
          : html`<h2 class="label">${t("home.no_room")}</h2>
              <p class="lead">${t("rooms.no_room_hint")}</p>
              ${loose}`}`,
        "rooms-page",
      )}`;
  }

  /** A zone whose label was deleted in HA, or lights with its label that cannot join it. */
  private zoneNote(n: ZoneNote) {
    const { ctx } = this;
    const { t } = ctx;
    if (n.kind === "foreign") {
      return banner({ title: t("zones.foreign_title", { zone: n.name }), text: t("zones.foreign", { lights: names(ctx, n.lights ?? []) }), warn: true });
    }
    const relink = () => ctx.ws({ type: "hue_studio/zones/relink", zone: n.zone });
    const remove = () =>
      this.askDelete(t("zones.delete_note", { zone: n.name }), t("zone.delete"), () => {
        if (n.entity_id) void ctx.call("hue_studio", "delete_zone", { entity_id: n.entity_id }, { optimistic: false });
      });
    return banner({
      title: t("zones.unlinked_title", { zone: n.name }),
      text: t("zones.unlinked"),
      warn: true,
      buttons: ctx.hass.user?.is_admin
        ? html`<button class="pill" @click=${relink}>${t("zones.relink")}</button>
            ${n.entity_id ? html`<button class="pill" @click=${remove}>${t("zone.delete")}</button>` : nothing}`
        : undefined,
    });
  }

  /** The alignment preview, its options and the button that applies it. */
  private plan(plan: RoomsPlan | null) {
    const { ctx } = this;
    const { t } = ctx;
    if (!plan) return html`<p class="lead">${t(ctx.roomsUnavailable ? "rooms.unavailable" : "rooms.loading")}</p>`;
    const auto = html`<p class="lead small">
      ${ctx.config.auto_align ? t("rooms.auto_on") : t("rooms.auto_off")}
      <button class="text-link" @click=${() => ctx.go("/settings")}>${t("room.mapping")}</button>
    </p>`;
    if (!plan.changed && !plan.empty.length) {
      return html`<div class="rows">
          ${row("mdi:check-circle-outline", t("rooms.aligned"))}
          ${plan.rooms.map((r) => row(ctx.hass.areas?.[r.area]?.icon || "mdi:sofa-outline", r.name, this.onBridge(lightsCount(ctx, r.lights.length), r.bridge)))}
        </div>
        ${this.conflicts(plan)} ${auto}`;
    }
    const area = (id: string) => areaName(ctx, id);
    const target = (id: string) => plan.rooms.find((r) => r.area === id)?.name || area(id);
    // Split rooms whose scenes would lose lights: they can be kept in a zone.
    const splits = (plan.splits || []).filter((s) => s.scenes.length);
    const items: TemplateResult[] = [
      ...plan.rooms
        .filter((r) => r.create)
        .map((r) => row(ctx.hass.areas?.[r.area]?.icon || "mdi:plus", t("rooms.create", { name: r.name }), this.onBridge(lightsCount(ctx, r.lights.length), r.bridge))),
      ...plan.rooms
        .filter((r) => r.rename)
        .map((r) => row("mdi:form-textbox", t("rooms.rename", { from: r.current_name || "", to: r.name }))),
      ...plan.moves.map((m) =>
        row("mdi:arrow-right", t("rooms.move", { light: names(ctx, m.lights), from: m.from || t("rooms.no_hue_room"), to: target(m.area) })),
      ),
      ...plan.scenes.flatMap((s) => [
        ...(s.lost.length ? [row("mdi:palette-outline", t("rooms.scene_loses", { scene: s.name, room: s.group_name || "", lights: names(ctx, s.lost) }))] : []),
        ...(s.missing.length
          ? [row("mdi:palette-outline", t(this.completeScenes ? "rooms.scene_gets" : "rooms.scene_misses", { scene: s.name, lights: names(ctx, s.missing) }))]
          : []),
      ]),
      ...(this.keepSplit
        ? splits.map((s) => row("mdi:texture-box", t("rooms.split_zone", { zone: s.name, room: s.from }), scenesCount(ctx, s.scenes.length)))
        : []),
      ...plan.empty.map((e) =>
        row(this.deleteEmpty ? "mdi:delete-outline" : "mdi:home-off-outline", t("rooms.empty_room", { name: e.name }), t("rooms.empty_scenes", { count: e.scenes })),
      ),
    ];
    const hasMissing = plan.scenes.some((s) => s.missing.length);
    return html`<p class="lead">${t("rooms.intro")}</p>
      <div class="rows plan">${items}</div>
      ${this.conflicts(plan)}
      ${hasMissing || plan.empty.length || splits.length
        ? html`<div class="rows options">
            ${splits.length
              ? row("mdi:texture-box", t("rooms.keep_split"), t("rooms.keep_split_sub"),
                  toggle(this.keepSplit, t("rooms.keep_split"), () => (this.keepSplit = !this.keepSplit)))
              : nothing}
            ${hasMissing
              ? row("mdi:auto-fix", t("rooms.complete_scenes"), t("rooms.complete_scenes_sub"),
                  toggle(this.completeScenes, t("rooms.complete_scenes"), () => (this.completeScenes = !this.completeScenes)))
              : nothing}
            ${plan.empty.length
              ? row("mdi:delete-outline", t("rooms.delete_empty"), t("rooms.delete_empty_sub"),
                  toggle(this.deleteEmpty, t("rooms.delete_empty"), () => (this.deleteEmpty = !this.deleteEmpty)))
              : nothing}
          </div>`
        : nothing}
      <div class="center"><button class="pill apply" ?disabled=${this.busy} @click=${() => this.align()}>${t("rooms.align")}</button></div>
      ${auto}`;
  }

  /** "2 lights · Garden Bridge" with several bridges, else just the text. */
  private onBridge(text: string, bridge: string | null | undefined): string {
    const name = severalBridges(this.ctx.rooms) ? bridgeName(this.ctx.rooms, bridge) : null;
    return name ? `${text} · ${name}` : text;
  }

  /**
   * Areas with lights on several bridges. An area belongs to one bridge (each bridge is its
   * own Hue system), so each is listed with which lights are where.
   */
  private splitAreas(plan: RoomsPlan | null) {
    const { ctx } = this;
    const { t } = ctx;
    const split = Object.keys(plan?.split_areas || {});
    if (!split.length) return nothing;
    return html`<h2 class="label">${t("rooms.split_title")}</h2>
      <p class="lead">${t("rooms.split_hint")}</p>
      <div class="rows conflicts">
        ${split.map((area) => {
          const lights = ctx.home.rooms.find((r) => r.key === `area.${area}`)?.lights || [];
          const where = lightsByBridge(plan, lights).map(([bridge, ids]) => `${bridgeName(plan, bridge)}: ${names(ctx, ids)}`);
          return html`<button class="item" @click=${() => ctx.go(`/room/${encodeURIComponent(`area.${area}`)}`)}>
            <ha-icon icon="mdi:alert-outline"></ha-icon>
            <div class="grow">${areaName(ctx, area)}<div class="dim small">${where.join(" · ")}</div></div>
            <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
          </button>`;
        })}
      </div>`;
  }

  private conflicts(plan: RoomsPlan) {
    if (!plan.conflicts.length) return nothing;
    const { ctx } = this;
    return html`<div class="rows conflicts">
      ${plan.conflicts.map((light) => row("mdi:alert-outline", ctx.t("rooms.conflict", { light: friendlyName(ctx.hass, light) })))}
    </div>`;
  }

  private async align(): Promise<void> {
    const { ctx } = this;
    if (this.busy) return;
    this.busy = true;
    const data = { complete_scenes: this.completeScenes, delete_empty_rooms: this.deleteEmpty, keep_split_scenes: this.keepSplit };
    const ok = await ctx.call("hue_studio", "align_rooms", data, { optimistic: false });
    this.busy = false;
    if (ok) ctx.toast(ctx.t("rooms.aligned_done"));
  }

  private zoneRow(z: Zone) {
    const { ctx } = this;
    const meta = this.onBridge(
      ctx.t("rooms.zone_meta", { lights: lightsCount(ctx, z.lights.length), scenes: scenesCount(ctx, z.scenes) }),
      groupBridge(ctx.rooms, { lights: z.lights, group: z.entity_id }),
    );
    return html`<button class="item" @click=${() => ctx.go(`/rooms/zone/${encodeURIComponent(z.entity_id)}`)}>
      <ha-icon icon=${hueGroupIcon(ctx.hass, ctx.config, z.entity_id)}></ha-icon>
      <div class="grow">${z.name}<div class="dim small">${meta}</div></div>
      <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
    </button>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-rooms-view": RoomsView;
  }
}
