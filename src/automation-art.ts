// Pictures of the automation types for the "+" cards, like the Hue app's: a small flat
// scene for each (drawn here, nothing of the Hue app's). Each fills its card (slice), so
// the middle of the 400×170 frame stays in sight at any width.

import { svg, type TemplateResult } from "lit";

import type { AutomationType } from "./automations.ts";

const frame = (id: string, body: TemplateResult): TemplateResult =>
  svg`<svg class="art" viewBox="0 0 400 170" preserveAspectRatio="xMidYMid slice" aria-hidden="true" data-art=${id}>${body}</svg>`;

/** A soft round glow (a lamp's light). */
const glow = (id: string, cx: number, cy: number, r: number, color: string, opacity = 0.55): TemplateResult => svg`
  <radialGradient id=${id}><stop offset="0" stop-color=${color} stop-opacity=${opacity}></stop><stop offset="1" stop-color=${color} stop-opacity="0"></stop></radialGradient>
  <circle cx=${cx} cy=${cy} r=${r} fill="url(#${id})"></circle>`;

const stars = (points: [number, number][], opacity = 0.7): TemplateResult =>
  svg`${points.map(([x, y], i) => svg`<circle cx=${x} cy=${y} r=${i % 3 ? 0.9 : 1.4} fill="#fff" opacity=${opacity}></circle>`)}`;

/** A house: walls, roof, windows (lit or not), a door. */
function house(x: number, wall: string, roof: string, windows: string[], door: string): TemplateResult {
  const spots: [number, number][] = [
    [x + 18, 92],
    [x + 58, 92],
    [x + 18, 124],
    [x + 58, 124],
  ];
  return svg`
    <path d="M${x - 8} 84 L${x + 50} 40 L${x + 108} 84 Z" fill=${roof}></path>
    <rect x=${x} y="80" width="100" height="90" fill=${wall}></rect>
    ${spots.slice(0, windows.length).map(([wx, wy], i) => svg`<rect x=${wx} y=${wy} width="22" height="20" rx="2" fill=${windows[i]}></rect>`)}
    <rect x=${x + 40} y="132" width="20" height="38" rx="2" fill=${door}></rect>`;
}

