// Part of the stylesheet (joined in index.ts): the color screen: its bar, the brightness button, the wheel and its pins, gradient styles, chips, effects.

export const COLOR_CSS = `
  /* The color screen's bar, like the Hue app: "...", Save; Done. Transparent over the screen's glow. */
  .colorview .screen-head { background: none; border: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .cv-bar { position: relative; display: flex; align-items: center; gap: 8px; min-height: 46px; }
  .cv-bar .grow { flex: 1; min-width: 0; }
  .cv-bar .bar-title { text-align: center; font-size: var(--fs-body); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                       opacity: 0; transform: translateY(6px); transition: opacity 0.2s, transform 0.25s var(--ease); }
  .cv-bar.scrolled .bar-title { opacity: 1; transform: none; }
  .colorview .screen-head:has(.cv-bar.scrolled) { background: rgba(22, 22, 24, 0.82); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); }
  .fx-title { margin: 8px 0 18px; font-size: var(--fs-large); font-weight: 700; letter-spacing: -0.6px; line-height: 1.1; }
  .menu-scrim { position: fixed; inset: 0; z-index: 9; }
  .menu { position: absolute; z-index: 10; top: calc(100% + 4px); left: 0; min-width: 220px; padding: 6px; border-radius: var(--r-m);
          background: rgba(44, 44, 46, 0.97); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px);
          box-shadow: var(--shadow-overlay); transform-origin: top left; animation: menu-in 0.2s var(--spring); }
  .menu button { display: flex; align-items: center; gap: 12px; width: 100%; padding: 11px 12px; border: none; border-radius: var(--r-s);
                 background: none; color: var(--text); font-size: var(--fs-body); text-align: left; cursor: pointer; }
  .menu button:active { background: rgba(255, 255, 255, 0.1); }
  .menu svg { width: 20px; height: 20px; opacity: 0.85; }
  @keyframes menu-in { from { transform: scale(0.85); opacity: 0; } }
  /* Brightness: a button you drag along, its value above it (the Hue app's). */
  .bri { position: relative; margin-left: auto; }
  .bri-value { position: absolute; left: 0; right: 0; bottom: calc(100% + 6px); text-align: center; font-size: var(--fs-tab); letter-spacing: 1.5px;
               color: var(--text-2); font-variant-numeric: tabular-nums; }
  .bri-pill { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; width: 72px; height: 48px;
              padding: 0; border: none; border-radius: var(--r-full); background: rgba(60, 60, 64, 0.7); color: #fff; cursor: pointer;
              touch-action: none; -webkit-user-select: none; user-select: none; transition: transform var(--t-press) var(--ease); }
  .bri-pill:active { transform: scale(var(--press-tile)); }
  /* Filled from the bottom, like the slider it opens. */
  .bri-pill::before { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: var(--level);
                      background: linear-gradient(#c7c7cc, #8e8e93); transition: height 0.15s linear; }
  .bri-pill svg { position: relative; width: 24px; height: 24px; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35)); }
  .bri-pill:focus-visible { box-shadow: 0 0 0 2px var(--selected); }
  .bri.off { opacity: 0.4; }
  .bri.off .bri-pill { cursor: default; }
  /* The open slider: grows up from the button over a dimmed screen. */
  .bri-layer { position: fixed; inset: 0; z-index: 30; animation: fade 0.2s ease; touch-action: none; }
  .bri-track { position: fixed; box-sizing: border-box; overflow: hidden; display: flex; align-items: flex-end; justify-content: center;
               padding-bottom: 13px; border-radius: var(--r-full); background: rgba(72, 72, 76, 0.92); color: #fff; touch-action: none; outline: none;
               box-shadow: var(--shadow-overlay); transform-origin: 50% 100%; animation: bri-grow 0.32s var(--spring); }
  .bri-track::before { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: var(--level);
                       background: linear-gradient(#e5e5ea, #a1a1a6); }
  .bri-track svg { position: relative; width: 28px; height: 28px; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35)); }
  .bri-track:focus-visible { box-shadow: 0 0 0 2px var(--selected), var(--shadow-overlay); }
  .bri-chip { position: fixed; transform: translateX(-50%); padding: 5px 10px; border-radius: var(--r-s); background: rgba(44, 44, 46, 0.95);
              font-size: var(--fs-footnote); font-weight: 500; letter-spacing: 1px; font-variant-numeric: tabular-nums; animation: fade 0.2s ease; }
  @keyframes bri-grow { from { transform: scaleY(0.22); opacity: 0.5; } }
  .controls:has(.bri) { align-items: flex-end; }
  /* Lights a Sync Box drives: why they are locked, and a way to stop it. */
  .sync-note { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px 10px; margin: 0 0 10px; padding: 10px 12px;
               border-radius: var(--r-m); background: var(--info-tint); color: var(--text-2); font-size: var(--fs-footnote); line-height: 1.4; }
  .sync-note svg { flex: none; width: 18px; height: 18px; color: var(--info); }
  .sync-note p { flex: 1 1 calc(100% - 40px); margin: 0; }
  .sync-note .pill { margin-left: auto; }
  .sync-note.all { flex-direction: column; flex-wrap: nowrap; justify-content: center; margin: 24px 0; padding: 32px 20px; text-align: center; font-size: var(--fs-body); }
  .sync-note.all > svg { width: 40px; height: 40px; }
  .sync-note.all p { flex: none; }
  .sync-note.all .pill { margin: 4px 0 0; }

  /* color wheel */
  .colorview { display: flex; flex-direction: column; }
  .colorview .page { display: flex; flex-direction: column; width: 100%; min-height: 100%; padding-bottom: 0; }
  /* The wheel takes the height the dock leaves (container units), a little above the middle. */
  .colorview .page:has(> .wheel-wrap) { height: 100%; }
  .colorview .wheel-wrap { container-type: size; min-height: 240px; padding: 8px 0 48px; }
  .colorview .wheel { width: min(calc(100cqw - 8px), 100cqh, 440px); }
  .dock { position: sticky; bottom: 0; z-index: 5; margin: 0 calc(-1 * var(--gutter)); padding: 14px var(--gutter) max(16px, calc(var(--safe-bottom) + 14px));
          background: linear-gradient(rgba(28, 28, 30, 0), var(--bg) 14px); }
  .colorbody .dock { position: static; margin: 0; padding: 0; background: none; }
  .wheel-wrap { position: relative; flex: 1; display: flex; align-items: center; justify-content: center; padding: 16px 0 8px; }
  .wheel-wrap::before { content: ""; position: absolute; left: 50%; top: 50%; width: min(120%, 520px); aspect-ratio: 1; border-radius: 50%;
                        transform: translate(-50%, -50%); background: var(--wheel-color); filter: blur(60px); opacity: 0.22; pointer-events: none; }
  .wheel-wrap.white::before { background: var(--wheel-white); }
  .wheel-wrap > .wheel { position: relative; }
  .wheel { position: relative; width: min(100%, 440px, 50dvh); aspect-ratio: 1; border-radius: 50%; touch-action: none;
           box-shadow: 0 0 60px var(--hairline); transition: background 0.3s; }
  .wheel.color { background: var(--wheel-color); }
  .wheel.white { background: var(--wheel-white); }
  .wheel .paths { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
  .wheel .paths path { fill: none; stroke: rgba(0, 0, 0, 0.5); stroke-width: 0.6px; vector-effect: non-scaling-stroke;
                       stroke-linecap: round; }
  .wheel .paths path.selected { stroke: rgba(0, 0, 0, 0.7); stroke-width: 0.9px; }
  .pin { position: absolute; width: 42px; height: 42px; margin: -48px 0 0 -21px; cursor: grab; touch-action: none; z-index: 1;
         transition: transform 0.2s var(--spring), left 0.35s var(--ease), top 0.35s var(--ease), opacity 0.25s; }
  .pin::before { content: ""; position: absolute; inset: 0; border-radius: 50% 50% 50% 0; transform: rotate(-45deg);
                 background: var(--pin); box-sizing: border-box; transition: background 0.2s;
                 /* A soft shadow under the drop (offsets turned with it: the shape is rotated -45deg). */
                 box-shadow: 1.4px 1.4px 5px rgba(0, 0, 0, 0.32), 0.4px 0.4px 1.5px rgba(0, 0, 0, 0.42); }
  .pin::after { content: ""; position: absolute; inset: -6px; }
  .pin ha-icon { position: relative; height: 100%; align-items: center; justify-content: center; --mdc-icon-size: 26px;
                 color: #fff; pointer-events: none; }
  .pin.off { opacity: 0.5; }
  .pin.selected { z-index: 2; transform: scale(1.1); }
  .pin.dragging { cursor: grabbing; transform: scale(1.22); transition: transform 0.2s var(--spring); }
  /* Pins with one color: one pin with their count; a tap spreads them around a disc (the Hue app's). */
  .pin.stack .count { position: relative; display: flex; height: 100%; align-items: center; justify-content: center; font-size: var(--fs-title-3);
                      font-weight: 500; color: #fff; pointer-events: none; }
  .spread-layer { position: absolute; inset: 0; z-index: 3; border-radius: 50%; }
  .spread-disc { position: absolute; inset: 25%; border-radius: 50%; background: rgba(96, 96, 102, 0.78); box-shadow: 0 0 0 2px var(--selected);
                 -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); animation: spread-in 0.3s var(--spring); }
  /* Lights other than the picked one: small dots, the Hue app's (a tap picks the light). */
  .pin.dot { width: 22px; height: 22px; margin: -11px 0 0 -11px; z-index: 0; }
  .pin.dot::before { border-radius: 50%; transform: none; border: 2.5px solid #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35); }
  .pin.dot.off { opacity: 1; }
  .pin.dot.off::before { background: rgba(28, 28, 30, 0.7); }
  .pin.dot ha-icon, .pin.dot .count { display: none; }
  .pin.round { width: 50px; height: 50px; margin: -25px 0 0 -25px; z-index: 4; animation: spread-in 0.3s var(--spring); }
  .pin.round::before { border-radius: 50%; transform: none; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.32), 0 0.5px 1.5px rgba(0, 0, 0, 0.42); }
  .pin.round ha-icon { --mdc-icon-size: 30px; }
  @keyframes spread-in { from { transform: scale(0.6); opacity: 0; } }
  /* The gradient style: a button by the brightness, a sheet with the modes and the direction. */
  .controls .grow { flex: 1; }
  .controls .bri { margin-left: 0; }
  .style-btn { width: 48px; height: 48px; background: rgba(60, 60, 64, 0.7); }
  .mode-art { width: 26px; height: 26px; fill: currentColor; }
  .style-sheet .label { margin: 18px 16px 10px; }
  .style-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 0 16px; }
  .style-modes button { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px 8px 14px; border: none;
                        border-radius: var(--r-m); background: var(--surface-2); color: var(--text); cursor: pointer; font-size: var(--fs-caption);
                        font-weight: 500; letter-spacing: 1.5px; text-transform: uppercase; box-shadow: var(--shadow-raised);
                        transition: background 0.2s, color 0.2s, transform var(--t-press) var(--ease); }
  .style-modes button:active { transform: scale(var(--press-tile)); }
  .style-modes button.on { background: #fff; color: var(--text-dark); }
  .style-sheet .label.sep { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--separator); }
  .style-flip { padding: 0 16px 18px; }
  .style-flip .round { width: var(--round-l); height: var(--round-l); }
  .controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 4px 0 18px; }
  .modes { display: flex; align-items: center; gap: 6px; height: 48px; box-sizing: border-box; padding: 0 7px; border-radius: var(--r-full);
           background: rgba(60, 60, 64, 0.7); }
  /* A filled disc (a pseudo-element: iOS paints a button's own gradient background square); the selected one gets a ring. */
  .modes button { position: relative; width: 34px; height: 34px; border-radius: 50%; border: none; cursor: pointer; padding: 0;
                  -webkit-appearance: none; appearance: none; background: transparent; color: inherit;
                  transition: box-shadow 0.2s, transform var(--t-press) var(--ease); }
  .modes button::before { content: ""; position: absolute; inset: 1px; border-radius: 50%; transition: inset 0.2s var(--ease); }
  .modes button:active { transform: scale(var(--press-round)); }
  .modes button.on { box-shadow: inset 0 0 0 2px var(--selected); }
  .modes button.on::before { inset: 4px; }
  .modes .m-color::before { background: radial-gradient(circle, #fff 0, rgba(255, 255, 255, 0) 62%),
                                        conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
  .modes .m-white::before { background: linear-gradient(#fdb247, #fff6d4 60%, #c7f3fe); }
  .modes .m-effects { display: flex; align-items: center; justify-content: center; }
  .modes .m-effects::before { content: none; }
  .modes .sep { width: 1px; height: 22px; margin: 0 2px; background: rgba(255, 255, 255, 0.2); }
  .bright { flex: 1; min-width: 180px; }
  .bright .value { text-align: right; font-size: var(--fs-tab); letter-spacing: 1px; color: var(--text-2); margin: 0 2px -10px; min-height: 13px; }
  .chips { display: flex; gap: 8px; overflow-x: auto; padding: 2px 2px 6px; scrollbar-width: none; }
  .chips::-webkit-scrollbar { display: none; }
  /* The Hue app's chips (bridges, a scene's room): grey on a low surface; the chosen one white on
     an accent tint, ringed in the accent. */
  .chip { flex: none; display: flex; align-items: center; gap: 6px; height: var(--control); padding: 0 12px; border-radius: var(--r-full); border: 2px solid transparent;
          cursor: pointer; background: var(--surface-low); color: var(--text-2); font-size: var(--fs-footnote); font-weight: 500; box-shadow: var(--shadow-flat);
          transition: border-color 0.2s, background 0.2s, color 0.2s; }
  .chip ha-icon { --mdc-icon-size: 16px; }
  .chip.on { border-color: var(--accent); background: var(--info-tint); color: var(--text); }
  .chip .swatch { width: 10px; height: 10px; border-radius: 50%; background: var(--swatch, #555); transition: background 0.3s; }

  /* effects (inside the color view) */
  .colorview hue-studio-effects { flex: 1; }
  .effects .label:first-child { margin-top: 6px; }
  .fx-row { display: grid; grid-auto-flow: column; grid-auto-columns: var(--light-tile); gap: var(--tile-gap); overflow-x: auto;
            margin: 0 calc(-1 * var(--gutter)) 0; padding: 2px var(--gutter) var(--tile-gap); scroll-padding: 0 var(--gutter); scrollbar-width: none; scroll-snap-type: x proximity;
            overscroll-behavior-x: contain; }
  .fx-row::-webkit-scrollbar { display: none; }
  .fx { display: flex; flex-direction: column; align-items: center; gap: 2px; box-sizing: border-box; height: 110px; padding: 10px 6px 8px; border: 2px solid transparent;
        box-shadow: var(--shadow-raised);
        border-radius: var(--r-m); background: var(--surface); cursor: pointer; scroll-snap-align: start; text-align: center;
        transition: transform var(--t-press) var(--ease), border-color 0.2s; }
  .fx:active { transform: scale(var(--press-tile)); }
  .fx.on { border-color: var(--selected); }
  .fx .art { flex: none; width: 48px; height: 48px; margin-bottom: 8px; border-radius: 50%; box-shadow: var(--shadow-dot); }
  .fx .name { font-size: var(--fs-callout); font-weight: 500; line-height: 1.2; }
  .fx .sub { font-size: var(--fs-caption); color: var(--text-2); }
  .fx.create { background: transparent; border: 1.5px solid var(--outline); box-shadow: none; }
  .fx.create .art.plus { display: flex; align-items: center; justify-content: center; width: var(--round-l); height: var(--round-l); margin: 4px 0 12px; background: var(--surface-raised); box-shadow: none; }
  .fx-sheet { max-width: 440px; }
  .sheet-bar { position: relative; z-index: 1; display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--surface-bar);
               box-shadow: var(--shadow-bar); font-size: var(--fs-body); font-weight: 500; }
  .sheet-bar .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fx-head { padding: 16px 16px 4px; }
  .fx-head .art { display: block; width: 56px; height: 56px; border-radius: 50%; box-shadow: var(--shadow-dot); }
  .fx-head h3 { margin: 12px 0 0; font-size: var(--fs-title-2); font-weight: 700; letter-spacing: -0.3px; }
  .fx-sheet .label { margin: 18px 16px 8px; }
  .rows { border-radius: var(--r-m); background: var(--surface-row); overflow: hidden; box-shadow: var(--shadow-row); }
  .fx-sheet .rows { border-radius: 0; background: var(--surface-row); }
  .rows .item { display: flex; align-items: center; gap: 12px; min-height: var(--row-h-compact); padding: 10px 16px; box-sizing: border-box; font-size: var(--fs-body); }
  .rows .item + .item { border-top: 1px solid var(--separator); }
  .rows .item.col { flex-direction: column; align-items: stretch; gap: 0; padding-bottom: 14px; }
  .rows .item .grow { flex: 1; min-width: 0; }
  .line { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .dim { color: var(--text-2); font-size: var(--fs-callout); }
  .dim.small { font-size: var(--fs-footnote); margin-top: 2px; }
  .swatch-btn { width: 40px; height: 40px; margin-left: auto; border: 2px solid rgba(255, 255, 255, 0.9); border-radius: 50%; cursor: pointer;
                box-shadow: var(--shadow-dot); }
  .wheel-item { justify-content: center; }
  .wheel.mini { width: min(64vw, 220px); cursor: crosshair; }
  .wheel.mini .dot { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border: 3px solid #fff; border-radius: 50%;
                     box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45); pointer-events: none; }
  .steps.slider { margin-top: 18px; }
  .ticks { display: flex; justify-content: space-between; margin: 10px -4px 0; font-size: var(--fs-caption); color: var(--text-2); }
  .ticks span { width: 16px; text-align: center; }
  .ticks span.on { color: var(--text); font-weight: 700; }

`;
