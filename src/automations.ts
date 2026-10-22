// Automations like the Hue app's: every one is a Home Assistant automation that uses one of
// Hue Studio's blueprints (custom_components/hue_studio/blueprints/automation/hue_studio/).
// Here: their inputs, the automation config written through HA's automation config API, and
// what the list shows. Pure functions, no DOM.

import type { StringKey, Translate } from "./i18n.ts";
import type { AutomationConfig, DayConfig, HassData } from "./types.ts";

export const TYPES = ["wake_up", "go_to_sleep", "coming_home", "leaving_home", "mimic_presence", "schedule", "motion"] as const;
export type AutomationType = (typeof TYPES)[number];
export const BLUEPRINT_DIR = "hue_studio";
export const ID_PREFIX = "hue_studio_";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type LightKind = "scene" | "white" | "natural" | "auto";
export type StartKind = "time" | "sunrise" | "sunset";
export type EndKind = "none" | StartKind;

/** A duration as HA's duration selector stores it (negative: before). */
export interface Duration {
  hours?: number;
  minutes?: number;
  seconds?: number;
}

/** The inputs of our blueprints: one shape for all, each type uses its own keys. */
export interface AutomationInput {
  /** HA areas. */
  rooms: string[];
  /** Hue rooms/zones (group light entities) no area holds, e.g. a zone across rooms. */
  zones?: string[];
  time?: string;
  /** Going to sleep: at `time` (else only by its buttons). */
  use_time?: boolean;
  /** Hue buttons (event entities) that start it with a short press. */
  buttons?: string[];
  days?: Weekday[];
  fade?: number;
  off_after?: number;
  light?: LightKind;
  scenes?: string[];
  kelvin?: number;
  brightness?: number | null;
  scene_of_the_day?: Partial<DayConfig>;
  zone?: string;
  only_dark?: boolean;
  only_away?: boolean;
  start_kind?: StartKind;
  start_time?: string;
  start_offset?: Duration;
  end_kind?: EndKind;
  end_time?: string;
  end_offset?: Duration;
  motion?: string[];
  lux_sensor?: string;
  lux_below?: number;
}

/** An automation being edited. */
export interface AutomationDraft {
  /** The automation config id (new ones get one when created). */
  id: string;
  type: AutomationType;
  alias: string;
  input: AutomationInput;
}

const LIGHT_KEYS = ["light", "scenes", "kelvin", "brightness", "scene_of_the_day"] as const;

/** The inputs each blueprint has (anything else is left out of the config). */
export const INPUT_KEYS: Record<AutomationType, readonly (keyof AutomationInput)[]> = {
  wake_up: ["rooms", "zones", "start_kind", "time", "start_offset", "days", "fade", "off_after", ...LIGHT_KEYS],
  go_to_sleep: ["rooms", "zones", "use_time", "time", "buttons", "days", "fade"],
  coming_home: ["rooms", "zones", "zone", "only_dark", ...LIGHT_KEYS],
  leaving_home: ["rooms", "zones", "zone"],
  mimic_presence: ["rooms", "zones", "start_kind", "start_time", "start_offset", "end_time", "days", "zone", "only_away", ...LIGHT_KEYS],
  schedule: ["rooms", "zones", "start_kind", "start_time", "start_offset", "end_kind", "end_time", "end_offset", "days", "fade", ...LIGHT_KEYS],
  motion: ["rooms", "zones", "motion", "lux_sensor", "lux_below", "off_after", ...LIGHT_KEYS],
};

/** Which light kinds a type offers (none: it only turns lights off). */
export const LIGHT_KINDS: Record<AutomationType, LightKind[]> = {
  wake_up: ["white", "scene", "natural", "auto"],
  go_to_sleep: [],
  coming_home: ["scene", "white", "natural", "auto"],
  leaving_home: [],
  mimic_presence: ["white", "scene", "natural", "auto"],
  schedule: ["scene", "white", "natural", "auto"],
  motion: ["auto", "natural", "scene", "white"],
};

