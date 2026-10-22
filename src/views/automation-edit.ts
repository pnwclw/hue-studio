// One automation, edited like in the Hue app: its name, when (per type), rooms/zones and light.
// Natural light and the scene of the day have a second page with what this automation adds to
// the global light of the day (Settings → Light of the day): extra and skipped scenes, its own
// phase times, brightness, the white of each phase; everything stays a draft until "Save"
// writes the automation into Home Assistant (HA's automation config API), which stores and
// runs it.

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import {
  allDayDraft,
  areaFor,
  type AutomationDraft,
  daysLine,
  type Duration,
  type EndKind,
  fromConfig,
  hhmm,
  isType,
  missing,
  momentLine,
  newDraft,
  offsetDuration,
  placesOf,
  offsetMinutes,
  type StartKind,
  toConfig,
  TYPE_ICONS,
  WEEKDAYS,
  type Weekday,
} from "../automations.ts";
import { isLegacy, splitLegacy } from "../daylight.ts";
import { haptic, inCompanionApp, leavePanel, openAppSettings } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import { findGroup, friendlyName } from "../model.ts";
import { banner } from "../controls.ts";
import { type PresenceCheck, presenceCheck, presenceReady } from "../presence.ts";
import { icon, toggle } from "../ui.ts";
import { AutomationParts } from "./automation-parts.ts";
import { type MomentKind, momentChoice, navRow, several, single, timeWheels } from "./choice.ts";

/** Minutes before (−) or after sunrise or sunset. */
const OFFSETS = [-120, -90, -60, -45, -30, -20, -15, -10, -5, 0, 5, 10, 15, 20, 30, 45, 60, 90, 120];

@customElement("hue-studio-automation-edit-view")
export class AutomationEditView extends AutomationParts {
  /** The config id of the automation, or null for a new one (`newType`). */
  @property() accessor automationId: string | null = null;
  @property() accessor newType: string | null = null;
  /** The room or zone a new automation starts with (a group key, or an area id), from its screen. */
  @property() accessor room: string | null = null;
  /** `all_day`: a new all-day scene (a schedule showing the scene of the day). */
  @property() accessor preset: string | null = null;
  /** A new motion automation started from a sensor's settings: its motion and light level sensors. */
  @property() accessor sensor: string | null = null;
  @property() accessor lux: string | null = null;
  /** Where "back" and saving leave the panel for (the page its more-info sheet was on). */
  @property() accessor exitPath: string | null = null;

  @state() private accessor confirmDelete = false;
  @state() private accessor saving = false;
  @state() private accessor editingName = false;
  /** "On certain days" switched on while every day is still chosen. */
  @state() private accessor someDays = false;

  private get isNew(): boolean {
    return !this.automationId;
  }

  /** The group key of `room` (dashboards' cards pass a bare area id). */
  private get roomKey(): string | null {
    return this.room ? (this.room.includes(".") ? this.room : `area.${this.room}`) : null;
  }

  /** Where "back" and saving lead: the page or the room or zone it came from, else the tab. */
  private leave(): void {
    if (this.exitPath) return leavePanel(this.exitPath);
    const key = this.roomKey;
    this.ctx.go(key && findGroup(this.ctx.home, key) ? `/room/${encodeURIComponent(key)}` : "/automations");
  }

  protected override willUpdate(): void {
    if (this.draft) return;
    const { ctx } = this;
    if (this.newType && isType(this.newType)) {
      const key = this.roomKey;
      const places = key && findGroup(ctx.home, key) ? [key] : [];
      this.draft =
        this.preset === "all_day" && this.newType === "schedule"
          ? allDayDraft(ctx.t("add.all_day"), places)
          : newDraft(this.newType, ctx.t(`automations.type_${this.newType}` as StringKey), places);
      if (this.newType === "motion" && this.sensor && ctx.hass.states[this.sensor]) {
        const lux = this.lux && ctx.hass.states[this.lux] ? { lux_sensor: this.lux } : {};
        this.draft = { ...this.draft, input: { ...this.draft.input, motion: [this.sensor], ...lux } };
      }
    } else if (this.automationId) {
      const entity = ctx.automationEntity(this.automationId);
      const config = entity ? ctx.automationConfigs[entity] : undefined;
      if (config) this.draft = fromConfig(config);
      // From before 0.10: its pools go global (the context moves them), the rest stays.
      const day = this.draft?.input.scene_of_the_day;
      if (this.draft && isLegacy(day)) this.draft = { ...this.draft, input: { ...this.draft.input, scene_of_the_day: splitLegacy(day!).local } };
    }
  }

