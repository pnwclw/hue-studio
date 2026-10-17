// Scanning devices' QR codes (Add devices, moving to another bridge): the Zigbee MAC and
// install code in a device's QR code let exactly that device into a bridge that takes
// install codes (Bridge Pro). In the companion app its own scanner reads them (HA's QR
// scanner does the same); elsewhere a camera sheet decodes the video with the browser's
// BarcodeDetector, or jsQR where there is none. Codes keep coming until it is closed.
//
// <hue-studio-qr-scan .ctx .open .names> fires "qr-code" (an InstallCode) per new device
// and "close". It renders its sheet itself, so it sits outside the view's scrolling body.

import { html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import type { StudioContext } from "../context.ts";
import { type InstallCode, parseQr } from "../devices.ts";
import { appScansQr, haptic, scanQrWithApp } from "../ha-internals.ts";
import { icon, LightElement } from "../ui.ts";

/** Frames looked at per second, and the widest frame decoded (px). */
const SCANS_PER_SECOND = 6;
const MAX_FRAME = 960;
/** How long "added" or "not a device's code" stays under the camera (ms). */
const NOTE_MS = 2500;

type Decode = (frame: HTMLCanvasElement) => Promise<string | null>;

/** The browser's BarcodeDetector where it reads QR codes, else jsQR (loaded only now). */
interface BarcodeDetectorClass {
  new (options: { formats: string[] }): { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
  getSupportedFormats?(): Promise<string[]>;
}

async function decoder(): Promise<Decode> {
  const Detector = (window as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
  if (Detector && (await Detector.getSupportedFormats?.().catch((): string[] => []))?.includes("qr_code")) {
    const detector = new Detector({ formats: ["qr_code"] });
    return async (frame) => (await detector.detect(frame))[0]?.rawValue ?? null;
  }
  const jsQR = (await import("jsqr")).default;
  return async (frame) => {
    const image = frame.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, frame.width, frame.height);
    return jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
  };
}

/** "Scan QR codes" and the codes read so far, by device name where known (each can be removed). */
export function qrRows(
  ctx: StudioContext,
  { codes, names = {}, sub, scan, remove }: { codes: InstallCode[]; names?: Record<string, string>; sub: string; scan: () => void; remove: (mac: string) => void },
): TemplateResult {
  const { t } = ctx;
  return html`<button class="item" @click=${scan}>
      <ha-icon icon="mdi:qrcode-scan"></ha-icon>
      <div class="grow">${t("qr.scan")}<div class="dim small">${sub}</div></div>
      <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
    </button>
    ${codes.map(
      (c) => html`<div class="item">
        <ha-icon icon="mdi:qrcode"></ha-icon>
        <div class="grow">${names[c.mac] ?? c.mac}<div class="dim small">${t("qr.scanned")}</div></div>
        <button class="round" aria-label=${t("qr.remove")} @click=${() => remove(c.mac)}>${icon("close")}</button>
      </div>`,
    )}`;
}

@customElement("hue-studio-qr-scan")
export class QrScan extends LightElement {
  @property({ attribute: false }) accessor ctx!: StudioContext;
  @property({ type: Boolean }) accessor open = false;
  /** Names of the devices expected, by MAC (`AA:BB:…`): shown when their code is read. */
  @property({ attribute: false }) accessor names: Record<string, string> = {};

  @state() private accessor camera = false;
  @state() private accessor note: { text: string; ok: boolean } | null = null;
  @state() private accessor problem: string | null = null;

  private stream?: MediaStream;
  private timer?: ReturnType<typeof setTimeout>;
  private noteTimer?: ReturnType<typeof setTimeout>;
  private seen = new Set<string>();

  protected override updated(changed: PropertyValues<this>): void {
    if (!changed.has("open")) return;
    if (this.open) this.start();
    else this.stop();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop();
  }

  /** What a code read means: a message to show, and the device's install code if it is one. */
  private take(raw: string): { text: string; ok: boolean; code?: InstallCode } {
    const { t } = this.ctx;
    const code = parseQr(raw);
    if (!code) return { text: t("qr.not_device"), ok: false };
    const name = this.names[code.mac] ?? code.mac;
    if (Object.keys(this.names).length && !this.names[code.mac]) return { text: t("qr.not_here", { name }), ok: false, code };
    return { text: t("qr.added", { name }), ok: true, code };
  }

  private found(code: InstallCode): void {
    if (this.seen.has(code.mac)) return;
    this.seen.add(code.mac);
    haptic("success");
    this.dispatchEvent(new CustomEvent<InstallCode>("qr-code", { detail: code }));
  }

  private async start(): Promise<void> {
    const { ctx } = this;
    this.seen = new Set();
    this.note = null;
    this.problem = null;
    if (appScansQr(ctx.hass)) {
      await scanQrWithApp(ctx.hass, { title: ctx.t("qr.title"), description: ctx.t("qr.description") }, (raw) => {
        const read = this.take(raw);
        if (read.code && read.ok) this.found(read.code);
        return read.text;
      });
      this.close();
      return;
    }
    this.camera = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.problem = ctx.t(window.isSecureContext ? "qr.no_camera" : "qr.not_secure");
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch {
      this.problem = ctx.t("qr.no_camera");
      return;
    }
    if (!this.open) return this.stop();
    await this.updateComplete;
    const video = this.querySelector<HTMLVideoElement>("video");
    if (!video) return this.stop();
    video.srcObject = this.stream;
    await video.play().catch(() => undefined);
    const decode = await decoder();
    const frame = document.createElement("canvas");
    const tick = async () => {
      if (!this.stream) return;
      if (video.videoWidth) {
        const scale = Math.min(1, MAX_FRAME / video.videoWidth);
        frame.width = Math.round(video.videoWidth * scale);
        frame.height = Math.round(video.videoHeight * scale);
        frame.getContext("2d", { willReadFrequently: true })!.drawImage(video, 0, 0, frame.width, frame.height);
        const raw = await decode(frame).catch(() => null);
        if (raw) this.show(raw);
      }
      this.timer = setTimeout(tick, 1000 / SCANS_PER_SECOND);
    };
    tick();
  }

  private show(raw: string): void {
    const read = this.take(raw);
    if (read.code && this.seen.has(read.code.mac)) return;
    if (read.code && read.ok) this.found(read.code);
    this.note = { text: read.text, ok: read.ok };
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => (this.note = null), NOTE_MS);
  }

  private stop(): void {
    clearTimeout(this.timer);
    clearTimeout(this.noteTimer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.camera = false;
  }

  private close(): void {
    this.stop();
    this.dispatchEvent(new CustomEvent("close"));
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.open || !this.camera) return nothing;
    const { ctx } = this;
    const { t } = ctx;
    return html`<div class=${classMap({ sheet: true, bottom: ctx.narrow })} @click=${(e: Event) => e.target === e.currentTarget && this.close()}>
      <div class="box form qr-sheet" role="dialog" aria-label=${t("qr.title")}>
        <div class="sheet-bar">
          <button class="round close" aria-label=${t("common.close")} @click=${() => this.close()}>${icon("close")}</button>
          <div class="grow">${t("qr.title")}</div>
        </div>
        <div class="qr-camera">
          ${this.problem
            ? html`<p class="lead center-text">${this.problem}</p>`
            : html`<video playsinline muted autoplay></video><div class="qr-frame"></div>`}
        </div>
        ${this.problem
          ? nothing
          : html`<p class=${classMap({ hint: true, "center-text": true, ok: !!this.note?.ok, warn: !!this.note && !this.note.ok })}>
              ${this.note?.text ?? t("qr.description")}
            </p>`}
        <div class="center"><button class="pill go" @click=${() => this.close()}>${t("qr.done")}</button></div>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-qr-scan": QrScan;
  }
}
