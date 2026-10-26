// Settings → Integration settings: everything of the integration's options in the panel.
// Rooms follow areas; our scenes and automations organized in HA's lists; which area each
// Hue room or zone belongs to; the sensors of each room. Adding or pairing a Sync Box stays
// on HA's integration page (a link); bridges come from the Philips Hue integration by
// themselves.

import { html } from "lit";
import { customElement } from "lit/decorators.js";

import { allGroups, friendlyName, type Group, hueGroupIcon, isHueGroup } from "../model.ts";
import type { StringKey } from "../i18n.ts";
import type { RoomSensors } from "../types.ts";
import { icon, toggle } from "../ui.ts";
import { StudioView } from "./base.ts";
import { navRow, single } from "./choice.ts";

const MOTION_CLASSES = ["motion", "occupancy", "presence"];
type SensorKind = keyof RoomSensors;
const KINDS: [SensorKind, string, (id: string, cls: string | undefined) => boolean][] = [
  ["motion", "mdi:motion-sensor", (id, cls) => id.startsWith("binary_sensor.") && MOTION_CLASSES.includes(cls || "")],
  ["temperature", "mdi:thermometer", (id, cls) => id.startsWith("sensor.") && cls === "temperature"],
  ["illuminance", "mdi:brightness-5", (id, cls) => id.startsWith("sensor.") && cls === "illuminance"],
];

@customElement("hue-studio-integration-view")
export class IntegrationView extends StudioView {
  protected override renderPage() {
    const { ctx } = this;
    const { t } = ctx;
    const autoAlign = !!ctx.config.auto_align;
    const organize = ctx.config.organize !== false;
    const zoneLabels = !!ctx.config.zone_labels;
    return this.screen(
      this.subHead(t("settings.integration"), () => ctx.go("/settings")),
      html`<div class="rows">
          <div class="item">
            <ha-icon icon="mdi:sync"></ha-icon>
            <div class="grow">${t("settings.auto_align")}<div class="dim small">${t("settings.auto_align_sub")}</div></div>
            ${toggle(autoAlign, t("settings.auto_align"), () => ctx.setConfig({ auto_align: !autoAlign }))}
          </div>
          <div class="item">
            <ha-icon icon="mdi:label-outline"></ha-icon>
            <div class="grow">${t("settings.organize")}<div class="dim small">${t("settings.organize_sub")}</div></div>
            ${toggle(organize, t("settings.organize"), () => ctx.setConfig({ organize: !organize }))}
          </div>
          <div class="item">
            <ha-icon icon="mdi:texture-box"></ha-icon>
            <div class="grow">${t("settings.zone_labels")}<div class="dim small">${t("settings.zone_labels_sub")}</div></div>
            ${toggle(zoneLabels, t("settings.zone_labels"), () => ctx.setConfig({ zone_labels: !zoneLabels }))}
          </div>
        </div>
        <h2 class="label">${t("integ.groups")}</h2>
        <p class="lead">${t("integ.groups_hint")}</p>
        ${this.groups()}
        <h2 class="label">${t("integ.sensors")}</h2>
        <p class="lead">${t("integ.sensors_hint")}</p>
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
        const isRoom = ctx.hass.states[id].attributes.hue_type === "room";
        const name = friendlyName(ctx.hass, id);
        const label = (v: string) => (v === "auto" ? autoLabel : v === "zone" ? t("integ.own_zone") : ctx.hass.areas?.[v]?.name || v);
        const options = [
          { value: "auto", label: autoLabel, icon: "mdi:auto-fix" },
          ...areas.map(([aid, a]) => ({ value: aid, label: a.name, icon: a.icon || "mdi:sofa-outline" })),
          { value: "zone", label: t("integ.own_zone"), icon: "mdi:texture-box" },
        ];
        return navRow({ icon: hueGroupIcon(ctx.hass, ctx.config, id), title: name, sub: `${t(isRoom ? "integ.hue_room" : "integ.hue_zone")} · ${label(current)}` }, () =>
          this.choose(single(name, options, current, (v) => set(id, v), t("integ.groups_hint"))),
        );
      })}
    </div>`;
  }

  /** A room's motion, temperature and light sensors (defaults: its Hue sensors), on a screen of its own. */
  private roomSensors(g: Group) {
    const { ctx } = this;
    const { t } = ctx;
    const custom = !!ctx.config.rooms[g.key];
    const summary = KINDS.map(([kind]) => g.sensors[kind].length).reduce((a, b) => a + b, 0);
    const ids = Object.keys(ctx.hass.states).sort((a, b) => friendlyName(ctx.hass, a).localeCompare(friendlyName(ctx.hass, b)));
    const save = (sensors: RoomSensors | null) => ctx.ws({ type: "hue_studio/config/set_room_sensors", room: g.key, ...(sensors ?? {}) });
    const set = (kind: SensorKind, values: string[]) => {
      // The room as it is now: the other kinds may have changed since the screen opened.
      const now = allGroups(ctx.home).find((x) => x.key === g.key)?.sensors ?? g.sensors;
      save({ motion: [...now.motion], temperature: [...now.temperature], illuminance: [...now.illuminance], [kind]: values });
    };
    const open = () =>
      this.choose({
        title: g.name,
        hint: t("integ.sensors_hint"),
        screen: true,
        lists: KINDS.map(([kind, glyph, fits]) => {
          const options = ids.filter((id) => fits(id, ctx.hass.states[id].attributes.device_class));
          return {
            label: t(`integ.kind_${kind}` as StringKey),
            hint: options.length ? undefined : t("integ.no_sensors"),
            options: options.map((id) => ({ value: id, label: friendlyName(ctx.hass, id), icon: glyph })),
            selected: g.sensors[kind],
            multi: true,
            pick: (values: string[]) => set(kind, values),
          };
        }),
        action: custom ? { label: t("integ.sensors_reset"), run: () => void save(null) } : undefined,
      });
    return navRow({ icon: g.icon, title: g.name, sub: t(custom ? "integ.sensors_custom" : "integ.sensors_default", { count: summary }) }, open);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-integration-view": IntegrationView;
  }
}