  protected override renderPage() {
    const { ctx } = this;
    const { t } = ctx;
    const d = this.draft;
    const back = () => (this.page === "day" ? this.leaveDay() : this.leave());
    if (!d) {
      const entity = this.automationId ? ctx.automationEntity(this.automationId) : null;
      const loading = !ctx.automations || (entity && ctx.automationConfigsRead !== ctx.automations);
      if (loading || !entity || !this.automationId)
        return this.screen(this.subHead(t("automations.title"), back), html`<p class="empty">${t(loading ? "rooms.loading" : "automations.not_found")}</p>`);
      // It exists, but its config can't be read here (not an admin, or kept outside HA's automations.yaml).
      const id = this.automationId;
      return this.screen(
        this.subHead(friendlyName(ctx.hass, entity), back),
        html`<p class="empty">${t("automations.not_readable")}</p>
          <div class="center"><button class="pill" @click=${() => ctx.openHa(`/config/automation/edit/${encodeURIComponent(id)}`)}>${t("automations.open_ha")}</button></div>`,
        "settings-page automation-page",
      );
    }
    if (this.page === "day") return this.dayScreen();
    const typeName = t(`automations.type_${d.type}` as StringKey);
    // Arriving and leaving rely on HA knowing who is home: a new one waits until it does.
    const presence = d.type === "coming_home" || d.type === "leaving_home" ? presenceCheck(ctx.hass, ctx.hass.user?.id) : null;
    const unready = !!presence && !presenceReady(presence, inCompanionApp(ctx.hass));
    const lacking = missing(d) || (unready && this.isNew ? "presence" : null);
    // Like the Hue app's editor: what it is in the header with "Save", the name once below.
    const save = html`<button class="pill save" ?disabled=${!!lacking || this.saving} @click=${() => this.save()}>
      ${t(this.isNew ? "automations.create" : "zone.save")}
    </button>`;
    return html`${this.screen(
      this.subHead(t(this.isNew ? "automations.new" : "automations.edit"), back, save),
      unready && this.isNew
        ? html`${this.hero(d, typeName)}${this.presenceSetup(d, presence!)}`
        : html`${this.hero(d, typeName)}
        ${unready ? this.presenceSetup(d, presence!) : nothing}
        ${d.type === "wake_up" ? html`<h2 class="label">${t("automations.time")}</h2>` : d.type === "go_to_sleep" ? nothing : html`<h2 class="label">${t("automations.when")}</h2>`}
        ${this.when(d)}
        ${this.selectedLights(d)}
        ${this.general(d)}
        ${d.type === "go_to_sleep" ? this.controlledBy(d) : nothing}
        ${lacking && lacking !== "rooms" && lacking !== "presence" /* those say so themselves */
          ? html`<p class="hint warn">${t(`automations.missing_${lacking}` as StringKey)}</p>`
          : nothing}
        ${this.isNew
          ? nothing
          : html`<h2 class="label">${t("automations.more")}</h2>
              <div class="rows">
                <button class="item nav" @click=${() => ctx.openHa(`/config/automation/edit/${encodeURIComponent(d.id)}`)}>
                  <ha-icon icon="mdi:home-assistant"></ha-icon><div class="grow">${t("automations.open_ha")}</div>${icon("open")}
                </button>
              </div>
              <div class="delete-area">
                <button class=${classMap({ "delete-btn": true, confirm: this.confirmDelete })} @click=${() => this.deleteIt()}>
                  ${t(this.confirmDelete ? "automations.delete_confirm" : "automations.delete")}
                </button>
              </div>`}`,
      "settings-page automation-page",
    )}
    ${this.partSheets(d)}`;
  }

