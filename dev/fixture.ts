// A fake `hass` for dev/panel.html: neutral demo data and a tiny simulation of the services
// the panel calls, so every screen can be clicked through without Home Assistant.

import { mirekToRgb, xyToRgb } from "../src/color.ts";
import type { Gallery, Hass, HassState, LightInfo, LightsMessage, Palette, ServiceData, XY } from "../src/types.ts";

/** Simulated light state. */
interface Sim {
  on?: boolean;
  xy?: XY | null;
  mirek?: number | null;
  bri?: number;
}

const COLOR = { supported_color_modes: ["color_temp", "xy"] };

const LIGHTS: Record<string, [string, string, Sim]> = {
  // id: [name, area, initial state]
  desk_lamp: ["Desk lamp", "office", { on: true, xy: [0.5784, 0.3827], bri: 115 }],
  tv_strip: ["TV strip", "living_room", {}],
  play_left: ["Play left", "living_room", {}],
  play_right: ["Play right", "living_room", {}],
  candle: ["Candle", "living_room", {}],
  kitchen_bulb: ["Kitchen bulb", "kitchen", { on: true, mirek: 370, bri: 200 }],
  string_lights: ["String lights", "bedroom", {}],
  globe_lights: ["Globe lights", "balcony", { on: true, xy: [0.2, 0.25], bri: 160 }],
};

const GROUPS: Record<string, [string, string, string[]]> = {
  // id: [name, hue_type, members]
  office: ["Office", "room", ["desk_lamp"]],
  balcony: ["Balcony", "room", ["globe_lights"]],
  downstairs: ["Downstairs", "room", ["tv_strip", "play_left", "play_right", "candle", "kitchen_bulb", "string_lights"]],
  tv_area: ["TV area", "zone", ["tv_strip", "play_left", "play_right"]],
  tree: ["Tree", "zone", ["string_lights"]],
};

const SCENES: Record<string, string[]> = {
  office: ["Read", "Bright", "Dimmed", "Nature's colors", "Ocean dawn"],
  tv_area: ["Movie", "Read"],
  balcony: ["Galaxy", "Fairy lights"],
};

const AREAS: NonNullable<Hass["areas"]> = {
  office: { name: "Office", icon: "mdi:chair-rolling", temperature_entity_id: "sensor.office_thermostat" },
  living_room: { name: "Living room", icon: "mdi:sofa" },
  kitchen: { name: "Kitchen", icon: "mdi:stove" },
  bedroom: { name: "Bedroom", icon: "mdi:bed" },
  balcony: { name: "Balcony", icon: "mdi:balcony" },
  hallway: { name: "Hallway", icon: "mdi:door" },
};

const GAMUT_C: XY[] = [[0.6915, 0.3083], [0.17, 0.7], [0.1532, 0.0475]];

