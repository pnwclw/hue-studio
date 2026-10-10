// Rooms and zones: how the Hue rooms on the bridge differ from the HA areas (and aligning
// them), the Hue zones with an editor, and Hue lights that have no area yet.
// Areas are Home Assistant's truth; rooms on the bridge follow them (hue_studio.align_rooms).

import { html, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import type { StudioContext } from "../context.ts";
import { friendlyName, lightIcon } from "../model.ts";
import { hueZones, lightsByArea, lightsWithoutArea, type Zone } from "../rooms.ts";
import type { RoomsPlan } from "../types.ts";
import { icon, toggle } from "../ui.ts";
import { StudioView } from "./base.ts";

/** The zone editor: an existing zone (entity id) or a new one (null). */
interface ZoneDraft {
  zone: string | null;
  name: string;
  lights: string[];
  confirmDelete: boolean;
}

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
export function noRoomRows(ctx: StudioContext): TemplateResult | typeof nothing {
  const lights = lightsWithoutArea(ctx.hass);
  if (!lights.length) return nothing;
  const areas = Object.entries(ctx.hass.areas || {}).sort(([, a], [, b]) => a.name.localeCompare(b.name));
  const pick = async (light: string, e: Event) => {
    const area = (e.target as HTMLSelectElement).value;
    if (area && (await ctx.setArea(light, area))) {
      ctx.toast(ctx.t("rooms.area_set", { light: friendlyName(ctx.hass, light), area: areaName(ctx, area) }));
    }
  };
  return html`<div class="rows no-room">
    ${lights.map((light) => {
      const hueRoom = ctx.rooms?.hue_rooms[light];
      return row(
        lightIcon(ctx.hass, light, ctx.lightInfo[light]),
        friendlyName(ctx.hass, light),
        hueRoom ? ctx.t("rooms.in_hue", { room: hueRoom }) : nothing,
        html`<select class="select" aria-label=${ctx.t("rooms.pick_area")} @change=${(e: Event) => pick(light, e)}>
          <option value="">${ctx.t("rooms.pick_area")}</option>
          ${areas.map(([id, area]) => html`<option value=${id}>${area.name}</option>`)}
        </select>`,
      );
    })}
  </div>`;
}

@customElement("hue-studio-rooms-view")
export class RoomsView extends StudioView {
  @state() private accessor completeScenes = true;
  @state() private accessor deleteEmpty = false;
  @state() private accessor busy = false;
  @state() private accessor draft: ZoneDraft | null = null;

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const zones = hueZones(ctx.hass);
    const loose = noRoomRows(ctx);
    return html`<div class="page rooms-page">
        <div class="topbar">
          <button class="round back" aria-label=${t("common.back")} @click=${() => ctx.go("")}>${icon("back")}</button>
          <div class="grow"></div>
        </div>
        <h1 class="big">${t("rooms.title")}</h1>
        <h2 class="label">${t("rooms.bridge")}</h2>
        ${this.plan(ctx.rooms)}
        <h2 class="label">${t("rooms.zones")}</h2>
        <p class="lead">${t("rooms.zones_hint")}</p>
        <div class="rows zones">
          ${zones.map((z) => this.zoneRow(z))}
          <button class="item" @click=${() => this.edit(null)}>
            <ha-icon icon="mdi:plus"></ha-icon><div class="grow">${t("rooms.new_zone")}</div>
          </button>
        </div>
        ${loose === nothing
          ? nothing
          : html`<h2 class="label">${t("home.no_room")}</h2>
              <p class="lead">${t("rooms.no_room_hint")}</p>
              ${loose}`}
      </div>
      ${this.draft ? this.editor(this.draft) : nothing}`;
  }

  /** The alignment preview, its options and the button that applies it. */
  private plan(plan: RoomsPlan | null) {
    const { ctx } = this;
    const { t } = ctx;
    if (!plan) return html`<p class="lead">${t(ctx.roomsUnavailable ? "rooms.unavailable" : "rooms.loading")}</p>`;
    const auto = html`<p class="lead small">
      ${ctx.config.auto_align ? t("rooms.auto_on") : t("rooms.auto_off")}
      <button class="text-link" @click=${() => ctx.openSettings()}>${t("room.mapping")}</button>
    </p>`;
    if (!plan.changed && !plan.empty.length) {
      return html`<div class="rows">
          ${row("mdi:check-circle-outline", t("rooms.aligned"))}
          ${plan.rooms.map((r) => row(ctx.hass.areas?.[r.area]?.icon || "mdi:sofa-outline", r.name, lightsCount(ctx, r.lights.length)))}
        </div>
        ${this.conflicts(plan)} ${auto}`;
    }
    const area = (id: string) => areaName(ctx, id);
    const target = (id: string) => plan.rooms.find((r) => r.area === id)?.name || area(id);
    const items: TemplateResult[] = [
      ...plan.rooms
        .filter((r) => r.create)
        .map((r) => row(ctx.hass.areas?.[r.area]?.icon || "mdi:plus", t("rooms.create", { name: r.name }), lightsCount(ctx, r.lights.length))),
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
      ...plan.empty.map((e) =>
        row(this.deleteEmpty ? "mdi:delete-outline" : "mdi:home-off-outline", t("rooms.empty_room", { name: e.name }), t("rooms.empty_scenes", { count: e.scenes })),
      ),
    ];
    const hasMissing = plan.scenes.some((s) => s.missing.length);
    return html`<p class="lead">${t("rooms.intro")}</p>
      <div class="rows plan">${items}</div>
      ${this.conflicts(plan)}
      ${hasMissing || plan.empty.length
        ? html`<div class="rows options">
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
      <div class="center"><button class="pill go" ?disabled=${this.busy} @click=${() => this.align()}>${t("rooms.align")}</button></div>
      ${auto}`;
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
    const data = { complete_scenes: this.completeScenes, delete_empty_rooms: this.deleteEmpty };
    const ok = await ctx.call("hue_studio", "align_rooms", data, { optimistic: false });
    this.busy = false;
    if (ok) ctx.toast(ctx.t("rooms.aligned_done"));
  }

  private zoneRow(z: Zone) {
    const { ctx } = this;
    const meta = ctx.t("rooms.zone_meta", { lights: lightsCount(ctx, z.lights.length), scenes: ctx.t("rooms.scenes_count", { count: z.scenes }) });
    return html`<button class="item" @click=${() => this.edit(z)}>
      <ha-icon icon="mdi:texture-box"></ha-icon>
      <div class="grow">${z.name}<div class="dim small">${meta}</div></div>
      <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
    </button>`;
  }

  private edit(zone: Zone | null): void {
    this.draft = { zone: zone?.entity_id ?? null, name: zone?.name ?? "", lights: zone ? [...zone.lights] : [], confirmDelete: false };
    this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".sheet input")?.focus());
  }

  /** Name and lights of a zone; saved to the bridge at once (create_zone / update_zone). */
  private editor(draft: ZoneDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const close = () => (this.draft = null);
    const zone = draft.zone ? hueZones(ctx.hass).find((z) => z.entity_id === draft.zone) : undefined;
    const name = draft.name.trim();
    // Read the current draft, not this render's: two taps may come before the next render.
    const set = (patch: Partial<ZoneDraft>) => (this.draft = { ...this.draft!, ...patch, confirmDelete: false });
    const flip = (light: string) => {
      const lights = this.draft!.lights;
      set({ lights: lights.includes(light) ? lights.filter((l) => l !== light) : [...lights, light] });
    };
    const save = async () => {
      if (!name || !draft.lights.length || this.busy) return;
      this.busy = true;
      const ok = draft.zone
        ? await ctx.call("hue_studio", "update_zone", { entity_id: draft.zone, name, lights: draft.lights }, { optimistic: false })
        : await ctx.call("hue_studio", "create_zone", { entity_id: draft.lights, name }, { optimistic: false });
      this.busy = false;
      if (ok) {
        close();
        ctx.toast(t("zone.saved", { name }));
      }
    };
    const remove = async () => {
      if (!draft.zone || this.busy) return;
      if (!this.draft?.confirmDelete) {
        this.draft = { ...draft, confirmDelete: true };
        return;
      }
      this.busy = true;
      const ok = await ctx.call("hue_studio", "delete_zone", { entity_id: draft.zone }, { optimistic: false });
      this.busy = false;
      if (ok) {
        close();
        ctx.toast(t("zone.deleted", { name: zone?.name || name }));
      }
    };
    return html`<div class="sheet" @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="box form zone-editor" role="dialog" aria-label=${draft.zone ? t("zone.title_edit") : t("zone.title_new")}>
        <div class="sheet-bar"><div class="grow">${draft.zone ? t("zone.title_edit") : t("zone.title_new")}</div>
          <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
        </div>
        <div class="form-body">
          <input
            class="field"
            maxlength="32"
            placeholder=${t("zone.name")}
            aria-label=${t("zone.name")}
            .value=${draft.name}
            @input=${(e: InputEvent) => set({ name: (e.target as HTMLInputElement).value })}
          />
        </div>
        ${lightsByArea(ctx.hass).map(
          ([area, lights]) => html`<h2 class="label">${area ? areaName(ctx, area) : t("home.no_room")}</h2>
            <div class="rows pick">
              ${lights.map(
                (light) => html`<button class=${classMap({ item: true, on: draft.lights.includes(light) })} role="checkbox"
                  aria-checked=${draft.lights.includes(light)} @click=${() => flip(light)}>
                  <ha-icon icon=${lightIcon(ctx.hass, light, ctx.lightInfo[light])}></ha-icon>
                  <div class="grow">${friendlyName(ctx.hass, light)}</div>
                  <span class="check">${icon("check")}</span>
                </button>`,
              )}
            </div>`,
        )}
        <div class="actions">
          <button class="pill apply" ?disabled=${!name || !draft.lights.length || this.busy} @click=${save}>${t("zone.save")}</button>
          ${draft.zone
            ? html`<button class=${classMap({ pill: true, reset: true, danger: true, confirm: draft.confirmDelete })} ?disabled=${this.busy} @click=${remove}>
                  ${draft.confirmDelete ? t("zone.delete_confirm") : t("zone.delete")}
                </button>
                ${zone?.scenes ? html`<div class="target">${t("zone.delete_hint", { count: zone.scenes })}</div>` : nothing}`
            : nothing}
        </div>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-rooms-view": RoomsView;
  }
}