export const TYPE_ICONS: Record<AutomationType, string> = {
  wake_up: "mdi:weather-sunset-up",
  go_to_sleep: "mdi:weather-night",
  coming_home: "mdi:home-import-outline",
  leaving_home: "mdi:home-export-outline",
  mimic_presence: "mdi:home-clock-outline",
  schedule: "mdi:calendar-clock",
  motion: "mdi:motion-sensor",
};

const EVERY_DAY: Weekday[] = [...WEEKDAYS];
const NO_OFFSET: Duration = { hours: 0, minutes: 0, seconds: 0 };

/** The blueprints' defaults (what HA uses for an input that is not set). */
export function defaultInput(type: AutomationType, rooms: string[] = [], zones: string[] = []): AutomationInput {
  return { ...typeDefaults(type, rooms), zones };
}

function typeDefaults(type: AutomationType, rooms: string[]): AutomationInput {
  const light = { light: LIGHT_KINDS[type][0], scenes: [], kelvin: 2700, brightness: null, scene_of_the_day: {} };
  switch (type) {
    case "wake_up":
      return { rooms, start_kind: "time", time: "07:00:00", start_offset: NO_OFFSET, days: EVERY_DAY, fade: 30, off_after: 0, ...light, kelvin: 4000, brightness: 100 };
    case "go_to_sleep":
      return { rooms, use_time: true, time: "23:00:00", buttons: [], days: EVERY_DAY, fade: 30 };
    case "coming_home":
      return { rooms, zone: "zone.home", only_dark: false, ...light };
    case "leaving_home":
      return { rooms, zone: "zone.home" };
    case "mimic_presence":
      return { rooms, start_kind: "sunset", start_time: "19:00:00", start_offset: NO_OFFSET, end_time: "23:30:00", days: EVERY_DAY, zone: "zone.home", only_away: true, ...light, brightness: 80 };
    case "schedule":
      return { rooms, start_kind: "time", start_time: "07:00:00", start_offset: NO_OFFSET, end_kind: "none", end_time: "23:00:00", end_offset: NO_OFFSET, days: EVERY_DAY, fade: 0, ...light };
    case "motion":
      return { rooms, motion: [], lux_sensor: "", lux_below: 0, off_after: 15, ...light };
  }
}

/**
 * An all-day scene, like the Hue app's: a schedule from sunrise whose light is the scene of
 * the day, which keeps up with the day until the lights are changed.
 */
export function allDayDraft(alias: string, places: string[] = [], now = Date.now()): AutomationDraft {
  const draft = newDraft("schedule", alias, places, now);
  return { ...draft, input: { ...draft.input, start_kind: "sunrise", light: "auto" } };
}

export const isType = (value: unknown): value is AutomationType => TYPES.includes(value as AutomationType);

/** A new automation of a type for rooms/zones (group keys, see placesOf); its id stays when it is taken over in HA. */
export function newDraft(type: AutomationType, alias: string, places: string[] = [], now = Date.now()): AutomationDraft {
  const { rooms, zones } = splitPlaces(places);
  return { id: `${ID_PREFIX}${type}_${now.toString(36)}`, type, alias, input: defaultInput(type, rooms, zones) };
}

const AREA = "area.";
const HUE = "hue.";

/** Rooms and zones of an automation as the panel's group keys (`area.<id>`, `hue.<entity>`). */
export const placesOf = (input: Pick<AutomationInput, "rooms" | "zones">): string[] => [
  ...input.rooms.map((a) => AREA + a),
  ...(input.zones || []).map((z) => HUE + z),
];

/** Group keys back to the blueprint inputs. */
export function splitPlaces(places: string[]): { rooms: string[]; zones: string[] } {
  return {
    rooms: places.filter((k) => k.startsWith(AREA)).map((k) => k.slice(AREA.length)),
    zones: places.filter((k) => k.startsWith(HUE)).map((k) => k.slice(HUE.length)),
  };
}

/** A room or zone as the light picker sees it: its group key and its Hue lights. */
export interface PlaceGroup {
  key: string;
  lights: string[];
}

