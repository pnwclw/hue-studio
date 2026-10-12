// The parts of Home Assistant's frontend `hass` object and of our own WebSocket payloads
// that the panel uses. HA's own types are not published as a package, so this is a minimal
// hand-written subset; everything here is documented frontend API.

export type XY = [number, number];
export type RGB = [number, number, number];

export interface HassState {
  entity_id?: string;
  state: string;
  /** ISO time of the last state change. */
  last_changed?: string;
  // Attributes depend on the domain and integration.
  attributes: Record<string, any>;
}

export interface HassEntityEntry {
  platform?: string;
  device_id?: string | null;
  area_id?: string | null;
  icon?: string | null;
  translation_key?: string | null;
}

export interface HassArea {
  name: string;
  icon?: string | null;
  temperature_entity_id?: string | null;
}

export type Unsubscribe = () => void;

export interface HassConnection {
  subscribeMessage<T>(callback: (msg: T) => void, msg: { type: string }): Promise<Unsubscribe>;
}

export type ServiceData = Record<string, unknown> & { entity_id?: string | string[] };

/** The data part of `hass` (what the pure model functions read). */
export interface HassData {
  states: Record<string, HassState>;
  entities?: Record<string, HassEntityEntry>;
  /** `entry_type` "service": not a physical device (the `hue` integration's Hue rooms and zones). */
  devices?: Record<
    string,
    { area_id?: string | null; name?: string | null; name_by_user?: string | null; model?: string | null; entry_type?: string | null }
  >;
  areas?: Record<string, HassArea>;
  config?: { location_name?: string };
  language?: string;
  /** `time_format`: "12", "24", "language" or "system" (HA's profile setting). */
  locale?: { language: string; time_format?: string };
}

/** A Hue device in the "Add devices" screen (hue_studio/devices/subscribe). */
export interface HueDeviceInfo {
  /** The bridge's device id. */
  id: string;
  name: string;
  product: string;
  model: string;
  archetype: string;
  kind: "light" | "switch" | "sensor" | "other";
  /** Added while Home Assistant runs and not set up yet. */
  new: boolean;
  found: number | null;
  area: string | null;
  lights: string[];
  /** Its HA device id, or null. */
  ha_device: string | null;
  /** A motion sensor's sensitivity (0..max; `changing`: calibrating to it), else null. */
  sensitivity: { value: number; max: number; changing?: boolean } | null;
  software?: string | null;
  /** Whether the bridge reaches it over Zigbee (null: the bridge does not say). */
  reachable?: boolean | null;
  /** A light's function (the Hue app's "How you use this light"), else null. */
  function?: LightFunction | null;
  /** A light's power-up preset (the Hue app's "Power on"), else null. */
  power_on?: PowerOn | null;
}

export type LightFunction = "functional" | "decorative" | "mixed";
/** "custom" is set in the Hue app only: shown, not picked. */
export type PowerOn = "safety" | "powerfail" | "last_on_state" | "custom";

/** One bridge's devices (hue_studio/devices/subscribe). */
export interface BridgeDevices {
  name: string;
  /** null: the bridge cannot search through its API. */
  searching: boolean | null;
  /** When a search through Hue Studio started (seconds), while the bridge searches. */
  search_started?: number | null;
  /** The search can also let other brands' Zigbee lights join. */
  other_brands?: boolean;
  devices: HueDeviceInfo[];
}

/** Per bridge (native hue entry id). */
export type DevicesMessage = Record<string, BridgeDevices>;

/** Entertainment areas per bridge (hue_studio/entertainment/subscribe). */
export type EntertainmentMessage = Record<string, { name: string; lights: string[]; areas: EntertainmentArea[] }>;

export interface EntertainmentArea {
  id: string;
  name: string;
  type: "screen" | "monitor" | "music" | "3dspace" | "other";
  streaming: boolean;
  /** Light entity id -> its points (x, y, z in -1..1). */
  lights: Record<string, RoomPoint[]>;
}

/** Bridges and their MotionAware areas (hue_studio/bridges/subscribe). */
export type BridgesMessage = Record<string, BridgeInfo>;

/** A bridge of the native integration; one Hue Studio is not connected to has its entry's facts only. */
export interface BridgeInfo {
  name: string;
  connected?: boolean;
  host: string | null;
  id: string;
  model: string | null;
  software: string | null;
  /** A Hue Bridge Pro (MotionAware). */
  pro?: boolean;
  /** The native bridge device in HA. */
  ha_device?: string | null;
  /** How many devices (lights, switches, sensors) and lights it has. */
  devices?: number | null;
  lights?: number | null;
  /** null: no MotionAware on this bridge. */
  motion_areas: MotionArea[] | null;
}

