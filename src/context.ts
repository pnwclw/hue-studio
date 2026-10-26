// Shared state for the panel and the more-info dialog: `hass` with optimistic patches,
// bridge light info and integration config (WebSocket subscriptions), service calls.
// Not a component: the element that owns it re-renders when `onChange` fires.

import { loadGallery } from "./gallery-data.ts";
import { navigate } from "./ha-internals.ts";
import { isLegacy, splitLegacy } from "./daylight.ts";
import { localize, type Translate } from "./i18n.ts";
import { adaptiveFor, buildHome, findGroup, type Group, type Home } from "./model.ts";
import { Optimistic, predict } from "./optimistic.ts";
import { confirmed, predictSync, type SyncMemo, syncMemo } from "./sync.ts";
import type {
  AutomationConfig,
  AutomationsMessage,
  DayConfig,
  DaylightMessage,
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
  /** The lights it shows were changed here (brightness, the wheel, shuffled colors). */
  touched: boolean;
}

const TOAST_MS = 3200;
/** Like optimistic.ts: a prediction falls back to the real state after this long. */
const SYNC_PREDICTION_MS = 5000;

const SYNC_MEMO_KEY = "hue_studio.sync_memo";
/** How long (x 300 ms) a new zone may take to show up in HA. */
const ZONE_WAIT_TRIES = 40;
/** How long (x 300 ms) a saved automation may take to show up in HA. */
const AUTOMATION_WAIT_TRIES = 40;

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
  /** Automations made with Hue Studio and the others touching Hue lights (null until known). */
  automations: AutomationsMessage | null = null;
  /** Configs of our automations by entity id (HA's automation/config), read on every message. */
  automationConfigs: Record<string, AutomationConfig> = {};
  /** The message whose configs `automationConfigs` holds (null: still reading). */
  automationConfigsRead: AutomationsMessage | null = null;
  /** The global light of the day: pool, phase times, sources, mood (null until known). */
  daylight: DaylightMessage | null = null;
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
  /** Automations whose own pools are being moved into the global pool. */
  private migrating = new Set<string>();

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
    sub<DaylightMessage>("hue_studio/daylight/subscribe", (msg) => {
      this.daylight = msg;
      void this.migrateDayPools();
    });
    sub<PositionsMessage>("hue_studio/positions/subscribe", (msg) => {
      this.positions = msg;
    });
    sub<AutomationsMessage>("hue_studio/automations/subscribe", (msg) => {
      this.automations = msg;
      void this.loadAutomationConfigs(msg);
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
  watch<T>(type: string, onEvent: (msg: T) => void, params: Record<string, unknown> = {}): () => void {
    const conn = this.raw?.connection;
    if (!conn) return () => {};
    const sub = conn
      .subscribeMessage<T>((msg) => {
        onEvent(msg);
        this.onChange();
      }, { ...params, type })
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

  /** HA's page of the integration (adding a Sync Box, the bridges as services, logs). */
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

  /** One WebSocket command and its result; failures show a toast and give null. */
  async query<T>(msg: { type: string } & Record<string, unknown>, { quiet = false } = {}): Promise<T | null> {
    if (!this.raw?.callWS) return null;
    try {
      return await this.raw.callWS<T>(msg);
    } catch (err) {
      if (!quiet) this.toast(this.t("common.error", { error: (err as Error)?.message || String(err) }));
      return null;
    }
  }

  /**
   * Read the stored configs of our automations through HA's automation config API, as HA's
   * editor does (HA's `automation/config` command gives a blueprint automation already
   * expanded, without its inputs). Admins only; for others the list stays without them.
   */
  private async loadAutomationConfigs(msg: AutomationsMessage): Promise<void> {
    const configs: Record<string, AutomationConfig> = {};
    const api = this.raw?.callApi?.bind(this.raw);
    if (api) {
      await Promise.all(
        Object.entries(msg.automations).map(async ([entityId, a]) => {
          if (!a.id) return;
          try {
            const config = await api<AutomationConfig>("GET", `config/automation/config/${encodeURIComponent(a.id)}`);
            if (config) configs[entityId] = config;
          } catch {
            // Not an admin, or the automation lives outside automations.yaml: no editor here.
          }
        }),
      );
    }
    if (this.automations !== msg) return;
    this.automationConfigs = configs;
    this.automationConfigsRead = msg;
    this.onChange();
    void this.migrateDayPools();
  }

  /**
   * Automations from before 0.10 have scene pools of their own: move them into the global
   * pool (hue_studio/daylight/merge), and their weather, season and light sensor and phase
   * times into the global settings while those are not set, then save the automation
   * without them. Until then the backend still uses its pools as they are.
   */
  private async migrateDayPools(): Promise<void> {
    const daylight = this.daylight;
    if (!daylight || !this.raw?.callApi) return;
    for (const config of Object.values(this.automationConfigs)) {
      const input = config.use_blueprint?.input;
      const old = input?.scene_of_the_day as Partial<DayConfig> | undefined;
      if (!config.id || !input || !isLegacy(old) || this.migrating.has(config.id)) continue;
      this.migrating.add(config.id);
      const { local, pools, holidays, sources } = splitLegacy(old!);
      const merged = await this.query({ type: "hue_studio/daylight/merge", pools, holidays }, { quiet: true });
      if (!merged) continue;
      const global: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(sources)) if (!daylight.settings[key as keyof typeof sources]) global[key] = value;
      const own = local.settings;
      const sameTimes = JSON.stringify([own.night_from, own.shifts]) === JSON.stringify([daylight.settings.night_from, daylight.settings.shifts]);
      if (own.night_from !== undefined || own.shifts !== undefined) {
        if (daylight.settings.night_from === undefined && daylight.settings.shifts === undefined) {
          // The first automation's phase times become everybody's.
          Object.assign(global, { night_from: own.night_from, shifts: own.shifts });
          daylight.settings = { ...daylight.settings, night_from: own.night_from, shifts: own.shifts };
          delete own.night_from;
          delete own.shifts;
        } else if (sameTimes) {
          delete own.night_from;
          delete own.shifts;
        }
      }
      if (Object.keys(global).length) await this.query({ type: "hue_studio/daylight/set", ...global }, { quiet: true });
      try {
        await this.raw.callApi("POST", `config/automation/config/${encodeURIComponent(config.id)}`, {
          ...config,
          use_blueprint: { ...config.use_blueprint!, input: { ...input, scene_of_the_day: local } },
        });
      } catch (err) {
        console.warn("hue_studio: automation not saved after moving its pools", err);
      }
    }
  }

  /** Change global settings of the light of the day (hue_studio/daylight/set); shown at once. */
  async setDaylight(change: Record<string, unknown>): Promise<boolean> {
    const before = this.daylight;
    if (before) {
      const settings: Record<string, unknown> = { ...before.settings };
      for (const [key, value] of Object.entries(change)) {
        if (value === null) delete settings[key];
        else settings[key] = value;
      }
      this.daylight = { ...before, settings: settings as unknown as DaylightMessage["settings"] };
      this.onChange();
    }
    const ok = await this.ws({ type: "hue_studio/daylight/set", ...change });
    if (!ok && before) {
      this.daylight = before;
      this.onChange();
    }
    return ok;
  }

  /** A scene's tags in the global pool ({}: out of it; null: back to the ready-made ones). */
  async setSceneTags(scene: string, tags: DaylightMessage["tags"][string] | null): Promise<boolean> {
    const before = this.daylight;
    if (before) {
      const user = { ...before.user_tags };
      if (tags === null) delete user[scene];
      else user[scene] = tags;
      const effective = { ...before.tags };
      const now = tags ?? (before.settings.defaults ? before.defaults[scene] : undefined);
      if (now && Object.keys(now).length) effective[scene] = now;
      else delete effective[scene];
      this.daylight = { ...before, user_tags: user, tags: effective };
      this.onChange();
    }
    const ok = await this.ws({ type: "hue_studio/daylight/tags", scene, tags });
    if (!ok && before) {
      this.daylight = before;
      this.onChange();
    }
    return ok;
  }

  /** The automation entity of a config id, or null. */
  automationEntity(id: string): string | null {
    return Object.entries(this.automations?.automations || {}).find(([, a]) => a.id === id)?.[0] || null;
  }

  /**
   * Write an automation through HA's automation config API (what HA's editor uses); HA
   * reloads it. Then label, category and area (`area`: its one room) once its entity exists.
   */
  async saveAutomation(config: AutomationConfig, area: string | null): Promise<boolean> {
    if (!this.raw?.callApi || !config.id) return false;
    try {
      await this.raw.callApi("POST", `config/automation/config/${encodeURIComponent(config.id)}`, config);
    } catch (err) {
      this.toast(this.t("common.error", { error: (err as Error)?.message || String(err) }));
      return false;
    }
    void this.organizeAutomation(config.id, area);
    return true;
  }

  private async organizeAutomation(id: string, area: string | null): Promise<void> {
    for (let i = 0; i < AUTOMATION_WAIT_TRIES; i++) {
      const entityId = Object.keys(this.raw?.states || {}).find((e) => e.startsWith("automation.") && this.raw?.states[e].attributes.id === id);
      if (entityId) {
        await this.query({ type: "hue_studio/automations/organize", entity_id: entityId, area_id: area }, { quiet: true });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  /** Remove an automation from HA (its config and entity). */
  async deleteAutomation(id: string): Promise<boolean> {
    if (!this.raw?.callApi) return false;
    try {
      await this.raw.callApi("DELETE", `config/automation/config/${encodeURIComponent(id)}`);
      return true;
    } catch (err) {
      this.toast(this.t("common.error", { error: (err as Error)?.message || String(err) }));
      return false;
    }
  }

  /** Remove a config entry from HA (a Sync Box), as its integration page does. */
  async deleteEntry(entryId: string): Promise<boolean> {
    if (!this.raw?.callApi) return false;
    try {
      await this.raw.callApi("DELETE", `config/config_entries/entry/${encodeURIComponent(entryId)}`);
      return true;
    } catch (err) {
      this.toast(this.t("common.error", { error: (err as Error)?.message || String(err) }));
      return false;
    }
  }

  /** A page of HA itself (e.g. its automation editor). */
  openHa(path: string): void {
    navigate(path);
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
  async setConfig(change: Partial<Pick<StudioConfig, "auto_align" | "organize" | "footer" | "footer_tabs" | "gallery_seasonal" | "gallery_rules">>): Promise<boolean> {
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

  /**
   * The Hue room or zone that holds a group's scenes. A group without one (an area whose
   * lights no Hue room or zone covers exactly) gets a zone of its lights on the bridge,
   * which then matches the area by itself; null if that fails or takes too long.
   */
  async hueGroupOf(group: Group): Promise<string | null> {
    if (group.group) return group.group;
    if (!(await this.call("hue_studio", "create_zone", { entity_id: group.lights, name: group.name }, { optimistic: false }))) return null;
    // The native integration adds the zone's light entity a moment later.
    for (let i = 0; i < ZONE_WAIT_TRIES; i++) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const found = findGroup(this.home, group.key)?.group;
      if (found) return found;
    }
    this.toast(this.t("gallery.zone_wait", { name: group.name }));
    return null;
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
