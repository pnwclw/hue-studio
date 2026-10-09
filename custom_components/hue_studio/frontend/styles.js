// Panel styles. The panel has the dark look of the Hue app regardless of the HA theme.

export const CSS = `
  :host {
    --bg: #1c1c1e; --surface: #2c2c2e; --surface-2: #3a3a3c; --text: #fff;
    --text-2: rgba(235, 235, 245, 0.6); --accent: #0a62ff; --radius: 18px;
    position: relative; display: flex; flex-direction: column; height: 100%; overflow: hidden;
    background: radial-gradient(140% 70% at 50% -10%, #3b322c 0%, var(--bg) 55%);
    color: var(--text); font-family: var(--ha-font-family-body, -apple-system, system-ui, Roboto, sans-serif);
    -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: transparent;
  }
  button { font: inherit; color: inherit; }
  svg { width: 24px; height: 24px; fill: currentColor; display: block; }
  ha-icon { --mdc-icon-size: 32px; display: flex; }

  main { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  .page { container-type: inline-size; max-width: 1100px; margin: 0 auto; padding: 0 16px 40px; box-sizing: border-box; }
  .topbar { display: flex; align-items: center; gap: 10px; min-height: 56px; padding-top: max(10px, env(safe-area-inset-top)); }
  .topbar .grow { flex: 1; min-width: 0; }
  .round { width: 44px; height: 44px; border: none; border-radius: 50%; padding: 0; flex: none; cursor: pointer;
           display: flex; align-items: center; justify-content: center; background: rgba(120, 120, 128, 0.32); }
  .round[hidden] { display: none; }
  .pill { height: 44px; padding: 0 20px; border: none; border-radius: 22px; cursor: pointer; font-size: 15px; font-weight: 600;
          letter-spacing: 0.4px; text-transform: uppercase; background: rgba(120, 120, 128, 0.32); }
  h1.big { margin: 14px 0 0; font-size: 40px; font-weight: 700; letter-spacing: -0.6px; line-height: 1.1; }
  h2.label { margin: 30px 2px 12px; font-size: 13px; font-weight: 500; letter-spacing: 2px; text-transform: uppercase; color: var(--text-2); }
  .empty { margin: 32px 4px; color: var(--text-2); font-size: 15px; line-height: 1.5; }

  /* toggle */
  .toggle { position: relative; width: 60px; height: 36px; flex: none; border: none; border-radius: 18px; padding: 0; cursor: pointer;
            background: rgba(120, 120, 128, 0.4); transition: background 0.2s; }
  .toggle span { position: absolute; top: 3px; left: 3px; width: 30px; height: 30px; border-radius: 50%; background: #fff;
                 box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3); transition: left 0.2s; }
  .toggle.on { background: var(--accent); }
  .toggle.on span { left: 27px; }
  .lit .toggle.on { background: rgba(0, 0, 0, 0.22); }

  /* brightness slider */
  .slider { position: relative; height: 14px; margin: 22px 4px 4px; border-radius: 7px; cursor: pointer; touch-action: none;
            background: rgba(255, 255, 255, 0.12); }
  .slider::before { content: ""; position: absolute; inset: -14px 0; }
  .slider .fill { position: absolute; inset: 0 auto 0 0; width: var(--value); border-radius: 7px;
                  background: linear-gradient(90deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.7)); }
  .slider .knob { position: absolute; top: 50%; left: var(--value); width: 28px; height: 28px; border-radius: 50%; background: #fff;
                  transform: translate(-50%, -50%); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); }
  .off .slider .fill, .off .slider .knob { display: none; }
  .dark-text .slider { background: rgba(0, 0, 0, 0.12); }
  .dark-text .slider .fill { background: linear-gradient(90deg, rgba(0, 0, 0, 0.05), rgba(0, 0, 0, 0.18)); }

  /* home: room cards */
  .cards { display: grid; gap: 14px; }
  .card { position: relative; padding: 20px 18px 18px; border-radius: var(--radius); background: var(--surface); cursor: pointer;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25); transition: transform 0.15s; }
  .card:active { transform: scale(0.985); }
  .card.lit { background: var(--lit-bg); }
  .card.unavailable { opacity: 0.45; }
  .row { display: flex; align-items: center; gap: 18px; }
  .row .name { flex: 1; min-width: 0; font-size: 21px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dark-text { color: #1c1c1e; }

  /* tab bar */
  nav.tabs { display: flex; justify-content: center; gap: 8px; padding: 8px 8px max(8px, env(safe-area-inset-bottom));
             background: rgba(16, 16, 18, 0.94); border-top: 1px solid rgba(255, 255, 255, 0.06); }
  nav.tabs[hidden] { display: none; }
  nav.tabs button { flex: 0 1 140px; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 0; border: none;
                    background: none; cursor: pointer; color: var(--text-2); font-size: 12px; letter-spacing: 0.5px; text-transform: uppercase; }
  nav.tabs button svg { width: 28px; height: 28px; }
  nav.tabs button.on { color: var(--text); }

  /* room */
  .hero { margin: 0 -16px; padding: 0 16px 18px; border-radius: 0 0 26px 26px; background: var(--surface); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25); }
  .hero.lit { background: var(--lit-bg); }
  .hero .title { flex: 1; min-width: 0; font-size: 22px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hero .inner { max-width: 1100px; margin: 0 auto; }
  .hero.dark-text .round { background: rgba(0, 0, 0, 0.1); }
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .scene, .light { position: relative; border: none; border-radius: var(--radius); background: var(--surface); cursor: pointer; text-align: center;
                   box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2); transition: transform 0.15s; }
  .scene:active, .light:active { transform: scale(0.97); }
  .scene { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; aspect-ratio: 1 / 1; padding: 12px; }
  .scene .dot { width: 76px; height: 76px; border-radius: 50%; background: #555 center / cover no-repeat; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); }
  .scene .name { font-size: 17px; font-weight: 600; line-height: 1.2; }
  .scene .sub { margin-top: -8px; font-size: 13px; color: var(--text-2); }
  .light { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 22px 12px 16px; }
  .light ha-icon { --mdc-icon-size: 44px; }
  .light .name { font-size: 17px; font-weight: 500; line-height: 1.2; min-height: 2.4em; display: flex; align-items: center; }
  .light.lit { background: var(--lit-bg); }
  .light.unavailable { opacity: 0.45; }

  /* color wheel */
  .colorview { display: flex; flex-direction: column; height: 100%; }
  .colorview .page { display: flex; flex-direction: column; width: 100%; min-height: 100%; }
  .wheel-wrap { flex: 1; display: flex; align-items: center; justify-content: center; padding: 28px 0 12px; }
  .wheel { position: relative; width: min(92vw, 520px, 56vh); aspect-ratio: 1; border-radius: 50%; touch-action: none;
           box-shadow: 0 0 80px rgba(255, 255, 255, 0.08); }
  .wheel.color { background: var(--wheel-color); }
  .wheel.white { background: var(--wheel-white); }
  .pin { position: absolute; width: 46px; height: 46px; margin: -52px 0 0 -23px; cursor: grab; touch-action: none; z-index: 1;
         filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.45)); transition: transform 0.12s; }
  .pin::before { content: ""; position: absolute; inset: 0; border-radius: 50% 50% 50% 0; transform: rotate(-45deg);
                 background: var(--pin); border: 3px solid #fff; box-sizing: border-box; }
  .pin span { position: relative; display: flex; align-items: center; justify-content: center; height: 100%; font-size: 14px; font-weight: 700; color: #1c1c1e; }
  .pin.off { opacity: 0.55; }
  .pin.selected { z-index: 2; transform: scale(1.12); }
  .pin.dragging { cursor: grabbing; transform: scale(1.2); }
  .controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 8px 0 16px; }
  .modes { display: flex; gap: 6px; padding: 6px; border-radius: 30px; background: rgba(60, 60, 64, 0.7); }
  .modes button { width: 44px; height: 44px; border-radius: 50%; border: 3px solid transparent; cursor: pointer; padding: 0; }
  .modes button.on { border-color: #fff; }
  .modes .m-color { background: conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
  .modes .m-white { background: linear-gradient(#cfe3ff, #fff3d6, #ffc46b); }
  .bright { flex: 1; min-width: 200px; }
  .bright .value { text-align: right; font-size: 13px; letter-spacing: 1px; color: var(--text-2); margin: 0 4px -12px; }
  .chips { display: flex; gap: 10px; overflow-x: auto; padding: 4px 2px 8px; scrollbar-width: none; }
  .chips::-webkit-scrollbar { display: none; }
  .chip { flex: none; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px; border-radius: 20px; border: 2px solid transparent;
          cursor: pointer; background: var(--surface); font-size: 15px; font-weight: 500; }
  .chip ha-icon { --mdc-icon-size: 20px; }
  .chip.on { border-color: #fff; }
  .chip .swatch { width: 14px; height: 14px; border-radius: 50%; background: var(--swatch, #555); }

  /* gallery */
  .q { display: none; width: 100%; height: 44px; box-sizing: border-box; margin: 12px 0 0; border: none; border-radius: 22px; padding: 0 18px;
       font: inherit; font-size: 16px; color: var(--text); outline: none; background: var(--surface); }
  .q.on { display: block; }
  .tiles { display: grid; grid-auto-flow: column; grid-template-rows: repeat(var(--rows, 2), auto); gap: 12px;
           grid-auto-columns: calc((100% - 24px) / 2.3); overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none;
           margin: 0 -16px; padding: 0 16px 4px; scroll-padding: 0 16px; }
  .tiles::-webkit-scrollbar { display: none; }
  .tile { position: relative; aspect-ratio: 16 / 9; border-radius: 14px; overflow: hidden; scroll-snap-align: start; cursor: pointer;
          background: #2a2b2f center / cover no-repeat; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25); transition: transform 0.15s; }
  .tile:active { transform: scale(0.97); }
  .tile img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .tile::after { content: ""; position: absolute; inset: 40% 0 0; background: linear-gradient(transparent, rgba(0, 0, 0, 0.42)); }
  .tile span { position: absolute; left: 12px; right: 10px; bottom: 9px; z-index: 1; color: #fff; font-size: 15px; font-weight: 500;
               text-shadow: 0 1px 6px rgba(0, 0, 0, 0.4); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .searching { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-top: 16px; }
  .searching section:not([hidden]), .searching .tiles { display: contents; }
  .searching h2 { display: none; }
  section[hidden], .tile[hidden], .note[hidden] { display: none; }
  .note { margin-top: 24px; color: var(--text-2); }

  /* scene sheet */
  .sheet { position: absolute; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; padding: 16px;
           background: rgba(0, 0, 0, 0.6); animation: fade 0.2s ease; }
  .sheet .box { width: min(100%, 460px); max-height: 100%; overflow: auto; border-radius: 22px; background: var(--surface);
                box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55); animation: pop 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.15); }
  .sheet .pic { position: relative; aspect-ratio: 16 / 10; background: #333 center / cover no-repeat; }
  .sheet .pic::after { content: ""; position: absolute; inset: 45% 0 0; background: linear-gradient(transparent, rgba(0, 0, 0, 0.5)); }
  .sheet .pic h3 { position: absolute; left: 20px; right: 70px; bottom: 14px; z-index: 1; margin: 0; font-size: 28px; font-weight: 700; }
  .sheet .pic .round { position: absolute; top: 14px; right: 14px; z-index: 1; background: rgba(120, 120, 124, 0.75); }
  .sheet .dots { display: flex; align-items: center; padding: 16px 20px; background: #333336; }
  .sheet .dots i { width: 44px; height: 44px; border-radius: 50%; margin-left: -12px; box-shadow: -3px 0 6px rgba(0, 0, 0, 0.3); }
  .sheet .dots i:first-child { margin-left: 0; box-shadow: none; }
  .sheet .actions { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 20px; }
  .sheet .actions .pill { min-width: 220px; }
  .sheet .actions .target { font-size: 13px; color: var(--text-2); }
  @keyframes fade { from { opacity: 0; } }
  @keyframes pop { from { opacity: 0; transform: scale(0.92); } }

  .toast { position: absolute; left: 50%; bottom: 90px; z-index: 20; max-width: calc(100% - 48px); padding: 12px 18px; border-radius: 14px;
           background: rgba(60, 60, 64, 0.96); font-size: 15px; transform: translate(-50%, 20px); opacity: 0; pointer-events: none;
           transition: opacity 0.2s, transform 0.2s; }
  .toast.on { opacity: 1; transform: translate(-50%, 0); }

  @container (min-width: 640px) {
    .cards { grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); }
    .grid { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); }
    .tiles { grid-auto-flow: row; grid-template-rows: none; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
             overflow: visible; margin: 0; padding: 0; }
    .searching { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
    h1.big { font-size: 44px; }
  }
`;
