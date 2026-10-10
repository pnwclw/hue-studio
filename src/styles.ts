// Styles. Dark look of the Hue app regardless of the HA theme; sizes follow iOS metrics
// (17px body, 44px hit areas without oversized visuals). One stylesheet for the panel's (or
// dialog's) shadow root: views and controls render into the light DOM below it.

export const CSS = `
  :host {
    --bg: #1c1c1e; --surface: #2c2c2e; --surface-2: #3a3a3c; --text: #fff;
    --text-2: rgba(235, 235, 245, 0.6); --accent: #0a62ff; --radius: 14px;
    --spring: cubic-bezier(0.3, 1.3, 0.5, 1); --ease: cubic-bezier(0.25, 0.8, 0.25, 1);
    /* HA does not size custom panels: take the viewport ourselves. */
    position: relative; display: flex; flex-direction: column; height: 100vh; height: 100dvh; overflow: hidden;
    background: radial-gradient(140% 70% at 50% -10%, #3b322c 0%, var(--bg) 55%);
    color: var(--text); font-family: var(--ha-font-family-body, -apple-system, system-ui, Roboto, sans-serif);
    font-size: 15px; -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: transparent;
  }
  button { font: inherit; color: inherit; }
  hue-studio-home-view, hue-studio-room-view, hue-studio-color-view, hue-studio-gallery-view, hue-studio-slider { display: block; }
  svg { width: 20px; height: 20px; fill: currentColor; display: block; }
  ha-icon { --mdc-icon-size: 22px; display: flex; flex: none; }

  main { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
  .page { container-type: inline-size; max-width: 960px; margin: 0 auto; padding: 0 16px 28px; box-sizing: border-box; }
  .topbar { display: flex; align-items: center; gap: 8px; min-height: 52px; padding-top: max(6px, env(safe-area-inset-top)); }
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
  nav.tabs { flex: none; display: flex; justify-content: center; gap: 4px; padding: 4px 8px max(4px, env(safe-area-inset-bottom));
             background: rgba(18, 18, 20, 0.94); border-top: 1px solid rgba(255, 255, 255, 0.06); }
  nav.tabs[hidden] { display: none; }
  nav.tabs button { flex: 0 1 120px; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 0; border: none;
                    background: none; cursor: pointer; color: var(--text-2); font-size: 10px; letter-spacing: 0.4px; text-transform: uppercase;
                    transition: color 0.2s; }
  nav.tabs button svg { width: 24px; height: 24px; }
  nav.tabs button.on { color: var(--text); }

  /* room */
  .hero { margin: 0 -16px; padding: 0 16px 14px; border-radius: 0 0 22px 22px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22); }
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
  .light { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 8px 12px; }
  .light ha-icon { --mdc-icon-size: 28px; }
  .light .name { font-size: 13px; font-weight: 500; line-height: 1.2; min-height: 2.4em; display: flex; align-items: center; }
  .light.unavailable { opacity: 0.45; }

  /* color wheel */
  .colorview { display: flex; flex-direction: column; }
  .colorview .page { display: flex; flex-direction: column; width: 100%; min-height: 100%; }
  .wheel-wrap { flex: 1; display: flex; align-items: center; justify-content: center; padding: 16px 0 8px; }
  .wheel { position: relative; width: min(84vw, 420px, 50vh); aspect-ratio: 1; border-radius: 50%; touch-action: none;
           box-shadow: 0 0 60px rgba(255, 255, 255, 0.06); transition: background 0.3s; }
  .wheel.color { background: var(--wheel-color); }
  .wheel.white { background: var(--wheel-white); }
  .pin { position: absolute; width: 36px; height: 36px; margin: -41px 0 0 -18px; cursor: grab; touch-action: none; z-index: 1;
         filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.45)); transition: transform 0.2s var(--spring), left 0.35s var(--ease), top 0.35s var(--ease), opacity 0.25s; }
  .pin::before { content: ""; position: absolute; inset: 0; border-radius: 50% 50% 50% 0; transform: rotate(-45deg);
                 background: var(--pin); border: 2.5px solid #fff; box-sizing: border-box; transition: background 0.2s; }
  .pin::after { content: ""; position: absolute; inset: -6px; }
  .pin span { position: relative; display: flex; align-items: center; justify-content: center; height: 100%; font-size: 12px; font-weight: 700; color: #1c1c1e; }
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
  .points { display: flex; align-items: center; gap: 6px; margin: 2px 2px 8px; font-size: 12px; color: var(--text-2); }
  .points[hidden] { display: none; }
  .points button { min-width: 30px; height: 26px; border: none; border-radius: 13px; cursor: pointer; background: var(--surface);
                   font-size: 12px; font-weight: 600; transition: background 0.2s, color 0.2s; }
  .points button.on { background: #fff; color: #1c1c1e; }

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
