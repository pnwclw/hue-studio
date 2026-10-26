// Part of the stylesheet (joined in index.ts): pills, lit surfaces, the switch, the brightness slider.

export const CONTROLS_CSS = `
  /* The Hue app's action button: a light grey pill, 24px of room around its words. */
  .pill { height: var(--pill); padding: 0 24px; border: none; border-radius: var(--r-full); cursor: pointer; font-size: var(--fs-footnote); font-weight: 500;
          background: var(--surface-raised); transition: transform var(--t-press) var(--ease); }
  .pill:active { transform: scale(var(--press-tile)); }
  .pill:disabled { opacity: 0.4; }
  /* The screen's main action (the Hue app's): the accent pill. */
  .pill.apply { display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: var(--accent); color: var(--text); }
  .pill.apply svg { width: 18px; height: 18px; }
  h1.big { margin: 6px 0 0; font-size: var(--fs-large); font-weight: 700; letter-spacing: -0.5px; line-height: 1.15; }
  h2.label { margin: var(--section-gap) var(--text-inset) var(--title-gap); font-size: var(--fs-label); font-weight: 500; letter-spacing: 1.4px; text-transform: uppercase; color: var(--text-2); }
  .empty { margin: 24px 4px; color: var(--text-2); font-size: var(--fs-callout); line-height: 1.5; }

  /* lit surfaces: the color layer fades in instead of jumping */
  /* The light's colors, softened like the Hue app's: blurred into each other and a touch less
     saturated, a light shade towards the bottom, a soft shadow under light text. */
  .surface { position: relative; isolation: isolate; overflow: clip; background: var(--surface); }
  .surface::before { content: ""; position: absolute; inset: -24px; z-index: -1; background: var(--lit-bg);
                     filter: blur(18px) saturate(calc(0.85 - var(--dim, 0) * 0.3)); opacity: 0; transition: opacity 0.35s var(--ease); }
  /* The shade, deeper the dimmer the light (--dim: 0 at full brightness, ~1 at the bottom). */
  .surface::after { content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; pointer-events: none;
                    background: linear-gradient(rgba(0, 0, 0, calc(var(--dim, 0) * 0.4)), rgba(0, 0, 0, calc(var(--dim, 0) * 0.55))),
                      linear-gradient(rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0) 38%, rgba(0, 0, 0, 0.26));
                    opacity: 0; transition: opacity 0.35s var(--ease), background 0.3s var(--ease); }
  .surface.lit::before, .surface.lit::after { opacity: 1; }
  /* A light playing a dynamic scene: its colors drift, at its speed (--dyn-dur). */
  .surface.dynamic::before { background-size: 300% 300%; animation: dyn-drift var(--dyn-dur, 12s) ease-in-out infinite alternate; }
  @keyframes dyn-drift { from { background-position: 0% 0%; } to { background-position: 100% 100%; } }
  @media (prefers-reduced-motion: reduce) { .surface.dynamic::before { animation: none; } }
  .hero, .card.surface { --lit-angle: 105deg; }
  .surface { transition: color 0.3s var(--ease), opacity 0.3s; }
  .dark-text { color: var(--text-dark); }

  /* toggle: one size everywhere (the master switch's), a small knob well inside the track (the Hue app's look) */
  .toggle { position: relative; width: var(--switch-w); height: var(--control); flex: none; border: none; border-radius: var(--r-full); padding: 0; cursor: pointer;
            background: var(--switch-off); transition: background 0.25s var(--ease); }
  .toggle::after { content: ""; position: absolute; inset: -8px -4px; }
  .toggle span { position: absolute; top: 4px; left: 4px; width: var(--knob); height: var(--knob); border-radius: 50%; background: #fff;
                 box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25); transition: transform 0.3s var(--spring), width var(--t-press) var(--ease); }
  .toggle:active span { width: 28px; }
  .toggle.on { background: var(--accent); }
  .toggle.on span { transform: translateX(20px); }
  .toggle.on:active span { transform: translateX(16px); }
  .lit .toggle.on { background: rgba(0, 0, 0, 0.22); }

  /* brightness slider: a thin track and a small knob (the Hue app's, measured at 430pt) */
  .slider { position: relative; height: 8px; margin: 16px 2px 2px; border-radius: var(--r-full); cursor: pointer; touch-action: pan-y;
            background: rgba(255, 255, 255, 0.14); }
  .slider::before { content: ""; position: absolute; inset: -16px 0; }
  .slider .fill { position: absolute; inset: 0 auto 0 0; width: var(--value); border-radius: var(--r-full);
                  background: linear-gradient(90deg, rgba(255, 255, 255, 0.25), rgba(255, 255, 255, 0.75));
                  transition: width 0.25s var(--ease), opacity 0.25s; }
  .slider .knob { position: absolute; top: 50%; left: var(--value); width: 16px; height: 16px; border-radius: 50%; background: #fff;
                  transform: translate(-50%, -50%); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
                  transition: left 0.25s var(--ease), opacity 0.25s, transform var(--t-press) var(--ease); }
  .slider.dragging .fill, .slider.dragging .knob { transition: none; }
  .slider.dragging .knob { transform: translate(-50%, -50%) scale(1.15); }
  .off .slider .fill, .off .slider .knob, .slider[disabled] .fill, .slider[disabled] .knob { opacity: 0; }
  .slider[disabled] { cursor: inherit; }
  .dark-text .slider { background: rgba(0, 0, 0, 0.12); }
  .dark-text .slider .fill { background: linear-gradient(90deg, rgba(0, 0, 0, 0.04), rgba(0, 0, 0, 0.16)); }

`;
