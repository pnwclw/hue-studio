// Sync: the Hue Play HDMI Sync Box, like the Sync tab of the Hue app. Start/stop, mode,
// intensity, brightness, HDMI input and entertainment area; every change is one
// `hue_studio.set_sync` call and shows at once (StudioContext.setSync). A box paired
// directly also has the music palette, background lighting, presets and remote buttons.

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import type { StringKey } from "../i18n.ts";
import { friendlyName } from "../model.ts";
import { currentArea, currentInput, hasFeature, INTENSITIES, IR_ACTIONS, PALETTES, statusKey, SYNC_MODES } from "../sync.ts";
import type { SyncBoxInfo, SyncChange, SyncInput, SyncIrCode } from "../types.ts";
import { icon, toggle } from "../ui.ts";
import { StudioView } from "./base.ts";

const MODE_ICONS: Record<string, string> = {
  video: "mdi:movie-open-outline",
  music: "mdi:music",
  game: "mdi:gamepad-variant-outline",
};

// Device types the Sync Box app offers for inputs -> MDI icons.
const INPUT_ICONS: [RegExp, string][] = [
  [/appletv/, "mdi:apple"],
  [/xbox|playstation|nintendo|game/, "mdi:controller"],
  [/desktop|laptop|monitor/, "mdi:monitor"],
  [/phone/, "mdi:cellphone"],
  [/diskplayer/, "mdi:disc-player"],
  [/roku|shield|chromecast|firetv|settopbox|satellite|video/, "mdi:television-box"],
  [/music|speaker|soundbar|avreceiver/, "mdi:speaker"],
];
const inputIcon = (input: SyncInput): string => INPUT_ICONS.find(([re]) => re.test(input.type || ""))?.[1] || "mdi:hdmi-port";

/** Brightness commands to the box while dragging (it handles a few per second). */
const BRIGHTNESS_INTERVAL = 300;

/** Music palettes as the Sync Box app pictures them. */
const PALETTE_ART: Record<string, string> = {
  happy_energetic: "linear-gradient(135deg, #ff4d6d, #ffb347, #ffe14d)",
  happy_calm: "linear-gradient(135deg, #ffb6a3, #ffd59e, #a8e6cf)",
  melancholic_calm: "linear-gradient(135deg, #5b6cff, #8e7dff, #b7c4ff)",
  melancholic_energetic: "linear-gradient(135deg, #6a00f4, #db00b6, #ff4d6d)",
  neutral: "linear-gradient(135deg, #f5e6c8, #c9d6df, #f5e6c8)",
};

/** The remote button editor: a known code (or one just learned), its name and action. */
interface IrDraft {
  code: string;
  name: string;
  action: string;
  known: boolean;
}