export interface MotionArea {
  id: string;
  name: string;
  group: string | null;
  enabled: boolean;
  health: string;
  lights: { entity_id: string | null; health: string }[];
}

/** A sidebar panel (`hass.panels`). */
export interface HassPanel {
  url_path: string;
  /** A dashboard's title, or a translation key for built-in panels ("map", "history"). */
  title: string | null;
  icon: string | null;
  component_name?: string;
}

export interface Hass extends HassData {
  connection?: HassConnection;
  /** The signed-in user (HA's automation config API is for administrators only). */
  user?: { is_admin?: boolean };
  panels?: Record<string, HassPanel>;
  /** HA's own translations ("panel.map", …). */
  localize?: (key: string) => string;
  callService(domain: string, service: string, data?: ServiceData): Promise<unknown>;
  /** One WebSocket command (HA's frontend API). */
  callWS?<T>(msg: { type: string } & Record<string, unknown>): Promise<T>;
  /** HA's REST API (e.g. the automation config API its editor uses). */
  callApi?<T>(method: "GET" | "POST" | "DELETE", path: string, data?: Record<string, unknown>): Promise<T>;
}

/** Bridge info of one light (hue_studio/lights/subscribe). */
export interface LightInfo {
  gamut?: XY[] | null;
  gamut_type?: string | null;
  mirek?: [number, number] | null;
  gradient?: {
    points_capable: number;
    points: XY[];
    mode?: string | null;
    modes?: string[];
  } | null;
  /** Effects the light can play (no "no_effect"). */
  effects?: string[];
  /** The running effect and its parameters, or null. */
  effect?: RunningEffect | null;
  /** Hue archetype (e.g. "hue_signe": the shape chosen in the Hue app), for the light's icon. */
  archetype?: string | null;
  /** Product name (e.g. "Signe gradient table"): one archetype can be several products. */
  product?: string | null;
}

export interface RunningEffect {
  effect: string;
  xy?: XY;
  mirek?: number;
  /** 0-1. */
  speed?: number;
}

export interface LightsMessage {
  lights: Record<string, LightInfo>;
}

/** Bridge info of one Hue scene (hue_studio/scenes/subscribe). */
export interface SceneInfo {
  active: "inactive" | "static" | "dynamic_palette" | string;
  /** Has a palette that can play dynamically. */
  dynamic: boolean;
  /** Has a palette to rebuild the scene from. */
  resettable: boolean;
  /** Dynamic speed, 0-1. */
  speed: number;
  auto_dynamic: boolean;
  palette: XY[];
  mirek: number[];
  /** Light entity ids the scene sets. */
  lights: string[];
  /** Id of the scene's picture in the Hue app (`public_image` of a gallery scene). */
  image: string | null;
}

export interface ScenesMessage {
  scenes: Record<string, SceneInfo>;
}

export interface RoomSensors {
  motion: string[];
  temperature: string[];
  illuminance: string[];
}

/** Integration options (hue_studio/config/subscribe). */
export interface StudioConfig {
  /** Hue group entity id -> area id, or "zone". */
  groups: Record<string, string>;
  /** Room key -> sensors overriding the defaults. */
  rooms: Record<string, Partial<RoomSensors>>;
  /** Hue rooms follow area changes automatically (an option of the integration). */
  auto_align?: boolean;
  /** Experimental: the "Liquid Glass" footer on phones, and its tabs (panel url paths). */
  footer?: boolean;
  footer_tabs?: string[];
  /** Scene gallery: each category only in its time; the user's rules (seasons, a "MM-DD" window) per category. */
  gallery_seasonal?: boolean;
  gallery_rules?: Record<string, { seasons?: ("winter" | "spring" | "summer" | "autumn")[]; window?: [string, string] }>;
}

/** The Hue room of an area after alignment (hue_studio/rooms/subscribe). */
export interface RoomTarget {
  area: string;
  /** The room's name after alignment (the area's). */
  name: string;
  create: boolean;
  rename: boolean;
  current_name: string | null;
  /** The existing room's grouped light entity. */
  group: string | null;
  lights: string[];
}

/** Lights (of one device) going to the room of an area. */
export interface RoomMove {
  lights: string[];
  area: string;
  /** Name of the Hue room they are in now, or null. */
  from: string | null;
  from_group: string | null;
  /** Area whose room they are in now: a mismatch, e.g. moved in the Hue app. */
  from_area: string | null;
}

