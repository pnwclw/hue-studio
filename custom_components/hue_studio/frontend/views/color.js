// Color wheel: one pin per light (one per gradient point for gradient lights), dragged
// to change colors. Pins are clipped to each light's gamut, commands are throttled.

import {
  clipToGamut,
  mirekToRgb,
  mirekToWheelY,
  rgbCss,
  WHEEL_CSS,
  WHITE_CSS,
  wheelToRgb,
  wheelToXy,
  wheelYToMirek,
  xyToWheel,
} from "../color.js";
import { findGroup, friendlyName, groupState, lightColors } from "../model.js";
import { attachSlider, esc, setSlider, sliderHtml, svg, throttle } from "../ui.js";
import { brightnessInterval } from "./home.js";

const COLOR_MODES = ["xy", "hs", "rgb", "rgbw", "rgbww"];
const supportsColor = (state) => state?.attributes.supported_color_modes?.some((m) => COLOR_MODES.includes(m));
const supportsWhite = (state) => state?.attributes.supported_color_modes?.includes("color_temp");
// Bridge limit is ~10 commands/s per light; gradients are heavier, keep them slower.
const LIGHT_INTERVAL = 150;
const GRADIENT_INTERVAL = 300;
// After a drag, ignore HA state for a moment so the pin doesn't jump back to stale values.
const HOLD_MS = 2000;

const pct = (v) => `${((v + 1) / 2) * 100}%`;

export class ColorView {
  constructor(ctx, key, lightId) {
    this.ctx = ctx;
    const { t } = ctx;
    this.group = findGroup(ctx.home, key);
    this.el = document.createElement("div");
    this.el.className = "page";
    this.pins = new Map();
    this.senders = new Map();
    this.selected = lightId || null;
    if (!this.group) {
      this.el.innerHTML = `<div class="topbar"><button class="round back">${svg("back")}</button></div><p class="empty">${esc(t("room.not_found"))}</p>`;
      this.el.querySelector(".back").addEventListener("click", () => ctx.go(""));
      return;
    }
    const states = this.group.lights.map((id) => ctx.hass.states[id]);
    this.colorLights = this.group.lights.filter((id) => supportsColor(ctx.hass.states[id]));
    this.whiteLights = this.group.lights.filter((id) => supportsWhite(ctx.hass.states[id]));
    const focus = ctx.hass.states[lightId] || states.find((s) => s?.state === "on");
    this.mode = !this.colorLights.length || focus?.attributes.color_mode === "color_temp" ? "white" : "color";
    this._render();
  }

  _render() {
    const { ctx, group } = this;
    const { t } = ctx;
    const room = encodeURIComponent(group.key);
    this.el.innerHTML = `
      <div class="topbar">
        <button class="round back" aria-label="${esc(t("common.back"))}">${svg("back")}</button>
        <div class="grow" style="font-size:20px;font-weight:600">${esc(group.name)}</div>
        <button class="pill done">${esc(t("color.done"))}</button>
      </div>
      <div class="wheel-wrap"><div class="wheel" style="--wheel-color:${WHEEL_CSS};--wheel-white:${WHITE_CSS}"></div></div>
      <div class="controls">
        <div class="modes">
          ${this.colorLights.length ? `<button class="m-color" data-mode="color" aria-label="${esc(t("color.mode_color"))}"></button>` : ""}
          ${this.whiteLights.length ? `<button class="m-white" data-mode="white" aria-label="${esc(t("color.mode_white"))}"></button>` : ""}
        </div>
        <div class="bright"><div class="value"></div>${sliderHtml(0, t("common.brightness"))}</div>
      </div>
      <div class="chips">${group.lights
        .map((id) => `<button class="chip" data-light="${esc(id)}"><span class="swatch"></span>${esc(friendlyName(ctx.hass, id))}</button>`)
        .join("")}</div>`;

    const back = () => ctx.go(`/room/${room}`);
    this.el.querySelector(".back").addEventListener("click", back);
    this.el.querySelector(".done").addEventListener("click", back);
    for (const b of this.el.querySelectorAll(".modes button")) {
      b.addEventListener("click", () => {
        this.mode = b.dataset.mode;
        this._buildPins();
        this.update();
      });
    }
    for (const c of this.el.querySelectorAll(".chip")) {
      c.addEventListener("click", () => {
        this.selected = this.selected === c.dataset.light ? null : c.dataset.light;
        this.update();
      });
    }
    const send = throttle(
      (v) => ctx.call("light", "turn_on", { entity_id: group.target, brightness_pct: v }),
      brightnessInterval(group),
    );
    const slider = this.el.querySelector(".slider");
    attachSlider(slider, {
      onInput: (v) => {
        this.el.querySelector(".bright .value").textContent = `${v}%`;
        send(v);
      },
      onChange: (v) => {
        send(v);
        send.flush();
      },
    });
    this._buildPins();
  }

  /** Create pin elements for the current mode. */
  _buildPins() {
    const wheel = this.el.querySelector(".wheel");
    wheel.className = `wheel ${this.mode}`;
    wheel.replaceChildren();
    this.pins.clear();
    const lights = this.mode === "color" ? this.colorLights : this.whiteLights;
    lights.forEach((id, order) => {
      const points = this.mode === "color" ? this._gradientPoints(id) : null;
      const count = points?.length || 1;
      for (let index = 0; index < count; index++) {
        const el = document.createElement("div");
        el.className = "pin";
        el.innerHTML = `<span>${points ? index + 1 : ""}</span>`;
        const pin = { el, id, index: points ? index : -1, order, pos: [0, 0], hold: 0 };
        this.pins.set(`${id}#${index}`, pin);
        this._bindDrag(pin);
        wheel.append(el);
      }
    });
    if (!lights.length) wheel.innerHTML = `<p class="empty" style="text-align:center;padding:40%  12%">${esc(this.ctx.t("color.no_color"))}</p>`;
  }

