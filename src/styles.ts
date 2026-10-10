// Styles. Dark look of the Hue app regardless of the HA theme; sizes follow iOS metrics
// (17px body, 44px hit areas without oversized visuals). One stylesheet for the panel's (or
// dialog's) shadow root: views and controls render into the light DOM below it.

export const CSS = `
  :host {
    --bg: #1c1c1e; --surface: #2c2c2e; --surface-2: #3a3a3c; --text: #fff;
    --text-2: rgba(235, 235, 245, 0.6); --accent: #0a62ff; --radius: 14px;
    --spring: cubic-bezier(0.3, 1.3, 0.5, 1); --ease: cubic-bezier(0.25, 0.8, 0.25, 1);
    /* HA does not size custom panels: take the viewport ourselves (fitToViewport refines the
       height). Safe areas are ours (handle_safe_area), padded with HA's own variables;
       --hue-top/--hue-bottom are what HA covers around us anyway, if it does. */
    --safe-top: max(0px, calc(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) - var(--hue-top, 0px)));
    --safe-bottom: max(0px, calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) - var(--hue-bottom, 0px)));
    position: relative; display: flex; flex-direction: column; height: 100vh; height: 100dvh; overflow: hidden;
    background: radial-gradient(140% 70% at 50% -10%, #3b322c 0%, var(--bg) 55%);
    color: var(--text); font-family: var(--ha-font-family-body, -apple-system, system-ui, Roboto, sans-serif);
    font-size: 15px; -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: transparent;
  }
  button { font: inherit; color: inherit; }
  hue-studio-home-view, hue-studio-room-view, hue-studio-color-view, hue-studio-gallery-view, hue-studio-scene-view, hue-studio-effects,
  hue-studio-slider { display: block; }
  svg { width: 20px; height: 20px; fill: currentColor; display: block; }
  ha-icon { --mdc-icon-size: 22px; display: flex; flex: none; }

  main { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
  .page { container-type: inline-size; max-width: 960px; margin: 0 auto; padding: 0 16px 28px; box-sizing: border-box; }
  .topbar { display: flex; align-items: center; gap: 8px; min-height: 52px; padding-top: max(6px, var(--safe-top)); }
  /* Bars stay put while the page scrolls under them. */
  .page > .topbar { position: sticky; top: 0; z-index: 5; margin: 0 -16px; padding-inline: 16px;
                    background: rgba(28, 28, 30, 0.8); -webkit-backdrop-filter: saturate(1.6) blur(18px); backdrop-filter: saturate(1.6) blur(18px); }
  .topbar .grow { flex: 1; min-width: 0; }
  .round { position: relative; width: 34px; height: 34px; border: none; border-radius: 50%; padding: 0; flex: none; cursor: pointer;
           display: flex; align-items: center; justify-content: center; background: rgba(120, 120, 128, 0.28);
           transition: background 0.2s, transform 0.15s var(--ease); }
  .round::after { content: ""; position: absolute; inset: -5px; }
  .round:active { transform: scale(0.92); }
  .round[hidden] { display: none; }
  .pill { height: 34px; padding: 0 16px; border: none; border-radius: 17px; cursor: pointer; font-size: 13px; font-weight: 600;
          letter-spacing: 0.3px; text-transform: uppercase; background: rgba(120, 120, 128, 0.28); transition: transform 0.15s var(--ease); }
  .pill:active { transform: scale(0.96); }
  .pill:disabled { opacity: 0.4; }
  h1.big { margin: 6px 0 0; font-size: 30px; font-weight: 700; letter-spacing: -0.5px; line-height: 1.15; }
  h2.label { margin: 22px 2px 8px; font-size: 12px; font-weight: 500; letter-spacing: 1.4px; text-transform: uppercase; color: var(--text-2); }
  .empty { margin: 24px 4px; color: var(--text-2); font-size: 14px; line-height: 1.5; }

  /* lit surfaces: the color layer fades in instead of jumping */
  .surface { position: relative; isolation: isolate; background: var(--surface); }
  .surface::before { content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; background: var(--lit-bg);
                     opacity: 0; transition: opacity 0.35s var(--ease); }
  .surface.lit::before { opacity: 1; }
  .surface { transition: color 0.3s var(--ease), opacity 0.3s; }
  .dark-text { color: #1c1c1e; }

  /* toggle (iOS proportions, a bit smaller) */
  .toggle { position: relative; width: 46px; height: 28px; flex: none; border: none; border-radius: 14px; padding: 0; cursor: pointer;
            background: rgba(120, 120, 128, 0.36); transition: background 0.25s var(--ease); }
  .toggle::after { content: ""; position: absolute; inset: -8px -4px; }
  .toggle span { position: absolute; top: 2px; left: 2px; width: 24px; height: 24px; border-radius: 50%; background: #fff;
                 box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25); transition: transform 0.3s var(--spring), width 0.15s var(--ease); }
  .toggle:active span { width: 28px; }
  .toggle.on { background: var(--accent); }
  .toggle.on span { transform: translateX(18px); }
  .toggle.on:active span { transform: translateX(14px); }
  .lit .toggle.on { background: rgba(0, 0, 0, 0.22); }

  /* brightness slider */
  .slider { position: relative; height: 8px; margin: 16px 2px 2px; border-radius: 4px; cursor: pointer; touch-action: none;
            background: rgba(255, 255, 255, 0.14); }
  .slider::before { content: ""; position: absolute; inset: -14px 0; }
  .slider .fill { position: absolute; inset: 0 auto 0 0; width: var(--value); border-radius: 4px;
                  background: linear-gradient(90deg, rgba(255, 255, 255, 0.25), rgba(255, 255, 255, 0.75));
                  transition: width 0.25s var(--ease), opacity 0.25s; }
  .slider .knob { position: absolute; top: 50%; left: var(--value); width: 22px; height: 22px; border-radius: 50%; background: #fff;
                  transform: translate(-50%, -50%); box-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
                  transition: left 0.25s var(--ease), opacity 0.25s, transform 0.15s var(--ease); }
  .slider.dragging .fill, .slider.dragging .knob { transition: none; }
  .slider.dragging .knob { transform: translate(-50%, -50%) scale(1.12); }
  .off .slider .fill, .off .slider .knob { opacity: 0; }
  .dark-text .slider { background: rgba(0, 0, 0, 0.12); }
  .dark-text .slider .fill { background: linear-gradient(90deg, rgba(0, 0, 0, 0.04), rgba(0, 0, 0, 0.16)); }

  /* home: room cards */
  .cards { display: grid; gap: 10px; }
  .card { padding: 14px 14px 12px; border-radius: var(--radius); cursor: pointer; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
          transition: transform 0.15s var(--ease), color 0.3s var(--ease); }
  .card:active { transform: scale(0.985); }
  .card.unavailable { opacity: 0.45; }
  .row { display: flex; align-items: center; gap: 12px; }
  .row .text { flex: 1; min-width: 0; }
  .row .name { font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { display: flex; align-items: center; gap: 8px; font-size: 12px; opacity: 0.7; min-height: 0; }
  .meta:empty { display: none; }
  .meta .motion { width: 7px; height: 7px; border-radius: 50%; background: #3ddc84; box-shadow: 0 0 6px #3ddc84; }

  /* tab bar */
  nav.tabs { flex: none; display: flex; justify-content: center; gap: 4px; padding: 4px 8px max(4px, var(--safe-bottom));
             background: rgba(18, 18, 20, 0.94); border-top: 1px solid rgba(255, 255, 255, 0.06); }
  nav.tabs[hidden] { display: none; }
  nav.tabs button { flex: 0 1 120px; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 0; border: none;
                    background: none; cursor: pointer; color: var(--text-2); font-size: 10px; letter-spacing: 0.4px; text-transform: uppercase;
                    transition: color 0.2s; }
  nav.tabs button svg { width: 24px; height: 24px; }
  nav.tabs button.on { color: var(--text); }

  /* room */
  .hero { position: sticky; top: 0; z-index: 5; margin: 0 -16px; padding: 0 16px 14px; border-radius: 0 0 22px 22px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22); }
  .hero .title { flex: 1; min-width: 0; font-size: 18px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hero .inner { max-width: 960px; margin: 0 auto; }
  .hero .meta { margin: 2px 2px 0; }
  .hero.dark-text .round { background: rgba(0, 0, 0, 0.1); }
  .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: none; border-radius: 14px; cursor: pointer;
           font-size: 12px; font-weight: 600; background: rgba(0, 0, 0, 0.22); transition: background 0.2s, transform 0.15s var(--ease); }
  .badge:active { transform: scale(0.96); }
  .badge svg { width: 16px; height: 16px; }
  .badge.on { background: rgba(255, 214, 102, 0.9); color: #1c1c1e; }
  .grid { display: grid; gap: 10px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .scene, .light { position: relative; border: none; border-radius: var(--radius); cursor: pointer; text-align: center;
                   box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18); transition: transform 0.15s var(--ease), color 0.3s var(--ease); }
  .scene:active, .light:active { transform: scale(0.96); }
  .scene { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; aspect-ratio: 1; padding: 8px; }
  .scene .dot { width: 52px; height: 52px; border-radius: 50%; background: #555 center / cover no-repeat; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
                transition: transform 0.25s var(--spring); }
  .scene:active .dot { transform: scale(0.9); }
  .scene .name { font-size: 13px; font-weight: 600; line-height: 1.2; }
  .scene .sub { margin-top: -6px; font-size: 11px; color: var(--text-2); }
  .scene.active { box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85), 0 3px 10px rgba(0, 0, 0, 0.18); }
  .scene-actions { position: absolute; top: 6px; left: 6px; right: 6px; display: flex; }
  .scene-actions .edit { margin-left: auto; }
  .round.mini { width: 28px; height: 28px; background: rgba(0, 0, 0, 0.28); color: #fff; }
  .round.mini svg { width: 16px; height: 16px; }
  .light { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 8px 12px; }
  .light ha-icon { --mdc-icon-size: 28px; }
  .light .name { font-size: 13px; font-weight: 500; line-height: 1.2; min-height: 2.4em; display: flex; align-items: center; }
  .light.unavailable { opacity: 0.45; }

  /* color wheel */
  .colorview { display: flex; flex-direction: column; }
  .colorview .page { display: flex; flex-direction: column; width: 100%; min-height: 100%; padding-bottom: 0; }
  .dock { position: sticky; bottom: 0; z-index: 5; margin: 0 -16px; padding: 14px 16px max(10px, var(--safe-bottom));
          background: linear-gradient(rgba(28, 28, 30, 0), var(--bg) 14px); }
  .colorbody .dock { position: static; margin: 0; padding: 0; background: none; }
  .wheel-wrap { flex: 1; display: flex; align-items: center; justify-content: center; padding: 16px 0 8px; }
  .wheel { position: relative; width: min(84vw, 420px, 50vh); aspect-ratio: 1; border-radius: 50%; touch-action: none;
           box-shadow: 0 0 60px rgba(255, 255, 255, 0.06); transition: background 0.3s; }
  .wheel.color { background: var(--wheel-color); }
  .wheel.white { background: var(--wheel-white); }
  .wheel .paths { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
  .wheel .paths path { fill: none; stroke: rgba(255, 255, 255, 0.7); stroke-width: 2px; vector-effect: non-scaling-stroke;
                       stroke-linecap: round; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3)); }
  .wheel .paths path.selected { stroke: #fff; stroke-width: 2.5px; }
  .pin { position: absolute; width: 42px; height: 42px; margin: -48px 0 0 -21px; cursor: grab; touch-action: none; z-index: 1;
         filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.45)); transition: transform 0.2s var(--spring), left 0.35s var(--ease), top 0.35s var(--ease), opacity 0.25s; }
  .pin::before { content: ""; position: absolute; inset: 0; border-radius: 50% 50% 50% 0; transform: rotate(-45deg);
                 background: var(--pin); border: 2.5px solid #fff; box-sizing: border-box; transition: background 0.2s; }
  .pin::after { content: ""; position: absolute; inset: -6px; }
  .pin ha-icon { position: relative; height: 100%; align-items: center; justify-content: center; --mdc-icon-size: 20px;
                 color: rgba(28, 28, 30, 0.82); pointer-events: none; }
  .pin.off { opacity: 0.5; }
  .pin.selected { z-index: 2; transform: scale(1.1); }
  .pin.dragging { cursor: grabbing; transform: scale(1.22); transition: transform 0.2s var(--spring); }
  .pin.merged::before { border-width: 3px; }
  .controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 4px 0 10px; }
  .modes { display: flex; gap: 4px; padding: 4px; border-radius: 22px; background: rgba(60, 60, 64, 0.7); }
  .modes button { width: 34px; height: 34px; border-radius: 50%; border: 2.5px solid transparent; cursor: pointer; padding: 0;
                  transition: border-color 0.2s, transform 0.15s var(--ease); }
  .modes button:active { transform: scale(0.9); }
  .modes button.on { border-color: #fff; }
  .modes .m-color { background: conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
  .modes .m-white { background: linear-gradient(#cfe3ff, #fff3d6, #ffc46b); }
  .modes .m-effects { display: flex; align-items: center; justify-content: center; background: transparent; }
  .modes .sep { width: 1px; margin: 8px 2px; background: rgba(255, 255, 255, 0.2); }
  .link { width: 42px; height: 42px; border: none; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center;
          background: rgba(60, 60, 64, 0.7); transition: background 0.2s, color 0.2s; }
  .link.on { background: #fff; color: #1c1c1e; }
  .bright { flex: 1; min-width: 180px; }
  .bright .value { text-align: right; font-size: 11px; letter-spacing: 1px; color: var(--text-2); margin: 0 2px -10px; min-height: 13px; }
  .chips { display: flex; gap: 8px; overflow-x: auto; padding: 2px 2px 6px; scrollbar-width: none; }
  .chips::-webkit-scrollbar { display: none; }
  .chip { flex: none; display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 16px; border: 1.5px solid transparent;
          cursor: pointer; background: var(--surface); font-size: 13px; font-weight: 500; transition: border-color 0.2s, background 0.2s; }
  .chip ha-icon { --mdc-icon-size: 16px; }
  .chip.on { border-color: #fff; }
  .chip .swatch { width: 10px; height: 10px; border-radius: 50%; background: var(--swatch, #555); transition: background 0.3s; }

  /* effects (inside the color view) */
  .colorview hue-studio-effects { flex: 1; }
  .effects .label:first-child { margin-top: 6px; }
  .fx-row { display: grid; grid-auto-flow: column; grid-auto-columns: calc((100% - 30px) / 3.6); gap: 10px; overflow-x: auto;
            margin: 0 -16px 10px; padding: 0 16px 2px; scrollbar-width: none; scroll-snap-type: x proximity; }
  .fx-row::-webkit-scrollbar { display: none; }
  .fx { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 12px 6px 10px; border: 2px solid transparent;
        border-radius: var(--radius); background: var(--surface); cursor: pointer; scroll-snap-align: start; text-align: center;
        transition: transform 0.15s var(--ease), border-color 0.2s; }
  .fx:active { transform: scale(0.96); }
  .fx.on { border-color: #fff; }
  .fx .art { width: 54px; height: 54px; margin-bottom: 6px; border-radius: 50%; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35); }
  .fx .name { font-size: 14px; font-weight: 600; line-height: 1.2; }
  .fx .sub { font-size: 12px; color: var(--text-2); }
  .fx.create { background: transparent; border: 2px solid var(--surface-2); }
  .fx.create .art.plus { display: flex; align-items: center; justify-content: center; background: var(--surface-2); box-shadow: none; }
  .fx-sheet { max-width: 440px; }
  .sheet-bar { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: #333336; font-size: 16px; font-weight: 600; }
  .sheet-bar .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fx-head { padding: 16px 16px 4px; }
  .fx-head .art { display: block; width: 56px; height: 56px; border-radius: 50%; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35); }
  .fx-head h3 { margin: 12px 0 0; font-size: 26px; font-weight: 700; letter-spacing: -0.3px; }
  .fx-sheet .label { margin: 18px 16px 8px; }
  .rows { border-radius: var(--radius); background: var(--surface); overflow: hidden; }
  .fx-sheet .rows { border-radius: 0; background: #333336; }
  .rows .item { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 10px 16px; box-sizing: border-box; font-size: 16px; }
  .rows .item + .item { border-top: 1px solid rgba(255, 255, 255, 0.08); }
  .rows .item.col { flex-direction: column; align-items: stretch; gap: 0; padding-bottom: 14px; }
  .rows .item .grow { flex: 1; min-width: 0; }
  .line { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .dim { color: var(--text-2); font-size: 14px; }
  .dim.small { font-size: 13px; margin-top: 2px; }
  .swatch-btn { width: 40px; height: 40px; margin-left: auto; border: 2px solid rgba(255, 255, 255, 0.9); border-radius: 50%; cursor: pointer;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); }
  .wheel-item { justify-content: center; }
  .wheel.mini { width: min(64vw, 220px); cursor: crosshair; }
  .wheel.mini .dot { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border: 3px solid #fff; border-radius: 50%;
                     box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45); pointer-events: none; }
  .steps.slider { margin-top: 18px; }
  .ticks { display: flex; justify-content: space-between; margin: 10px -4px 0; font-size: 12px; color: var(--text-2); }
  .ticks span { width: 16px; text-align: center; }
  .ticks span.on { color: var(--text); font-weight: 700; }

  /* scene editor */
  .scene-edit { padding-bottom: calc(28px + var(--safe-bottom)); }
  .scene-edit > .topbar.surface { background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; }
  .scene-edit > .topbar .title { flex: 1; min-width: 0; font-size: 17px; font-weight: 600; }
  .scene-edit .hero { position: relative; z-index: 0; padding-bottom: 18px; border-radius: 0 0 22px 22px; }
  .scene-edit .hero .inner { padding-top: 8px; }
  .scene-edit .dot.big { width: 60px; height: 60px; border-radius: 50%; background: #555 center / cover no-repeat;
                         box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35); }
  .name-row { display: flex; align-items: center; gap: 12px; margin: 10px 0 18px; }
  .name-row h1.big { flex: 1; min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; }
  .name-input { flex: 1; min-width: 0; height: 42px; padding: 0 12px; border: none; border-radius: 12px; font: inherit; font-size: 24px;
                font-weight: 700; color: inherit; background: rgba(0, 0, 0, 0.25); outline: none; }
  .scene-edit .hero .line .dim { color: inherit; opacity: 0.75; }
  .scene-edit .hero .slider { margin-top: 18px; }
  .hero.dark-text .name-input { background: rgba(255, 255, 255, 0.4); }
  .section-head { display: flex; align-items: center; justify-content: space-between; margin-top: 22px; }
  .section-head h2.label { margin: 0 2px; }
  .pill.shuffle { display: inline-flex; align-items: center; gap: 8px; }
  .pill.shuffle svg { width: 18px; height: 18px; }
  .section-head + .grid { margin-top: 10px; }
  .center { display: flex; justify-content: center; margin-top: 28px; }
  .pill.reset { min-width: 180px; height: 40px; border-radius: 20px; text-transform: none; font-size: 15px; letter-spacing: 0; }
  .pill.reset.confirm { background: #c0392b; }

  /* gallery */
  .q { display: block; width: 100%; height: 0; box-sizing: border-box; margin: 0; border: none; border-radius: 18px; padding: 0 16px;
       font: inherit; font-size: 15px; color: var(--text); outline: none; background: var(--surface); opacity: 0;
       transition: height 0.25s var(--ease), margin 0.25s var(--ease), opacity 0.2s; }
  .q.on { height: 36px; margin-top: 10px; opacity: 1; }
  .tiles { display: grid; grid-auto-flow: column; grid-template-rows: repeat(var(--rows, 2), auto); gap: 10px;
           grid-auto-columns: calc((100% - 20px) / 2.4); overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none;
           margin: 0 -16px; padding: 0 16px 2px; scroll-padding: 0 16px; overscroll-behavior-x: contain; }
  .tiles::-webkit-scrollbar { display: none; }
  .tile { position: relative; aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden; scroll-snap-align: start; cursor: pointer;
          background: #2a2b2f center / cover no-repeat; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22); transition: transform 0.15s var(--ease); }
  .tile:active { transform: scale(0.97); }
  .tile img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .tile::after { content: ""; position: absolute; inset: 40% 0 0; background: linear-gradient(transparent, rgba(0, 0, 0, 0.42)); }
  .tile span { position: absolute; left: 10px; right: 8px; bottom: 7px; z-index: 1; color: #fff; font-size: 13px; font-weight: 600;
               text-shadow: 0 1px 6px rgba(0, 0, 0, 0.4); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .searching { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-top: 14px; }
  .searching section:not([hidden]), .searching .tiles { display: contents; }
  .searching h2 { display: none; }
  section[hidden], .tile[hidden], .note[hidden] { display: none; }
  .note { margin-top: 20px; color: var(--text-2); }

  /* scene sheet / dialogs */
  .sheet { position: absolute; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; padding: 16px;
           background: rgba(0, 0, 0, 0.55); animation: fade 0.2s ease; }
  .sheet .box { width: min(100%, 400px); max-height: 100%; overflow: auto; border-radius: 18px; background: var(--surface);
                box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55); animation: pop 0.3s var(--spring); }
  .sheet .pic { position: relative; aspect-ratio: 16 / 10; background: #333 center / cover no-repeat; }
  .sheet .pic::after { content: ""; position: absolute; inset: 45% 0 0; background: linear-gradient(transparent, rgba(0, 0, 0, 0.5)); }
  .sheet .pic h3 { position: absolute; left: 16px; right: 56px; bottom: 12px; z-index: 1; margin: 0; font-size: 22px; font-weight: 700; }
  .sheet .pic .round { position: absolute; top: 12px; right: 12px; z-index: 1; background: rgba(120, 120, 124, 0.75); }
  .sheet .dots { display: flex; align-items: center; padding: 12px 16px; background: #333336; }
  .sheet .dots i { width: 34px; height: 34px; border-radius: 50%; margin-left: -9px; box-shadow: -3px 0 6px rgba(0, 0, 0, 0.3); }
  .sheet .dots i:first-child { margin-left: 0; box-shadow: none; }
  .sheet .actions { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px; }
  .sheet .actions .pill { min-width: 200px; }
  .sheet .actions .target { font-size: 12px; color: var(--text-2); }
  @keyframes fade { from { opacity: 0; } }
  @keyframes pop { from { opacity: 0; transform: scale(0.94) translateY(8px); } }

  .toast { position: absolute; left: 50%; bottom: 76px; z-index: 20; max-width: calc(100% - 48px); padding: 10px 16px; border-radius: 12px;
           background: rgba(60, 60, 64, 0.96); font-size: 14px; transform: translate(-50%, 16px); opacity: 0; pointer-events: none;
           transition: opacity 0.2s, transform 0.25s var(--spring); }
  .toast.on { opacity: 1; transform: translate(-50%, 0); }

  @container (min-width: 600px) {
    .cards { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
    .grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
    .tiles { grid-auto-flow: row; grid-template-rows: none; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
             overflow: visible; margin: 0; padding: 0; }
    .searching { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); }
    .tile:hover, .card:hover, .scene:hover, .light:hover { transform: translateY(-1px); }
    h1.big { font-size: 34px; }
  }
`;