export interface SceneChange {
  entity_id: string | null;
  name: string;
  group_name: string | null;
  /** Lights the scene loses (they leave its room). */
  lost: string[];
  /** Lights joining its room that the scene has no setting for. */
  missing: string[];
}

/** A Hue room whose lights go to several areas, and the zone that can keep its scenes. */
export interface RoomSplit {
  /** Name of the zone over the room's lights (the room's, or its areas' joined). */
  name: string;
  /** The room's name now. */
  from: string;
  group: string | null;
  /** The room's lights before alignment. */
  lights: string[];
  /** Its scenes that lose lights (entity ids): copied into the zone. */
  scenes: string[];
}

/** How the bridge's rooms would change to match the HA areas. */
export interface RoomsPlan {
  changed: boolean;
  rooms: RoomTarget[];
  moves: RoomMove[];
  /** Rooms left without lights, given to no area. */
  empty: { name: string; group: string | null; scenes: number }[];
  scenes: SceneChange[];
  /** Lights of one device in different areas (left alone). */
  conflicts: string[];
  /** Rooms split over several areas. */
  splits: RoomSplit[];
  /** Light entity id -> its Hue room's name. */
  hue_rooms: Record<string, string>;
}

/** A palette or gallery scene. */
export interface Palette {
  id?: string;
  name?: string;
  kind: "gradient" | "white";
  points?: XY[];
  mirek?: number;
  brightness?: number;
}

export interface GalleryScene extends Palette {
  id: string;
  name: string;
  category: string;
  /** Id of the scene's picture in the Hue app, when known. */
  public_image?: string;
}

export interface Gallery {
  categories: { id: string; name: string }[];
  scenes: GalleryScene[];
}

/** One HDMI input of a Sync Box. */
export interface SyncInput {
  id: string;
  name: string;
  type?: string | null;
  status?: "unplugged" | "plugged" | "linked" | "unknown" | string | null;
}

/** An entertainment area the box can sync, with its Hue light entities. */
export interface SyncArea {
  id: string;
  name: string;
  /** Streaming right now. */
  active: boolean;
  lights: string[];
}

export type SyncMode = "video" | "music" | "game";
export type SyncIntensity = "subtle" | "moderate" | "high" | "intense";

/** A Hue Play HDMI Sync Box (hue_studio/sync/subscribe). */
export interface SyncBoxInfo {
  available: boolean;
  /** Its light sync switch: the target of `hue_studio.set_sync`. */
  entity_id: string | null;
  name: string | null;
  model?: string;
  power?: boolean;
  syncing?: boolean;
  /** The current mode, or the last one while not syncing. */
  mode?: SyncMode;
  intensity?: SyncIntensity | null;
  /** 1-100. */
  brightness?: number;
  input?: string | null;
  inputs?: SyncInput[];
  area?: string | null;
  areas?: SyncArea[];
  /** e.g. "3840 x 2160 @ 60000 - HDR10". */
  content?: string | null;
  video_supported?: boolean;
  audio_supported?: boolean;
  connection?: string | null;
  /** Direct pairing only (not a box linked through huesyncbox). */
  features?: ("palette" | "background_lighting" | "presets" | "ir" | "settings")[];
  /** The box itself (settings only for a box paired directly). */
  device?: SyncBoxDevice;
  /** Music mode's palette. */
  palette?: string | null;
  background_lighting?: { video: boolean; game: boolean };
  presets?: SyncPreset[];
  /** The preset applied last, if the box reports it. */
  preset?: string | null;
  ir?: { scanning: boolean; scanned: string[]; codes: SyncIrCode[] } | null;
}

export interface SyncPreset {
  id: string;
  name: string;
  last_used: string | null;
}

/** A remote button the box knows; `action` is one of ours (sync.IR_ACTIONS) or null. */
export interface SyncIrCode {
  code: string;
  name: string;
  action: string | null;
}

export interface SyncMessage {
  boxes: Record<string, SyncBoxInfo>;
}

export interface SyncBoxDevice {
  id: string | null;
  host: string | null;
  firmware: string | null;
  /** A newer firmware the box can install, or null. */
  update: string | null;
  /** Wi-Fi strength 0 (none) to 4, or null (wired or unknown). */
  wifi: number | null;
  led: "off" | "dimmed" | "normal" | null;
  /** Turns on and off with the TV (HDMI CEC). */
  tv_power: boolean | null;
  ha_device: string | null;
}