export function createHass({ language = "en", onChange }: { language?: string; onChange: (hass: Hass) => void }): Hass {
  const states: Record<string, HassState & { _s?: Sim }> = {};
  const entities: NonNullable<Hass["entities"]> = {};
  const devices: NonNullable<Hass["devices"]> = {};
  const lightInfo: Record<string, LightInfo> = {};
  const listeners = new Set<(msg: LightsMessage) => void>();

  const setLight = (id: string, s: Sim) => {
    const [name] = LIGHTS[id];
    const attrs: Record<string, unknown> = { ...COLOR, friendly_name: name };
    if (s.on) {
      attrs.brightness = s.bri ?? 200;
      if (s.mirek) {
        attrs.color_mode = "color_temp";
        attrs.color_temp_kelvin = Math.round(1e6 / s.mirek);
        attrs.rgb_color = mirekToRgb(s.mirek);
      } else {
        const xy = s.xy || [0.45, 0.41];
        attrs.color_mode = "xy";
        attrs.xy_color = xy;
        attrs.rgb_color = xyToRgb(...xy);
      }
    }
    states[`light.${id}`] = { entity_id: `light.${id}`, state: s.on ? "on" : "off", attributes: attrs, _s: s };
  };

  for (const [id, [, area, s]] of Object.entries(LIGHTS)) {
    devices[`dev_${id}`] = { area_id: area };
    entities[`light.${id}`] = { platform: "hue", device_id: `dev_${id}` };
    setLight(id, s);
  }
  // Sensors: a Hue motion sensor (with its thermometer) and a thermostat in the office.
  devices.dev_motion = { area_id: "office" };
  devices.dev_thermostat = { area_id: "office" };
  const sensor = (id: string, platform: string, device: string, state: string, attributes: Record<string, unknown>) => {
    entities[id] = { platform, device_id: device };
    states[id] = { entity_id: id, state, attributes };
  };
  sensor("binary_sensor.office_motion", "hue", "dev_motion", "on", { device_class: "motion", friendly_name: "Office motion" });
  sensor("sensor.office_motion_temperature", "hue", "dev_motion", "21.9", { device_class: "temperature", friendly_name: "Office motion temperature" });
  sensor("sensor.office_thermostat", "demo", "dev_thermostat", "22.5", { device_class: "temperature", friendly_name: "Office thermostat" });
  // Adaptive Lighting for the office lamp.
  entities["switch.adaptive_lighting_office"] = { platform: "adaptive_lighting" };
  states["switch.adaptive_lighting_office"] = {
    entity_id: "switch.adaptive_lighting_office",
    state: "on",
    attributes: { friendly_name: "Adaptive Lighting: Office", configuration: { lights: ["light.desk_lamp"] }, manual_control: [] },
  };

  for (const id of ["desk_lamp", "tv_strip"]) {
    lightInfo[`light.${id}`] = {
      gamut: GAMUT_C,
      gamut_type: "C",
      mirek: [153, 454],
      gradient: {
        points_capable: 5,
        points: id === "desk_lamp" ? [[0.5784, 0.3827], [0.62, 0.35], [0.55, 0.39], [0.5, 0.41], [0.45, 0.41]] : [],
        mode: "interpolated_palette",
        modes: ["interpolated_palette"],
      },
    };
  }
  for (const id of Object.keys(LIGHTS)) lightInfo[`light.${id}`] ??= { gamut: GAMUT_C, gamut_type: "C", mirek: [153, 454], gradient: null };

  const refreshGroups = () => {
    for (const [id, [name, type, members]] of Object.entries(GROUPS)) {
      const ids = members.map((m) => `light.${m}`);
      const lit = ids.filter((m) => states[m].state === "on");
      states[`light.${id}`] = {
        entity_id: `light.${id}`,
        state: lit.length ? "on" : "off",
        attributes: { ...COLOR, friendly_name: name, is_hue_group: true, hue_type: type, entity_id: ids },
      };
      entities[`light.${id}`] = { platform: "hue" };
    }
  };
  refreshGroups();

  for (const [group, names] of Object.entries(SCENES)) {
    for (const name of names) {
      const id = `scene.${group}_${name.toLowerCase().replace(/[^a-z]+/g, "_")}`;
      states[id] = { entity_id: id, state: "unknown", attributes: { group_name: GROUPS[group][0], name, friendly_name: `${GROUPS[group][0]} ${name}` } };
      entities[id] = { platform: "hue" };
    }
  }

  const expand = (ids: string | string[] | undefined): string[] => [ids].flat().flatMap((id) => (!id ? [] : states[id]?.attributes.is_hue_group ? states[id].attributes.entity_id : [id]));
  const update = (id: string, patch: Sim) => setLight(id.replace("light.", ""), { ...states[id]._s, ...patch });

  let gallery: Gallery | undefined;
  // The page is dev/panel.html (this module is bundled into dev/build/).
  fetch(new URL("../custom_components/hue_studio/frontend/gallery/gallery.json", location.href))
    .then((r) => r.json())
    .then((g: Gallery) => (gallery = g));

  const applyPalette = (ids: string[], palette: Palette) => {
    ids.forEach((id, i) => {
      if (palette.kind === "white") return update(id, { on: true, mirek: palette.mirek, xy: null, bri: (palette.brightness ?? 100) * 2.55 });
      const points = palette.points ?? [];
      if (lightInfo[id].gradient && points.length > 1) lightInfo[id] = { ...lightInfo[id], gradient: { ...lightInfo[id].gradient, points: points.slice(0, 5) } };
      update(id, { on: true, mirek: null, xy: points[i % points.length], bri: (palette.brightness ?? 80) * 2.55 });
    });
    push(Object.fromEntries(ids.map((id) => [id, lightInfo[id]])));
  };

  const push = (lights: Record<string, LightInfo>) => listeners.forEach((cb) => cb({ lights }));

  const hass: Hass = {
    language,
    locale: { language },
    config: { location_name: "Home" },
    areas: AREAS,
    devices,
    entities,
    states,
    async callService(domain: string, service: string, data: ServiceData = {}) {
      const d = data as ServiceData & {
        brightness_pct?: number;
        xy_color?: XY;
        color_temp_kelvin?: number;
        gallery_scene?: string;
        lights: string[];
        manual_control?: boolean;
        points: XY[];
      };
      const one = String(data.entity_id);
      console.info("callService", domain, service, JSON.stringify(data));
      await new Promise((r) => setTimeout(r, 60));
      const ids = expand(data.entity_id);
      if (domain === "light" && service === "turn_off") ids.forEach((id) => update(id, { on: false }));
      if (domain === "light" && service === "toggle") ids.forEach((id) => update(id, { on: states[id].state !== "on" }));
      if (domain === "light" && service === "turn_on") {
        for (const id of ids) {
          const patch: Sim = { on: true };
          if (d.brightness_pct) patch.bri = d.brightness_pct * 2.55;
          if (d.xy_color) Object.assign(patch, { xy: d.xy_color, mirek: null });
          if (d.color_temp_kelvin) Object.assign(patch, { mirek: 1e6 / d.color_temp_kelvin, xy: null });
          update(id, patch);
        }
      }
      if (domain === "scene") {
        const name = states[one].attributes.name;
        const group = Object.entries(GROUPS).find(([, [n]]) => n === states[one].attributes.group_name);
        const scene = gallery?.scenes.find((s) => s.name === name);
        if (group) applyPalette(group[1][2].map((m) => `light.${m}`), scene || { kind: "white", mirek: 300, brightness: 80 });
      }
      if (domain === "hue_studio" && service === "apply_palette") {
        const scene = gallery?.scenes.find((s) => s.id === d.gallery_scene);
        if (scene) applyPalette(ids, scene);
      }
      if (domain === "adaptive_lighting" && service === "set_manual_control") {
        const al = states[one];
        const manual = new Set<string>(al.attributes.manual_control);
        d.lights.forEach((l) => (d.manual_control ? manual.add(l) : manual.delete(l)));
        states[one] = { ...al, attributes: { ...al.attributes, manual_control: [...manual] } };
      }
      if (domain === "switch") {
        const sw = states[one];
        states[one] = { ...sw, state: service === "turn_on" ? "on" : "off" };
      }
      if (domain === "light" && ids.includes("light.desk_lamp") && (d.xy_color || d.color_temp_kelvin)) {
        // What Adaptive Lighting's take-over detection does for light.turn_on.
        const al = states["switch.adaptive_lighting_office"];
        states["switch.adaptive_lighting_office"] = { ...al, attributes: { ...al.attributes, manual_control: ["light.desk_lamp"] } };
      }
      if (domain === "hue_studio" && service === "set_gradient") {
        for (const id of ids) {
          const gradient = lightInfo[id].gradient;
          if (gradient) lightInfo[id] = { ...lightInfo[id], gradient: { ...gradient, points: d.points } };
          update(id, { on: true, xy: d.points[0], mirek: null });
        }
        push(Object.fromEntries(ids.map((id) => [id, lightInfo[id]])));
      }
      refreshGroups();
      onChange({ ...hass, states: { ...states } });
    },
    connection: {
      async subscribeMessage<T>(cb: (msg: T) => void, msg: { type: string }) {
        const send = cb as unknown as (m: unknown) => void;
        if (msg.type === "hue_studio/config/subscribe") {
          setTimeout(() => send({ groups: {}, rooms: {} }), 30);
          return () => {};
        }
        if (msg.type !== "hue_studio/lights/subscribe") throw new Error("unknown command");
        listeners.add(send);
        setTimeout(() => send({ lights: { ...lightInfo } }), 50);
        return () => {
          listeners.delete(send);
        };
      },
    },
  };
  return hass;
}
