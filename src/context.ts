// Shared state for the panel and the more-info dialog: `hass` with optimistic patches,
// bridge light info and integration config (WebSocket subscriptions), service calls.
// Not a component: the element that owns it re-renders when `onChange` fires.

import { loadGallery } from "./gallery-data.ts";
import { navigate } from "./ha-internals.ts";
import { localize, type Translate } from "./i18n.ts";
import { adaptiveFor, buildHome, type Group, type Home } from "./model.ts";
import { Optimistic, predict } from "./optimistic.ts";
import { confirmed, predictSync, type SyncMemo, syncMemo } from "./sync.ts";
import type {
  AutoLightMessage,
  Gallery,
  Hass,
  LightInfo,
  LightsMessage,
  PositionsMessage,
  RoomsPlan,
  SceneInfo,
  ScenesMessage,
  ServiceData,
  StudioConfig,
  SyncBoxInfo,
  SyncChange,
  SyncMessage,
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
/** Like optimistic.ts: a prediction falls back to the real state after this long. */
const SYNC_PREDICTION_MS = 5000;

const SYNC_MEMO_KEY = "hue_studio.sync_memo";

/** Sync Boxes' switches and lights, for HA's more-info before any WebSocket answer (per browser). */
export function loadSyncMemo(): SyncMemo {
  try {
    return JSON.parse(localStorage.getItem(SYNC_MEMO_KEY) || "{}") as SyncMemo;
  } catch {
    return {};
  }
}

function saveSyncMemo(memo: SyncMemo): void {
  try {
    localStorage.setItem(SYNC_MEMO_KEY, JSON.stringify(memo));
  } catch {
    // Private mode or blocked storage: more-info then learns it once the dialog subscribed.
  }
}

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
  /** How the bridge's rooms differ from the HA areas (null until known). */
  rooms: RoomsPlan | null = null;
  /** The backend could not send the plan (older version, or no bridge). */
  roomsUnavailable = false;
  /** Where the Hue lights of each area stand (null until known). */
  positions: PositionsMessage | null = null;
  /** Auto light settings and state of the areas (null until known). */
  autoLight: AutoLightMessage | null = null;
  /** Sync Boxes by config entry id, with pending predictions applied. */
  boxes: Record<string, SyncBoxInfo> = {};
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
  private syncExpiry?: ReturnType<typeof setTimeout>;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private rawBoxes: Record<string, SyncBoxInfo> = {};
  private syncPredictions = new Map<string, { box: SyncBoxInfo; until: number }>();

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
    const now = Date.now();
    this.boxes = { ...this.rawBoxes };
    for (const [id, p] of this.syncPredictions) {
      const actual = this.rawBoxes[id];
      if (!actual || p.until < now || confirmed(p.box, actual)) this.syncPredictions.delete(id);
      else this.boxes[id] = p.box;
    }
  }

  private subscribe(hass: Hass): void {
    const conn = hass.connection;
    if (!conn) return;
    const sub = <T>(type: string, onEvent: (msg: T) => void, onError?: () => void) =>
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
            onError?.();
            this.onChange();
            return () => {};
          }),
      );
    sub<LightsMessage>("hue_studio/lights/subscribe", (msg) => Object.assign(this.lightInfo, msg.lights));
    sub<ScenesMessage>("hue_studio/scenes/subscribe", (msg) => Object.assign(this.sceneInfo, msg.scenes));
    sub<StudioConfig>("hue_studio/config/subscribe", (msg) => {
      this.config = msg;
    });
    sub<SyncMessage>("hue_studio/sync/subscribe", (msg) => {
      this.rawBoxes = msg.boxes;
      saveSyncMemo(syncMemo(msg.boxes));
    });
    sub<PositionsMessage>("hue_studio/positions/subscribe", (msg) => {
      this.positions = msg;
    });
    sub<AutoLightMessage>("hue_studio/auto_light/subscribe", (msg) => {
      this.autoLight = msg;
    });
    sub<RoomsPlan>(
      "hue_studio/rooms/subscribe",
      (msg) => {
        this.rooms = msg;
      },
      () => (this.roomsUnavailable = true),
    );
  }

  /**
   * Subscribe while a screen needs it (admin-only data such as the device setup).
   * Returns the unsubscribe function; failures show a toast.
   */
  watch<T>(type: string, onEvent: (msg: T) => void): () => void {
    const conn = this.raw?.connection;
    if (!conn) return () => {};
    const sub = conn
      .subscribeMessage<T>((msg) => {
        onEvent(msg);
        this.onChange();
      }, { type })
      .catch((err) => {
        this.toast(String(err?.message || err));
        return () => {};
      });
    return () => void sub.then((unsub) => unsub()).catch(() => {});
  }

  dispose(): void {
    for (const p of this.unsubs) p.then((unsub) => unsub()).catch(() => {});
    this.unsubs = [];
    clearTimeout(this.expiry);
    clearTimeout(this.toastTimer);
    clearTimeout(this.syncExpiry);
  }

  go(path: string): void {
    navigate(`${PANEL_PATH}${path}`);
  }

  /** HA's page of the integration (its options hold the room mapping). */
  openSettings(): void {
    navigate("/config/integrations/integration/hue_studio");
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

  /** Change a Sync Box (one `hue_studio.set_sync` call); the result shows at once. */
  async setSync(boxId: string, change: SyncChange): Promise<boolean> {
    const box = this.boxes[boxId];
    if (!box?.entity_id) return false;
    this.syncPredictions.set(boxId, { box: predictSync(box, change), until: Date.now() + SYNC_PREDICTION_MS });
    this.refresh();
    this.onChange();
    clearTimeout(this.syncExpiry);
    this.syncExpiry = setTimeout(() => {
      this.refresh();
      this.onChange();
    }, SYNC_PREDICTION_MS + 100);
    const ok = await this.call("hue_studio", "set_sync", { entity_id: box.entity_id, ...change }, { optimistic: false });
    if (!ok) {
      this.syncPredictions.delete(boxId);
      this.refresh();
      this.onChange();
    }
    return ok;
  }

  /** One WebSocket command; failures show a toast. Resolves to true on success. */
  async ws(msg: { type: string } & Record<string, unknown>): Promise<boolean> {
    if (!this.raw?.callWS) return false;
    try {
      await this.raw.callWS(msg);
      return true;
    } catch (err) {
      this.toast(this.t("common.error", { error: (err as Error)?.message || String(err) }));
      return false;
    }
  }

  /** Put a Hue light into an HA area (null: no area). Resolves to true on success. */
  async setArea(light: string, area: string | null): Promise<boolean> {
    if (!this.raw?.callWS) return false;
    try {
      await this.raw.callWS({ type: "hue_studio/lights/set_area", entity_id: light, area_id: area });
      return true;
    } catch (err) {
      this.toast(this.t("common.error", { error: (err as Error)?.message || String(err) }));
      return false;
    }
  }

  /** Change integration options from the panel (hue_studio/config/set); shown at once. */
  async setConfig(change: Partial<Pick<StudioConfig, "auto_align" | "footer" | "footer_tabs" | "gallery_seasonal" | "gallery_windows">>): Promise<boolean> {
    if (!this.raw?.callWS) return false;
    const before = this.config;
    this.config = { ...this.config, ...change };
    this.onChange();
    try {
      await this.raw.callWS({ type: "hue_studio/config/set", ...change });
      return true;
    } catch (err) {
      this.config = before;
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