  /** Its picture and name (renamed in place), and its type when the name is another. */
  private hero(d: AutomationDraft, typeName: string) {
    const { t } = this.ctx;
    const done = (e: Event) => {
      this.editingName = false;
      const alias = (e.target as HTMLInputElement).value.trim();
      if (alias !== d.alias) this.draft = { ...d, alias };
    };
    return html`<div class="sensor-hero automation-hero">
      <ha-icon class="type-icon" icon=${TYPE_ICONS[d.type]}></ha-icon>
      <div class="name-row">
        ${this.editingName || !d.alias
          ? html`<input class="name-input" .value=${d.alias} placeholder=${t("automations.name")} aria-label=${t("automations.name")}
              @keydown=${(e: KeyboardEvent) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} @blur=${done}
              @input=${(e: InputEvent) => (this.draft = { ...d, alias: (e.target as HTMLInputElement).value })} />`
          : html`<h1 class="big">${d.alias}</h1>`}
        <button class="round rename" aria-label=${t("automations.rename")} @click=${() => {
          this.editingName = true;
          void this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".name-input")?.focus());
        }}>${icon("pencil")}</button>
      </div>
      ${d.alias && d.alias !== typeName ? html`<div class="kind">${typeName}</div>` : nothing}
    </div>`;
  }

  // ---- saving ----

  private async save(): Promise<void> {
    const { ctx } = this;
    const d = this.draft;
    if (!d || missing(d)) return;
    this.saving = true;
    const description = ctx.t("automations.description", { url: `/hue/automations/${d.id}` });
    const ok = await ctx.saveAutomation(toConfig(d, description), areaFor(d));
    this.saving = false;
    if (ok) {
      haptic("success");
      this.leave();
    }
  }

  private async deleteIt(): Promise<void> {
    if (!this.confirmDelete) {
      this.confirmDelete = true;
      haptic("warning");
      return;
    }
    if (!(await this.ctx.deleteAutomation(this.draft!.id))) return;
    if (this.exitPath) leavePanel(this.exitPath);
    else this.ctx.go("/automations");
  }

  // ---- rows ----

  /** A time of day on its wheels in place, like the Hue app's editor. */
  private time(title: string, value: string | undefined, change: (v: string) => void) {
    return html`<div class="item time-item">
      <div class="grow">${title}</div>
      ${timeWheels(hhmm(value) || "00:00", (v) => change(`${v}:00`))}
    </div>`;
  }

  /** Going to sleep now, as the editor has it (also before it is saved): the lights dim to off. */
  private startNow(d: AutomationDraft): void {
    const { rooms, zones = [] } = d.input;
    haptic("success");
    void this.ctx.call(
      "hue_studio",
      "apply_light",
      { area_id: rooms, entity_id: zones, light: "off", transition: (d.input.fade ?? 0) * 60 },
      { optimistic: false },
    );
  }