/**
 * What an automation has of a room or zone, like the Hue app's light picker: "all" (the
 * room or zone itself), or which of its lights (single lights live among the zones, an
 * entity selector of Hue lights). Zones are only ever whole.
 */
export function pickedOf(input: Pick<AutomationInput, "rooms" | "zones">, g: PlaceGroup): "all" | string[] {
  if (placesOf(input).includes(g.key)) return "all";
  if (!g.key.startsWith(AREA)) return [];
  const zones = input.zones || [];
  return g.lights.filter((l) => zones.includes(l));
}

/** The whole room or zone in or out (its single lights go either way). */
export function withGroup(input: AutomationInput, g: PlaceGroup): Pick<AutomationInput, "rooms" | "zones"> {
  const all = pickedOf(input, g) === "all";
  const places = placesOf(input).filter((k) => k !== g.key && !(k.startsWith(HUE) && g.lights.includes(k.slice(HUE.length))));
  return splitPlaces(all ? places : [...places, g.key]);
}

/** One light of a room in or out; all of its lights chosen are the room itself. */
export function withLight(input: AutomationInput, g: PlaceGroup, light: string): Pick<AutomationInput, "rooms" | "zones"> {
  const picked = pickedOf(input, g);
  const now = picked === "all" ? g.lights.filter((l) => l !== light) : picked.includes(light) ? picked.filter((l) => l !== light) : [...picked, light];
  const others = placesOf(input).filter((k) => k !== g.key && !(k.startsWith(HUE) && g.lights.includes(k.slice(HUE.length))));
  const mine = now.length && g.lights.every((l) => now.includes(l)) ? [g.key] : now.map((l) => HUE + l);
  return splitPlaces([...others, ...mine]);
}

/** Add or remove a room/zone (a group key). */
export function withPlace(input: AutomationInput, key: string): Pick<AutomationInput, "rooms" | "zones"> {
  const places = placesOf(input);
  return splitPlaces(places.includes(key) ? places.filter((k) => k !== key) : [...places, key]);
}

/** The type of a blueprint path, or null when it is not ours. */
export function typeOfPath(path: string | undefined): AutomationType | null {
  const match = /^hue_studio\/([a-z_]+)\.yaml$/.exec(path || "");
  return match && isType(match[1]) ? match[1] : null;
}

/** An automation config read back as a draft (null: not one of our blueprints). */
export function fromConfig(config: AutomationConfig): AutomationDraft | null {
  const type = typeOfPath(config.use_blueprint?.path);
  if (!type || !config.id) return null;
  const input = { ...defaultInput(type), ...(config.use_blueprint?.input as Partial<AutomationInput>) };
  input.rooms = toList(input.rooms);
  input.zones = toList(input.zones);
  if (input.motion !== undefined) input.motion = toList(input.motion);
  if (input.buttons !== undefined) input.buttons = toList(input.buttons);
  if (input.scenes !== undefined) input.scenes = toList(input.scenes);
  return { id: config.id, type, alias: config.alias || "", input };
}

const toList = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : value ? [String(value)] : []);

/** The config HA stores for a draft; `description` links back to the panel. */
export function toConfig(draft: AutomationDraft, description: string): AutomationConfig {
  const input: Record<string, unknown> = {};
  for (const key of INPUT_KEYS[draft.type]) {
    const value = draft.input[key];
    if (value !== undefined) input[key] = value;
  }
  return {
    id: draft.id,
    alias: draft.alias,
    description,
    use_blueprint: { path: `${BLUEPRINT_DIR}/${draft.type}.yaml`, input },
  };
}

/** What a draft still needs before it can be saved, or null. */
export function missing(draft: AutomationDraft): "name" | "rooms" | "scenes" | "motion" | "trigger" | null {
  if (!draft.alias.trim()) return "name";
  if (!placesOf(draft.input).length) return "rooms";
  if (draft.type === "go_to_sleep" && draft.input.use_time === false && !draft.input.buttons?.length) return "trigger";
  if (draft.type === "motion" && !draft.input.motion?.length) return "motion";
  if (LIGHT_KINDS[draft.type].length && draft.input.light === "scene" && !draft.input.scenes?.length) return "scenes";
  return null;
}

