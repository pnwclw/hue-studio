// A MotionAware area (Hue Bridge Pro: lights that sense motion), like the Hue app's.
//
// New area (`area` "new"): pick a room or zone (rooms with fewer than three lights that
// can sense are greyed), then its three or four lights (each blinks when picked) and a
// name, then calibration: everyone leaves the room, "Start" makes the area and the bridge
// measures the empty room (about 30 s, each light done on its own). Then what happens on
// motion: a Hue Studio motion automation on the area's sensor.
//
// An area: its name (renamed in place), on/off, how it does (calibrating with progress,
// motion right now), what happens on motion (our automations, "Add lights", and the Hue
// app's responses, which can be switched off: both at once send the lights two commands),
// its room, its lights and their health ("Change lights" recalibrates), the sensitivity
// for lights and for Hue Secure alerts (tried out live, as for a Hue sensor),
// "Recalibrate" (off and on, the Hue app's way) and delete.

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import { type AutomationDraft, fromConfig } from "../automations.ts";
import { haptic } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import { areaOf, defaultSensitivity, friendlyName, lightIcon, sensitivityLevels } from "../model.ts";
import {
  activeResponses,
  areaState,
  CALIBRATION_MS,
  calibrationProgress,
  defaultName,
  enoughLights,
  findArea,
  flipLight,
  type GroupChoice,
  groupChoices,
  lightsInAreas,
  MAX_LIGHTS,
  MIN_LIGHTS,
} from "../motion.ts";
import type { BridgeInfo, BridgesMessage, MotionArea } from "../types.ts";
import { icon, toggle } from "../ui.ts";
import { type FlowStep, flowRing, StudioView } from "./base.ts";

const NAME_MAX = 32;
const LIST = "/settings/motionaware";

type Step = "room" | "lights" | "calibrate";
type Sheet = "lights" | "sensitivity" | "security" | "recalibrate";

@customElement("hue-studio-motion-area-view")
export class MotionAreaView extends StudioView {
  /** The area's id, or "new". */
  @property() accessor area = "";
  /** The bridge (hue entry id) a new area goes on. */
  @property() accessor bridge: string | null = null;

  @state() private accessor bridges: BridgesMessage | null = null;
  @state() private accessor step: Step = "room";
  @state() private accessor choice: GroupChoice | null = null;
  @state() private accessor picked: string[] = [];
  @state() private accessor name = "";
  /** The new area once the bridge made it. */
  @state() private accessor created: string | null = null;
  @state() private accessor busy = false;
  @state() private accessor now = Date.now();
  @state() private accessor sheet: Sheet | null = null;
  @state() private accessor editingName = false;
  /** The sensitivity sheet: the value tried out and the one it opened with. */
  @state() private accessor trying: number | null = null;
  private opened: number | null = null;
  private stop?: () => void;
  private ticker?: ReturnType<typeof setInterval>;

  override connectedCallback(): void {
    super.connectedCallback();
    this.stop = this.ctx.watch<BridgesMessage>("hue_studio/bridges/subscribe", (msg) => (this.bridges = msg));
    // Calibration progress moves with the clock.
    this.ticker = setInterval(() => {
      if (this.calibrating) this.now = Date.now();
    }, 500);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop?.();
    clearInterval(this.ticker);
    // Left with a sensitivity only tried out: the area gets back the one it had.
    if ((this.sheet === "sensitivity" || this.sheet === "security") && this.opened !== null) this.sendSensitivity(this.sheet, this.opened);
  }

  private get found(): [string, BridgeInfo, MotionArea] | null {
    const id = this.area === "new" ? this.created : this.area;
    return id ? findArea(this.bridges, id) : null;
  }