  /**
   * What arriving and leaving need from HA, like a checklist: the home's location, people
   * whose phone shares its location all the time, and (in the companion app) this phone.
   */
  private presenceSetup(d: AutomationDraft, check: PresenceCheck) {
    const { ctx } = this;
    const { t } = ctx;
    const inApp = inCompanionApp(ctx.hass);
    const ok = html`<span class="check-ok" aria-label=${t("presence.ok")}>${icon("check")}</span>`;
    const setUp = (path: string) => html`<button class="pill" @click=${() => ctx.openHa(path)}>${t("presence.set_up")}</button>`;
    const radius = Math.round(Number(ctx.hass.states["zone.home"]?.attributes.radius) || 0);
    const phoneLine = (p: PresenceCheck["people"][number]["phones"][number]) =>
      t(
        p.issue === "permission"
          ? /in use/i.test(p.permission || "") ? "presence.permission" : "presence.denied"
          : p.issue === "no_location" ? "presence.no_location" : "presence.phone_ok",
        { phone: p.name },
      );
    const me = check.me;
    const meBlocked = inApp && !!me && !(me.ok && me.phones.every((p) => p.issue !== "permission"));
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    return html`${banner({ title: t("presence.title"), text: t(d.type === "coming_home" ? "presence.text_coming" : "presence.text_leaving"), warn: true })}
      <div class="rows presence-rows">
        <div class="item">
          <div class="grow">${t("presence.home")}<div class=${classMap({ "dim small": true, warn: !check.home })}>
            ${check.home ? t("presence.home_ok", { radius }) : t("presence.home_missing")}</div></div>
          ${check.home ? ok : setUp("/config/zone")}
        </div>
        ${check.people.length
          ? check.people.map(
              (p) => html`<div class="item">
                <div class="grow">${p.name}<div class=${classMap({ "dim small": true, warn: !p.ok })}>${p.phones.map(phoneLine).join(" · ")}</div></div>
                ${p.ok ? ok : html`<ha-icon class="check-warn" icon="mdi:alert-circle-outline"></ha-icon>`}
              </div>`,
            )
          : html`<div class="item">
              <div class="grow">${t("presence.people")}<div class="dim small warn">${t("presence.no_people")}</div></div>
              ${setUp("/config/person")}
            </div>`}
        ${meBlocked
          ? html`<div class="item">
              <div class="grow">${t("presence.this_phone")}<div class="dim small warn">${t("presence.this_phone_sub")}</div></div>
              <button class="pill" @click=${() => openAppSettings(ctx.hass)}>${t("presence.open_app")}</button>
            </div>`
          : nothing}
      </div>
      ${meBlocked ? html`<p class="hint">${t(ios ? "presence.ios_hint" : "presence.android_hint")}</p>` : nothing}`;
  }

  /** Wheels in place, under the row that says what they choose. */
  private wheelsItem(wheels: unknown) {
    return html`<div class="item time-item">${wheels}</div>`;
  }

  /** Waking up with sunrise: minutes before or after it on one wheel. */
  private sunriseWheel(d: AutomationDraft) {
    const minutes = offsetMinutes(d.input.start_offset);
    const values = OFFSETS.includes(minutes) ? OFFSETS : [...OFFSETS, minutes].sort((a, b) => a - b);
    const options = values.map((v) => ({ value: String(v), label: this.offsetLabel("sunrise", v) }));
    return this.wheelsItem(
      html`<div class="wheels"><hue-studio-wheel .options=${options} .value=${String(minutes)}
        .change=${(v: string) => this.set({ start_offset: offsetDuration(Number(v)) })}></hue-studio-wheel></div>`,
    );
  }

  /** The line under waking up and going to sleep: when the lights start or end. */
  private fadeHint(d: AutomationDraft) {
    const { t } = this.ctx;
    const fade = d.input.fade ?? 0;
    if (d.type === "wake_up" && d.input.start_kind === "sunrise") {
      const minutes = offsetMinutes(d.input.start_offset);
      const wake = minutes ? this.offsetLabel("sunrise", minutes).toLowerCase() : t("automations.at_sunrise");
      return html`<p class="hint">${t(fade ? "automations.wake_hint_sun" : "automations.wake_hint_sun_now", { when: wake, n: fade })}</p>`;
    }
    const moment = this.fadeMoment(d, fade);
    if (!moment) return nothing;
    const key = d.type === "wake_up" ? (fade ? "automations.wake_hint" : "automations.wake_hint_now") : "automations.sleep_hint";
    return html`<p class="hint">${t(key, { time: moment.time, n: fade })}</p>`;
  }

  /** "On certain days": off is every day, on opens the days of the week (the Hue app's "Repeat"). */
  private days(d: AutomationDraft) {
    const { t } = this.ctx;
    const days = d.input.days?.length ? d.input.days : [...WEEKDAYS];
    const open = this.someDays || days.length < 7;
    const flip = (day: Weekday) => {
      const next = days.includes(day) ? days.filter((x) => x !== day) : [...days, day];
      if (!next.length) return;
      haptic("selection");
      this.set({ days: WEEKDAYS.filter((x) => next.includes(x)) });
    };
    const flipAll = () => {
      haptic("selection");
      this.someDays = !open;
      if (open) this.set({ days: [...WEEKDAYS] });
    };
    return html`<div class="item days-item">
      <div class="line">
        <div class="grow">${t("automations.some_days")}<div class="dim small">${daysLine(days, t)}</div></div>
        ${toggle(open, t("automations.some_days"), flipAll)}
      </div>
      ${open
        ? html`<div class="days-row">
            ${WEEKDAYS.map(
              (day) => html`<button class=${classMap({ on: days.includes(day) })} aria-pressed=${days.includes(day)}
                aria-label=${t(`automations.day_${day}` as StringKey)} @click=${() => flip(day)}>
                ${t(`automations.letter_${day}` as StringKey)}
              </button>`,
            )}
          </div>`
        : nothing}
    </div>`;
  }