/** Minutes of a duration (negative: before). */
export const offsetMinutes = (d: Duration | undefined): number => Math.round((d?.hours || 0) * 60 + (d?.minutes || 0) + (d?.seconds || 0) / 60);

/** A duration of minutes, as HA's duration selector stores it. */
export const offsetDuration = (minutes: number): Duration => ({ hours: 0, minutes, seconds: 0 });

/** "07:00:00" -> "07:00". */
export const hhmm = (time: string | undefined): string => (time || "").slice(0, 5);

/** The days, short: "Every day", "Weekdays", "Weekend" or "Mon, Wed". */
export function daysLine(days: Weekday[] | undefined, t: Translate): string {
  const set = new Set(days?.length ? days : WEEKDAYS);
  if (set.size === 7) return t("automations.every_day");
  const weekdays = WEEKDAYS.slice(0, 5);
  if (set.size === 5 && weekdays.every((d) => set.has(d))) return t("automations.weekdays");
  if (set.size === 2 && set.has("sat") && set.has("sun")) return t("automations.weekend");
  return WEEKDAYS.filter((d) => set.has(d))
    .map((d) => t(`automations.day_${d}` as StringKey))
    .join(", ");
}

/** A start or end: "07:00", "Sunset", "Sunset −30 min". */
export function momentLine(kind: StartKind | EndKind | undefined, time: string | undefined, offset: Duration | undefined, t: Translate): string {
  if (kind === "time" || kind === undefined) return hhmm(time);
  if (kind === "none") return "";
  const minutes = offsetMinutes(offset);
  const name = t(`automations.${kind}` as StringKey);
  return minutes ? `${name} ${minutes > 0 ? "+" : "−"}${Math.abs(minutes)} ${t("automations.min")}` : name;
}

/** When waking up is full: "07:00", "Sunrise", "Sunrise −15 min". */
const wakeMoment = (i: AutomationInput, t: Translate): string =>
  i.start_kind === "sunrise" ? momentLine("sunrise", i.time, i.start_offset, t) : hhmm(i.time);

/** When an automation runs, in a few words (the list's second line). */
export function whenLine(draft: AutomationDraft, t: Translate): string {
  const i = draft.input;
  switch (draft.type) {
    case "wake_up":
      return `${wakeMoment(i, t)} · ${daysLine(i.days, t)}`;
    case "go_to_sleep":
      return i.use_time === false ? t("automations.when_button") : `${hhmm(i.time)} · ${daysLine(i.days, t)}`;
    case "coming_home":
      return t(i.only_dark ? "automations.when_arrive_dark" : "automations.when_arrive");
    case "leaving_home":
      return t("automations.when_leave");
    case "mimic_presence":
      return `${momentLine(i.start_kind, i.start_time, i.start_offset, t)} – ${hhmm(i.end_time)} · ${daysLine(i.days, t)}`;
    case "schedule": {
      const end = momentLine(i.end_kind, i.end_time, i.end_offset, t);
      return `${momentLine(i.start_kind, i.start_time, i.start_offset, t)}${end ? ` – ${end}` : ""} · ${daysLine(i.days, t)}`;
    }
    case "motion":
      return t("automations.when_motion");
  }
}

/**
 * An automation's card, like the Hue app's: the time before the name ("07:00 • Wake up")
 * and the days under it; automations without a time of day have their trigger there.
 */
export function cardLines(draft: AutomationDraft, name: string, t: Translate): { title: string; sub: string } {
  const i = draft.input;
  const timed = (time: string) => ({ title: `${time} • ${name}`, sub: daysLine(i.days, t) });
  switch (draft.type) {
    case "wake_up":
      return timed(wakeMoment(i, t));
    case "go_to_sleep":
      return i.use_time === false ? { title: name, sub: t("automations.when_button") } : timed(hhmm(i.time));
    case "mimic_presence":
      return timed(`${momentLine(i.start_kind, i.start_time, i.start_offset, t)} – ${hhmm(i.end_time)}`);
    case "schedule": {
      const end = momentLine(i.end_kind, i.end_time, i.end_offset, t);
      return timed(`${momentLine(i.start_kind, i.start_time, i.start_offset, t)}${end ? ` – ${end}` : ""}`);
    }
    default:
      return { title: name, sub: whenLine(draft, t) };
  }
}

