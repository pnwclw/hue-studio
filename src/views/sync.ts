// Sync: the Hue Play HDMI Sync Box, like the Sync tab of the Hue app. Start/stop, mode,
// intensity, brightness, HDMI input and entertainment area; every change is one
// `hue_studio.set_sync` call and shows at once (StudioContext.setSync).

import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import type { StringKey } from "../i18n.ts";
import { friendlyName } from "../model.ts";
import { currentArea, currentInput, INTENSITIES, statusKey, SYNC_MODES } from "../sync.ts";
import type { SyncBoxInfo, SyncChange, SyncInput } from "../types.ts";
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

@customElement("hue-studio-sync-view")
export class SyncView extends StudioView {
  /** Config entry id of the box to show (null: the first one). */
  @property() accessor box: string | null = null;

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