  /** A start or an end as one row ("Sunrise", "07:00", "30 min before sunset"); it opens the time screen. */
  private moment<K extends string>(
    title: string,
    kinds: readonly K[],
    kind: K,
    time: string | undefined,
    offset: Duration | undefined,
    set: (patch: { kind?: K; time?: string; offset?: Duration }) => void,
  ) {
    const { t } = this.ctx;
    const minutes = offsetMinutes(offset);
    const sun = (k: string) => k === "sunrise" || k === "sunset";
    const label = (k: string) => t((k === "none" ? "automations.none" : `automations.kind_${k}`) as StringKey);
    const value = kind === "none" ? label(kind) : momentLine(kind as StartKind | EndKind, time, offset, t);
    const options: MomentKind[] = kinds.map((k) => ({ value: k, label: label(k), wheel: k === "none" ? "none" : sun(k) ? "sun" : "time" }));
    return navRow({ title, value }, () =>
      this.choose(
        momentChoice(title, {
          kinds: options,
          kind,
          time: hhmm(time),
          offset: minutes,
          offsets: OFFSETS,
          offsetLabel: (k, m) => this.offsetLabel(k, m),
          done: (v) => set({ kind: v.kind as K, time: `${v.time}:00`, offset: offsetDuration(v.offset) }),
        }),
      ),
    );
  }

  private zones(d: AutomationDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const zones = Object.keys(ctx.hass.states).filter((id) => id.startsWith("zone."));
    if (zones.length < 2) return nothing;
    const current = d.input.zone || "zone.home";
    return navRow({ icon: "mdi:map-marker-radius-outline", title: t("automations.zone"), value: friendlyName(ctx.hass, current) }, () =>
      this.choose(
        single(t("automations.zone"), zones.map((id) => ({ value: id, label: friendlyName(ctx.hass, id), icon: "mdi:map-marker-radius-outline" })), current, (zone) => this.set({ zone })),
      ),
    );
  }

  // ---- when ----

