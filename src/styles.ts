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
  hue-studio-home-view, hue-studio-room-view, hue-studio-color-view, hue-studio-gallery-view, hue-studio-scene-view, hue-studio-sync-view, hue-studio-rooms-view, hue-studio-settings-view, hue-studio-automations-view, hue-studio-automation-new-view, hue-studio-automation-edit-view, hue-studio-space-view, hue-studio-effects,
  hue-studio-experimental-view, hue-studio-devices-view, hue-studio-slider { display: block; }
  svg { width: 20px; height: 20px; fill: currentColor; display: block; }
  ha-icon { --mdc-icon-size: 22px; display: flex; flex: none; }

  /* The panel does not scroll; every screen has a fixed header and a body that scrolls on its own. */
  main { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  main > * { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .screen-head { flex: none; padding: max(6px, var(--safe-top)) 16px 6px; background: rgba(24, 24, 26, 0.62);
                 -webkit-backdrop-filter: saturate(1.8) blur(24px); backdrop-filter: saturate(1.8) blur(24px); border-bottom: 1px solid rgba(255, 255, 255, 0.06); z-index: 3; }
  .screen-head > * { max-width: 928px; margin-left: auto; margin-right: auto; }
  .screen-head:empty { display: none; }
  .screen-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  .screen-body > .page { padding-top: 10px; }
  .bar { display: flex; align-items: center; gap: 8px; min-height: 44px; }
  .bar.sub .title { flex: 1; min-width: 0; font-size: 17px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* A tab's header floats: the body scrolls under it. On phones it is a bar over a large
     title (iOS): clear at the top; once the title went under the bar, the bar shows it (the
     room header's size) and blurs what scrolls below. A search field takes the title's place. */
  main > * { position: relative; }
  .screen-head:has(> .tab-head) { position: absolute; top: 0; left: 0; right: 0; }
  .screen-head:has(> .tab-head) + .screen-body > .page { padding-top: calc(var(--head-h, calc(var(--safe-top, 0px) + var(--header-height, 56px))) + 10px); }
  .screen-head:has(> .tab-head:not(.wide)) { transition: background-color 0.2s, border-color 0.2s; }
  .screen-head:has(> .tab-head:not(.wide)):not(.scrolled):not(:has(.search-field)) {
    background-color: transparent; border-bottom-color: transparent; -webkit-backdrop-filter: none; backdrop-filter: none; }
  /* Until measured, the bar's own height (padding, 44px row, border), so the first frame doesn't jump. */
  .screen-head:has(> .tab-head:not(.wide)) + .screen-body > .page { padding-top: var(--head-h, calc(max(6px, var(--safe-top)) + 51px)); }
  h1.big.tab-title { margin: 4px 2px 2px; }
  .tab-head .bar-title { flex: 1; min-width: 0; font-size: 17px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                         opacity: 0; transform: translateY(6px); transition: opacity 0.2s, transform 0.25s var(--ease); }
  .screen-head.scrolled .bar-title { opacity: 1; transform: none; }
  /* Desktop (HA's sidebar shown): every screen's header is one row as tall as the sidebar's
     header (its line included), the content centered in it. */
  main.wide { --bar-h: calc(var(--header-height, 56px) - 1px); }
  main.wide .screen-head:not(.hero-head) { padding-top: var(--safe-top, 0px); padding-bottom: 0; }
  main.wide .screen-head > .bar, main.wide .screen-head > .cv-bar { height: var(--bar-h); min-height: 0; }
  main.wide .hero .topbar { min-height: var(--bar-h); padding-top: var(--safe-top, 0px); }
  .tab-head.wide { display: flex; align-items: center; gap: 12px; height: var(--bar-h, calc(var(--header-height, 56px) - 1px)); }
  .tab-head.wide h1.big { margin: 0; font-size: 24px; }
  /* The room's colored header is its fixed header. */
  .screen-head.hero-head { padding: 0; background: none; border: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .screen-head.hero-head > * { max-width: none; }
  .hero-head .hero { position: relative; margin: 0; }
  .page { container-type: inline-size; max-width: 960px; margin: 0 auto; padding: 0 16px 28px; box-sizing: border-box; }
  .topbar { display: flex; align-items: center; gap: 8px; min-height: 52px; padding-top: max(6px, var(--safe-top)); }
  /* Bars stay put while the page scrolls under them. */
  .page > .topbar { position: sticky; top: 0; z-index: 5; margin: 0 -16px; padding-inline: 16px;
                    background: rgba(28, 28, 30, 0.8); -webkit-backdrop-filter: saturate(1.6) blur(18px); backdrop-filter: saturate(1.6) blur(18px); }
  .topbar .grow, .head .grow, .bar .grow, .tab-head .grow { flex: 1; min-width: 0; }
  /* Desktop header of a top-level screen: title and actions in one row, no bar. */
  .head { display: flex; align-items: center; gap: 12px; padding: max(28px, var(--safe-top)) 0 4px; }
  .head h1.big { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
  .hero, .card.surface { --lit-angle: 105deg; }
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

  /* brightness slider: a thin track and a small knob (the Hue app's, measured at 430pt) */
  .slider { position: relative; height: 6px; margin: 16px 2px 2px; border-radius: 3px; cursor: pointer; touch-action: pan-y;
            background: rgba(255, 255, 255, 0.14); }
  .slider::before { content: ""; position: absolute; inset: -16px 0; }
  .slider .fill { position: absolute; inset: 0 auto 0 0; width: var(--value); border-radius: 3px;
                  background: linear-gradient(90deg, rgba(255, 255, 255, 0.25), rgba(255, 255, 255, 0.75));
                  transition: width 0.25s var(--ease), opacity 0.25s; }
  .slider .knob { position: absolute; top: 50%; left: var(--value); width: 16px; height: 16px; border-radius: 50%; background: #fff;
                  transform: translate(-50%, -50%); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
                  transition: left 0.25s var(--ease), opacity 0.25s, transform 0.15s var(--ease); }
  .slider.dragging .fill, .slider.dragging .knob { transition: none; }
  .slider.dragging .knob { transform: translate(-50%, -50%) scale(1.15); }
  .off .slider .fill, .off .slider .knob, .slider[disabled] .fill, .slider[disabled] .knob { opacity: 0; }
  .slider[disabled] { cursor: inherit; }
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
  /* The on-screen keyboard is up (fitToViewport): it covers the tab bar and the home indicator,
     and dialogs move up so their fields stay above it. */
  :host([keyboard]) { --safe-bottom: 0px; }
  :host([keyboard]) nav.tabs:not(.top) { display: none; }
  :host([keyboard]) .sheet { align-items: flex-start; padding-top: max(16px, calc(var(--safe-top) + 8px)); }
  nav.tabs button { flex: 0 1 120px; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 0; border: none;
                    background: none; cursor: pointer; color: var(--text-2); font-size: 10px; letter-spacing: 0.4px; text-transform: uppercase;
                    transition: color 0.2s; }
  nav.tabs button svg { width: 24px; height: 24px; }
  nav.tabs button.on { color: var(--text); }
  /* tabs on top while the experimental footer sits at the bottom */
  nav.tabs.top { order: -1; gap: 4px;
                 padding: max(8px, var(--safe-top)) 12px 8px; border-top: none; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
  nav.tabs.top button { flex: 1 1 0; min-width: 0; flex-direction: row; justify-content: center; gap: 5px; padding: 7px 8px;
                        border-radius: 16px; font-size: 12px; letter-spacing: 0; text-transform: none;
                        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  nav.tabs.top button svg { flex: none; }
  nav.tabs.top button svg { width: 18px; height: 18px; }
  nav.tabs.top button.on { background: var(--surface); }
  main.under-footer { padding-bottom: var(--safe-bottom); }
  main.under-footer .topbar, main.under-footer .screen-head { padding-top: 6px; }

  /* room */
  .hero { position: sticky; top: 0; z-index: 5; margin: 0 -16px; padding: 0 16px 14px; border-radius: 0 0 22px 22px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22); }
  .hero .title { flex: 1; min-width: 0; font-size: 17px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Dragging the brightness: the bar shows just the percentage (the Hue app's). */
  .hero .topbar > :not(.title) { transition: opacity 0.2s var(--ease); }
  .hero .topbar.adjusting > :not(.title) { opacity: 0; pointer-events: none; }
  .hero .topbar.adjusting .title { font-variant-numeric: tabular-nums; }
  .hero .inner { max-width: 960px; margin: 0 auto; }
  .hero .meta { margin: 2px 2px 0; }
  .sensor-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 0; }
  .sensor-chip { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px 7px 10px; border-radius: 999px; border: 0; background: var(--surface); color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
  .sensor-chip ha-icon { --mdc-icon-size: 18px; opacity: 0.75; }
  .sensor-chip.on ha-icon { color: #3ddc84; opacity: 1; }
  .hero.dark-text .round { background: rgba(0, 0, 0, 0.1); }
  .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: none; border-radius: 14px; cursor: pointer;
           font-size: 12px; font-weight: 600; background: rgba(0, 0, 0, 0.22); transition: background 0.2s, transform 0.15s var(--ease); }
  .badge:active { transform: scale(0.96); }
  .badge svg { width: 16px; height: 16px; }
  .badge.on { background: rgba(255, 214, 102, 0.9); color: #1c1c1e; }
  .grid { display: grid; gap: 10px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  /* Cards (scenes, lights, sensors; tileCard): the picture at a fixed distance from the top, a text
     block of fixed height with the name (and lines under it) centered in it, and an optional
     switch zone of its own at the bottom (the Hue app's). Every card is as tall as any other. */
  .tile-card { --top: 14px; --art: 44px; --gap: 6px; --text-h: 52px; --zone: 48px; --icon-y: calc(var(--top) + var(--art) / 2);
               position: relative; box-sizing: border-box; display: flex; flex-direction: column; align-items: center;
               min-width: 0; padding: var(--top) 6px 8px; border: none; border-radius: 16px; cursor: pointer; text-align: center;
               background: var(--surface); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
               transition: transform 0.15s var(--ease), color 0.3s var(--ease); }
  .tile-card.switchable { padding-bottom: calc(var(--zone) + 8px); }
  .tile-card:active { transform: scale(0.96); }
  .tile-card > .art { flex: none; width: 100%; height: var(--art); display: flex; align-items: center; justify-content: center; }
  .tile-card > .art ha-icon { --mdc-icon-size: 30px; }
  .tile-card > .art .dot { width: var(--art); height: var(--art); border-radius: 50%; background: #555 center / cover no-repeat;
                           box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3); transition: transform 0.25s var(--spring); }
  .tile-card:active > .art .dot { transform: scale(0.9); }
  .tile-card > .text { flex: none; box-sizing: border-box; width: 100%; height: var(--text-h); margin-top: var(--gap); display: flex;
                       flex-direction: column; align-items: center; justify-content: center; overflow: hidden; }
  .tile-card .name { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; max-width: 100%; overflow: hidden;
                     overflow-wrap: anywhere; font-size: 15px; font-weight: 600; line-height: 1.2; }
  /* Two lines under the name: the name keeps one. */
  .tile-card .subs-2 .name { -webkit-line-clamp: 1; }
  .tile-card .sub { max-width: 100%; margin-top: 2px; font-size: 13px; line-height: 1.2; opacity: 0.75; white-space: nowrap;
                    overflow: hidden; text-overflow: ellipsis; }
  .tile-card > .switch-zone { position: absolute; left: 0; right: 0; bottom: 0; height: var(--zone); display: flex; align-items: center;
                              justify-content: center; border-radius: 0 0 16px 16px; background: rgba(0, 0, 0, 0.16);
                              border-top: 1px solid rgba(255, 255, 255, 0.1); }
  .switch-zone.inert { pointer-events: none; }
  .switch-zone.inert .toggle { opacity: 0.35; }
  .scene.active { box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85), 0 3px 10px rgba(0, 0, 0, 0.18); }
  .scene-actions { position: absolute; top: 6px; left: 6px; right: 6px; z-index: 1; display: flex; }
  .scene-actions .edit { margin-left: auto; }
  .round.mini { width: 28px; height: 28px; background: rgba(0, 0, 0, 0.28); color: #fff; }
  .round.mini svg { width: 16px; height: 16px; }
  .light.unavailable { opacity: 0.45; }
  .light.selected { box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28); outline: 2px solid var(--ring); outline-offset: 3px; }
  .sensor.motion > .art ha-icon { color: #3ddc84; }
  .sensor.off > .art ha-icon { opacity: 0.5; }
  /* A row of cards that scrolls sideways (lights, sensors), like the Hue app's. */
  .light-row { display: grid; grid-auto-flow: column; grid-auto-columns: 104px; gap: 12px; overflow-x: auto;
               margin: 0 -16px; padding: 7px 16px 8px; scroll-padding: 0 16px; scrollbar-width: none; scroll-snap-type: x proximity;
               overscroll-behavior-x: contain; }
  .light-row::-webkit-scrollbar { display: none; }
  .light-row .tile-card { scroll-snap-align: start; }
  /* Syncing: the switch reads plainly as off (the Hue app's), it is just out of reach. */
  .light.busy .switch-zone.inert .toggle { opacity: 1; }
  /* Short screens (small phones, landscape): compact cards and spacing, so the wheel keeps its size. */
  @media (max-height: 760px) {
    .tile-card { --top: 10px; --art: 38px; --gap: 4px; --text-h: 48px; --zone: 44px; }
    .tile-card > .art ha-icon { --mdc-icon-size: 26px; }
    .tile-card .name { font-size: 14px; }
    .colorview .wheel-wrap { padding: 12px 0 20px; min-height: 180px; }
    .controls { margin-bottom: 12px; }
  }
  /* A Sync Box drives it (the Hue app's "Sync active"): white light pulsing out from the icon
     (--icon-y: the icon's center); every tile on the same beat (views align the animations). */
  .light.busy { cursor: default; }
  .light.busy:active { transform: none; }
  .light .sync-glow { position: absolute; inset: 0; z-index: -1; border-radius: inherit; pointer-events: none;
                      background: radial-gradient(circle at 50% var(--icon-y, 28px), rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.07) 72px, transparent 140px); }
  .light .sync-glow::before { content: ""; position: absolute; inset: 0; border-radius: inherit;
                              background: radial-gradient(circle at 50% var(--icon-y, 28px), rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.14) 48px, transparent 115px);
                              animation: sync-pulse 1.6s ease-in-out infinite; }
  @keyframes sync-pulse { 0%, 100% { opacity: 0.2; } 50% { opacity: 0.95; } }
  /* A tap that can't be served: a shake, left and right (with the error haptic). */
  .refused { animation: refuse 0.42s cubic-bezier(0.36, 0.07, 0.19, 0.97); }
  @keyframes refuse {
    15% { transform: translateX(-7px); } 35% { transform: translateX(6px); } 55% { transform: translateX(-4px); }
    75% { transform: translateX(2px); } 100% { transform: none; }
  }
  @media (prefers-reduced-motion: reduce) { .light .sync-glow::before { animation: none; opacity: 0.5; } }

  /* The color screen's bar, like the Hue app: "...", Save; Done. Transparent over the screen's glow. */
  .colorview .screen-head { background: none; border: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .cv-bar { position: relative; display: flex; align-items: center; gap: 8px; min-height: 46px; }
  .cv-bar .grow { flex: 1; min-width: 0; }
  .cv-bar .bar-title { text-align: center; font-size: 17px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                       opacity: 0; transform: translateY(6px); transition: opacity 0.2s, transform 0.25s var(--ease); }
  .cv-bar.scrolled .bar-title { opacity: 1; transform: none; }
  .colorview .screen-head:has(.cv-bar.scrolled) { background: rgba(22, 22, 24, 0.82); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); }
  .fx-title { margin: 8px 0 18px; font-size: 36px; font-weight: 800; letter-spacing: -0.6px; line-height: 1.1; }
  .cv-bar .round.more { width: 34px; height: 34px; }
  .cv-bar .pill { height: 34px; padding: 0 14px; border-radius: 17px; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;
                  background: rgba(120, 120, 128, 0.28); color: var(--text); }
  .menu-scrim { position: fixed; inset: 0; z-index: 9; }
  .menu { position: absolute; z-index: 10; top: calc(100% + 4px); left: 0; min-width: 220px; padding: 6px; border-radius: 14px;
          background: rgba(44, 44, 46, 0.97); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px);
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5); transform-origin: top left; animation: menu-in 0.2s var(--spring); }
  .menu button { display: flex; align-items: center; gap: 12px; width: 100%; padding: 11px 12px; border: none; border-radius: 9px;
                 background: none; color: var(--text); font-size: 16px; text-align: left; cursor: pointer; }
  .menu button:active { background: rgba(255, 255, 255, 0.1); }
  .menu svg { width: 20px; height: 20px; opacity: 0.85; }
  @keyframes menu-in { from { transform: scale(0.85); opacity: 0; } }
  /* Brightness: a button you drag along, its value above it (the Hue app's). */
  .bri { position: relative; margin-left: auto; }
  .bri-value { position: absolute; left: 0; right: 0; bottom: calc(100% + 6px); text-align: center; font-size: 11px; letter-spacing: 1.5px;
               color: var(--text-2); font-variant-numeric: tabular-nums; }
  .bri-pill { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; width: 72px; height: 48px;
              padding: 0; border: none; border-radius: 24px; background: rgba(60, 60, 64, 0.7); color: #fff; cursor: pointer;
              touch-action: none; -webkit-user-select: none; user-select: none; transition: transform 0.15s var(--ease); }
  .bri-pill:active { transform: scale(0.95); }
  /* Filled from the bottom, like the slider it opens. */
  .bri-pill::before { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: var(--level);
                      background: linear-gradient(#c7c7cc, #8e8e93); transition: height 0.15s linear; }
  .bri-pill svg { position: relative; width: 24px; height: 24px; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35)); }
  .bri-pill:focus-visible { box-shadow: 0 0 0 2px #fff; }
  .bri.off { opacity: 0.4; }
  .bri.off .bri-pill { cursor: default; }
  /* The open slider: grows up from the button over a dimmed screen. */
  .bri-layer { position: fixed; inset: 0; z-index: 30; background: rgba(0, 0, 0, 0.6); animation: fade 0.2s ease; touch-action: none; }
  .bri-track { position: fixed; box-sizing: border-box; overflow: hidden; display: flex; align-items: flex-end; justify-content: center;
               padding-bottom: 13px; border-radius: 26px; background: rgba(72, 72, 76, 0.92); color: #fff; touch-action: none; outline: none;
               box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5); transform-origin: 50% 100%; animation: bri-grow 0.32s var(--spring); }
  .bri-track::before { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: var(--level);
                       background: linear-gradient(#e5e5ea, #a1a1a6); }
  .bri-track svg { position: relative; width: 28px; height: 28px; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35)); }
  .bri-track:focus-visible { box-shadow: 0 0 0 2px #fff, 0 16px 40px rgba(0, 0, 0, 0.5); }
  .bri-chip { position: fixed; transform: translateX(-50%); padding: 5px 10px; border-radius: 10px; background: rgba(44, 44, 46, 0.95);
              font-size: 13px; font-weight: 600; letter-spacing: 1px; font-variant-numeric: tabular-nums; animation: fade 0.2s ease; }
  @keyframes bri-grow { from { transform: scaleY(0.22); opacity: 0.5; } }
  .controls:has(.bri) { align-items: flex-end; }
  /* Lights a Sync Box drives: why they are locked, and a way to stop it. */
  .sync-note { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin: 6px 0 2px; padding: 10px 12px;
               border-radius: var(--radius); background: rgba(106, 91, 255, 0.18); font-size: 13px; line-height: 1.35; }
  .sync-note p { flex: 1 1 calc(100% - 40px); margin: 0; }
  .sync-note .pill { margin-left: auto; }
  .sync-note > svg { flex: none; width: 22px; height: 22px; }
  .sync-note.all { flex-direction: column; flex-wrap: nowrap; justify-content: center; margin: 24px 0; padding: 32px 20px; text-align: center; font-size: 15px; }
  .sync-note.all > svg { width: 40px; height: 40px; }
  .sync-note.all p { flex: none; }
  .sync-note.all .pill { margin: 4px 0 0; }

  /* color wheel */
  .colorview { display: flex; flex-direction: column; }
  .colorview .page { display: flex; flex-direction: column; width: 100%; min-height: 100%; padding-bottom: 0; }
  /* The wheel takes the height the dock leaves (container units), a little above the middle. */
  .colorview .page:has(> .wheel-wrap) { height: 100%; }
  .colorview .wheel-wrap { container-type: size; min-height: 240px; padding: 20px 0 36px; }
  .colorview .wheel { width: min(100cqw, 100cqh, 440px); }
  .dock { position: sticky; bottom: 0; z-index: 5; margin: 0 -16px; padding: 14px 16px max(10px, var(--safe-bottom));
          background: linear-gradient(rgba(28, 28, 30, 0), var(--bg) 14px); }
  .colorbody .dock { position: static; margin: 0; padding: 0; background: none; }
  .wheel-wrap { position: relative; flex: 1; display: flex; align-items: center; justify-content: center; padding: 16px 0 8px; }
  .wheel-wrap::before { content: ""; position: absolute; left: 50%; top: 50%; width: min(120%, 520px); aspect-ratio: 1; border-radius: 50%;
                        transform: translate(-50%, -50%); background: var(--wheel-color); filter: blur(60px); opacity: 0.22; pointer-events: none; }
  .wheel-wrap.white::before { background: var(--wheel-white); }
  .wheel-wrap > .wheel { position: relative; }
  .wheel { position: relative; width: min(100%, 440px, 50dvh); aspect-ratio: 1; border-radius: 50%; touch-action: none;
           box-shadow: 0 0 60px rgba(255, 255, 255, 0.06); transition: background 0.3s; }
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
  .pin.stack .count { position: relative; display: flex; height: 100%; align-items: center; justify-content: center; font-size: 20px;
                      font-weight: 600; color: #fff; pointer-events: none; }
  .spread-layer { position: absolute; inset: 0; z-index: 3; border-radius: 50%; }
  .spread-disc { position: absolute; inset: 25%; border-radius: 50%; background: rgba(96, 96, 102, 0.78); box-shadow: 0 0 0 2px #fff;
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
                        border-radius: 14px; background: var(--surface-2); color: var(--text); cursor: pointer; font-size: 12px;
                        font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
                        transition: background 0.2s, color 0.2s, transform 0.15s var(--ease); }
  .style-modes button:active { transform: scale(0.97); }
  .style-modes button.on { background: #fff; color: #1c1c1e; }
  .style-sheet .label.sep { margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
  .style-flip { padding: 0 16px 18px; }
  .style-flip .round { width: 40px; height: 40px; }
  .controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 4px 0 18px; }
  .modes { display: flex; align-items: center; gap: 6px; height: 48px; box-sizing: border-box; padding: 0 7px; border-radius: 24px;
           background: rgba(60, 60, 64, 0.7); }
  /* A filled disc (a pseudo-element: iOS paints a button's own gradient background square); the selected one gets a ring. */
  .modes button { position: relative; width: 34px; height: 34px; border-radius: 50%; border: none; cursor: pointer; padding: 0;
                  -webkit-appearance: none; appearance: none; background: transparent; color: inherit;
                  transition: box-shadow 0.2s, transform 0.15s var(--ease); }
  .modes button::before { content: ""; position: absolute; inset: 1px; border-radius: 50%; transition: inset 0.2s var(--ease); }
  .modes button:active { transform: scale(0.9); }
  .modes button.on { box-shadow: inset 0 0 0 2px #fff; }
  .modes button.on::before { inset: 4px; }
  .modes .m-color::before { background: radial-gradient(circle, #fff 0, rgba(255, 255, 255, 0) 62%),
                                        conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
  .modes .m-white::before { background: linear-gradient(#cfe3ff, #fff3d6, #ffc46b); }
  .modes .m-effects { display: flex; align-items: center; justify-content: center; }
  .modes .m-effects::before { content: none; }
  .modes .sep { width: 1px; height: 22px; margin: 0 2px; background: rgba(255, 255, 255, 0.2); }
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
            margin: 0 -16px 0; padding: 2px 16px 18px; scroll-padding: 0 16px; scrollbar-width: none; scroll-snap-type: x proximity;
            overscroll-behavior-x: contain; }
  .fx-row::-webkit-scrollbar { display: none; }
  .fx { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 12px 6px 10px; border: 2px solid transparent;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.32);
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
  .center.stack { flex-direction: column; align-items: center; gap: 12px; }
  .pill.reset.danger { color: #ff6b5e; }
  .pill.reset.danger.confirm { color: #fff; }
  .scene-actions .shuffle { margin-left: 6px; }
  .sheet .form-body { padding: 16px 16px 0; }
  .sheet .add-sheet .rows { border-radius: 0; background: none; }
  .sheet .field, .page .field { width: 100%; box-sizing: border-box; height: 44px; padding: 0 12px; border: none; border-radius: 12px; font: inherit;
                  font-size: 17px; color: inherit; background: rgba(120, 120, 128, 0.24); outline: none; }
  .sheet .hint { margin: 10px 2px 0; font-size: 13px; line-height: 1.45; color: var(--text-2); }

  /* gallery */
  /* In a bar instead of its title (phones), or before the actions (desktop Explore tab). */
  .search-field { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; height: 34px; margin: 0; padding: 0 10px; box-sizing: border-box;
                  border-radius: 10px; background: rgba(120, 120, 128, 0.24); color: var(--text-2); cursor: text; animation: field-in 0.25s var(--ease); }
  @keyframes field-in { from { opacity: 0; transform: scaleX(0.96); } }
  .search-field svg { width: 18px; height: 18px; flex: none; }
  .search-field .q { flex: 1; min-width: 0; height: 100%; margin: 0; padding: 0; border: none; background: none; outline: none;
                     font: inherit; font-size: 16px; color: var(--text); }
  .search-field .q::placeholder { color: var(--text-2); }
  .tab-head.wide .search-field { flex: 0 1 260px; height: 34px; margin: 0; }
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
           background: rgba(0, 0, 0, 0.55); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); animation: fade 0.2s ease; }
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

  /* sync (Sync Box): a glow in the colors of the mode while syncing */
  .m-video { --g1: #3a5bff; --g2: #b03cff; --g3: #ff3d8b; }
  .m-music { --g1: #ff3d8b; --g2: #ff8a3d; --g3: #ffd23d; }
  .m-game { --g1: #19e6a0; --g2: #19b5ff; --g3: #6a5bff; }
  .glow { position: absolute; inset: -60%; z-index: -1; opacity: 0; filter: blur(42px); pointer-events: none;
          background: conic-gradient(from 0deg, var(--g1, #555), var(--g2, #777), var(--g3, #999), var(--g1, #555));
          transition: opacity 0.6s var(--ease); animation: spin 14s linear infinite; animation-play-state: paused; }
  .syncing > .glow { opacity: 0.55; animation-play-state: running; }
  @keyframes spin { to { transform: rotate(1turn); } }
  @media (prefers-reduced-motion: reduce) { .glow { animation: none; } }
  .tv { width: 44px; height: 44px; flex: none; border-radius: 50%; display: flex; align-items: center; justify-content: center;
        background: rgba(255, 255, 255, 0.12); }
  .tv svg { width: 24px; height: 24px; }
  .sync .chips.boxes { margin-top: 12px; }
  .sync-hero { position: relative; isolation: isolate; overflow: hidden; margin-top: 16px; padding: 18px 18px 16px; border-radius: 22px;
               background: var(--surface); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25); }
  .sync-hero .name { font-size: 18px; font-weight: 600; }
  .sync-hero .status { margin-top: 2px; font-size: 14px; }
  .sync-hero .center { margin-top: 18px; }
  .sync-hero .area-line { margin-top: 10px; text-align: center; }
  .sync-hero.off .tv { opacity: 0.5; }
  .pill.go { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-width: 210px; height: 44px; border-radius: 22px;
             font-size: 15px; letter-spacing: 0; text-transform: none; background: #fff; color: #1c1c1e; }
  .pill.go svg { width: 20px; height: 20px; }
  .pill.go.stop { background: rgba(0, 0, 0, 0.35); color: #fff; }
  .sync-body { transition: opacity 0.3s; }
  .rows.bright-row { margin-top: 22px; }
  .sync-body.disabled { opacity: 0.4; pointer-events: none; }
  .sync-modes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .mode-tile { position: relative; isolation: isolate; overflow: hidden; display: flex; flex-direction: column; align-items: center; gap: 8px;
               padding: 16px 6px 14px; border: 2px solid transparent; border-radius: var(--radius); cursor: pointer; background: var(--surface);
               font-size: 14px; font-weight: 600; transition: border-color 0.2s, transform 0.15s var(--ease); }
  .mode-tile::before { content: ""; position: absolute; inset: 0; z-index: -1; opacity: 0; transition: opacity 0.4s var(--ease);
                       background: linear-gradient(135deg, var(--g1), var(--g2) 55%, var(--g3)); }
  .mode-tile:nth-child(1) { --g1: #3a5bff; --g2: #b03cff; --g3: #ff3d8b; }
  .mode-tile:nth-child(2) { --g1: #ff3d8b; --g2: #ff8a3d; --g3: #ffd23d; }
  .mode-tile:nth-child(3) { --g1: #19e6a0; --g2: #19b5ff; --g3: #6a5bff; }
  .mode-tile ha-icon { --mdc-icon-size: 30px; }
  .mode-tile:active { transform: scale(0.96); }
  .mode-tile.on { border-color: #fff; }
  .mode-tile.live::before { opacity: 0.85; }
  .mode-tile.unsupported { opacity: 0.5; }
  .seg { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2px; padding: 2px; border-radius: 11px;
         background: rgba(118, 118, 128, 0.24); }
  .seg button { height: 34px; border: none; border-radius: 9px; cursor: pointer; background: transparent; font-size: 13px; font-weight: 500;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 4px; transition: background 0.2s var(--ease); }
  .seg button.on { background: #636366; font-weight: 600; box-shadow: 0 3px 8px rgba(0, 0, 0, 0.12); }
  .grid.inputs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .palettes { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .palette { display: flex; align-items: center; gap: 10px; padding: 8px 12px 8px 8px; border-radius: var(--radius); border: 1.5px solid transparent;
             background: var(--surface); cursor: pointer; font-size: 13px; text-align: left; }
  .palette.on { border-color: #fff; }
  .palette .art { width: 34px; height: 34px; flex: none; border-radius: 50%; }
  .select.wide { width: 100%; margin-top: 10px; }
  .rows.mode-extra { margin-top: 10px; }
  .device-card + .device-card { border-top: 1px solid rgba(255, 255, 255, 0.06); }
  .device-card > .item { width: 100%; }
  .device-form { padding: 0 14px 14px 50px; }
  .chips.wrap { flex-wrap: wrap; overflow: visible; }
  .sensor-kind { display: flex; align-items: center; gap: 6px; margin: 10px 0 6px; }
  .sensor-kind ha-icon { --mdc-icon-size: 16px; }
  .rows .item .check { width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid var(--text-2); display: flex; align-items: center; justify-content: center; flex: none; }
  .rows .item .check.on { background: var(--accent); border-color: var(--accent); }
  .rows .item .check svg { width: 14px; height: 14px; }
  .dot-badge.live { background: #3ddc84; }
  /* Phones: the area picker of a Hue room/zone gets a line of its own. */
  @container (max-width: 560px) {
    .group-row { flex-wrap: wrap; }
    .group-row .select { flex: 1 1 100%; max-width: none; width: auto; margin-left: 38px; }
  }
  .device-form .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
  .item.col .field { margin-top: 10px; }
  .input-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 14px; border: none; border-radius: var(--radius);
                cursor: pointer; text-align: left; background: var(--surface); box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18);
                transition: transform 0.15s var(--ease), box-shadow 0.2s; }
  .input-tile:active { transform: scale(0.97); }
  .input-tile ha-icon { --mdc-icon-size: 26px; margin-bottom: 6px; }
  .input-tile .name { font-size: 15px; font-weight: 600; }
  .input-tile .dim { display: flex; align-items: center; gap: 6px; }
  .input-tile.on { box-shadow: 0 0 0 2px #fff, 0 3px 10px rgba(0, 0, 0, 0.18); }
  .input-tile.unplugged { opacity: 0.5; }
  .led { width: 7px; height: 7px; border-radius: 50%; background: #8e8e93; }
  .led.linked { background: #3ddc84; box-shadow: 0 0 6px #3ddc84; }
  .led.plugged { background: #ffb340; }
  .rows.areas .item { width: 100%; border: none; background: none; cursor: pointer; text-align: left; font: inherit; color: inherit; }
  .rows.areas ha-icon { color: var(--text-2); }
  .radio { width: 22px; height: 22px; flex: none; box-sizing: border-box; border: 2px solid rgba(235, 235, 245, 0.3); border-radius: 50%;
           transition: border 0.2s var(--ease); }
  .on > .radio { border: 7px solid var(--accent); }
  .sync-cards { display: grid; gap: 10px; margin-top: 16px; }
  .sync-card { position: relative; isolation: isolate; overflow: hidden; display: flex; align-items: center; gap: 12px; padding: 12px 14px;
               border-radius: var(--radius); cursor: pointer; background: var(--surface); box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18); }
  .sync-card .text { flex: 1; min-width: 0; }
  .sync-card .name { font-size: 15px; font-weight: 600; }
  .sync-card .status { font-size: 13px; opacity: 0.75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sync-card .tv { width: 38px; height: 38px; }
  .sync-card .tv svg { width: 20px; height: 20px; }
  .sync-card.syncing .toggle.on { background: rgba(0, 0, 0, 0.3); }
  .sync-note { display: flex; align-items: flex-start; gap: 10px; margin: 0 0 10px; padding: 10px 12px; border-radius: 12px; font-size: 13px;
               line-height: 1.4; color: var(--text-2); background: rgba(10, 98, 255, 0.14); }
  .sync-note svg { flex: none; width: 18px; height: 18px; color: #6c9dff; }
  /* Phones: a room's scenes scroll sideways in two rows, cards as wide as the light cards (the Hue app's). */
  @media (max-width: 600px) {
    .grid.scene-row { grid-template-columns: none; grid-template-rows: repeat(2, auto); grid-auto-flow: column; grid-auto-columns: 104px;
                      gap: 12px; overflow-x: auto; margin: 0 -16px; padding: 2px 16px 8px; scroll-padding: 0 16px; scrollbar-width: none;
                      scroll-snap-type: x proximity; overscroll-behavior-x: contain; }
    .grid.scene-row::-webkit-scrollbar { display: none; }
    .grid.scene-row .tile-card { scroll-snap-align: start; }
  }
  .grid.locked .scene { opacity: 0.45; cursor: default; }
  .grid.locked .scene:active { transform: none; }
  .sync-meta svg { width: 14px; height: 14px; }

  /* rooms and zones */
  .notice { display: flex; align-items: center; gap: 10px; width: 100%; margin: 14px 0 0; padding: 12px 14px; border: none;
            border-radius: var(--radius); cursor: pointer; text-align: left; font-size: 14px; line-height: 1.35;
            background: rgba(10, 98, 255, 0.16); }
  .notice svg { flex: none; color: #6c9dff; }
  .notice .grow { flex: 1; min-width: 0; }
  .notice .go { flex: none; font-weight: 600; color: #6c9dff; }
  .notice:active { transform: scale(0.99); }
  /* A Sync Box drives lights: the Hue app's "Hue Sync is active" bar with its Stop button. */
  .sync-banner { display: flex; align-items: center; gap: 14px; margin: 14px 0 0; padding: 10px 10px 10px 18px; border-radius: 28px;
                 cursor: pointer; background: rgba(120, 120, 128, 0.24); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
                 transition: transform 0.15s var(--ease); }
  .sync-banner:active { transform: scale(0.99); }
  .sync-banner > svg { flex: none; width: 24px; height: 24px; }
  .sync-banner .grow { flex: 1; min-width: 0; }
  .sync-banner .title { font-size: 14px; font-weight: 500; line-height: 1.3; }
  .sync-banner .sub { font-size: 14px; line-height: 1.3; color: var(--text-2); }
  .sync-banner .pill { height: 30px; padding: 0 12px; border-radius: 15px; font-size: 13px; background: rgba(255, 255, 255, 0.14); }
  /* Settings → Scene gallery: a category's rule opens under its row; whether it shows now. */
  .rule-row .chevron { flex: none; opacity: 0.5; }
  .rule-editor { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 4px 16px 14px; }
  .rule-editor .chips { flex-wrap: wrap; overflow: visible; padding: 0; }
  .rule-editor .chip:not(.on) { background: rgba(120, 120, 128, 0.24); }
  .rule-editor .chip ha-icon { --mdc-icon-size: 16px; }
  .rule-editor .dates { display: flex; flex-wrap: wrap; gap: 10px; }
  .rule-editor p { margin: 0; }
  .date-field { display: flex; flex-direction: column; gap: 4px; }
  .date-value { position: relative; display: flex; align-items: center; min-width: 76px; height: 36px; padding: 0 12px; box-sizing: border-box;
                border-radius: 10px; background: rgba(120, 120, 128, 0.24); font-size: 16px; cursor: pointer; }
  .date-value input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; border: none; opacity: 0; cursor: pointer;
                      font-size: 16px; color-scheme: dark; }
  .season-state { flex: none; font-size: 12px; font-weight: 600; color: var(--text-2); }
  .season-state.on { color: #3ddc84; }
  .lead { margin: 0 2px 10px; font-size: 14px; line-height: 1.45; color: var(--text-2); }
  .lead.small { margin-top: 12px; font-size: 13px; }
  .text-link { display: inline; margin-left: 4px; padding: 0; border: none; background: none; cursor: pointer; color: #6c9dff; font-size: inherit; }
  .rows + .rows { margin-top: 10px; }
  .rows .item ha-icon { color: var(--text-2); }
  .rows button.item { width: 100%; border: none; background: none; cursor: pointer; text-align: left; font: inherit; color: inherit; }
  .rows button.item:active { background: rgba(255, 255, 255, 0.04); }
  .rows .item .chevron { --mdc-icon-size: 20px; }
  .rows .item > svg { color: var(--text-2); }
  .dot-badge { width: 8px; height: 8px; flex: none; border-radius: 50%; background: #6c9dff; }
  .rows.plan .item, .rows.conflicts .item { font-size: 15px; }
  .rows.conflicts ha-icon { color: #ffb340; }
  .select { flex: none; max-width: 46%; height: 34px; padding: 0 10px; border: none; border-radius: 10px; font: inherit; font-size: 14px;
            color: inherit; background: rgba(120, 120, 128, 0.28); }
  .rooms-page .center { margin-top: 18px; }
  .sheet .box.zone-editor { width: min(100%, 440px); }
  .zone-editor h2.label { margin: 18px 16px 8px; }
  .zone-editor .rows { border-radius: 0; background: #333336; }
  .check { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; flex: none; box-sizing: border-box;
           border: 2px solid rgba(235, 235, 245, 0.3); border-radius: 50%; transition: background 0.2s, border 0.2s; }
  .check svg { width: 16px; height: 16px; opacity: 0; }
  .on > .check { border-color: var(--accent); background: var(--accent); }
  .on > .check svg { opacity: 1; }
  /* automations */
  .rows .item .row-open { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 0; border: none; background: none;
                          cursor: pointer; text-align: left; font: inherit; color: inherit; }
  .rows .item .row-open .grow { display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
  .rows .item .row-open .dim.small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .automations-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 0 4px; text-align: center; }
  .automation-type { display: flex; align-items: center; gap: 8px; margin: 2px 2px 10px; font-size: 13px; color: var(--text-2); }
  .automation-type ha-icon { --mdc-icon-size: 18px; }
  .automation-page h3.sublabel { margin: 14px 2px 8px; font-size: 13px; font-weight: 500; color: var(--text-2); }
  .automation-page .seg + .rows { margin-top: 10px; }
  .automation-page .seg.kinds { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .automation-page .chips.wrap { flex-wrap: wrap; overflow: visible; }
  .automation-page .chips.days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; margin-top: 10px; overflow: visible; }
  .automation-page .chips.days .chip { min-width: 0; padding: 0; justify-content: center; }
  .automation-page .center .pill.apply { min-width: 200px; }
  .automation-page .rows.pick .item .check { margin-left: auto; }
  /* light of the day (natural light, scene of the day) */
  .rows .item .thumb { width: 40px; height: 40px; flex: none; border-radius: 50%; object-fit: cover; }
  .rows .item.wrap { flex-wrap: wrap; }
  .rows .item.wrap .grow { min-width: 140px; }
  .rows .item .plain { padding: 0; border: none; background: none; cursor: pointer; text-align: left; font: inherit; color: inherit; }
  .lead.pad { padding: 0 16px 16px; }
  .seg.three { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 12px; }
  .swatch-dot { width: 26px; height: 26px; flex: none; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15); }
  .today span.pic { display: block; }
  .seg button:disabled { opacity: 0.4; }
  .today { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin-top: 14px; padding: 14px; border-radius: var(--radius);
           background: var(--surface); }
  .today .pic { width: 64px; height: 64px; flex: none; border-radius: 50%; object-fit: cover; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35); }
  .today .text { flex: 1; min-width: 160px; }
  .today .name { font-size: 18px; font-weight: 600; margin: 2px 0; }
  .today-actions { display: flex; flex-wrap: wrap; gap: 8px; width: 100%; }
  .today-actions .pill { text-transform: none; letter-spacing: 0; font-size: 13px; }
  .empty-today { color: var(--text-2); font-size: 14px; }
  .scene-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-top: 10px; }
  .scene-tiles.small { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); }
  .scene-tiles .tile { border: none; padding: 0; text-align: left; font: inherit; color: inherit; }
  .scene-tiles .tile .remove { position: absolute; top: 6px; right: 6px; z-index: 2; }
  .scene-tiles .tile.dimmed { opacity: 0.55; }
  .add-tile { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; background: transparent !important;
              box-shadow: inset 0 0 0 1.5px rgba(120, 120, 128, 0.45) !important; color: var(--text-2); }
  .add-tile::after { display: none; }
  .add-tile span { position: static !important; text-shadow: none !important; color: var(--text-2) !important; }
  .picker-grid { max-height: 52vh; overflow-y: auto; padding: 0 16px; margin: 12px 0 0; }
  .picker-grid .tile .check { position: absolute; top: 6px; right: 6px; z-index: 2; width: 22px; height: 22px; background: rgba(0, 0, 0, 0.35);
                              border-color: rgba(255, 255, 255, 0.7); }
  .picker-grid .tile.on { box-shadow: 0 0 0 2px #fff; }
  .sheet .box.picker, .sheet .box.holiday-editor { width: min(100%, 560px); }
  .stepper { display: flex; align-items: center; gap: 6px; flex: none; }
  .stepper .value { min-width: 64px; text-align: center; font-size: 14px; font-variant-numeric: tabular-nums; }
  .round.mini-step { width: 30px; height: 30px; font-size: 17px; line-height: 1; }
  .round.mini-step:disabled { opacity: 0.35; }
  .round.mini-step svg { width: 16px; height: 16px; }
  .select.time { max-width: 120px; color-scheme: dark; }
  /* Below 16px iOS zooms the page in when a field or picker gets focus. */
  @media (pointer: coarse) { .select { font-size: 16px; } }
  .md-row { display: flex; align-items: center; gap: 10px; }
  .sheet .field.md { width: 110px; text-align: center; font-variant-numeric: tabular-nums; }
  .holiday-editor .chips { margin-top: 12px; flex-wrap: wrap; }

  /* arrange lights */
  .room { position: relative; width: min(100%, 560px); aspect-ratio: 1; margin: 14px auto 0; border-radius: 18px; touch-action: none;
          background: linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px) 6% 6% / 22% 22%,
                      linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px) 6% 6% / 22% 22%, var(--surface);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); }
  .room.locked { opacity: 0.6; }
  .edge-label { margin: 8px 0 0; text-align: center; font-size: 11px; letter-spacing: 1.2px; text-transform: uppercase; color: var(--text-2); }
  .edge-label + .room { margin-top: 6px; }
  .room .links { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .room .links line { stroke: rgba(255, 255, 255, 0.45); stroke-width: 0.8; stroke-dasharray: 2 1.5; }
  .spot { position: absolute; width: 38px; height: 38px; margin: -19px 0 0 -19px; padding: 0; border: 2px solid rgba(255, 255, 255, 0.85);
         border-radius: 50%; cursor: grab; display: flex; align-items: center; justify-content: center; background: var(--pin);
         color: #fff; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.45); touch-action: none; transition: transform 0.15s var(--ease); }
  .spot ha-icon { --mdc-icon-size: 18px; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6)); }
  .spot.on { transform: scale(1.18); border-color: #fff; box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.35), 0 3px 10px rgba(0, 0, 0, 0.45); }
  .spot:active { cursor: grabbing; }
  .rows.height { margin-top: 14px; }
  .height-line { align-items: center; margin-top: 10px; }
  .height-line input { flex: 1; accent-color: #fff; }
  .center-text { text-align: center; margin-top: 12px; }
  .rows button.item:disabled { opacity: 0.5; }
  .seg.two { grid-template-columns: repeat(2, minmax(0, 1fr)); width: min(100%, 260px); }

  .mismatch { margin: 0 0 10px; padding: 12px 14px; border-radius: 12px; background: rgba(255, 179, 64, 0.14); }
  .mismatch p { margin: 0; font-size: 14px; line-height: 1.4; }
  .mismatch .buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .mismatch .pill { text-transform: none; letter-spacing: 0; font-size: 13px; }

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
    .grid.inputs { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .sync-hero { padding: 24px; }
    .tile:hover, .card:hover, .tile-card:hover { transform: translateY(-1px); }
    h1.big { font-size: 34px; }
    /* Room header: a card in the column instead of a sheet glued to the top edge. */
    .page > .hero:first-child { position: relative; margin: 20px 0 0; padding: 4px 20px 18px; border-radius: 22px; }
  }
`;