const ART: Record<AutomationType, () => TemplateResult> = {
  // Dawn through the window, a lamp coming up on the night stand.
  wake_up: () =>
    frame(
      "wake",
      svg`<defs>
          <linearGradient id="art-wake-wall" x1="0" x2="1"><stop offset="0" stop-color="#3a2420"></stop><stop offset="1" stop-color="#6a4434"></stop></linearGradient>
          <linearGradient id="art-wake-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#121a44"></stop><stop offset="0.55" stop-color="#4c3566"></stop><stop offset="1" stop-color="#ee8a4c"></stop></linearGradient>
          <linearGradient id="art-wake-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe7b4"></stop><stop offset="1" stop-color="#f2a35a"></stop></linearGradient>
          <clipPath id="art-wake-window"><rect x="22" y="12" width="150" height="112"></rect></clipPath>
        </defs>
        <rect width="400" height="170" fill="url(#art-wake-wall)"></rect>
        <rect x="22" y="12" width="150" height="112" fill="url(#art-wake-sky)"></rect>
        <g clip-path="url(#art-wake-window)">
          ${stars([[40, 26], [70, 40], [118, 22], [150, 46], [96, 58]])}
          <circle cx="98" cy="112" r="24" fill="#ffb35c"></circle>
          <path d="M22 108 L60 96 L84 104 L120 92 L172 106 L172 124 L22 124 Z" fill="#2a1830"></path>
        </g>
        <rect x="22" y="12" width="150" height="112" fill="none" stroke="#2a1814" stroke-width="7"></rect>
        <line x1="97" y1="12" x2="97" y2="124" stroke="#2a1814" stroke-width="5"></line>
        ${glow("art-wake-glow", 258, 66, 110, "#ffbf7a")}
        <rect x="206" y="112" width="104" height="58" rx="3" fill="#2a1914"></rect>
        <rect x="246" y="94" width="24" height="18" rx="4" fill="#1a0f0c"></rect>
        <path d="M232 94 L284 94 L274 50 L242 50 Z" fill="url(#art-wake-shade)"></path>
        <path d="M318 98 Q318 84 334 84 L400 84 L400 170 L318 170 Z" fill="#7a5444"></path>
        <path d="M330 92 Q332 70 360 72 L400 74 L400 110 L338 112 Q328 110 330 92 Z" fill="#a4806c"></path>`,
    ),
  // A dim, red evening room: the lamp low, the sofa, a plant in the dark.
  go_to_sleep: () =>
    frame(
      "sleep",
      svg`<defs>
          <linearGradient id="art-sleep-wall" x1="0" x2="1"><stop offset="0" stop-color="#3a0f16"></stop><stop offset="1" stop-color="#1c070b"></stop></linearGradient>
          <linearGradient id="art-sleep-sofa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a1c26"></stop><stop offset="1" stop-color="#3e0c13"></stop></linearGradient>
        </defs>
        <rect width="400" height="170" fill="url(#art-sleep-wall)"></rect>
        ${glow("art-sleep-glow", 100, 40, 120, "#ff8a5c", 0.45)}
        <path d="M76 44 A24 24 0 0 1 124 44 Z" fill="#ffad7a"></path>
        <rect x="20" y="46" width="150" height="124" fill="#2a0a10" opacity="0.7"></rect>
        <path d="M96 120 Q96 88 130 88 L270 88 Q300 88 300 118 L300 170 L96 170 Z" fill="url(#art-sleep-sofa)"></path>
        <path d="M80 126 Q80 112 96 112 L120 112 L120 170 L80 170 Z M276 112 L300 112 Q316 112 316 126 L316 170 L276 170 Z" fill="#5a141c"></path>
        <rect x="120" y="128" width="156" height="42" fill="#4c1018"></rect>
        <g fill="#14050a">
          <path d="M330 170 L336 96 L342 170 Z"></path>
          <path d="M336 104 Q300 70 320 30 Q350 56 336 104 Z"></path>
          <path d="M338 112 Q380 92 400 50 L400 90 Q376 120 338 112 Z"></path>
          <path d="M336 96 Q360 40 400 22 L400 40 Q370 64 336 96 Z"></path>
          <path d="M334 124 Q296 118 280 86 Q318 88 334 124 Z"></path>
        </g>`,
    ),
  // A warm evening: the house with its lights on, the path lit.
  coming_home: () =>
    frame(
      "coming",
      svg`<defs>
          <linearGradient id="art-coming-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2e1d4a"></stop><stop offset="0.55" stop-color="#b24a66"></stop><stop offset="1" stop-color="#f7a65a"></stop></linearGradient>
        </defs>
        <rect width="400" height="170" fill="url(#art-coming-sky)"></rect>
        <circle cx="190" cy="138" r="26" fill="#ffc36e" opacity="0.9"></circle>
        <path d="M0 140 Q120 118 220 136 T400 128 L400 170 L0 170 Z" fill="#3a1e36"></path>
        ${glow("art-coming-glow", 300, 112, 120, "#ffc26a", 0.45)}
        ${house(252, "#22142a", "#170d1e", ["#ffd27e", "#ffd27e", "#ffc566", "#3a2440"], "#ffb257")}
        <circle cx="364" cy="108" r="4" fill="#ffe6b0"></circle>
        ${glow("art-coming-porch", 364, 108, 26, "#ffe6b0", 0.6)}`,
    ),
  // Dusk: the house goes dark behind you.
  leaving_home: () =>
    frame(
      "leaving",
      svg`<defs>
          <linearGradient id="art-leaving-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#110e2a"></stop><stop offset="0.6" stop-color="#3a2452"></stop><stop offset="1" stop-color="#8a3c58"></stop></linearGradient>
        </defs>
        <rect width="400" height="170" fill="url(#art-leaving-sky)"></rect>
        ${stars([[30, 24], [80, 50], [122, 18], [262, 30], [340, 54], [372, 20], [210, 14]])}
        <path d="M98 34 A20 20 0 1 0 118 56 A15 15 0 1 1 98 34 Z" fill="#f2e2c4"></path>
        <path d="M0 146 Q140 128 240 144 T400 138 L400 170 L0 170 Z" fill="#1c1228"></path>
        ${house(256, "#1d142a", "#140d1f", ["#2e2440", "#2e2440", "#2e2440", "#43345a"], "#2a2038")}
        ${glow("art-leaving-glow", 70, 158, 60, "#ffd9a0", 0.35)}`,
    ),
  // Night: some windows lit, others dark, as if someone were home.
  mimic_presence: () =>
    frame(
      "mimic",
      svg`<defs>
          <linearGradient id="art-mimic-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1230"></stop><stop offset="1" stop-color="#26305e"></stop></linearGradient>
        </defs>
        <rect width="400" height="170" fill="url(#art-mimic-sky)"></rect>
        ${stars([[24, 30], [64, 16], [104, 46], [276, 20], [312, 52], [360, 28], [390, 60], [236, 40]])}
        <circle cx="74" cy="60" r="22" fill="#f4ecd6"></circle>
        <path d="M0 150 Q100 136 200 150 T400 146 L400 170 L0 170 Z" fill="#111633"></path>
        ${glow("art-mimic-glow", 306, 104, 90, "#ffcf7a", 0.35)}
        ${house(256, "#161c3a", "#0e1228", ["#ffd27e", "#28305a", "#28305a", "#ffc566"], "#28305a")}
        <path d="M0 170 L0 150 Q20 140 40 150 Q60 138 84 152 Q100 144 120 156 L120 170 Z M280 170 L280 156 Q300 142 322 152 Q344 140 366 150 Q384 142 400 148 L400 170 Z" fill="#0a0e22"></path>`,
    ),
  // The sun's arc over the day: a time, sunrise or sunset.
  schedule: () =>
    frame(
      "schedule",
      svg`<defs>
          <linearGradient id="art-schedule-sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f3d74"></stop><stop offset="0.6" stop-color="#7a5a8c"></stop><stop offset="1" stop-color="#f0985c"></stop></linearGradient>
        </defs>
        <rect width="400" height="170" fill="url(#art-schedule-sky)"></rect>
        <path d="M40 150 A160 120 0 0 1 360 150" fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="2.5" stroke-dasharray="2 9" stroke-linecap="round"></path>
        ${glow("art-schedule-glow", 300, 66, 70, "#ffd27a", 0.6)}
        <circle cx="300" cy="66" r="20" fill="#ffd27a"></circle>
        <path d="M0 150 Q80 124 160 146 Q240 126 320 144 Q370 134 400 140 L400 170 L0 170 Z" fill="#2c2346"></path>
        <path d="M0 160 Q120 146 220 162 T400 156 L400 170 L0 170 Z" fill="#1c1630"></path>`,
    ),
  // A dark hallway: someone walks in, the ceiling light comes on.
  motion: () =>
    frame(
      "motion",
      svg`<defs>
          <linearGradient id="art-motion-beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe2a6" stop-opacity="0.65"></stop><stop offset="1" stop-color="#ffe2a6" stop-opacity="0.04"></stop></linearGradient>
        </defs>
        <rect width="400" height="170" fill="#151826"></rect>
        <path d="M0 0 L120 30 L120 140 L0 170 Z M400 0 L280 30 L280 140 L400 170 Z" fill="#1c2032"></path>
        <rect x="120" y="30" width="160" height="110" fill="#11131f"></rect>
        <rect x="176" y="62" width="48" height="78" rx="2" fill="#0b0d16"></rect>
        <path d="M0 170 L120 140 L280 140 L400 170 Z" fill="#232739"></path>
        <path d="M188 14 L212 14 L270 170 L130 170 Z" fill="url(#art-motion-beam)"></path>
        <rect x="186" y="6" width="28" height="9" rx="4" fill="#ffe9bd"></rect>
        <g transform="translate(212 76) scale(2.3)" fill="#05060b">
          <path d="M14.12,10H19V8.2H15.38L13.38,4.87C13.08,4.37 12.54,4.03 11.92,4.03C11.74,4.03 11.58,4.06 11.42,4.11L6,5.8V11H7.8V7.33L9.91,6.67L6,22H7.8L10.67,13.89L13,17V22H14.8V15.59L12.31,11.05L13.04,8.18M14,3.8C15,3.8 15.8,3 15.8,2C15.8,1 15,0.2 14,0.2C13,0.2 12.2,1 12.2,2C12.2,3 13,3.8 14,3.8Z"></path>
        </g>`,
    ),
};

