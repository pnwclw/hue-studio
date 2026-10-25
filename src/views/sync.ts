// Sync: the Hue Play HDMI Sync Box, the Hue app's Sync tab. What plays (the input's picture),
// mode, intensity and brightness as three buttons that open their popovers, and a dock:
// what (the HDMI input), start/stop, where (the entertainment area). Every change is one
// `hue_studio.set_sync` call and shows at once (StudioContext.setSync). A box paired
// directly also has the music palette, background lighting (in the mode popover), presets
// and remote buttons ("⋯").

import { html, nothing, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import { BrightnessControl, type BrightnessSource, tileCard } from "../controls.ts";
import { haptic } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import { currentArea, currentInput, hasFeature, inputIcon, INTENSITIES, IR_ACTIONS, PALETTES, statusKey, SYNC_MODES } from "../sync.ts";
import type { SyncBoxInfo, SyncChange, SyncIrCode } from "../types.ts";
import { icon, toggle } from "../ui.ts";
import { StudioView } from "./base.ts";

const MODE_ICONS: Record<string, string> = {
  video: "mdi:monitor",
  music: "mdi:headphones",
  game: "mdi:controller",
};

/** The intensities as the Hue app draws them: a wave, higher (and then twice) as it grows. */
const WAVES: Record<string, string> = {
  subtle: "M4 12c2.7-1.6 5.3-1.6 8 0s5.3 1.6 8 0",
  moderate: "M4 12c2.7-4.4 5.3-4.4 8 0s5.3 4.4 8 0",
  high: "M4 12c2.7-9.4 5.3-9.4 8 0s5.3 9.4 8 0",
  intense: "M3 12c1.5-9.4 3-9.4 4.5 0s3 9.4 4.5 0 3-9.4 4.5 0 3 9.4 4.5 0",
};
const wave = (level: string) =>
  html`<svg class="wave" viewBox="0 0 24 24" aria-hidden="true">${svg`<path d=${WAVES[level]} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>`}</svg>`;

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

/** What is open over the screen: a popover above the controls, or a sheet. */
type Open = { kind: "mode" | "intensity"; at: { top: number; center: number; width: number } } | { kind: "what" | "where" | "more" };

@customElement("hue-studio-sync-view")
export class SyncView extends StudioView {
  /** Config entry id of the box to show (null: the first one). */
  @property() accessor box: string | null = null;
  @state() private accessor open: Open | null = null;
  /** The "save as preset" sheet: the name typed so far (null: closed). */
  @state() private accessor presetName: string | null = null;
  @state() private accessor ir: IrDraft | null = null;
  private readonly bri = new BrightnessControl(this);

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const ids = Object.keys(ctx.boxes);
    const id = this.box && ctx.boxes[this.box] ? this.box : ids[0];
    const box = id ? ctx.boxes[id] : undefined;
    const actions = html`
      <button class="round" aria-label=${t("bridges.add_box")} @click=${() => ctx.openSettings()}>${icon("plus")}</button>
      ${box ? html`<button class="round" aria-label=${t("sync.settings")} @click=${() => (this.open = { kind: "more" })}>${icon("dots")}</button>` : nothing}
      ${box?.available ? toggle(!!box.power, t("sync.power"), () => this.set(id, { power: !box.power })) : nothing}`;
    if (!box) return this.tabScreen(t("sync.title"), html`<p class="empty">${this.box ? t("sync.not_found") : t("sync.none")}</p>`, { end: actions });
    const bri = this.briSource(id, box);
    return html`${this.tabScreen(t("sync.title"), this.stage(id, box, ids), { end: actions, cls: "sync-page" })}
      ${this.bri.layer(bri)}
      ${this.open?.kind === "mode" || this.open?.kind === "intensity" ? this.popCard(id, box, this.open.kind, this.open.at) : nothing}
      ${this.open?.kind === "what" ? this.whatSheet(id, box) : nothing}
      ${this.open?.kind === "where" ? this.whereSheet(id, box) : nothing}
      ${this.open?.kind === "more" ? this.moreSheet(id, box) : nothing}
      ${this.presetName !== null ? this.presetSheet(box) : nothing} ${this.ir ? this.irSheet(box, this.ir) : nothing}
      ${this.askSheet()}`;
  }

  /** The screen: the box (when there are several), what plays, the three controls, the dock. */
  private stage(id: string, box: SyncBoxInfo, ids: string[]) {
    const { ctx } = this;
    const { t } = ctx;
    const input = currentInput(box);
    const area = currentArea(box);
    const off = !box.available || !box.power;
    const status = off || box.syncing || !input?.status ? t(statusKey(box)) : t(`sync.input_${input.status}` as StringKey);
    // The popover sits over the column, its bottom just above the label of the button that
    // opened it (anchored to the button, not to the window's height, which the visible area
    // may not match).
    const pop = (kind: "mode" | "intensity") => (e: Event) => {
      haptic("light");
      const button = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const column = (e.currentTarget as HTMLElement).closest(".sync-stage")!.getBoundingClientRect();
      this.open = { kind, at: { top: button.top - 44, center: column.left + column.width / 2, width: column.width } };
    };
    return html`<div class="sync-stage">
      ${ids.length > 1
        ? html`<div class="chips boxes">${ids.map(
            (other) => html`<button class=${classMap({ chip: true, on: other === id })} @click=${() => ctx.go(`/sync?box=${encodeURIComponent(other)}`)}>
              ${ctx.boxes[other].name || other}
            </button>`,
          )}</div>`
        : nothing}
      <div class=${classMap({ "sync-picture": true, syncing: !!box.syncing, off, [`m-${box.mode}`]: true })}>
        <div class="glow"></div>
        <ha-icon icon=${inputIcon(input)}></ha-icon>
      </div>
      <div class="sync-caption">
        <div class="caps">${box.name || "Sync Box"}</div>
        <div class="sync-what">${input?.name || t("sync.title")}</div>
        <div class="sync-status">${status}</div>
      </div>
      <div class=${classMap({ "sync-controls": true, inert: off })}>
        <div class="sync-ctl">
          <div class="bri-value">${t("sync.mode")}</div>
          <button class="sync-pill" aria-label=${t("sync.mode")} aria-haspopup="dialog" ?disabled=${off} @click=${pop("mode")}>
            <ha-icon icon=${MODE_ICONS[box.mode || "video"]}></ha-icon>
          </button>
        </div>
        <div class="sync-ctl">
          <div class="bri-value">${t("sync.intensity")}</div>
          <button class="sync-pill" aria-label=${t("sync.intensity")} aria-haspopup="dialog" ?disabled=${off} @click=${pop("intensity")}>
            ${wave(box.intensity || "moderate")}
          </button>
        </div>
        <div class="sync-ctl">${this.bri.button(this.briSource(id, box))}</div>
      </div>
      <div class=${classMap({ "sync-dock": true, inert: !box.available })}>
        <button class="dock-side" ?disabled=${off} @click=${() => (this.open = { kind: "what" })}>
          <span class="dock-round"><ha-icon icon=${inputIcon(input)}></ha-icon></span>
          <span class="caps">${t("sync.what")}</span><span class="dock-value">${input?.name || "–"}</span>
        </button>
        <button
          class=${classMap({ "dock-go": true, on: !!box.syncing, [`m-${box.mode}`]: true })}
          aria-label=${box.syncing ? t("sync.stop") : t("sync.start")}
          aria-pressed=${!!box.syncing}
          ?disabled=${!box.available}
          @click=${() => {
            haptic("medium");
            this.set(id, box.power ? { sync: !box.syncing } : { power: true, sync: true });
          }}
        >${icon("sync")}</button>
        <button class="dock-side" ?disabled=${off} @click=${() => (this.open = { kind: "where" })}>
          <span class="dock-round"><ha-icon icon="mdi:lightbulb-group"></ha-icon></span>
          <span class="caps">${t("sync.where")}</span><span class="dock-value">${area?.name || "–"}</span>
        </button>
      </div>
    </div>`;
  }

  private briSource(id: string, box: SyncBoxInfo): BrightnessSource {
    const send = this.ctx.sender(`sync-bri:${id}`, BRIGHTNESS_INTERVAL, (v: number) => this.set(id, { brightness: v }));
    return {
      value: box.brightness ?? 50,
      inert: !box.available || !box.power,
      caption: this.ctx.t("sync.brightness"),
      label: this.ctx.t("sync.brightness"),
      send: (v) => send(v),
      flush: () => send.flush(),
    };
  }

  /** The mode or intensity popover above the controls, over a dimmed screen. */
  private popCard(id: string, box: SyncBoxInfo, kind: "mode" | "intensity", at: { top: number; center: number; width: number }) {
    const { t } = this.ctx;
    const close = () => (this.open = null);
    const pick = (change: SyncChange) => {
      haptic("selection");
      this.set(id, change);
    };
    const body =
      kind === "mode"
        ? html`<div class="pop-modes">${SYNC_MODES.map((mode) => {
              const on = box.mode === mode;
              const unsupported = mode === "music" ? box.audio_supported === false : box.video_supported === false;
              return html`<button class=${classMap({ "pop-mode": true, on, unsupported })} aria-pressed=${on} @click=${() => pick({ mode })}>
                <ha-icon icon=${MODE_ICONS[mode]}></ha-icon><span>${t(`sync.mode_${mode}` as StringKey)}</span>
              </button>`;
            })}</div>
            ${this.modeSettings(id, box)}`
        : html`<div class="pop-waves" role="radiogroup" aria-label=${t("sync.intensity")}>${INTENSITIES.map(
            (level) => html`<button role="radio" class=${classMap({ "pop-wave": true, on: box.intensity === level })} aria-checked=${box.intensity === level}
              aria-label=${t(`sync.intensity_${level}` as StringKey)} title=${t(`sync.intensity_${level}` as StringKey)} @click=${() => pick({ intensity: level })}>${wave(level)}</button>`,
          )}</div>`;
    return html`<div class="pop-layer" @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="pop-card" role="dialog" aria-label=${t(`sync.${kind}` as StringKey)}
        style=${styleMap({ top: `${at.top}px`, left: `${at.center}px`, width: `min(400px, ${at.width - 24}px)` })}>
        <div class="pop-title">${t(`sync.${kind}` as StringKey)}</div>
        ${body}
      </div>
    </div>`;
  }

  /** Music: the palette; video and game: background lighting (a box paired directly). */
  private modeSettings(id: string, box: SyncBoxInfo) {
    const { t } = this.ctx;
    if (box.mode === "music" && hasFeature(box, "palette")) {
      return html`<div class="pop-sub caps">${t("sync.palette")}</div>
        <div class="palettes">${PALETTES.map(
          (p) => html`<button class=${classMap({ palette: true, on: box.palette === p })} aria-pressed=${box.palette === p} @click=${() => this.set(id, { palette: p })}>
            <span class="art" style="background:${PALETTE_ART[p]}"></span><span>${t(`sync.palette_${p}` as StringKey)}</span>
          </button>`,
        )}</div>`;
    }
    if ((box.mode === "video" || box.mode === "game") && hasFeature(box, "background_lighting")) {
      const on = !!box.background_lighting?.[box.mode];
      return html`<div class="pop-row">
        <div class="grow">${t("sync.background")}<div class="dim small">${t("sync.background_sub")}</div></div>
        ${toggle(on, t("sync.background"), () => this.set(id, { background_lighting: !on }))}
      </div>`;
    }
    return nothing;
  }

  /** A sheet: its bar (close, title, an action) over the body. */
  private sheet(title: string, body: unknown, end: unknown = nothing) {
    const { ctx } = this;
    const close = () => (this.open = null);
    return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && close()}>
      <div class="box form sensor-sheet choice-sheet sync-sheet" role="dialog" aria-label=${title}>
        <div class="sheet-bar">
          <button class="round close" aria-label=${ctx.t("common.close")} @click=${close}>${icon("close")}</button>
          <div class="grow">${title}</div>
          ${end}
        </div>
        <div class="form-body">${body}</div>
      </div>
    </div>`;
  }

  /** "What": the box's HDMI inputs as tiles, the one in use checked (the Hue app's "Sync options"). */
  private whatSheet(id: string, box: SyncBoxInfo) {
    const { t } = this.ctx;
    const inputs = box.inputs || [];
    return this.sheet(
      t("sync.options"),
      html`<h2 class="label">${t("sync.input")}</h2>
        <div class="rows sync-inputs">
          <div class="item"><div class="grow">${box.name || "Sync Box"}</div></div>
          <div class="input-row">${inputs.map((input) => {
            const on = input.id === box.input;
            const status = input.status === "linked" || input.status === "plugged" || input.status === "unplugged" ? t(`sync.input_${input.status}` as StringKey) : "";
            return tileCard({
              art: html`<ha-icon icon=${inputIcon(input)}></ha-icon>`,
              name: input.name,
              sub: [status],
              toggle: html`<span class=${classMap({ check: true, on })}>${icon("check")}</span>`,
              classes: { "input-tile": true, on, unplugged: input.status === "unplugged" },
              click: () => {
                haptic("selection");
                this.set(id, { input: input.id });
              },
            });
          })}</div>
        </div>`,
    );
  }

  /** "Where": the entertainment areas, the one in use ticked; a new one in Settings. */
  private whereSheet(id: string, box: SyncBoxInfo) {
    const { ctx } = this;
    const { t } = ctx;
    return this.sheet(
      t("sync.area"),
      html`<p class="hint">${t("sync.area_pick")}</p>
        <div class="rows choice-list">
          ${(box.areas || []).map(
            (area) => html`<button class=${classMap({ item: true, on: area.id === box.area })} role="radio" aria-checked=${area.id === box.area}
              @click=${() => {
                haptic("selection");
                this.set(id, { entertainment_area: area.id });
              }}>
              <div class="grow">${area.name}</div>
              ${area.id === box.area ? html`<span class="tick">${icon("check")}</span>` : nothing}
            </button>`,
          )}
          <button class="item" @click=${() => ctx.go("/settings/entertainment")}>
            <span class="round plus-blue">${icon("plus")}</span>
            <div class="grow">${t("sync.area_create")}</div>
          </button>
        </div>`,
    );
  }

  /** "⋯": the box's own settings, then (paired directly) presets and remote buttons. */
  private moreSheet(id: string, box: SyncBoxInfo) {
    const { ctx } = this;
    const { t } = ctx;
    return this.sheet(
      t("sync.settings"),
      html`<div class="rows">
          <button class="item" @click=${() => ctx.go(`/settings/bridges/${encodeURIComponent(id)}`)}>
            <ha-icon icon="hue-studio:sync"></ha-icon>
            <div class="grow">${t("sync.device")}<div class="dim small">${box.name || "Sync Box"}</div></div>
            <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
          </button>
        </div>
        ${hasFeature(box, "presets") ? this.presets(id, box) : nothing}
        ${hasFeature(box, "ir") ? this.remote(box) : nothing}`,
    );
  }

  /** Presets of the box: start one, save the current state, delete. */
  private presets(id: string, box: SyncBoxInfo) {
    const { ctx } = this;
    const { t } = ctx;
    const remove = (preset: string, name: string) =>
      this.askDelete(t("sync.preset_delete_note", { name }), t("sync.preset_delete"), () =>
        void ctx.call("hue_studio", "delete_sync_preset", { entity_id: box.entity_id!, preset }, { optimistic: false }),
      );
    return html`<h2 class="label">${t("sync.presets")}</h2>
      <div class="rows">
        ${(box.presets || []).map(
          (p) => html`<div class="item">
            <ha-icon icon="mdi:bookmark-outline"></ha-icon>
            <button class="grow plain" @click=${() => this.set(id, { preset: p.id })}>${p.name}</button>
            <button class="round mini-step" aria-label=${t("sync.preset_delete")} @click=${() => remove(p.id, p.name)}>
              <ha-icon icon="mdi:delete-outline"></ha-icon>
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
    return html`<h2 class="label">${t("sync.remote")}</h2>
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

  private set(id: string, change: SyncChange): void {
    this.ctx.setSync(id, change);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-sync-view": SyncView;
  }
}