/** Data of `hue_studio.set_sync`. */
export interface SyncChange {
  power?: boolean;
  sync?: boolean;
  mode?: SyncMode;
  intensity?: SyncIntensity;
  input?: string;
  entertainment_area?: string;
  brightness?: number;
  palette?: string;
  background_lighting?: boolean;
  preset?: string;
}

export type Phase = "morning" | "day" | "golden" | "evening" | "night";
export type Season = "winter" | "spring" | "summer" | "autumn";
export type Weather = "clear" | "gloomy";
export type Mood = "relax" | "cozy" | "focus" | "romantic" | "party" | "festive";

/** What a scene of the pool fits; a missing or empty list: any. */
export interface SceneTags {
  phases?: Phase[];
  seasons?: Season[];
  weather?: Weather[];
  moods?: Mood[];
}

/** Phase times: minutes (morning/day from sunrise, golden before and evening after sunset), night from "HH:MM". */
export interface PhaseTimes {
  night_from?: string;
  shifts?: Partial<Record<"morning" | "day" | "golden" | "evening", number>>;
}

/** An automation's own settings of the light of the day (else the global ones). */
export interface DaySettings extends PhaseTimes {
  /** Fixed brightness per phase (else the curve). */
  brightness?: Partial<Record<Phase, number>>;
  gradient_mode?: string | null;
  /** Natural light: color temperature (K) per phase, overriding the defaults. */
  kelvin?: Partial<Record<Phase, number>>;
  /** Before 0.10: sources of its own (now global). */
  weather?: string | null;
  light_sensor?: string | null;
  season?: string | null;
}

/** Before 0.10: a holiday of an automation's own pools. */
export interface Holiday {
  from: string;
  to: string;
  phases: Phase[];
  pool: string[];
}

/** An automation's settings of natural light and the scene of the day (the `scene_of_the_day` input). */
export interface DayConfig {
  /** Scenes it adds to the global pool, and skips. */
  include: string[];
  exclude: string[];
  offsets: Partial<Record<Phase, number>>;
  settings: DaySettings;
  /** Before 0.10: pools of its own (moved into the global pool by the panel). */
  pools?: Record<string, Record<string, Record<string, string[] | string[][]>>>;
  holidays?: Holiday[];
  excluded?: string[];
}

/** What natural light or a scene of the day shows now (hue_studio/automations/preview). */
export interface DayPreview {
  phase: Phase;
  pool_phase: Phase;
  season: Season;
  weather: Weather;
  /** The mood the scene came from (null: the day decided). */
  mood: Mood | null;
  scene: string | null;
  scene_name?: string | null;
  pool: string[];
  brightness: number;
  kelvin: number | null;
}

/** The global light of the day (hue_studio/daylight/subscribe). */
export interface DaylightMessage {
  settings: PhaseTimes & { weather?: string; season?: string; light_sensor?: string; defaults: boolean };
  /** The user's tags of single scenes ({}: out of the pool). */
  user_tags: Record<string, SceneTags>;
  /** Hue Studio's ready-made tags. */
  defaults: Record<string, SceneTags>;
  /** The pool: every scene in it with its tags. */
  tags: Record<string, SceneTags>;
  /** What is read: the chosen entities, else found ones. */
  sources: { weather: string | null; season: string | null; light_sensor: string | null };
  now: DayPreview;
  moods: Mood[];
  mood_entity: string | null;
  phase_entity: string | null;
}

/** hue_studio/automations/subscribe. */
export interface AutomationsMessage {
  /** Our automations: from a Hue Studio blueprint, or taken over in HA (custom). */
  automations: Record<string, { id: string | null; type: string | null; custom: boolean; areas?: string[]; groups?: string[] }>;
  /** Other automations that touch Hue lights or their areas. */
  related: string[];
  types: string[];
  /** Counts automation reloads: configs are read again on every message. */
  reloads: number;
}

/** An automation as HA's automation config API reads and writes it. */
export interface AutomationConfig {
  id?: string;
  alias?: string;
  description?: string;
  use_blueprint?: { path: string; input: Record<string, unknown> };
  [key: string]: unknown;
}

/** A light's points in the room: x left→right, y back→front, z floor→ceiling (-1..1). */
export type RoomPoint = [number, number, number];

export interface AreaPositions {
  lights: Record<string, { positions: RoomPoint[]; source: "bridge" | "store" | null }>;
  /** The entertainment area the positions come from (written back on save). */
  configuration: { id: string; name: string; streaming: boolean } | null;
}

/** hue_studio/positions/subscribe: area id -> its lights' positions. */
export type PositionsMessage = Record<string, AreaPositions>;