  private get calibrating(): boolean {
    return !!this.found?.[2].calibrating || (this.area === "new" && this.step === "calibrate" && !!this.created);
  }

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    if (!this.bridges) return this.screen(this.subHead(t("settings.motionaware"), () => ctx.go(LIST)), html`<p class="empty">${t("rooms.loading")}</p>`);
    if (this.area === "new") return this.newArea();
    const found = this.found;
    if (!found) return this.screen(this.subHead(t("settings.motionaware"), () => ctx.go(LIST)), html`<p class="empty">${t("ma.not_found")}</p>`);
    return html`${this.edit(found[0], found[1], found[2])}${this.askSheet()}`;
  }

  // --- A new area ------------------------------------------------------------------

  private get newBridge(): [string, BridgeInfo] | null {
    const entries = Object.entries(this.bridges || {}).filter(([, b]) => b.motion_areas !== null);
    return entries.find(([id]) => id === this.bridge) ?? entries[0] ?? null;
  }

  private newArea(): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const target = this.newBridge;
    const back = () => {
      if (this.step === "lights") this.step = "room";
      else if (this.step === "calibrate" && !this.created) this.step = "lights";
      else ctx.go(this.created ? `${LIST}/${encodeURIComponent(this.created)}` : LIST);
    };
    const first = this.step === "room" || !!this.created;
    if (!target) return this.flow(true, back, { panel: html`<p class="empty">${t("motion.unsupported")}</p>` });
    const [entry, bridge] = target;
    const step = this.step === "room" ? this.roomStep(bridge) : this.step === "lights" ? this.lightsStep(bridge) : this.calibrateStep(entry, bridge);
    return this.flow(first, back, step);
  }

  private roomStep(bridge: BridgeInfo): FlowStep {
    const { ctx } = this;
    const { t } = ctx;
    if (!bridge.motion_lights) return { panel: html`<p class="empty">${t("rooms.loading")}</p>` };
    const choices = groupChoices(bridge);
    const pick = (c: GroupChoice) => {
      haptic("selection");
      this.choice = c;
      // A room with just enough lights: all of them.
      this.picked = c.lights.length <= MAX_LIGHTS ? c.lights.map((l) => l.entity_id!) : [];
      this.name = defaultName(bridge, c.group);
      this.step = "lights";
    };
    const row = (c: GroupChoice) => html`<button class="item" ?disabled=${!!c.reason} @click=${() => pick(c)}>
      <ha-icon icon=${c.group.type === "zone" ? "mdi:texture-box" : "mdi:sofa-outline"}></ha-icon>
      <div class="grow">${c.group.name}
        <div class="dim small">${c.reason ? t("ma.room_few", { count: c.lights.length, min: MIN_LIGHTS }) : t("ma.room_lights", { count: c.lights.length })}</div>
      </div>
    </button>`;
    const rooms = choices.filter((c) => c.group.type === "room");
    const zones = choices.filter((c) => c.group.type === "zone");
    return {
      panel: html`${this.flowTitle(t("ma.where"), t("ma.where_text", { min: MIN_LIGHTS }))}
        ${rooms.length ? html`<h2 class="label">${t("ma.rooms")}</h2><div class="rows inset">${rooms.map(row)}</div>` : nothing}
        ${zones.length ? html`<h2 class="label">${t("ma.zones")}</h2><div class="rows inset">${zones.map(row)}</div>` : nothing}
        ${!choices.length ? html`<p class="lead flow-lead">${t("ma.no_rooms")}</p>` : nothing}`,
    };
  }

  private lightRows(bridge: BridgeInfo, choice: GroupChoice, picked: string[], flip: (id: string) => void, except: string | null): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const used = lightsInAreas(bridge, except);
    return html`<div class="rows inset">
      ${choice.lights.map((l) => {
        const id = l.entity_id!;
        const on = picked.includes(id);
        const full = !on && picked.length >= MAX_LIGHTS;
        return html`<button class="item" role="checkbox" aria-checked=${on} ?disabled=${full} @click=${() => flip(id)}>
          <ha-icon icon=${lightIcon(ctx.hass, id, ctx.lightInfo[id])}></ha-icon>
          <div class="grow">${friendlyName(ctx.hass, id)}${used.has(id) ? html`<div class="dim small">${t("ma.in_area", { area: used.get(id)! })}</div>` : nothing}</div>
          <span class=${classMap({ check: true, on })}>${on ? icon("check") : nothing}</span>
        </button>`;
      })}
    </div>`;
  }

  /** Pick or drop a light; a light picked blinks, so you see which one it is. */
  private flip(bridge: BridgeInfo, picked: string[], id: string): string[] {
    const next = flipLight(picked, id);
    haptic("selection");
    if (next.includes(id) && !picked.includes(id)) {
      const device = bridge.motion_lights?.find((l) => l.entity_id === id)?.device;
      if (device) void this.ctx.ws({ type: "hue_studio/devices/identify", device });
    }
    return next;
  }

  private lightsStep(bridge: BridgeInfo): FlowStep {
    const { ctx } = this;
    const { t } = ctx;
    const choice = this.choice;
    if (!choice) return this.roomStep(bridge);
    const ok = enoughLights(this.picked) && this.name.trim().length > 0;
    return {
      panel: html`${this.flowTitle(t("ma.which"), t("ma.which_text", { min: MIN_LIGHTS, max: MAX_LIGHTS }))}
        <input class="field outlined" maxlength=${NAME_MAX} placeholder=${t("ma.name")} aria-label=${t("ma.name")} .value=${this.name}
          @input=${(e: InputEvent) => (this.name = (e.target as HTMLInputElement).value)} />
        <h2 class="label">${t("ma.lights_in", { room: choice.group.name })} · ${t("ma.picked", { count: this.picked.length, max: MAX_LIGHTS })}</h2>
        ${this.lightRows(bridge, choice, this.picked, (id) => (this.picked = this.flip(bridge, this.picked, id)), null)}`,
      foot: html`<button class="pill apply" ?disabled=${!ok} @click=${() => {
        haptic("selection");
        this.step = "calibrate";
      }}>${t("ma.next")}</button>`,
    };
  }

  private calibrateStep(entry: string, bridge: BridgeInfo): FlowStep {
    const { ctx } = this;
    const { t } = ctx;
    const choice = this.choice;
    const area = this.found?.[2];
    const art = (badge: "ok" | null, progress: number | "spin" | null) =>
      flowRing(html`<ha-icon class="art-icon" icon="hue-studio:motionaware"></ha-icon>`, progress, badge);
    if (!this.created || !area) {
      if (!choice) return this.roomStep(bridge);
      if (this.created) return { art: art(null, "spin"), panel: this.flowTitle(t("ma.starting")) };
      const start = async () => {
        this.busy = true;
        haptic("selection");
        const result = await ctx.query<{ area_id: string }>({
          type: "hue_studio/motion_areas/create",
          hue_entry_id: entry,
          group: choice.group.id,
          lights: this.picked,
          name: this.name.trim(),
        });
        this.busy = false;
        if (result?.area_id) this.created = result.area_id;
      };
      // "Leave the room": the bridge measures it empty.
      const steps = (["ma.leave_1", "ma.leave_2", "ma.leave_3"] as StringKey[]).map((key) => t(key, { seconds: CALIBRATION_MS / 1000 })).join(" ");
      return {
        art: html`<ha-icon class="art-icon" icon="mdi:exit-run"></ha-icon>`,
        panel: html`${this.flowTitle(t("ma.leave_title"), t("ma.leave_text", { room: choice.group.name }))}<p class="lead flow-lead">${steps}</p>`,
        foot: html`<button class="pill apply" ?disabled=${this.busy} @click=${start}>${t("ma.start")}</button>`,
      };
    }
    const done = areaState(area) !== "calibrating" && area.lights.every((l) => l.health === "healthy");
    if (!done) return { art: art(null, calibrationProgress(area, this.now)), panel: html`${this.flowTitle(t("ma.calibrating_text"), this.secondsLeft(area))}${this.lightHealth(area)}` };
    const room = area.lights.map((l) => (l.entity_id ? areaOf(ctx.hass, l.entity_id) : null)).find(Boolean);
    const params = new URLSearchParams({ ...(room ? { room } : {}), ...(area.sensor ? { sensor: area.sensor } : {}) });
    return {
      art: art("ok", null),
      panel: this.flowTitle(t("ma.ready_title"), t("ma.ready_text", { name: area.name })),
      foot: html`<button class="pill" @click=${() => ctx.go(`${LIST}/${encodeURIComponent(area.id)}`)}>${t("qr.done")}</button>
        <button class="pill apply" ?disabled=${!area.sensor} @click=${() => ctx.go(`/automations/new/motion?${params}`)}>${t("ma.set_lights")}</button>`,
    };
  }

  /** Seconds the calibration has left. */
  private secondsLeft(area: MotionArea): string {
    const { t } = this.ctx;
    const started = area.calibration_started ? area.calibration_started * 1000 : this.now;
    const left = Math.max(0, Math.ceil((CALIBRATION_MS - (this.now - started)) / 1000));
    return left ? t("add_device.seconds", { n: left }) : t("add_device.almost");
  }

  /** Each light of an area and how it does. */
  private lightHealth(area: MotionArea): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const calibrating = area.calibrating;
    return html`<div class="rows">
      ${area.lights.map((l) => {
        const status = !area.enabled ? "off" : l.health === "healthy" ? "ready" : calibrating || l.health === null ? "calibrating" : "problem";
        return html`<div class="item">
          <ha-icon icon=${l.entity_id ? lightIcon(ctx.hass, l.entity_id, ctx.lightInfo[l.entity_id]) : "mdi:lightbulb-question-outline"}></ha-icon>
          <div class="grow">${l.entity_id ? friendlyName(ctx.hass, l.entity_id) : t("ma.unknown_light")}</div>
          <span class=${classMap({ "ma-health": true, [status]: true })}>
            ${status === "calibrating" ? html`<span class="spinner"></span>` : nothing}${t(`ma.light_${status}` as StringKey)}
          </span>
        </div>`;
      })}
    </div>`;
  }

  // --- An area ---------------------------------------------------------------------

  /** Our motion automations on the area's sensor. */
  private uses(area: MotionArea): { id: string; draft: AutomationDraft }[] {
    const { ctx } = this;
    if (!area.sensor) return [];
    return Object.entries(ctx.automations?.automations || {})
      .flatMap(([entityId, a]) => {
        const config = ctx.automationConfigs[entityId];
        const draft = config && a.id ? fromConfig(config) : null;
        return draft?.type === "motion" && (draft.input.motion || []).includes(area.sensor!) ? [{ id: a.id!, draft }] : [];
      })
      .sort((a, b) => a.draft.alias.localeCompare(b.draft.alias));
  }

  private edit(entry: string, bridge: BridgeInfo, area: MotionArea): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const state = areaState(area);
    const uses = this.uses(area);
    const responses = activeResponses(area);
    const room = area.lights.map((l) => (l.entity_id ? areaOf(ctx.hass, l.entity_id) : null)).find(Boolean) ?? null;
    const add = () => {
      const params = new URLSearchParams({ ...(room ? { room } : {}), ...(area.sensor ? { sensor: area.sensor } : {}) });
      ctx.go(`/automations/new/motion?${params}`);
    };
    const motion = area.sensor ? ctx.hass.states[area.sensor]?.state === "on" : false;
    const status = t(`ma.state_${state}` as StringKey);
    const head = this.subHead(t("ma.title"), () => ctx.go(`${LIST}?bridge=${encodeURIComponent(entry)}`));
    const body = html`<div class="sensor-hero">
        <ha-icon class="pic" icon=${area.enabled ? "mdi:motion-sensor" : "mdi:motion-sensor-off"}></ha-icon>
        <div class="name-row">
          ${this.editingName
            ? html`<input class="name-input" .value=${area.name} maxlength=${NAME_MAX} aria-label=${t("ma.rename")}
                @keydown=${(e: KeyboardEvent) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                @blur=${(e: Event) => this.rename(area, (e.target as HTMLInputElement).value)} />`
            : html`<h1 class="big">${area.name}</h1>`}
          <button class="round rename" aria-label=${t("ma.rename")} @click=${() => {
            this.editingName = true;
            this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".name-input")?.focus());
          }}>${icon("pencil")}</button>
        </div>
      </div>

      <div class="rows">
        <div class="item">
          <ha-icon icon="mdi:motion-sensor"></ha-icon>
          <div class="grow">${t("ma.title")}<div class=${classMap({ "dim small": true, warn: state === "problem" })}>${area.group ?? t("ma.whole_home")} · ${status}</div></div>
          ${toggle(area.enabled, area.name, () => {
            haptic("selection");
            void ctx.ws({ type: "hue_studio/motion_areas/update", area_id: area.id, enabled: !area.enabled });
          })}
        </div>
      </div>
      ${state === "calibrating" ? html`<p class="hint">${t("ma.calibrating_text")} ${this.secondsLeft(area)}</p>` : nothing}
      ${state === "working"
        ? html`<div class=${classMap({ "sens-try": true, moving: motion })} role="status"><span class="dot"></span><span>${motion ? t("sensor.motion_now") : t("ma.no_motion")}</span></div>`
        : nothing}
      ${state === "problem" ? html`<p class="hint warn">${t("ma.problem")}</p>` : nothing}

      <h2 class="label">${t("ma.on_motion")}</h2>
      <div class="rows">
        ${uses.map(
          (u) => html`<button class="item" @click=${() => ctx.go(`/automations/${encodeURIComponent(u.id)}`)}>
            <ha-icon icon="mdi:lightbulb-group-outline"></ha-icon>
            <div class="grow">${u.draft.alias}<div class="dim small">${t("ma.ours")}</div></div>
            <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
          </button>`,
        )}
        ${area.responses.map(
          (r) => html`<div class="item">
            <ha-icon icon="mdi:cellphone"></ha-icon>
            <div class="grow">${r.name || area.name}<div class="dim small">${t("ma.hue_app", { count: r.slots })}</div></div>
            ${toggle(r.enabled, r.name || area.name, () => {
              haptic("selection");
              void ctx.ws({ type: "hue_studio/motion_areas/response", behavior_id: r.id, enabled: !r.enabled });
            })}
          </div>`,
        )}
        <button class="item" ?disabled=${!area.sensor} @click=${add}>
          <div class="grow">${t("sensor.add_lights")}</div>
          <span class="round plus-blue">${icon("plus")}</span>
        </button>
      </div>
      ${uses.length && responses.length ? html`<p class="hint warn">${t("ma.both")}</p>` : nothing}
      ${!uses.length && !responses.length ? html`<p class="hint">${t("ma.nothing")}</p>` : nothing}

      <h2 class="label">${t("ma.sensing")}</h2>
      ${this.lightHealth(area)}
      <div class="rows">
        <button class="item" @click=${() => this.open("lights", area)}>
          <ha-icon icon="mdi:lightbulb-multiple-outline"></ha-icon>
          <div class="grow">${t("ma.change_lights")}<div class="dim small">${t("ma.change_lights_sub", { min: MIN_LIGHTS, max: MAX_LIGHTS })}</div></div>
        </button>
        ${area.sensitivity ? this.row("mdi:tune-variant", t("sensor.sensitivity"), this.level(area.sensitivity.value, area.sensitivity.max), () => this.open("sensitivity", area)) : nothing}
        ${area.security_sensitivity
          ? this.row("mdi:shield-home-outline", t("ma.security"), this.level(area.security_sensitivity.value, area.security_sensitivity.max), () => this.open("security", area))
          : nothing}
        ${this.row("mdi:refresh", t("ma.recalibrate"), t("ma.recalibrate_sub"), () => this.open("recalibrate", area))}
      </div>

      <div class="delete-area">
        <button class="delete-btn" ?disabled=${this.busy} @click=${() => this.askDelete(t("ma.delete_hint"), t("ma.delete"), () => void this.deleteArea(entry, area))}>
          ${t("ma.delete")}
        </button>
      </div>`;
    // The sheet sits outside the scrolling body: a scroller (iOS) would clip it.
    return html`<div class="screen-head">${head}</div>
      <div class="screen-body"><div class="page settings-page sensor-edit ma-page">${body}</div></div>
      ${this.sheet ? this.renderSheet(this.sheet, bridge, area) : nothing}`;
  }

  private row(glyph: string, title: string, sub: string, act: () => void): TemplateResult {
    return html`<button class="item" @click=${act}>
      <ha-icon icon=${glyph}></ha-icon>
      <div class="grow">${title}${sub ? html`<div class="dim small">${sub}</div>` : nothing}</div>
    </button>`;
  }

  private level(value: number, max: number): string {
    const names = sensitivityLevels(max);
    return names?.[value] ? this.ctx.t(`sensor.level_${names[value]}` as StringKey) : this.ctx.t("sensor.level_n", { n: value + 1, of: max + 1 });
  }

  private async rename(area: MotionArea, value: string): Promise<void> {
    this.editingName = false;
    const name = value.trim().slice(0, NAME_MAX);
    if (!name || name === area.name) return;
    if (await this.ctx.ws({ type: "hue_studio/motion_areas/update", area_id: area.id, name })) haptic("success");
  }

  private open(sheet: Sheet, area: MotionArea): void {
    haptic("selection");
    this.editingName = false;
    this.sheet = sheet;
    this.picked = area.lights.map((l) => l.entity_id).filter((id): id is string => !!id);
    const current = sheet === "sensitivity" ? area.sensitivity : sheet === "security" ? area.security_sensitivity : null;
    this.opened = this.trying = current?.value ?? null;
  }

  /** Close a sheet; a sensitivity sheet puts back the value it opened with unless `keep`. */
  private close(keep = false): void {
    if ((this.sheet === "sensitivity" || this.sheet === "security") && this.opened !== null) {
      if (keep) haptic("success");
      else this.sendSensitivity(this.sheet, this.opened);
    }
    this.sheet = null;
    this.trying = this.opened = null;
  }

  private sendSensitivity(sheet: "sensitivity" | "security", value: number): void {
    const area = this.found?.[2];
    const current = sheet === "sensitivity" ? area?.sensitivity : area?.security_sensitivity;
    if (!area || !current || current.value === value) return;
    void this.ctx.ws({
      type: "hue_studio/motion_areas/update",
      area_id: area.id,
      [sheet === "sensitivity" ? "sensitivity" : "security_sensitivity"]: value,
    });
  }

  private sensitivitySheet(sheet: "sensitivity" | "security", area: MotionArea): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    const current = (sheet === "sensitivity" ? area.sensitivity : area.security_sensitivity)!;
    const { max } = current;
    const value = this.trying ?? current.value;
    const name = this.level(value, max);
    const moving = !!area.sensor && ctx.hass.states[area.sensor]?.state === "on";
    return html`<p class="hint">${t(sheet === "sensitivity" ? "ma.sensitivity_hint" : "ma.security_hint")}</p>
      <div class="sens-level">
        <div class="label">${t("sensor.sensitivity_label")}</div>
        <div class="value">${value === defaultSensitivity(max) ? t("sensor.level_default", { level: name }) : name}</div>
      </div>
      <div class="sens-slider" style="--f:${max ? value / max : 0}">
        <input type="range" min="0" max=${max} step="1" .value=${String(value)} aria-label=${t("sensor.sensitivity")} aria-valuetext=${name}
          @input=${(e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            if (v !== this.trying) haptic("selection");
            this.trying = v;
          }}
          @change=${(e: Event) => this.sendSensitivity(sheet, Number((e.target as HTMLInputElement).value))} />
        <div class="ticks">${Array.from({ length: max + 1 }, (_, i) => html`<span style="--i:${i / max}">${this.level(i, max)}</span>`)}</div>
      </div>
      <div class=${classMap({ "sens-try": true, moving })} role="status">
        <span class="dot"></span><span>${moving ? t("sensor.motion_now") : t("sensor.try_out")}</span>
      </div>`;
  }

  private renderSheet(sheet: Sheet, bridge: BridgeInfo, area: MotionArea): TemplateResult {
    const { ctx } = this;
    const { t } = ctx;
    let title: string;
    let content: TemplateResult;
    let save: TemplateResult | typeof nothing = nothing;
    if (sheet === "lights") {
      title = t("ma.change_lights");
      const choice = groupChoices(bridge).find((c) => c.group.id === area.group_id);
      const before = area.lights.map((l) => l.entity_id).join(",");
      const ok = enoughLights(this.picked) && this.picked.join(",") !== before;
      content = choice
        ? html`<p class="hint">${t("ma.which_text", { min: MIN_LIGHTS, max: MAX_LIGHTS })}</p>
            ${this.lightRows(bridge, choice, this.picked, (id) => (this.picked = this.flip(bridge, this.picked, id)), area.id)}
            <p class="hint warn">${t("ma.lights_recalibrate")}</p>`
        : html`<p class="hint">${t("ma.no_lights_here")}</p>`;
      save = html`<button class="pill save" ?disabled=${!ok || this.busy} @click=${async () => {
        this.busy = true;
        const done = await ctx.ws({ type: "hue_studio/motion_areas/update", area_id: area.id, lights: this.picked });
        this.busy = false;
        if (done) {
          haptic("success");
          this.close();
        }
      }}>${t("scene.save")}</button>`;
    } else if (sheet === "recalibrate") {
      title = t("ma.recalibrate");
      const steps = (["ma.leave_1", "ma.leave_2", "ma.leave_3"] as StringKey[]).map((key) => t(key, { seconds: CALIBRATION_MS / 1000 })).join(" ");
      content = html`<p class="hint">${t("ma.leave_text", { room: area.group ?? t("ma.whole_home") })}</p>
        <p class="hint">${steps}</p>
        <div class="center sheet-actions">
          <button class="pill apply" ?disabled=${this.busy} @click=${async () => {
            this.busy = true;
            haptic("selection");
            const done = await ctx.ws({ type: "hue_studio/motion_areas/recalibrate", area_id: area.id });
            this.busy = false;
            if (done) this.close();
          }}>${t("ma.start")}</button>
        </div>`;
    } else {
      title = t(sheet === "sensitivity" ? "sensor.sensitivity" : "ma.security");
      content = this.sensitivitySheet(sheet, area);
      save = html`<button class="pill save" ?disabled=${this.trying === null} @click=${() => this.close(true)}>${t("scene.save")}</button>`;
    }
    return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && this.close()}>
      <div class="box form sensor-sheet" role="dialog" aria-label=${title}>
        <div class="sheet-bar">
          <button class="round close" aria-label=${t("common.close")} @click=${() => this.close()}>${icon("close")}</button>
          <div class="grow">${title}</div>
          ${save}
        </div>
        <div class="form-body">${content}</div>
      </div>
    </div>`;
  }

  private async deleteArea(entry: string, area: MotionArea): Promise<void> {
    const { ctx } = this;
    this.busy = true;
    const ok = await ctx.ws({ type: "hue_studio/motion_areas/delete", area_id: area.id });
    this.busy = false;
    if (!ok) return;
    haptic("success");
    ctx.toast(ctx.t("ma.deleted", { name: area.name }));
    ctx.go(`${LIST}?bridge=${encodeURIComponent(entry)}`);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-motion-area-view": MotionAreaView;
  }
}
