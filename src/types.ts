// The parts of Home Assistant's frontend `hass` object and of our own WebSocket payloads
// that the panel uses. HA's own types are not published as a package, so this is a minimal
// hand-written subset; everything here is documented frontend API.

export type XY = [number, number];
export type RGB = [number, number, number];

export interface HassState {
  entity_id?: string;
  state: string;
  // Attributes depend on the domain and integration.
  attributes: Record<string, any>;
}

export interface HassEntityEntry {
  platform?: string;
  device_id?: string | null;
  area_id?: string | null;
  icon?: string | null;
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
  devices?: Record<string, { area_id?: string | null }>;
  areas?: Record<string, HassArea>;
  config?: { location_name?: string };
  language?: string;
  locale?: { language: string };
}

export interface Hass extends HassData {
  connection?: HassConnection;
  callService(domain: string, service: string, data?: ServiceData): Promise<unknown>;
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
  /** Hue product archetype (e.g. "hue_signe"), for the light's icon. */
  archetype?: string | null;
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
}

export interface ScenesMessage {
  scenes: Record<string, SceneInfo>;
}

export interface RoomSensors {
  motion: string[];
  temperature: string[];
}

/** Integration options (hue_studio/config/subscribe). */
export interface StudioConfig {
  /** Hue group entity id -> area id, or "zone". */
  groups: Record<string, string>;
  /** Room key -> sensors overriding the defaults. */
  rooms: Record<string, Partial<RoomSensors>>;
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
}

export interface Gallery {
  categories: { id: string; name: string }[];
  scenes: GalleryScene[];
}
