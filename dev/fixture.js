// A fake `hass` for dev/panel.html: neutral demo data and a tiny simulation of the services
// the panel calls, so every screen can be clicked through without Home Assistant.

import { mirekToRgb, xyToRgb } from "../custom_components/hue_studio/frontend/color.js";

const COLOR = { supported_color_modes: ["color_temp", "xy"] };

const LIGHTS = {
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

const GROUPS = {
  // id: [name, hue_type, members]
  office: ["Office", "room", ["desk_lamp"]],
  balcony: ["Balcony", "room", ["globe_lights"]],
  downstairs: ["Downstairs", "room", ["tv_strip", "play_left", "play_right", "candle", "kitchen_bulb", "string_lights"]],
  tv_area: ["TV area", "zone", ["tv_strip", "play_left", "play_right"]],
  tree: ["Tree", "zone", ["string_lights"]],
};

const SCENES = {
  office: ["Read", "Bright", "Dimmed", "Nature's colors", "Ocean dawn"],
  tv_area: ["Movie", "Read"],
  balcony: ["Galaxy", "Fairy lights"],
};

const AREAS = {
  office: { name: "Office", icon: "mdi:chair-rolling" },
  living_room: { name: "Living room", icon: "mdi:sofa" },
  kitchen: { name: "Kitchen", icon: "mdi:stove" },
  bedroom: { name: "Bedroom", icon: "mdi:bed" },
  balcony: { name: "Balcony", icon: "mdi:balcony" },
  hallway: { name: "Hallway", icon: "mdi:door" },
};

const GAMUT_C = [[0.6915, 0.3083], [0.17, 0.7], [0.1532, 0.0475]];

export function createHass({ language = "en", onChange }) {
  const states = {};
  const entities = {};
  const devices = {};
  const lightInfo = {};
  const listeners = new Set();

  const setLight = (id, s) => {
    const [name] = LIGHTS[id];
    const attrs = { ...COLOR, friendly_name: name };
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
  for (const id of ["desk_lamp", "tv_strip"]) {
    lightInfo[`light.${id}`] = {
      gamut: GAMUT_C,
      gamut_type: "C",
      mirek: [153, 454],
      gradient: {
        points_capable: 5,
        points: id === "desk_lamp" ? [[0.5784, 0.3827], [0.62, 0.35], [0.5, 0.41]] : [[0.17, 0.2], [0.35, 0.18], [0.5, 0.3]],
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

  const expand = (ids) => [ids].flat().flatMap((id) => states[id]?.attributes.is_hue_group ? states[id].attributes.entity_id : [id]);
  const update = (id, patch) => setLight(id.replace("light.", ""), { ...states[id]._s, ...patch });

  let gallery;
  fetch(new URL("../custom_components/hue_studio/frontend/gallery/gallery.json", import.meta.url))
    .then((r) => r.json())
    .then((g) => (gallery = g));

  const applyPalette = (ids, palette) => {
    ids.forEach((id, i) => {
      if (palette.kind === "white") return update(id, { on: true, mirek: palette.mirek, xy: null, bri: palette.brightness * 2.55 });
      const points = palette.points;
      if (lightInfo[id].gradient && points.length > 1) lightInfo[id] = { ...lightInfo[id], gradient: { ...lightInfo[id].gradient, points: points.slice(0, 5) } };
      update(id, { on: true, mirek: null, xy: points[i % points.length], bri: (palette.brightness ?? 80) * 2.55 });
    });
    push(Object.fromEntries(ids.map((id) => [id, lightInfo[id]])));
  };

  const push = (lights) => listeners.forEach((cb) => cb({ lights }));

  const hass = {
    language,
    locale: { language },
    config: { location_name: "Home" },
    areas: AREAS,
    devices,
    entities,
    states,
    async callService(domain, service, data) {
      console.info("callService", domain, service, JSON.stringify(data));
      await new Promise((r) => setTimeout(r, 60));
      const ids = expand(data.entity_id);
      if (domain === "light" && service === "turn_off") ids.forEach((id) => update(id, { on: false }));
      if (domain === "light" && service === "toggle") ids.forEach((id) => update(id, { on: states[id].state !== "on" }));
      if (domain === "light" && service === "turn_on") {
        for (const id of ids) {
          const patch = { on: true };
          if (data.brightness_pct) patch.bri = data.brightness_pct * 2.55;
          if (data.xy_color) Object.assign(patch, { xy: data.xy_color, mirek: null });
          if (data.color_temp_kelvin) Object.assign(patch, { mirek: 1e6 / data.color_temp_kelvin, xy: null });
          update(id, patch);
        }
      }
      if (domain === "scene") {
        const name = states[data.entity_id].attributes.name;
        const group = Object.entries(GROUPS).find(([, [n]]) => n === states[data.entity_id].attributes.group_name);
        const scene = gallery?.scenes.find((s) => s.name === name);
        applyPalette(group[1][2].map((m) => `light.${m}`), scene || { kind: "white", mirek: 300, brightness: 80 });
      }
      if (domain === "hue_studio" && service === "apply_palette") {
        const scene = gallery.scenes.find((s) => s.id === data.gallery_scene);
        applyPalette(ids, scene);
      }
      if (domain === "hue_studio" && service === "set_gradient") {
        for (const id of ids) {
          lightInfo[id] = { ...lightInfo[id], gradient: { ...lightInfo[id].gradient, points: data.points } };
          update(id, { on: true, xy: data.points[0], mirek: null });
        }
        push(Object.fromEntries(ids.map((id) => [id, lightInfo[id]])));
      }
      refreshGroups();
      onChange({ ...hass, states: { ...states } });
    },
    connection: {
      async subscribeMessage(cb, msg) {
        if (msg.type !== "hue_studio/lights/subscribe") throw new Error("unknown command");
        listeners.add(cb);
        setTimeout(() => cb({ lights: { ...lightInfo } }), 50);
        return () => listeners.delete(cb);
      },
    },
  };
  return hass;
}