  _gradientPoints(id) {
    const points = this.ctx.lightInfo[id]?.gradient?.points;
    return points?.length > 1 ? points : null;
  }

  /** Where a pin should be, from HA state / bridge info. */
  _statePos(pin) {
    const state = this.ctx.hass.states[pin.id];
    const spread = (pin.order - (this.pins.size - 1) / 2) * 0.22;
    if (this.mode === "white") {
      const kelvin = state?.attributes.color_temp_kelvin;
      return [Math.max(-0.6, Math.min(0.6, spread)), mirekToWheelY(kelvin ? 1e6 / kelvin : 300)];
    }
    const points = this._gradientPoints(pin.id);
    if (pin.index >= 0 && points?.[pin.index]) return xyToWheel(...points[pin.index]);
    const xy = state?.attributes.xy_color;
    if (xy) return xyToWheel(...xy);
    return pin.pos[0] || pin.pos[1] ? pin.pos : [spread, -0.45];
  }

  _place(pin, pos) {
    pin.pos = pos;
    pin.el.style.left = pct(pos[0]);
    pin.el.style.top = pct(pos[1]);
    const rgb = this.mode === "white" ? mirekToRgb(wheelYToMirek(pos[1])) : wheelToRgb(...pos);
    pin.el.style.setProperty("--pin", rgbCss(rgb));
  }

  _sender(id, interval, fn) {
    if (!this.senders.has(id)) this.senders.set(id, throttle(fn, interval));
    return this.senders.get(id);
  }

  _bindDrag(pin) {
    const wheel = () => this.el.querySelector(".wheel");
    const move = (e) => {
      const r = wheel().getBoundingClientRect();
      let x = ((e.clientX - r.left) / r.width) * 2 - 1;
      let y = ((e.clientY - r.top) / r.height) * 2 - 1;
      const len = Math.hypot(x, y);
      if (len > 1) [x, y] = [x / len, y / len];
      this._drag(pin, [x, y]);
    };
    pin.el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pin.el.setPointerCapture(e.pointerId);
      pin.dragging = true;
      pin.el.classList.add("dragging");
      this.selected = pin.id;
      this.update();
    });
    pin.el.addEventListener("pointermove", (e) => pin.dragging && move(e));
    const end = (e) => {
      if (!pin.dragging) return;
      move(e);
      pin.dragging = false;
      pin.hold = Date.now() + HOLD_MS;
      pin.el.classList.remove("dragging");
      this.senders.get(pin.id)?.flush();
    };
    pin.el.addEventListener("pointerup", end);
    pin.el.addEventListener("pointercancel", end);
  }

  _drag(pin, raw) {
    const { ctx } = this;
    const info = ctx.lightInfo[pin.id];
    if (this.mode === "white") {
      const [lo, hi] = info?.mirek || [153, 500];
      const mirek = Math.min(hi, Math.max(lo, wheelYToMirek(raw[1])));
      this._place(pin, [raw[0], mirekToWheelY(mirek)]);
      this._sender(pin.id, LIGHT_INTERVAL, (m) =>
        ctx.call("light", "turn_on", { entity_id: pin.id, color_temp_kelvin: Math.round(1e6 / m) }),
      )(mirek);
      return;
    }
    const xy = wheelToXy(...raw);
    const clipped = clipToGamut(xy, info?.gamut);
    this._place(pin, clipped === xy ? raw : xyToWheel(...clipped));
    if (pin.index >= 0) {
      const points = [...this.pins.values()]
        .filter((p) => p.id === pin.id)
        .sort((a, b) => a.index - b.index)
        .map((p) => (p === pin ? clipped : clipToGamut(wheelToXy(...p.pos), info?.gamut)));
      this._sender(pin.id, GRADIENT_INTERVAL, (pts) =>
        ctx.call("hue_studio", "set_gradient", { entity_id: pin.id, points: pts }),
      )(points);
    } else {
      this._sender(pin.id, LIGHT_INTERVAL, (p) => ctx.call("light", "turn_on", { entity_id: pin.id, xy_color: p }))(clipped);
    }
  }

  update() {
    if (!this.group) return;
    const { ctx, group } = this;
    // Gradient info may arrive after the first render: rebuild when the pin layout changes.
    const expected = (this.mode === "color" ? this.colorLights : this.whiteLights).reduce(
      (n, id) => n + ((this.mode === "color" && this._gradientPoints(id)?.length) || 1),
      0,
    );
    if (expected !== this.pins.size) this._buildPins();

    const now = Date.now();
    for (const pin of this.pins.values()) {
      if (!pin.dragging && pin.hold < now) this._place(pin, this._statePos(pin));
      pin.el.classList.toggle("off", ctx.hass.states[pin.id]?.state !== "on");
      pin.el.classList.toggle("selected", pin.id === this.selected);
    }
    for (const b of this.el.querySelectorAll(".modes button")) b.classList.toggle("on", b.dataset.mode === this.mode);
    for (const c of this.el.querySelectorAll(".chip")) {
      const colors = lightColors(ctx.hass, c.dataset.light, ctx.lightInfo[c.dataset.light]);
      c.classList.toggle("on", c.dataset.light === this.selected);
      c.querySelector(".swatch").style.setProperty("--swatch", colors[0] || "#555");
    }
    const state = groupState(ctx.hass, group, ctx.lightInfo);
    const slider = this.el.querySelector(".slider");
    if (!slider.dataset.dragging) this.el.querySelector(".bright .value").textContent = state.on ? `${state.brightness}%` : "";
    setSlider(slider, state.brightness);
    this.el.querySelector(".bright").classList.toggle("off", !state.on);
  }
}
