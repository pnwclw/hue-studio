// Shared state for the panel and the more-info dialog: `hass` with optimistic patches,
// bridge light info and integration config (WebSocket subscriptions), service calls.
// Not a component: the element that owns it re-renders when `onChange` fires.

import { loadGallery } from "./gallery-data.ts";
import { navigate } from "./ha-internals.ts";
import { localize, type Translate } from "./i18n.ts";
import { adaptiveFor, buildHome, type Group, type Home } from "./model.ts";
import { Optimistic, predict } from "./optimistic.ts";
import type {
  Gallery,
  Hass,
  LightInfo,
  LightsMessage,
  SceneInfo,
  ScenesMessage,
  ServiceData,
  StudioConfig,
  Unsubscribe,
} from "./types.ts";
import { type Throttled, throttle } from "./ui.ts";

export const PANEL_PATH = "/hue";

/** Edits of the scene editor; null = untouched (shown and kept as the bridge has it). */
export interface SceneDraft {
  scene: string;
  name: string | null;
  /** Speed step 1-12. */
  speed: number | null;
  autoplay: boolean | null;
}

const TOAST_MS = 3200;

export class StudioContext {
  /** `hass` with pending optimistic patches applied. */
  hass!: Hass;
  t: Translate = localize(null);
  home: Home = { rooms: [], zones: [] };
  lightInfo: Record<string, LightInfo> = {};
  sceneInfo: Record<string, SceneInfo> = {};
  /** Unsaved edits of the scene editor; they survive a trip to the color wheel. */
  sceneDraft: SceneDraft | null = null;
  config: StudioConfig = { groups: {}, rooms: {} };
  gallery: Gallery | null = null;
  galleryError = false;
  narrow = false;
  /** The last toast message and whether it is still shown. */
  toastText = "";
  toastOn = false;
  /** Set by the panel: open/close HA's sidebar. */
  toggleSidebar: () => void = () => {};

  private readonly onChange: () => void;
  private readonly optimistic = new Optimistic();
  private readonly senders = new Map<string, Throttled<never[]>>();
  private raw: Hass | null = null;
  private unsubs: Promise<Unsubscribe>[] = [];
  private expiry?: ReturnType<typeof setTimeout>;
  private toastTimer?: ReturnType<typeof setTimeout>;

  /** @param onChange called when anything shown may have changed */
  constructor(onChange: () => void) {
    this.onChange = onChange;
    loadGallery()
      .then((g) => {
        this.gallery = g;
        this.onChange();
      })
      .catch((err) => {
        console.error("hue_studio: gallery failed to load", err);
        this.galleryError = true;
        this.onChange();
      });
  }

  get ready(): boolean {
    return this.raw !== null;
  }

  /** New `hass` from HA. */
  setHass(hass: Hass): void {
    const first = !this.raw;
    this.raw = hass;
    if (first) this.subscribe(hass);
    this.refresh();
  }

  /** Recompute derived state (call after optimistic changes too). */
  refresh(): void {
    if (!this.raw) return;
    this.hass = this.optimistic.apply(this.raw);
    this.t = localize(this.hass);
    this.home = buildHome(this.hass, this.config);
  }

  private subscribe(hass: Hass): void {
    const conn = hass.connection;
    if (!conn) return;
    const sub = <T>(type: string, onEvent: (msg: T) => void) =>
      this.unsubs.push(
        conn
          .subscribeMessage<T>((msg) => {
            onEvent(msg);
            this.refresh();
            this.onChange();
          }, { type })
          // The UI works without our backend parts (no gamut clipping, no mapping).
          .catch((err) => {
            console.warn(`hue_studio: ${type} unavailable`, err);
            return () => {};
          }),
      );
    sub<LightsMessage>("hue_studio/lights/subscribe", (msg) => Object.assign(this.lightInfo, msg.lights));
    sub<ScenesMessage>("hue_studio/scenes/subscribe", (msg) => Object.assign(this.sceneInfo, msg.scenes));
    sub<StudioConfig>("hue_studio/config/subscribe", (msg) => {
      this.config = msg;
    });
  }

  dispose(): void {
    for (const p of this.unsubs) p.then((unsub) => unsub()).catch(() => {});
    this.unsubs = [];
    clearTimeout(this.expiry);
    clearTimeout(this.toastTimer);
  }

  go(path: string): void {
    navigate(`${PANEL_PATH}${path}`);
  }

  /** A throttled command sender that survives re-renders (one per key). */
  sender<A extends unknown[]>(key: string, interval: number, fn: (...args: A) => void): Throttled<A> {
    let s = this.senders.get(key) as Throttled<A> | undefined;
    if (!s) {
      s = throttle(fn, interval);
      this.senders.set(key, s as unknown as Throttled<never[]>);
    }
    return s;
  }

  /** Deliver every pending throttled command now (end of a drag). */
  flushSenders(prefix = ""): void {
    for (const [key, s] of this.senders) if (key.startsWith(prefix)) s.flush();
  }

  /**
   * Call a service; the expected result shows immediately. On failure the UI falls back
   * to the real state and an error toast. Resolves to true on success.
   */
  async call(domain: string, service: string, data: ServiceData, { optimistic = true } = {}): Promise<boolean> {
    if (!this.raw) return false;
    if (optimistic) {
      this.optimistic.add(predict(this.hass, domain, service, data));
      this.refresh();
      this.onChange();
      // If HA never confirms, drop the prediction after its timeout.
      clearTimeout(this.expiry);
      this.expiry = setTimeout(() => {
        this.refresh();
        this.onChange();
      }, 5100);
    }
    try {
      await this.raw.callService(domain, service, data);
      return true;
    } catch (err) {
      this.optimistic.items.clear();
      this.refresh();
      this.toast(this.t("common.error", { error: (err as Error)?.message || String(err) }));
      return false;
    }
  }

  /** Scenes change lights behind HA's back: tell Adaptive Lighting they are manual now. */
  async markManual(group: Group): Promise<void> {
    for (const al of adaptiveFor(this.hass, group)) {
      if (!al.on) continue;
      await this.call(
        "adaptive_lighting",
        "set_manual_control",
        { entity_id: al.switch, lights: al.lights, manual_control: true },
        { optimistic: false },
      );
    }
  }

  /** Show a short message at the bottom of the panel or dialog. */
  toast(text: string): void {
    this.toastText = text;
    this.toastOn = true;
    this.onChange();
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastOn = false;
      this.onChange();
    }, TOAST_MS);
  }
}