  private when(d: AutomationDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const i = d.input;
    const start = (p: { kind?: StartKind; time?: string; offset?: Duration }) =>
      this.set({ ...(p.kind ? { start_kind: p.kind } : {}), ...(p.time ? { start_time: p.time } : {}), ...(p.offset ? { start_offset: p.offset } : {}) });
    switch (d.type) {
      case "wake_up": {
        // A time of day, like the Hue app's, or (switched off) with sunrise.
        const atTime = i.start_kind !== "sunrise";
        return html`<div class="rows">
            ${this.toggleRow("", t("automations.at_time"), atTime ? "" : t("automations.with_sunrise"), atTime, (on) => this.set({ start_kind: on ? "time" : "sunrise" }))}
            ${atTime ? this.wheelsItem(timeWheels(hhmm(i.time) || "07:00", (v) => this.set({ time: `${v}:00` }))) : this.sunriseWheel(d)}
            ${this.fadeRow(i.fade)}
          </div>
          ${this.fadeHint(d)}
          <div class="rows">${this.days(d)}</div>`;
      }
      case "go_to_sleep": {
        // At a time of day on its days, or (switched off) only by its buttons.
        const atTime = i.use_time !== false;
        return html`<div class="rows">
            <div class="item time-switch">
              <div class="grow">${t("automations.time")}${atTime ? nothing : html`<div class="dim small">${t("automations.when_button")}</div>`}</div>
              <button class="pill start" ?disabled=${!placesOf(i).length} @click=${() => this.startNow(d)}>${icon("play")}${t("automations.start_now")}</button>
              ${toggle(atTime, t("automations.time"), () => {
                haptic("selection");
                this.set({ use_time: !atTime });
              })}
            </div>
            ${atTime ? html`${this.wheelsItem(timeWheels(hhmm(i.time) || "23:00", (v) => this.set({ time: `${v}:00` })))}${this.days(d)}` : nothing}
          </div>
          ${atTime ? this.fadeHint(d) : nothing}`;
      }
      case "coming_home":
        return html`<p class="lead">${t("automations.coming_home_hint")}</p>
          <div class="rows">
            ${this.zones(d)}
            ${this.toggleRow("mdi:weather-sunset-down", t("automations.only_dark"), t("automations.only_dark_sub"), !!i.only_dark, (v) => this.set({ only_dark: v }))}
          </div>`;
      case "leaving_home":
        return html`<p class="lead">${t("automations.leaving_home_hint")}</p>${this.zones(d) === nothing ? nothing : html`<div class="rows">${this.zones(d)}</div>`}`;
      case "mimic_presence":
        return html`<p class="lead">${t("automations.mimic_hint")}</p>
          <div class="rows">
            ${this.moment(t("automations.start"), ["time", "sunset"] as const, i.start_kind === "sunset" ? "sunset" : "time", i.start_time, i.start_offset, start)}
            ${this.time(t("automations.end"), i.end_time, (end_time) => this.set({ end_time }))}
            ${this.days(d)}
          </div>
          <div class="rows">
            ${this.zones(d)}
            ${this.toggleRow("mdi:home-off-outline", t("automations.only_away"), t("automations.only_away_sub"), i.only_away !== false, (v) => this.set({ only_away: v }))}
          </div>`;
      case "schedule":
        return html`<div class="rows">
          ${this.moment(t("automations.start"), ["time", "sunrise", "sunset"] as const, (i.start_kind || "time") as StartKind, i.start_time, i.start_offset, start)}
          ${this.moment(t("automations.end"), ["none", "time", "sunrise", "sunset"] as const, (i.end_kind || "none") as EndKind, i.end_time, i.end_offset, (p) =>
            this.set({ ...(p.kind ? { end_kind: p.kind } : {}), ...(p.time ? { end_time: p.time } : {}), ...(p.offset ? { end_offset: p.offset } : {}) }))}
          ${this.days(d)}
          ${this.fadeRow(i.fade)}
        </div>`;
      case "motion":
        return this.motion(d);
    }
  }

  private motion(d: AutomationDraft) {
    return html`${this.selectedSensors(d)}
      <div class="rows">${this.offRow(d, this.ctx.t("automations.off_after_motion"))}${this.daylightRow(d)}</div>`;
  }


  /** Going to sleep by a button: Hue buttons (their event entities), like the Hue app's "Controlled by". */
  private controlledBy(d: AutomationDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const buttons = Object.keys(ctx.hass.states)
      .filter((id) => id.startsWith("event.") && ctx.hass.entities?.[id]?.platform === "hue")
      .sort((a, b) => friendlyName(ctx.hass, a).localeCompare(friendlyName(ctx.hass, b)));
    const chosen = (d.input.buttons || []).filter((id) => ctx.hass.states[id]);
    const area = (id: string) => {
      const entry = ctx.hass.entities?.[id];
      const areaId = entry?.area_id || (entry?.device_id ? ctx.hass.devices?.[entry.device_id]?.area_id : null);
      return (areaId && ctx.hass.areas?.[areaId]?.name) || "";
    };
    const value = chosen.length ? chosen.map((id) => friendlyName(ctx.hass, id)).join(", ") : t("automations.no_devices");
    return html`<h2 class="label">${t("automations.controlled_by")}</h2>
      <div class="rows">
        ${navRow({ title: t("automations.devices"), value }, () =>
          this.choose(
            several(
              t("automations.devices"),
              buttons.map((id) => ({ value: id, label: friendlyName(ctx.hass, id), sub: area(id), icon: "mdi:gesture-tap-button" })),
              chosen,
              (ids) => this.set({ buttons: ids }),
              { hint: t(buttons.length ? "automations.buttons_hint" : "automations.no_buttons") },
            ),
          ),
        )}
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-automation-edit-view": AutomationEditView;
  }
}
