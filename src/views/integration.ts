// Settings → Integration settings: everything of the integration's options in the panel.
// Rooms follow areas; which area each Hue room or zone belongs to; the sensors of each
// room. Adding or pairing a Sync Box stays on HA's integration page (a link); bridges come
// from the Philips Hue integration by themselves.

import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import { allGroups, friendlyName, type Group, isHueGroup } from "../model.ts";
import type { StringKey } from "../i18n.ts";
import type { RoomSensors } from "../types.ts";
import { icon, toggle } from "../ui.ts";
import { StudioView } from "./base.ts";

const MOTION_CLASSES = ["motion", "occupancy", "presence"];
type SensorKind = keyof RoomSensors;
const KINDS: [SensorKind, string, (id: string, cls: string | undefined) => boolean][] = [
  ["motion", "mdi:motion-sensor", (id, cls) => id.startsWith("binary_sensor.") && MOTION_CLASSES.includes(cls || "")],
  ["temperature", "mdi:thermometer", (id, cls) => id.startsWith("sensor.") && cls === "temperature"],
  ["illuminance", "mdi:brightness-5", (id, cls) => id.startsWith("sensor.") && cls === "illuminance"],
];

@customElement("hue-studio-integration-view")
export class IntegrationView extends StudioView {
  /** The room whose sensors are being edited. */
  @state() private accessor open: string | null = null;

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const autoAlign = !!ctx.config.auto_align;
    return this.screen(
      this.subHead(t("settings.integration"), () => ctx.go("/settings")),
      html`<div class="rows">
          <div class="item">
            <ha-icon icon="mdi:sync"></ha-icon>
            <div class="grow">${t("settings.auto_align")}<div class="dim small">${t("settings.auto_align_sub")}</div></div>
            ${toggle(autoAlign, t("settings.auto_align"), () => ctx.setConfig({ auto_align: !autoAlign }))}
          </div>
        </div>
        <h2 class="label">${t("integ.groups")}</h2>
        <p class="lead small">${t("integ.groups_hint")}</p>
        ${this.groups()}
        <h2 class="label">${t("integ.sensors")}</h2>
        <p class="lead small">${t("integ.sensors_hint")}</p>
        <div class="rows">${allGroups(ctx.home).map((g) => this.roomSensors(g))}</div>
        <h2 class="label">${t("integ.more")}</h2>
        <div class="rows">
          <button class="item" @click=${() => ctx.openSettings()}>
            <ha-icon icon="mdi:puzzle-outline"></ha-icon>
            <div class="grow">${t("integ.ha_page")}<div class="dim small">${t("integ.ha_page_sub")}</div></div>
            ${icon("open")}
          </button>
        </div>`,
      "settings-page",
    );
  }

  /** Each Hue room or zone with the area it belongs to (automatic, an area, or a zone of its own). */
  private groups() {
    const { ctx } = this;
    const { t } = ctx;
    const groups = Object.keys(ctx.hass.states)
      .filter((id) => isHueGroup(ctx.hass, id))
      .sort((a, b) => friendlyName(ctx.hass, a).localeCompare(friendlyName(ctx.hass, b)));
    const areas = Object.entries(ctx.hass.areas || {}).sort(([, a], [, b]) => a.name.localeCompare(b.name));
    const set = (entity_id: string, value: string) =>
      ctx.ws({ type: "hue_studio/config/set_group", entity_id, area_id: value === "zone" ? null : value });
    return html`<div class="rows">
      ${groups.map((id) => {
        const stored = ctx.config.groups[id];
        const room = ctx.home.rooms.find((r) => r.group === id);
        const current = stored ?? "auto";
        const autoLabel = stored ? t("integ.auto") : room ? t("integ.auto_area", { area: room.name }) : t("integ.auto_zone");
        const type = ctx.hass.states[id].attributes.hue_type === "room" ? t("integ.hue_room") : t("integ.hue_zone");
        return html`<div class="item wrap group-row">
          <ha-icon icon=${ctx.hass.states[id].attributes.hue_type === "room" ? "mdi:home-outline" : "mdi:texture-box"}></ha-icon>
          <div class="grow">${friendlyName(ctx.hass, id)}<div class="dim small">${type}</div></div>
          <select class="select" aria-label=${friendlyName(ctx.hass, id)} @change=${(e: Event) => set(id, (e.target as HTMLSelectElement).value)}>
            <option value="auto" ?selected=${current === "auto"}>${autoLabel}</option>
            ${areas.map(([aid, a]) => html`<option value=${aid} ?selected=${current === aid}>${a.name}</option>`)}
            <option value="zone" ?selected=${current === "zone"}>${t("integ.own_zone")}</option>
          </select>
        </div>`;
      })}
    </div>`;
  }

  /** A room's motion, temperature and light sensors (defaults: its Hue sensors). */
  private roomSensors(g: Group) {
    const { ctx } = this;
    const { t } = ctx;
    const isOpen = this.open === g.key;
    const custom = !!ctx.config.rooms[g.key];
    const summary = KINDS.map(([kind]) => g.sensors[kind].length).reduce((a, b) => a + b, 0);
    const ids = Object.keys(ctx.hass.states).sort((a, b) => friendlyName(ctx.hass, a).localeCompare(friendlyName(ctx.hass, b)));
    const save = (sensors: RoomSensors | null) =>
      ctx.ws({ type: "hue_studio/config/set_room_sensors", room: g.key, ...(sensors ?? {}) });
    const flip = (kind: SensorKind, id: string) => {
      const next: RoomSensors = { motion: [...g.sensors.motion], temperature: [...g.sensors.temperature], illuminance: [...g.sensors.illuminance] };
      next[kind] = next[kind].includes(id) ? next[kind].filter((s) => s !== id) : [...next[kind], id];
      save(next);
    };
    return html`<div class=${classMap({ "device-card": true, open: isOpen })}>
      <button class="item" aria-expanded=${isOpen} @click=${() => (this.open = isOpen ? null : g.key)}>
        <ha-icon icon=${g.icon}></ha-icon>
        <div class="grow">${g.name}<div class="dim small">${t(custom ? "integ.sensors_custom" : "integ.sensors_default", { count: summary })}</div></div>
        <ha-icon class="chevron" icon=${isOpen ? "mdi:chevron-up" : "mdi:chevron-down"}></ha-icon>
      </button>
      ${isOpen
        ? html`<div class="device-form">
            ${KINDS.map(([kind, glyph, fits]) => {
              const options = ids.filter((id) => fits(id, ctx.hass.states[id].attributes.device_class));
              return html`<div class="dim small sensor-kind"><ha-icon icon=${glyph}></ha-icon>${t(`integ.kind_${kind}` as StringKey)}</div>
                <div class="chips wrap">
                  ${options.length
                    ? options.map(
                        (id) => html`<button class=${classMap({ chip: true, on: g.sensors[kind].includes(id) })} @click=${() => flip(kind, id)}>
                          ${friendlyName(ctx.hass, id)}
                        </button>`,
                      )
                    : html`<span class="dim small">${t("integ.no_sensors")}</span>`}
                </div>`;
            })}
            ${custom ? html`<div class="actions"><button class="pill" @click=${() => save(null)}>${t("integ.sensors_reset")}</button></div>` : nothing}
          </div>`
        : nothing}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-integration-view": IntegrationView;
  }
}
