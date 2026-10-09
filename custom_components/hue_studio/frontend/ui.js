// Small DOM helpers shared by the views.

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export const normalize = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

// Material Design Icons paths for the panel chrome (area icons use <ha-icon>).
export const ICONS = {
  back: "M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z",
  close: "M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z",
  menu: "M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z",
  plus: "M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z",
  search:
    "M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44" +
    "C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14" +
    "C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z",
  home: "M10,20V14H14V20H19V12H22L12,3L2,12H5V20H10Z",
  explore:
    "M13.13 22.19L11.5 18.36C13.07 17.78 14.54 17 15.9 16.09L13.13 22.19M5.64 12.5L1.81 10.87L7.91 8.1" +
    "C7 9.46 6.22 10.93 5.64 12.5M21.61 2.39C21.61 2.39 16.66 .269 11 5.93C8.81 8.12 7.5 10.53 6.65 12.64" +
    "C6.37 13.39 6.56 14.21 7.11 14.77L9.24 16.89C9.79 17.45 10.61 17.63 11.36 17.35C13.5 16.53 15.88 15.19 18.07 13" +
    "C23.73 7.34 21.61 2.39 21.61 2.39M14.54 9.46C13.76 8.68 13.76 7.41 14.54 6.63S16.59 5.85 17.37 6.63" +
    "C18.14 7.41 18.15 8.68 17.37 9.46C16.59 10.24 15.32 10.24 14.54 9.46M8.88 16.53L7.47 15.12L8.88 16.53" +
    "M6.24 22L9.88 18.36C9.54 18.27 9.21 18.12 8.91 17.91L4.83 22H6.24M2 22H3.41L8.18 17.24L6.76 15.83L2 20.59V22" +
    "M2 19.17L6.09 15.09C5.88 14.79 5.73 14.47 5.64 14.12L2 17.76V19.17Z",
  palette:
    "M17.5,12A1.5,1.5 0 0,1 16,10.5A1.5,1.5 0 0,1 17.5,9A1.5,1.5 0 0,1 19,10.5A1.5,1.5 0 0,1 17.5,12M14.5,8A1.5,1.5 0 0,1 13,6.5" +
    "A1.5,1.5 0 0,1 14.5,5A1.5,1.5 0 0,1 16,6.5A1.5,1.5 0 0,1 14.5,8M9.5,8A1.5,1.5 0 0,1 8,6.5A1.5,1.5 0 0,1 9.5,5" +
    "A1.5,1.5 0 0,1 11,6.5A1.5,1.5 0 0,1 9.5,8M6.5,12A1.5,1.5 0 0,1 5,10.5A1.5,1.5 0 0,1 6.5,9A1.5,1.5 0 0,1 8,10.5" +
    "A1.5,1.5 0 0,1 6.5,12M12,3A9,9 0 0,0 3,12A9,9 0 0,0 12,21A1.5,1.5 0 0,0 13.5,19.5C13.5,19.11 13.35,18.76 13.11,18.5" +
    "C12.88,18.23 12.73,17.88 12.73,17.5A1.5,1.5 0 0,1 14.23,16H16A5,5 0 0,0 21,11C21,6.58 16.97,3 12,3Z",
  bulb: "M12,2A7,7 0 0,0 5,9C5,11.38 6.19,13.47 8,14.74V17A1,1 0 0,0 9,18H15A1,1 0 0,0 16,17V14.74C17.81,13.47 19,11.38 19,9A7,7 0 0,0 12,2M9,21A1,1 0 0,0 10,22H14A1,1 0 0,0 15,21V20H9V21Z",
  sun:
    "M12,8A4,4 0 0,0 8,12A4,4 0 0,0 12,16A4,4 0 0,0 16,12A4,4 0 0,0 12,8M12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6A6,6 0 0,1 18,12" +
    "A6,6 0 0,1 12,18M20,8.69V4H15.31L12,0.69L8.69,4H4V8.69L0.69,12L4,15.31V20H8.69L12,23.31L15.31,20H20V15.31L23.31,12L20,8.69Z",
};

export const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"></path></svg>`;

export const toggleHtml = (on, label, extra = "") =>
  `<button class="toggle${on ? " on" : ""}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" ${extra}><span></span></button>`;

export function setToggle(el, on) {
  el.classList.toggle("on", on);
  el.setAttribute("aria-checked", String(on));
}

/** Call fn at most every `ms`, always delivering the last call (trailing edge). */
export function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  let pending = null;
  const run = () => {
    last = Date.now();
    timer = null;
    const args = pending;
    pending = null;
    fn(...args);
  };
  const throttled = (...args) => {
    pending = args;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) run();
    else timer ??= setTimeout(run, wait);
  };
  throttled.flush = () => {
    if (timer) {
      clearTimeout(timer);
      run();
    }
  };
  return throttled;
}

/**
 * Horizontal brightness slider: `<div class="slider"><div class="fill"></div><div class="knob"></div></div>`.
 * Calls onInput(value 1-100) while dragging and onChange(value) on release.
 */
export function attachSlider(el, { onInput, onChange }) {
  const valueAt = (e) => {
    const r = el.getBoundingClientRect();
    return Math.max(1, Math.min(100, Math.round(((e.clientX - r.left) / r.width) * 100)));
  };
  el.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    el.dataset.dragging = "1";
    const v = valueAt(e);
    setSlider(el, v);
    onInput?.(v);
  });
  el.addEventListener("pointermove", (e) => {
    if (!el.dataset.dragging) return;
    const v = valueAt(e);
    setSlider(el, v);
    onInput?.(v);
  });
  const end = (e) => {
    if (!el.dataset.dragging) return;
    delete el.dataset.dragging;
    onChange?.(valueAt(e));
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("click", (e) => e.stopPropagation());
}

/** Update a slider unless the user is dragging it. */
export function setSlider(el, value, force = false) {
  if (el.dataset.dragging && !force) return;
  el.style.setProperty("--value", `${value}%`);
}

export const sliderHtml = (value, label) =>
  `<div class="slider" role="slider" aria-label="${esc(label)}" aria-valuemin="1" aria-valuemax="100" style="--value:${value}%"><div class="fill"></div><div class="knob"></div></div>`;

/** Show a short message at the bottom of `root`. */
export function toast(root, text) {
  let el = root.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    root.append(el);
  }
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("on"), 3200);
}
