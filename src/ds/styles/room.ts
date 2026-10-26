// Part of the stylesheet (joined in index.ts): a room: its header, tile and control cards, rows of cards, the Sync pulse, the refusal shake.

export const ROOM_CSS = `
  /* room */
  .hero { position: sticky; top: 0; z-index: 5; margin: 0 calc(-1 * var(--gutter)); padding: 0 16px 14px; border-radius: 0 0 var(--r-m) var(--r-m); box-shadow: var(--shadow-raised); }
  /* Its bar row sits where every other screen's is (the 44px row of .bar), the gap below kept. */
  .hero .topbar { min-height: 44px; padding-bottom: 8px; }
  main.wide .hero .topbar { padding-bottom: 0; }
  .hero .title { flex: 1; min-width: 0; font-size: var(--fs-body); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Dragging the brightness: the bar shows just the percentage (the Hue app's). */
  .hero .topbar > :not(.title) { transition: opacity 0.2s var(--ease); }
  .hero .topbar.adjusting > :not(.title) { opacity: 0; pointer-events: none; }
  .hero .topbar.adjusting .title { font-variant-numeric: tabular-nums; }
  .hero .inner { max-width: 960px; margin: 0 auto; }
  .hero .meta { margin: 2px 2px 0; }
  /* The Hue app's spacing around the room's slider: close under the bar, a short edge below. */
  .hero-head .hero .slider { margin-top: 10px; }
  .sensor-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 0; }
  .sensor-chip { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px 7px 10px; border-radius: var(--r-full); border: 0; background: var(--surface); color: inherit; font: inherit; font-size: var(--fs-footnote); cursor: pointer; }
  .sensor-chip ha-icon { --mdc-icon-size: 18px; opacity: 0.75; }
  .sensor-chip.on ha-icon { color: var(--ok); opacity: 1; }
  .hero.dark-text .round { background: rgba(0, 0, 0, 0.1); }
  .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .badges:empty { display: none; }
  .badge { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: none; border-radius: var(--r-m); cursor: pointer;
           font-size: var(--fs-caption); font-weight: 500; background: rgba(0, 0, 0, 0.22); transition: background 0.2s, transform var(--t-press) var(--ease); }
  .badge:active { transform: scale(var(--press-tile)); }
  .badge svg { width: 16px; height: 16px; }
  .badge.on { background: var(--sun); color: var(--text-dark); }
  .grid { display: grid; gap: var(--tile-gap); grid-template-columns: repeat(3, minmax(0, 1fr)); }
  /* Cards (scenes, lights, sensors; tileCard): the picture at a fixed distance from the top, a text
     block of fixed height with the name (and lines under it) centered in it, and an optional
     switch zone of its own at the bottom (the Hue app's). Every card is as tall as any other. */
  .tile-card { --top: 12px; --art: 48px; --gap: 2px; --text-h: 42px; --zone: 56px; --icon-y: calc(var(--top) + var(--art) / 2);
               position: relative; box-sizing: border-box; display: flex; flex-direction: column; align-items: center;
               min-width: 0; padding: var(--top) 6px 6px; border: none; border-radius: var(--r-m); cursor: pointer; text-align: center;
               background: var(--surface); box-shadow: var(--shadow-raised);
               transition: transform var(--t-press) var(--ease), color 0.3s var(--ease); }
  .tile-card.switchable { padding-bottom: var(--zone); }
  .tile-card:active { transform: scale(var(--press-tile)); }
  .tile-card > .art { flex: none; width: 100%; height: var(--art); display: flex; align-items: center; justify-content: center; }
  .tile-card > .art ha-icon { --mdc-icon-size: var(--art); }
  .tile-card > .art .dot { width: var(--art); height: var(--art); border-radius: 50%; background: var(--surface-raised) center / cover no-repeat;
                           box-shadow: var(--shadow-dot); transition: transform 0.25s var(--spring); }
  .tile-card:active > .art .dot { transform: scale(var(--press-round)); }
  .tile-card > .text { flex: none; box-sizing: border-box; width: 100%; height: var(--text-h); margin-top: var(--gap); display: flex;
                       flex-direction: column; align-items: center; justify-content: center; overflow: hidden; }
  .tile-card .name { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; max-width: 100%; overflow: hidden;
                     overflow-wrap: anywhere; font-size: var(--fs-callout); font-weight: 500; line-height: 1.2; }
  /* A line under the name: the name keeps one (two lines of name fill the text block, the Hue app's). */
  .tile-card :is(.subs-1, .subs-2) .name { -webkit-line-clamp: 1; }
  .tile-card .sub { max-width: 100%; margin-top: 2px; font-size: var(--fs-caption); line-height: 1.2; opacity: 0.75; white-space: nowrap;
                    overflow: hidden; text-overflow: ellipsis; }
  .tile-card > .switch-zone { position: absolute; left: 0; right: 0; bottom: 0; height: var(--zone); display: flex; align-items: center;
                              justify-content: center; border-radius: 0 0 var(--r-m) var(--r-m); background: rgba(0, 0, 0, 0.16);
                              border-top: 1px solid rgba(255, 255, 255, 0.1); }
  .switch-zone.inert { pointer-events: none; }
  .switch-zone.inert .toggle { opacity: 0.35; }
  .scene.active { box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85), var(--shadow-flat); }
  .round.mini { width: 28px; height: 28px; background: rgba(0, 0, 0, 0.28); color: #fff; }
  .round.mini svg { width: 16px; height: 16px; }
  .light.unavailable { opacity: 0.45; }
  .light.selected { box-shadow: var(--shadow-raised); outline: 2px solid var(--ring); outline-offset: 3px; }
  /* The Hue app's "Controls" tiles (sensors): picture and switch on top, name and status below. */
  .control-row { display: grid; grid-auto-flow: column; grid-auto-columns: 150px; gap: 12px; overflow-x: auto;
                 margin: -8px calc(-1 * var(--gutter)); padding: 8px var(--gutter); scroll-padding: 0 var(--gutter); scrollbar-width: none; scroll-snap-type: x proximity;
                 overscroll-behavior-x: contain; }
  .control-row::-webkit-scrollbar { display: none; }
  .control-card { box-sizing: border-box; display: flex; flex-direction: column; min-width: 0; height: 108px; padding: 16px 12px 12px 16px;
                  border-radius: var(--r-m); background: var(--surface); box-shadow: var(--shadow-raised); cursor: pointer;
                  scroll-snap-align: start; transition: transform var(--t-press) var(--ease); }
  .control-card:active { transform: scale(var(--press-tile)); }
  .control-card .top { display: flex; align-items: center; justify-content: space-between; height: 32px; margin-bottom: auto; }
  .control-card .top ha-icon { --mdc-icon-size: 24px; margin-left: 4px; }
  .control-card .top .inert { pointer-events: none; opacity: 0.35; }
  .control-card .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-callout); font-weight: 500; line-height: 1.3; }
  .control-card .sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-caption); line-height: 1.3; color: var(--text-2); }
  .control-card.off .top ha-icon { opacity: 0.5; }
  /* A row of cards that scrolls sideways (lights, sensors), like the Hue app's. */
  /* Rows that scroll sideways keep room for their cards' shadows inside (8px) and give it
     back outside, so every section's title sits as far from its cards as any other's. */
  .light-row { display: grid; grid-auto-flow: column; grid-auto-columns: var(--light-tile); gap: var(--card-gap); overflow-x: auto;
               margin: -8px calc(-1 * var(--gutter)); padding: 8px var(--gutter); scroll-padding: 0 var(--gutter); scrollbar-width: none; scroll-snap-type: x proximity;
               overscroll-behavior-x: contain; }
  .light-row::-webkit-scrollbar { display: none; }
  .light-row .tile-card { scroll-snap-align: start; }
  /* Syncing: the switch reads plainly as off (the Hue app's), it is just out of reach. */
  .light.busy .switch-zone.inert .toggle { opacity: 1; }
  /* Short screens (small phones, landscape): compact cards and spacing, so the wheel keeps its size. */
  @media (max-height: 760px) {
    .tile-card { --top: 10px; --art: 42px; --gap: 2px; --text-h: 40px; --zone: 50px; }
    .tile-card .name { font-size: var(--fs-callout); }
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

`;