/** Names of the rooms (areas) and zones an automation uses; single lights by their room. */
export function roomsLine(hass: HassData, input: Pick<AutomationInput, "rooms" | "zones">): string {
  const roomOf = (id: string): string | null => {
    if (hass.states[id]?.attributes.is_hue_group) return null;
    const entry = hass.entities?.[id];
    const area = entry?.area_id || (entry?.device_id ? hass.devices?.[entry.device_id]?.area_id : null);
    return area ? hass.areas?.[area]?.name || area : null;
  };
  const names = [
    ...input.rooms.map((id) => hass.areas?.[id]?.name || id),
    ...(input.zones || []).map((id) => roomOf(id) || hass.states[id]?.attributes.friendly_name || id),
  ];
  return [...new Set(names)].join(", ");
}

/** The area an automation gets in HA: that of its one room (and no zone), else none. */
export const areaFor = (draft: AutomationDraft): string | null =>
  draft.input.rooms.length === 1 && !draft.input.zones?.length ? draft.input.rooms[0] : null;

/** What HA reports an automation controls (hue_studio/automations/subscribe). */
export interface Controls {
  areas?: string[];
  groups?: string[];
  /** Single Hue lights (some of a room's). */
  lights?: string[];
}

/**
 * Whether an automation belongs on the screen of a room or zone (a group key, its Hue
 * group entity and its lights): it controls that area, that Hue room/zone, or some of the
 * lights of that room.
 */
export const controlsGroup = (c: Controls, key: string, group: string | null, lights: string[] = []): boolean =>
  (key.startsWith(AREA) && !!c.areas?.includes(key.slice(AREA.length))) ||
  (!!group && !!c.groups?.includes(group)) ||
  (key.startsWith(AREA) && !!c.lights?.some((l) => lights.includes(l)));

/**
 * Whether an entity is an automation made with Hue Studio, for the more-info override: its
 * config id has our prefix (it survives a takeover in HA), or HA reports it uses one of
 * our blueprints (`known`: hue_studio/automations/subscribe, once it arrived).
 */
export function isOurAutomation(entityId: unknown, configId: unknown, known: Record<string, unknown> | null | undefined): entityId is string {
  if (typeof entityId !== "string" || !entityId.startsWith("automation.")) return false;
  return (typeof configId === "string" && configId.startsWith(ID_PREFIX)) || !!known?.[entityId];
}

/** An automation's light in a few words: "Relax", "2700 K · 40%", "Natural light", "Off". */
export function lightLine(hass: HassData, draft: AutomationDraft, t: Translate): string {
  if (!LIGHT_KINDS[draft.type].length) return t("automations.light_off");
  const i = draft.input;
  const brightness = i.brightness == null ? "" : ` · ${i.brightness}%`;
  switch (i.light) {
    case "scene": {
      const names = (i.scenes || []).map((id) => hass.states[id]?.attributes.friendly_name || id);
      return (names.length ? names.join(", ") : t("automations.light_scene")) + brightness;
    }
    case "white":
      return `${i.kelvin || 2700} K${brightness}`;
    case "natural":
      return t("automations.light_natural") + brightness;
    default:
      return t("automations.light_auto") + brightness;
  }
}

/** An automation in Hue words, row by row (the more-info sheet): when, where, which light. */
export function summaryRows(hass: HassData, draft: AutomationDraft, t: Translate): { label: string; value: string }[] {
  const rows = [
    { label: t("automations.when"), value: whenLine(draft, t) },
    { label: t("automations.rooms_zones"), value: roomsLine(hass, draft.input) },
    { label: t("automations.light"), value: lightLine(hass, draft, t) },
  ];
  return rows.filter((r) => r.value);
}