@customElement("hue-studio-sync-view")
export class SyncView extends StudioView {
  /** Config entry id of the box to show (null: the first one). */
  @property() accessor box: string | null = null;
  /** The "save as preset" sheet: the name typed so far (null: closed). */
  @state() private accessor presetName: string | null = null;
  @state() private accessor ir: IrDraft | null = null;
  @state() private accessor confirmDelete: string | null = null;

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const ids = Object.keys(ctx.boxes);
    const id = this.box && ctx.boxes[this.box] ? this.box : ids[0];
    const box = id ? ctx.boxes[id] : undefined;
    const head = this.head(
      t("sync.title"),
      box?.available ? toggle(!!box.power, t("sync.power"), () => this.set(id, { power: !box.power })) : nothing,
    );
    if (!box) {
      return html`<div class="page sync">
        ${head}
        <p class="empty">${this.box ? t("sync.not_found") : t("sync.none")}</p>
      </div>`;
    }
    const off = !box.available || !box.power;
    return html`<div class="page sync">
      ${head}
      ${ids.length > 1
        ? html`<div class="chips boxes">
            ${ids.map(
              (other) => html`<button class=${classMap({ chip: true, on: other === id })} @click=${() => ctx.go(`/sync?box=${encodeURIComponent(other)}`)}>
                ${ctx.boxes[other].name || other}
              </button>`,
            )}
          </div>`
        : nothing}
      ${this.hero(id, box)}
      <div class=${classMap({ "sync-body": true, disabled: off })}>
        <h2 class="label">${t("sync.mode")}</h2>
        <div class="sync-modes">${SYNC_MODES.map((mode) => this.modeTile(id, box, mode))}</div>
        <h2 class="label">${t("sync.intensity")}</h2>
        <div class="seg" role="radiogroup" aria-label=${t("sync.intensity")}>
          ${INTENSITIES.map(
            (level) => html`<button
              role="radio"
              aria-checked=${box.intensity === level}
              class=${classMap({ on: box.intensity === level })}
              @click=${() => this.set(id, { intensity: level })}
            >
              ${t(`sync.intensity_${level}` as StringKey)}
            </button>`,
          )}
        </div>
        ${this.modeSettings(id, box)}
        <div class="rows bright-row">
          <div class="item col">
            <div class="line"><span>${t("sync.brightness")}</span><span class="dim">${box.brightness ?? 0}%</span></div>
            ${this.brightness(id, box)}
          </div>
        </div>
        ${box.inputs?.length
          ? html`<h2 class="label">${t("sync.input")}</h2>
              <div class="grid inputs">${box.inputs.map((input) => this.inputTile(id, box, input))}</div>`
          : nothing}
        ${box.areas?.length
          ? html`<h2 class="label">${t("sync.area")}</h2>
              <div class="rows areas">
                ${box.areas.map(
                  (area) => html`<button
                    class=${classMap({ item: true, on: area.id === box.area })}
                    role="radio"
                    aria-checked=${area.id === box.area}
                    @click=${() => this.set(id, { entertainment_area: area.id })}
                  >
                    <ha-icon icon="mdi:sofa-outline"></ha-icon>
                    <div class="grow">
                      <div>${area.name}</div>
                      <div class="dim small">
                        ${area.lights.length
                          ? area.lights.map((l) => friendlyName(ctx.hass, l)).join(", ")
                          : t("sync.area_lights", { count: 0 })}
                      </div>
                    </div>
                    <span class="radio"></span>
                  </button>`,
                )}
              </div>`
          : nothing}
        ${hasFeature(box, "presets") ? this.presets(id, box) : nothing}
      </div>
      ${hasFeature(box, "ir") ? this.remote(box) : nothing}
    </div>
    ${this.presetName !== null ? this.presetSheet(box) : nothing} ${this.ir ? this.irSheet(box, this.ir) : nothing}`;
  }

  /** Music: the palette; video and game: background lighting. */
  private modeSettings(id: string, box: SyncBoxInfo) {
    const { t } = this.ctx;
    if (box.mode === "music" && hasFeature(box, "palette")) {
      return html`<h2 class="label">${t("sync.palette")}</h2>
        <div class="palettes">${PALETTES.map(
          (p) => html`<button class=${classMap({ palette: true, on: box.palette === p })} aria-pressed=${box.palette === p} @click=${() => this.set(id, { palette: p })}>
            <span class="art" style="background:${PALETTE_ART[p]}"></span><span>${t(`sync.palette_${p}` as StringKey)}</span>
          </button>`,
        )}</div>`;
    }
    if ((box.mode === "video" || box.mode === "game") && hasFeature(box, "background_lighting")) {
      const on = !!box.background_lighting?.[box.mode];
      return html`<div class="rows mode-extra">
        <div class="item">
          <ha-icon icon="mdi:television-ambient-light"></ha-icon>
          <div class="grow">${t("sync.background")}<div class="dim small">${t("sync.background_sub")}</div></div>
          ${toggle(on, t("sync.background"), () => this.set(id, { background_lighting: !on }))}
        </div>
      </div>`;
    }
    return nothing;
  }

  /** Presets of the box: start one, save the current state, delete. */
  private presets(id: string, box: SyncBoxInfo) {
    const { ctx } = this;
    const { t } = ctx;
    const remove = (preset: string) => {
      if (this.confirmDelete !== preset) {
        this.confirmDelete = preset;
        return;
      }
      this.confirmDelete = null;
      ctx.call("hue_studio", "delete_sync_preset", { entity_id: box.entity_id!, preset }, { optimistic: false });
    };
    return html`<h2 class="label">${t("sync.presets")}</h2>
      <div class="rows">
        ${(box.presets || []).map(
          (p) => html`<div class="item">
            <ha-icon icon="mdi:bookmark-outline"></ha-icon>
            <button class="grow plain" @click=${() => this.set(id, { preset: p.id })}>${p.name}</button>
            <button class=${classMap({ "round mini-step": true, danger: this.confirmDelete === p.id })} aria-label=${t("sync.preset_delete")}
              title=${this.confirmDelete === p.id ? t("sync.preset_delete_confirm") : t("sync.preset_delete")} @click=${() => remove(p.id)}>
              <ha-icon icon=${this.confirmDelete === p.id ? "mdi:check" : "mdi:delete-outline"}></ha-icon>
            </button>
          </div>`,
        )}
        <button class="item" @click=${() => (this.presetName = "")}>
          <ha-icon icon="mdi:plus"></ha-icon><div class="grow">${t("sync.preset_save")}<div class="dim small">${t("sync.preset_save_sub")}</div></div>
        </button>
      </div>`;
  }

  private presetSheet(box: SyncBoxInfo) {
    const { ctx } = this;
    const { t } = ctx;
    const close = () => (this.presetName = null);
    const name = (this.presetName || "").trim();
    const save = async () => {
      if (!name) return;
      if (await ctx.call("hue_studio", "save_sync_preset", { entity_id: box.entity_id!, name }, { optimistic: false })) {
        close();
        ctx.toast(t("sync.preset_saved", { name }));
      }
    };
    return html`<div class="sheet" @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="box form" role="dialog" aria-label=${t("sync.preset_save")}>
        <div class="sheet-bar"><div class="grow">${t("sync.preset_save")}</div>
          <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
        </div>
        <div class="form-body">
          <input class="field" maxlength="24" placeholder=${t("sync.preset_name")} aria-label=${t("sync.preset_name")} .value=${this.presetName || ""}
            @input=${(e: InputEvent) => (this.presetName = (e.target as HTMLInputElement).value)} @keydown=${(e: KeyboardEvent) => e.key === "Enter" && save()} />
          <p class="hint">${t("sync.preset_save_sub")}</p>
        </div>
        <div class="actions"><button class="pill apply" ?disabled=${!name} @click=${save}>${t("scene.save")}</button></div>
      </div>
    </div>`;
  }

  /** Remote buttons: what each one does; learn a new one. */
  private remote(box: SyncBoxInfo) {
    const { ctx } = this;
    const { t } = ctx;
    const ir = box.ir!;
    const known = new Set(ir.codes.map((c) => c.code));
    const fresh = ir.scanned.filter((c) => !known.has(c));
    const learn = () => ctx.call("hue_studio", "learn_sync_ir_code", { entity_id: box.entity_id! }, { optimistic: false });
    return html`<div class="sync-body">
      <h2 class="label">${t("sync.remote")}</h2>
      <p class="lead small">${t("sync.remote_hint")}</p>
      <div class="rows">
        ${ir.codes.map(
          (c) => html`<button class="item" @click=${() => (this.ir = { code: c.code, name: c.name, action: c.action || "toggle_sync", known: true })}>
            <ha-icon icon="mdi:remote"></ha-icon>
            <div class="grow">${c.name}<div class="dim small">${this.actionLabel(box, c)}</div></div>
            <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
          </button>`,
        )}
        ${fresh.map(
          (code) => html`<button class="item" @click=${() => (this.ir = { code, name: "", action: "toggle_sync", known: false })}>
            <ha-icon icon="mdi:remote-tv"></ha-icon>
            <div class="grow">${t("sync.remote_new", { code })}<div class="dim small">${t("sync.remote_assign")}</div></div>
            <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
          </button>`,
        )}
        <button class="item" ?disabled=${ir.scanning} @click=${learn}>
          <ha-icon icon=${ir.scanning ? "mdi:access-point" : "mdi:plus"}></ha-icon>
          <div class="grow">${ir.scanning ? t("sync.remote_listening") : t("sync.remote_learn")}</div>
        </button>
      </div>
    </div>`;
  }

  private actionLabel(box: SyncBoxInfo, c: Pick<SyncIrCode, "action">): string {
    const { t } = this.ctx;
    const action = c.action;
    if (!action) return t("sync.action_other");
    const [kind, value] = action.split(":");
    if (kind === "input") return t("sync.action_input", { name: box.inputs?.find((i) => i.id === value)?.name || value });
    if (kind === "preset") return t("sync.action_preset", { name: box.presets?.find((p) => p.id === value)?.name || value });
    return t(`sync.action_${action}` as StringKey);
  }

  private irSheet(box: SyncBoxInfo, draft: IrDraft) {
    const { ctx } = this;
    const { t } = ctx;
    const close = () => (this.ir = null);
    const set = (patch: Partial<IrDraft>) => (this.ir = { ...this.ir!, ...patch });
    const actions = [
      ...IR_ACTIONS,
      ...(box.inputs || []).map((i) => `input:${i.id}`),
      ...(box.presets || []).map((p) => `preset:${p.id}`),
    ];
    const name = draft.name.trim();
    const save = async () => {
      if (!name) return;
      const data = { entity_id: box.entity_id!, code: draft.code, name, action: draft.action };
      if (await ctx.call("hue_studio", "set_sync_ir_code", data, { optimistic: false })) close();
    };
    const forget = async () => {
      if (await ctx.call("hue_studio", "delete_sync_ir_code", { entity_id: box.entity_id!, code: draft.code }, { optimistic: false })) close();
    };
    return html`<div class="sheet" @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="box form" role="dialog" aria-label=${t("sync.remote")}>
        <div class="sheet-bar"><div class="grow">${draft.known ? draft.name : t("sync.remote_new", { code: draft.code })}</div>
          <button class="round close" aria-label=${t("common.close")} @click=${close}>${icon("close")}</button>
        </div>
        <div class="form-body">
          <input class="field" maxlength="24" placeholder=${t("sync.remote_name")} aria-label=${t("sync.remote_name")} .value=${draft.name}
            @input=${(e: InputEvent) => set({ name: (e.target as HTMLInputElement).value })} />
          <select class="select wide" aria-label=${t("sync.remote_action")} @change=${(e: Event) => set({ action: (e.target as HTMLSelectElement).value })}>
            ${actions.map((a) => html`<option value=${a} ?selected=${a === draft.action}>${this.actionLabel(box, { action: a })}</option>`)}
          </select>
          <p class="hint">${t("sync.remote_code", { code: draft.code })}</p>
        </div>
        <div class="actions">
          ${draft.known ? html`<button class="pill" @click=${forget}>${t("sync.remote_forget")}</button>` : nothing}
          <button class="pill apply" ?disabled=${!name} @click=${save}>${t("scene.save")}</button>
        </div>
      </div>
    </div>`;
  }

  /** Big card: what plays, the start/stop button; colored by the mode while syncing. */
  private hero(id: string, box: SyncBoxInfo) {
    const { t } = this.ctx;
    const input = currentInput(box);
    const area = currentArea(box);
    const status = t(statusKey(box));
    const line = box.available && box.power ? [status, box.mode && t(`sync.mode_${box.mode}` as StringKey), input?.name].filter(Boolean).join(" · ") : status;
    const signal = input?.status === "linked";
    return html`<div class=${classMap({ "sync-hero": true, syncing: !!box.syncing, off: !box.available || !box.power, [`m-${box.mode}`]: true })}>
      <div class="glow"></div>
      <div class="row">
        <div class="tv">${icon("sync")}</div>
        <div class="text">
          <div class="name">${box.name || "Sync Box"}</div>
          <div class="status">${line}</div>
          <div class="dim small">${box.power ? (signal ? box.content || "" : t("sync.no_signal")) : box.model || ""}</div>
        </div>
      </div>
      <div class="center">
        ${!box.available
          ? nothing
          : !box.power
            ? html`<button class="pill go" @click=${() => this.set(id, { power: true })}>${icon("power")}${t("sync.power_on")}</button>`
            : html`<button class="pill go ${box.syncing ? "stop" : ""}" @click=${() => this.set(id, { sync: !box.syncing })}>
                ${icon(box.syncing ? "pause" : "play")}${box.syncing ? t("sync.stop") : t("sync.start")}
              </button>`}
      </div>
      ${area ? html`<div class="area-line dim small">${area.name}</div>` : nothing}
    </div>`;
  }

  /** Picking a mode starts syncing in it, like in the Sync Box app. */
  private modeTile(id: string, box: SyncBoxInfo, mode: (typeof SYNC_MODES)[number]) {
    const { t } = this.ctx;
    const on = box.mode === mode;
    const unsupported = mode === "music" ? box.audio_supported === false : box.video_supported === false;
    return html`<button
      class=${classMap({ "mode-tile": true, on, live: on && !!box.syncing, unsupported })}
      aria-pressed=${on}
      @click=${() => this.set(id, { mode })}
    >
      <ha-icon icon=${MODE_ICONS[mode]}></ha-icon>
      <span>${t(`sync.mode_${mode}` as StringKey)}</span>
    </button>`;
  }

  private inputTile(id: string, box: SyncBoxInfo, input: SyncInput) {
    const { t } = this.ctx;
    const status = input.status === "linked" || input.status === "plugged" || input.status === "unplugged" ? input.status : null;
    return html`<button
      class=${classMap({ "input-tile": true, on: input.id === box.input, unplugged: input.status === "unplugged" })}
      aria-pressed=${input.id === box.input}
      @click=${() => this.set(id, { input: input.id })}
    >
      <ha-icon icon=${inputIcon(input)}></ha-icon>
      <div class="name">${input.name}</div>
      <div class="dim small"><i class="led ${status || ""}"></i>${status ? t(`sync.input_${status}` as StringKey) : ""}</div>
    </button>`;
  }

  private brightness(id: string, box: SyncBoxInfo) {
    const send = this.ctx.sender(`sync-bri:${id}`, BRIGHTNESS_INTERVAL, (v: number) => this.set(id, { brightness: v }));
    return html`<hue-studio-slider
      .value=${box.brightness ?? 50}
      .label=${this.ctx.t("sync.brightness")}
      .disabled=${!box.available || !box.power}
      @value-input=${(e: CustomEvent<number>) => send(e.detail)}
      @value-change=${(e: CustomEvent<number>) => {
        send(e.detail);
        send.flush();
      }}
    ></hue-studio-slider>`;
  }

  private set(id: string, change: SyncChange): void {
    this.ctx.setSync(id, change);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-sync-view": SyncView;
  }
}