/** A custom automation (Home Assistant's editor): a flow of steps, when → if → then. */
export const customArt = (): TemplateResult =>
  frame(
    "custom",
    svg`<defs>
        <linearGradient id="art-custom-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b2a6b"></stop><stop offset="1" stop-color="#0a62ff"></stop></linearGradient>
      </defs>
      <rect width="400" height="170" fill="url(#art-custom-bg)"></rect>
      <g fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1">
        ${Array.from({ length: 9 }, (_, i) => svg`<line x1=${i * 50} y1="0" x2=${i * 50} y2="170"></line>`)}
        ${Array.from({ length: 4 }, (_, i) => svg`<line x1="0" y1=${i * 50 + 10} x2="400" y2=${i * 50 + 10}></line>`)}
      </g>
      <g transform="translate(-40 6)">
      <path d="M196 38 C236 38 236 38 236 58 M196 38 C236 38 250 92 286 92 M310 92 C340 92 340 40 362 40 M310 92 C340 92 340 136 362 136"
        fill="none" stroke="#bcd3ff" stroke-width="3" stroke-linecap="round" opacity="0.8"></path>
      <rect x="128" y="20" width="68" height="36" rx="10" fill="#ffffff"></rect>
      <circle cx="146" cy="38" r="7" fill="#0a62ff"></circle>
      <rect x="158" y="34" width="28" height="8" rx="4" fill="#9fb8e8"></rect>
      <path d="M298 72 L318 92 L298 112 L278 92 Z" fill="#ffd27a"></path>
      <rect x="362" y="24" width="64" height="32" rx="10" fill="#ffffff" opacity="0.92"></rect>
      <rect x="362" y="120" width="64" height="32" rx="10" fill="#ffffff" opacity="0.92"></rect>
      <circle cx="378" cy="40" r="6" fill="#ffb35c"></circle>
      <circle cx="378" cy="136" r="6" fill="#6fd38a"></circle>
      </g>`,
  );

/** The picture of an automation type. */
export const automationArt = (type: AutomationType): TemplateResult => ART[type]();
