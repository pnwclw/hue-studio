// Styles. Dark look of the Hue app regardless of the HA theme. One stylesheet for the panel's
// (or dialog's) shadow root: views and controls render into the light DOM below it. Every
// color, type size, radius, shadow and part size comes from the design system's tokens
// (tokens.ts, docs/design-system.md); tests/js/styles.test.ts keeps one-off values out.

import { tokensCss } from "./tokens.ts";

export const CSS = `
  :host {
    ${tokensCss()}
    /* HA does not size custom panels: take the viewport ourselves (fitToViewport refines the
       height). Safe areas are ours (handle_safe_area), padded with HA's own variables;
       --hue-top/--hue-bottom are what HA covers around us anyway, if it does. */
    --safe-top: max(0px, calc(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) - var(--hue-top, 0px)));
    --safe-bottom: max(0px, calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) - var(--hue-bottom, 0px)));
    position: relative; display: flex; flex-direction: column; height: 100vh; height: 100dvh; overflow: hidden;
    background: radial-gradient(140% 70% at 50% -10%, #3b322c 0%, var(--bg) 55%);
    color: var(--text); font-family: var(--ha-font-family-body, -apple-system, system-ui, Roboto, sans-serif);
    font-size: var(--fs-body); -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: transparent;
  }
  /* Nothing is selected as text (a long press on a tile or a drag over the wheel); only
     fields keep it, so typing and its caret work. */
  :host, * { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  input, textarea, [contenteditable] { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }
  button { font: inherit; color: inherit; }
  hue-studio-home-view, hue-studio-room-view, hue-studio-color-view, hue-studio-gallery-view, hue-studio-scene-view, hue-studio-sync-view, hue-studio-rooms-view, hue-studio-settings-view, hue-studio-automations-view, hue-studio-automation-new-view, hue-studio-automation-edit-view, hue-studio-space-view, hue-studio-effects,
  hue-studio-experimental-view, hue-studio-devices-view, hue-studio-slider { display: block; }
  svg { width: 20px; height: 20px; fill: currentColor; display: block; }
  ha-icon { --mdc-icon-size: 22px; display: flex; flex: none; }

  /* The panel does not scroll; every screen has a fixed header and a body that scrolls on its own. */
  main { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  main > * { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .screen-head { flex: none; padding: max(6px, var(--safe-top)) 16px 6px; background: rgba(24, 24, 26, 0.62);
                 -webkit-backdrop-filter: saturate(1.8) blur(24px); backdrop-filter: saturate(1.8) blur(24px); border-bottom: 1px solid var(--hairline); z-index: 3; }
  .screen-head > * { max-width: 928px; margin-left: auto; margin-right: auto; }
  .screen-head:empty { display: none; }
  .screen-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  .screen-body > .page { padding-top: 10px; }
  .bar { display: flex; align-items: center; gap: 8px; min-height: 44px; }
  .bar.sub .title { flex: 1; min-width: 0; font-size: var(--fs-body); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Everything in a header is 32px tall: round buttons, switches, pills, the search field. */
  :is(.bar, .topbar, .cv-bar, .sheet-bar, .tab-head, .sync-banner) .pill { height: var(--control); letter-spacing: 0.3px; text-transform: uppercase; }
  /* A bar's title after its back or close button starts where list rows' text does (72px), the Hue app's. */
  :is(.bar, .topbar) > .round:first-child + :is(.title, .grow) { margin-left: 16px; }
  .sheet-bar > .round:first-child + .grow { margin-left: 12px; }
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
  .tab-head .bar-title { flex: 1; min-width: 0; font-size: var(--fs-body); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                         opacity: 0; transform: translateY(6px); transition: opacity 0.2s, transform 0.25s var(--ease); }
  .screen-head.scrolled .bar-title { opacity: 1; transform: none; }
  /* Desktop (HA's sidebar shown): every screen's header is one row as tall as the sidebar's
     header (its line included), the content centered in it. */
  main.wide { --bar-h: calc(var(--header-height, 56px) - 1px); }
  main.wide .screen-head:not(.hero-head) { padding-top: var(--safe-top, 0px); padding-bottom: 0; }
  main.wide .screen-head > .bar, main.wide .screen-head > .cv-bar { height: var(--bar-h); min-height: 0; }
  main.wide .hero .topbar { min-height: var(--bar-h); padding-top: var(--safe-top, 0px); }
  .tab-head.wide { display: flex; align-items: center; gap: 12px; height: var(--bar-h, calc(var(--header-height, 56px) - 1px)); }
  .tab-head.wide h1.big { margin: 0; font-size: var(--fs-title-1); }
  /* The room's colored header is its fixed header. */
  .screen-head.hero-head { padding: 0; background: none; border: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .screen-head.hero-head > * { max-width: none; }
  .hero-head .hero { position: relative; margin: 0; }
  .page { container-type: inline-size; max-width: 960px; margin: 0 auto; padding: 0 var(--gutter) 28px; box-sizing: border-box; }
  .topbar { display: flex; align-items: center; gap: 8px; min-height: 52px; padding-top: max(6px, var(--safe-top)); }
  /* Bars stay put while the page scrolls under them. */
  .page > .topbar { position: sticky; top: 0; z-index: 5; margin: 0 calc(-1 * var(--gutter)); padding-inline: 16px;
                    background: rgba(28, 28, 30, 0.8); -webkit-backdrop-filter: saturate(1.6) blur(18px); backdrop-filter: saturate(1.6) blur(18px); }
  .topbar .grow, .head .grow, .bar .grow, .tab-head .grow { flex: 1; min-width: 0; }
  /* Desktop header of a top-level screen: title and actions in one row, no bar. */
  .head { display: flex; align-items: center; gap: 12px; padding: max(28px, var(--safe-top)) 0 4px; }
  .head h1.big { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .round { position: relative; width: var(--control); height: var(--control); border: none; border-radius: 50%; padding: 0; flex: none; cursor: pointer;
           display: flex; align-items: center; justify-content: center; background: var(--fill);
           transition: background 0.2s, transform var(--t-press) var(--ease); }
  .round::after { content: ""; position: absolute; inset: -5px; }
  .round > svg { width: 22px; height: 22px; }
  .round:active { transform: scale(var(--press-round)); }
  .round[hidden] { display: none; }
  .pill { height: var(--pill); padding: 0 16px; border: none; border-radius: var(--r-full); cursor: pointer; font-size: var(--fs-footnote); font-weight: 500;
          background: var(--fill); transition: transform var(--t-press) var(--ease); }
  .pill:active { transform: scale(var(--press-tile)); }
  .pill:disabled { opacity: 0.4; }
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

  /* home: room cards */
  .cards { display: grid; gap: var(--card-gap); }
  /* The Hue app's room card: its icon in a column of its own, the name well clear of it. */
  .card > .row { gap: 27px; }
  .card > .row > ha-icon { width: 28px; justify-content: center; --mdc-icon-size: 28px; }
  .card > .slider { margin-top: 20px; }
  .card { padding: 18px 18px 14px; border-radius: var(--r-m); cursor: pointer; box-shadow: var(--shadow-raised);
          transition: transform var(--t-press) var(--ease), color 0.3s var(--ease); }
  .card:active { transform: scale(var(--press-card)); }
  .card.unavailable { opacity: 0.45; }
  .row { display: flex; align-items: center; gap: 12px; }
  .row .text { flex: 1; min-width: 0; }
  .row .name { font-size: var(--fs-body); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { display: flex; align-items: center; gap: 8px; font-size: var(--fs-caption); opacity: 0.7; min-height: 0; }
  .meta:empty { display: none; }
  .meta .motion { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 6px var(--ok); }

  /* tab bar */
  nav.tabs { flex: none; display: flex; justify-content: center; gap: 4px; padding: 4px 8px max(4px, var(--safe-bottom));
             background: var(--bar-bottom); border-top: 1px solid var(--hairline); }
  nav.tabs[hidden] { display: none; }
  /* The on-screen keyboard is up (fitToViewport): it covers the tab bar and the home indicator,
     and dialogs move up so their fields stay above it. */
  :host([keyboard]) { --safe-bottom: 0px; }
  :host([keyboard]) nav.tabs:not(.top) { display: none; }
  :host([keyboard]) .sheet { align-items: flex-start; padding-top: max(16px, calc(var(--safe-top) + 8px)); }
  nav.tabs button { flex: 0 1 120px; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 5px 0 4px; border: none;
                    background: none; cursor: pointer; color: var(--tab-off); font-size: var(--fs-tab); letter-spacing: 0.4px; text-transform: uppercase;
                    transition: color 0.2s; }
  nav.tabs button svg { width: 26px; height: 26px; }
  nav.tabs button.on { color: var(--text); }
  /* tabs on top while the experimental footer sits at the bottom */
  nav.tabs.top { order: -1; gap: 4px;
                 padding: max(8px, var(--safe-top)) 12px 8px; border-top: none; border-bottom: 1px solid var(--hairline); }
  nav.tabs.top button { flex: 1 1 0; min-width: 0; flex-direction: row; justify-content: center; gap: 5px; padding: 7px 8px;
                        border-radius: var(--r-m); font-size: var(--fs-caption); letter-spacing: 0; text-transform: none;
                        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  nav.tabs.top button svg { flex: none; }
  nav.tabs.top button svg { width: 18px; height: 18px; }
  nav.tabs.top button.on { background: var(--surface); }
  main.under-footer { padding-bottom: var(--safe-bottom); }
  main.under-footer .topbar, main.under-footer .screen-head { padding-top: 6px; }

  /* room */
  .hero { position: sticky; top: 0; z-index: 5; margin: 0 calc(-1 * var(--gutter)); padding: 0 16px 14px; border-radius: 0 0 var(--r-3xl) var(--r-3xl); box-shadow: var(--shadow-raised); }
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
  .control-row { display: grid; grid-auto-flow: column; grid-auto-columns: 148px; gap: 12px; overflow-x: auto;
                 margin: -8px calc(-1 * var(--gutter)); padding: 8px var(--gutter); scroll-padding: 0 var(--gutter); scrollbar-width: none; scroll-snap-type: x proximity;
                 overscroll-behavior-x: contain; }
  .control-row::-webkit-scrollbar { display: none; }
  .control-card { box-sizing: border-box; display: flex; flex-direction: column; min-width: 0; height: 106px; padding: 14px 14px 12px;
                  border-radius: var(--r-m); background: var(--surface); box-shadow: var(--shadow-raised); cursor: pointer;
                  scroll-snap-align: start; transition: transform var(--t-press) var(--ease); }
  .control-card:active { transform: scale(var(--press-tile)); }
  .control-card .top { display: flex; align-items: center; justify-content: space-between; height: 32px; margin-bottom: auto; }
  .control-card .top ha-icon { --mdc-icon-size: 30px; }
  .control-card .top .inert { pointer-events: none; opacity: 0.35; }
  .control-card .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-body); font-weight: 500; line-height: 1.25; }
  .control-card .sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-footnote); line-height: 1.3; color: var(--text-2); }
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
  .bri-layer { position: fixed; inset: 0; z-index: 30; background: rgba(0, 0, 0, 0.6); animation: fade 0.2s ease; touch-action: none; }
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
  .colorview .wheel-wrap { container-type: size; min-height: 240px; padding: 20px 0 36px; }
  .colorview .wheel { width: min(100cqw, 100cqh, 440px); }
  .dock { position: sticky; bottom: 0; z-index: 5; margin: 0 calc(-1 * var(--gutter)); padding: 14px var(--gutter) max(10px, var(--safe-bottom));
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
  .chip { flex: none; display: flex; align-items: center; gap: 6px; height: var(--control); padding: 0 12px; border-radius: var(--r-full); border: 2px solid transparent;
          cursor: pointer; background: var(--surface); font-size: var(--fs-footnote); font-weight: 500; transition: border-color 0.2s, background 0.2s; }
  .chip ha-icon { --mdc-icon-size: 16px; }
  .chip.on { border-color: var(--accent); }
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
  .sheet-bar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--surface-row); font-size: var(--fs-body); font-weight: 500; }
  .sheet-bar .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fx-head { padding: 16px 16px 4px; }
  .fx-head .art { display: block; width: 56px; height: 56px; border-radius: 50%; box-shadow: var(--shadow-dot); }
  .fx-head h3 { margin: 12px 0 0; font-size: var(--fs-title-2); font-weight: 700; letter-spacing: -0.3px; }
  .fx-sheet .label { margin: 18px 16px 8px; }
  .rows { border-radius: var(--r-m); background: var(--surface-row); overflow: hidden; }
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

  /* Scene editor, the Hue app's: the top (header, picture, name, brightness) tinted with the
     scene's colors, fading into the page; the rows below on their own. */
  .scene-edit { padding-bottom: calc(28px + var(--safe-bottom)); }
  .scene-tint { position: absolute; top: 0; left: 0; right: 0; height: 460px; z-index: 0; pointer-events: none; background: var(--scene-tint);
                -webkit-mask-image: linear-gradient(#000 40%, transparent); mask-image: linear-gradient(#000 40%, transparent); }
  hue-studio-scene-view > .screen-body { position: relative; z-index: 1; }
  .screen-head.scene-head { background: rgba(255, 255, 255, 0.07); border-bottom-color: var(--hairline); }
  .scene-top { padding: 16px 2px 6px; }
  .scene-top .name-row { margin: 14px 0 12px; }
  .scene-top h1.big { font-size: var(--fs-large); }
  .scene-top .round.rename { background: rgba(255, 255, 255, 0.14); color: var(--text); }
  .scene-edit .dot.big { width: 52px; height: 52px; border-radius: 50%; background: var(--surface-raised) center / cover no-repeat;
                         box-shadow: var(--shadow-dot); }
  .rows.scene-brightness { background: rgba(255, 255, 255, 0.09); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
  .scene-brightness .item.col { display: block; padding: 16px 16px 22px; }
  .scene-brightness .line { display: flex; justify-content: space-between; font-size: var(--fs-body); font-weight: 500; }
  .scene-brightness .line .dim { font-weight: 400; color: var(--text-2); }
  .scene-brightness .slider { margin-top: 22px; }
  .scene-lights { margin-top: 22px; }
  .scene-lights .light-row { margin: 0; padding: 2px 16px 16px; }
  .scene-lights .lights-head .pill.shuffle { display: inline-flex; align-items: center; gap: 8px; height: 32px; }
  .scene-lights .lights-head .pill.shuffle svg { width: 18px; height: 18px; }
  .scene-edit > .center { margin-top: 28px; }
  .name-row { display: flex; align-items: center; gap: 12px; margin: 10px 0 18px; }
  .name-row h1.big { flex: 1; min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; }
  .name-input { flex: 1; min-width: 0; height: 42px; padding: 0 12px; border: none; border-radius: var(--r-m); font: inherit; font-size: var(--fs-title-2);
                font-weight: 700; color: inherit; background: rgba(0, 0, 0, 0.25); outline: none; }
  .hero.dark-text .name-input { background: rgba(255, 255, 255, 0.4); }
  .section-head { display: flex; align-items: center; justify-content: space-between; margin-top: 22px; }
  .section-head h2.label { margin: 0 var(--text-inset); }
  /* The room's bridge, with several bridges: next to "Lights". */
  .move-steps .step-no svg { width: 14px; height: 14px; }
  .move-steps .item.dim { color: var(--text-2); }
  .power-cycle { display: flex; flex-direction: column; align-items: center; margin: 18px 0 14px; padding: 20px 16px; border-radius: var(--r-m);
    background: var(--info-tint); text-align: center; }
  .power-cycle > ha-icon { --mdc-icon-size: 40px; color: var(--info); }
  .power-cycle .link-title { margin: 10px 0 0; }
  .power-cycle .lead { margin: 6px 0 0; }
  .power-cycle.calm { background: var(--hairline); }
  .power-cycle.calm > ha-icon { color: var(--text-2); }
  .rows .item.current { background: var(--info-tint); }
  .rows .item > .spinner { flex: none; margin: 0 2px; }
  .move-log { margin: 8px 0 0; padding: 0 4px; list-style: none; font-size: var(--fs-footnote); line-height: 1.5; color: var(--text-2); }
  .move-log li { display: flex; gap: 10px; }
  .move-log time { flex: none; font-variant-numeric: tabular-nums; color: var(--text-3, rgba(255, 255, 255, 0.45)); }
  .sheet .sheet-actions { padding: 14px 0 0; }
  .notice.warn ha-icon { flex: none; color: var(--warn); }
  .zone-bridges { margin: 14px 16px 0; }
  .pill.shuffle { display: inline-flex; align-items: center; gap: 8px; }
  .pill.shuffle svg { width: 18px; height: 18px; }
  .section-head + .grid { margin-top: 10px; }
  .center { display: flex; justify-content: center; margin-top: 28px; }
  .pill.reset { min-width: 180px; }
  .pill.reset.confirm { background: var(--danger-fill); }
  .center.stack { flex-direction: column; align-items: center; gap: 12px; }
  .pill.reset.danger { color: var(--danger); }
  .pill.reset.danger.confirm { color: #fff; }
  .sheet .form-body { padding: 16px 16px 0; }
  .sheet .add-sheet .rows { border-radius: 0; background: none; }
  .sheet .field, .page .field { width: 100%; box-sizing: border-box; height: 44px; padding: 0 12px; border: none; border-radius: var(--r-m); font: inherit;
                  font-size: var(--fs-headline); color: inherit; background: var(--fill-soft); outline: none; }
  .sheet .hint { margin: 10px 2px 0; font-size: var(--fs-footnote); line-height: 1.45; color: var(--text-2); }

  /* gallery */
  /* In a bar instead of its title (phones), or before the actions (desktop Explore tab). */
  .search-field { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; height: var(--control); margin: 0; padding: 0 10px; box-sizing: border-box;
                  border-radius: var(--r-s); background: var(--fill-soft); color: var(--text-2); cursor: text; animation: field-in 0.25s var(--ease); }
  @keyframes field-in { from { opacity: 0; transform: scaleX(0.96); } }
  .search-field svg { width: 18px; height: 18px; flex: none; }
  .search-field .q { flex: 1; min-width: 0; height: 100%; margin: 0; padding: 0; border: none; background: none; outline: none;
                     font: inherit; font-size: var(--fs-body); color: var(--text); }
  .search-field .q::placeholder { color: var(--text-2); }
  .tab-head.wide .search-field { flex: 0 1 260px; margin: 0; }
  .tiles { display: grid; grid-auto-flow: column; grid-template-rows: repeat(var(--rows, 2), auto); gap: var(--tile-gap);
           grid-auto-columns: calc((100% - 2 * var(--tile-gap)) / 2.6); overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none;
           margin: 0 calc(-1 * var(--gutter)); padding: 0 var(--gutter) 2px; scroll-padding: 0 var(--gutter); overscroll-behavior-x: contain; }
  .tiles::-webkit-scrollbar { display: none; }
  .tile { position: relative; aspect-ratio: 16 / 9; border-radius: var(--r-m); overflow: hidden; scroll-snap-align: start; cursor: pointer;
          background: var(--surface) center / cover no-repeat; box-shadow: var(--shadow-flat); transition: transform var(--t-press) var(--ease); }
  .tile:active { transform: scale(var(--press-tile)); }
  .tile img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .tile::after { content: ""; position: absolute; inset: 40% 0 0; background: linear-gradient(transparent, rgba(0, 0, 0, 0.42)); }
  .tile span { position: absolute; left: 10px; right: 8px; bottom: 7px; z-index: 1; color: #fff; font-size: var(--fs-footnote); font-weight: 500;
               text-shadow: 0 1px 6px rgba(0, 0, 0, 0.4); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .searching { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-top: 14px; }
  .searching section:not([hidden]), .searching .tiles { display: contents; }
  .searching h2 { display: none; }
  section[hidden], .tile[hidden], .note[hidden] { display: none; }
  .note { margin-top: 20px; color: var(--text-2); }

  /* scene sheet / dialogs */
  .sheet { position: absolute; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; padding: 16px;
           background: rgba(0, 0, 0, 0.55); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); animation: fade 0.2s ease; }
  .sheet .box { width: min(100%, 400px); max-height: 100%; overflow: auto; border-radius: var(--r-2xl); background: var(--surface-row);
                box-shadow: var(--shadow-overlay); animation: pop 0.3s var(--spring); }
  .sheet .pic { position: relative; aspect-ratio: 16 / 10; background: var(--surface-row) center / cover no-repeat; }
  .sheet .pic::after { content: ""; position: absolute; inset: 45% 0 0; background: linear-gradient(transparent, rgba(0, 0, 0, 0.5)); }
  .sheet .pic h3 { position: absolute; left: 16px; right: 56px; bottom: 12px; z-index: 1; margin: 0; font-size: var(--fs-title-2); font-weight: 700; }
  .sheet .pic .round { position: absolute; top: 12px; right: 12px; z-index: 1; background: rgba(120, 120, 124, 0.75); }
  .sheet .dots { display: flex; align-items: center; padding: 12px 16px; background: var(--surface-row); }
  .sheet .dots i { width: 34px; height: 34px; border-radius: 50%; margin-left: -9px; box-shadow: -3px 0 6px rgba(0, 0, 0, 0.3); }
  .sheet .dots i:first-child { margin-left: 0; box-shadow: none; }
  .sheet .actions { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px; }
  .sheet .actions .pill { min-width: 200px; }
  .sheet .actions .target { font-size: var(--fs-caption); color: var(--text-2); }
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
        background: var(--fill-light); }
  .tv svg { width: 24px; height: 24px; }
  .sync .chips.boxes { margin-top: 12px; }
  .sync-hero { position: relative; isolation: isolate; overflow: hidden; margin-top: 16px; padding: 18px 18px 16px; border-radius: var(--r-3xl);
               background: var(--surface); box-shadow: var(--shadow-raised); }
  .sync-hero .name { font-size: var(--fs-headline); font-weight: 500; }
  .sync-hero .status { margin-top: 2px; font-size: var(--fs-callout); }
  .sync-hero .center { margin-top: 18px; }
  .sync-hero .area-line { margin-top: 10px; text-align: center; }
  .sync-hero.off .tv { opacity: 0.5; }
  .pill.go { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 180px; background: #fff; color: var(--text-dark); }
  .pill.go svg { width: 18px; height: 18px; }
  .pill.go.stop { background: rgba(0, 0, 0, 0.35); color: #fff; }
  .sync-body { transition: opacity 0.3s; }
  .rows.bright-row { margin-top: 22px; }
  .sync-body.disabled { opacity: 0.4; pointer-events: none; }
  .sync-modes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .mode-tile { position: relative; isolation: isolate; overflow: hidden; display: flex; flex-direction: column; align-items: center; gap: 8px;
               padding: 16px 6px 14px; border: 2px solid transparent; border-radius: var(--r-m); cursor: pointer; background: var(--surface);
               font-size: var(--fs-callout); font-weight: 500; transition: border-color 0.2s, transform var(--t-press) var(--ease); }
  .mode-tile::before { content: ""; position: absolute; inset: 0; z-index: -1; opacity: 0; transition: opacity 0.4s var(--ease);
                       background: linear-gradient(135deg, var(--g1), var(--g2) 55%, var(--g3)); }
  .mode-tile:nth-child(1) { --g1: #3a5bff; --g2: #b03cff; --g3: #ff3d8b; }
  .mode-tile:nth-child(2) { --g1: #ff3d8b; --g2: #ff8a3d; --g3: #ffd23d; }
  .mode-tile:nth-child(3) { --g1: #19e6a0; --g2: #19b5ff; --g3: #6a5bff; }
  .mode-tile ha-icon { --mdc-icon-size: 30px; }
  .mode-tile:active { transform: scale(var(--press-tile)); }
  .mode-tile.on { border-color: var(--selected); }
  .mode-tile.live::before { opacity: 0.85; }
  .mode-tile.unsupported { opacity: 0.5; }
  .seg { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2px; padding: 2px; border-radius: var(--r-s);
         background: var(--fill-soft); }
  .seg button { height: 34px; border: none; border-radius: var(--r-s); cursor: pointer; background: transparent; font-size: var(--fs-footnote); font-weight: 500;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 4px; transition: background 0.2s var(--ease); }
  .seg button.on { background: var(--segment-on); font-weight: 500; box-shadow: var(--shadow-flat); }
  .grid.inputs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .palettes { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .palette { display: flex; align-items: center; gap: 10px; padding: 8px 12px 8px 8px; border-radius: var(--r-m); border: 1.5px solid transparent;
             background: var(--surface); cursor: pointer; font-size: var(--fs-footnote); text-align: left; }
  .palette.on { border-color: var(--selected); }
  .palette .art { width: 34px; height: 34px; flex: none; border-radius: 50%; }
  .select.wide { width: 100%; margin-top: 10px; }
  .rows.mode-extra { margin-top: 10px; }
  .chips.wrap { flex-wrap: wrap; overflow: visible; }
  .dot-badge.live { background: var(--ok); }
  .hint.warn, .dim.warn, .small.warn { color: var(--warn); }
  .small.error { color: var(--danger); }
  .pill.danger { color: var(--danger); }
  .pill.danger.confirm { background: var(--danger-fill); color: #fff; }
  .rows .item .value-text { max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
  .settings-page .sensor-hero { padding-bottom: 14px; }
  /* "Add devices": what is added, the steps to get it ready, the search. */
  .kind-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 6px; }
  .kind-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-height: 100px; padding: 14px; border: none;
               border-radius: var(--r-m); background: var(--surface); color: inherit; font: inherit; text-align: left; cursor: pointer;
               transition: transform var(--t-press) var(--ease); }
  .kind-tile:active { transform: scale(var(--press-tile)); }
  .kind-tile ha-icon { --mdc-icon-size: 28px; margin-bottom: 6px; color: var(--text); }
  .kind-tile .name { font-size: var(--fs-body); font-weight: 500; }
  @container (max-width: 560px) {
    .kind-tiles { grid-template-columns: 1fr; }
    .kind-tile { display: grid; grid-template-columns: auto 1fr; column-gap: 14px; min-height: 0; align-items: center; }
    .kind-tile ha-icon { grid-row: span 2; margin: 0; }
  }
  .add-art { display: flex; justify-content: center; padding: 18px 0 8px; }
  .add-art ha-icon { --mdc-icon-size: 76px; }
  .add-art.dim ha-icon { color: var(--text-2); }
  .add-steps { margin: 6px 0 16px; padding: 0; list-style: none; counter-reset: step; }
  .add-steps li { position: relative; padding: 10px 4px 10px 44px; font-size: var(--fs-body); line-height: 1.45; counter-increment: step; }
  .add-steps li::before { content: counter(step); position: absolute; left: 4px; top: 8px; width: 28px; height: 28px; border-radius: 50%;
                          display: flex; align-items: center; justify-content: center; background: var(--surface-2); font-size: var(--fs-callout); font-weight: 500; }
  .add-steps.tips li::before { content: "•"; background: none; font-size: var(--fs-title-3); }
  .add-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin: 22px 0 6px; }
  .add-actions .pill:not(.go) { min-width: 180px; }
  .search-ring { position: relative; width: 180px; height: 180px; margin: 22px auto 10px; }
  .search-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
  .search-ring circle { fill: none; stroke-width: 6; }
  .search-ring .track { stroke: var(--surface-2); }
  .search-ring .bar { stroke: var(--accent); stroke-linecap: round; transition: stroke-dashoffset 0.5s linear; }
  .search-ring .ring-text { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
                            font-size: var(--fs-title-3); font-weight: 500; font-variant-numeric: tabular-nums; }
  .search-ring .ring-text ha-icon { --mdc-icon-size: 40px; animation: breathe 2s ease-in-out infinite; }
  @keyframes breathe { 50% { opacity: 0.45; } }
  .rows .item.fresh { animation: pop 0.35s var(--ease); }
  .actions-row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
  .item.col .field { margin-top: 10px; }
  .input-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 14px; border: none; border-radius: var(--r-m);
                cursor: pointer; text-align: left; background: var(--surface); box-shadow: var(--shadow-flat);
                transition: transform var(--t-press) var(--ease), box-shadow 0.2s; }
  .input-tile:active { transform: scale(var(--press-tile)); }
  .input-tile ha-icon { --mdc-icon-size: 26px; margin-bottom: 6px; }
  .input-tile .name { font-size: var(--fs-body); font-weight: 500; }
  .input-tile .dim { display: flex; align-items: center; gap: 6px; }
  .input-tile.on { box-shadow: 0 0 0 2px var(--selected), var(--shadow-flat); }
  .input-tile.unplugged { opacity: 0.5; }
  .led { width: 7px; height: 7px; border-radius: 50%; background: #8e8e93; }
  .led.linked { background: var(--ok); box-shadow: 0 0 6px var(--ok); }
  .led.plugged { background: var(--warn); }
  .rows.areas .item { width: 100%; border: none; background: none; cursor: pointer; text-align: left; font: inherit; color: inherit; }
  .rows.areas ha-icon { color: var(--text-2); }
  .radio { width: 24px; height: 24px; flex: none; box-sizing: border-box; border: 2px solid var(--text-3); border-radius: 50%;
           transition: border 0.2s var(--ease); }
  .on > .radio { border: 7px solid var(--accent); }
  .sync-cards { display: grid; gap: 10px; margin-top: 16px; }
  .sync-card { position: relative; isolation: isolate; overflow: hidden; display: flex; align-items: center; gap: 12px; padding: 12px 14px;
               border-radius: var(--r-m); cursor: pointer; background: var(--surface); box-shadow: var(--shadow-flat); }
  .sync-card .text { flex: 1; min-width: 0; }
  .sync-card .name { font-size: var(--fs-body); font-weight: 500; }
  .sync-card .status { font-size: var(--fs-footnote); opacity: 0.75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sync-card .tv { width: 38px; height: 38px; }
  .sync-card .tv svg { width: 20px; height: 20px; }
  .sync-card.syncing .toggle.on { background: rgba(0, 0, 0, 0.3); }
  /* A room's scenes, the Hue app's: columns of two that scroll sideways, cards as wide as the
     light cards; narrow columns beside the active scene (edit, "⋯") and the suggestion (shuffle). */
  .scene-cols { overflow-x: auto; margin: -8px calc(-1 * var(--gutter)); padding: 8px var(--gutter); scroll-padding: 0 var(--gutter); scrollbar-width: none;
                scroll-snap-type: x proximity; overscroll-behavior-x: contain; }
  .scene-cols::-webkit-scrollbar { display: none; }
  /* A room without scenes, the Hue app's: what scenes are, then a suggestion and the gallery, centered. */
  .first-scene { padding: 18px 8px 4px; text-align: center; }
  .first-scene h3 { margin: 0; font-size: var(--fs-title-2); font-weight: 500; }
  .first-scene p { margin: 12px auto 22px; max-width: 420px; font-size: var(--fs-body); line-height: 1.45; color: var(--text-2); }
  .first-scene-cards { display: flex; align-items: stretch; justify-content: center; gap: 12px; }
  .first-scene-cards .tile-card { width: var(--light-tile); }
  .first-scene-cards .scene-side { align-self: center; height: auto; }
  .scene-grid { display: grid; grid-template-columns: max-content max-content; gap: var(--tile-gap); width: max-content; }
  .scene-line { display: flex; gap: var(--tile-gap); }
  .scene-cols .tile-card { width: var(--light-tile); }
  .scene-cell { display: flex; scroll-snap-align: start; }
  /* The active scene's buttons (and the shuffle) come in softly while the cards slide aside. */
  .scene-side { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; width: 32px;
                animation: side-in 0.36s var(--ease) both; }
  @keyframes side-in { from { opacity: 0; transform: scale(0.6); } }
  .scene-side .round { background: var(--fill-light); color: var(--text); }
  .scene-side .round svg { width: 18px; height: 18px; }
  .scene-cols.locked .scene { opacity: 0.45; cursor: default; }
  .scene-cols.locked .scene:active { transform: none; }
  /* A dynamic active scene: play/stop in place of its picture. */
  .scene-play { width: var(--art); height: var(--art); border: none; border-radius: 50%; padding: 0; display: flex; align-items: center;
                justify-content: center; background: rgba(255, 255, 255, 0.3); color: #fff; cursor: pointer; transition: transform 0.2s var(--spring);
                box-shadow: var(--shadow-dot); }
  .scene-play:active { transform: scale(var(--press-round)); }
  .scene-play svg { width: 22px; height: 22px; }
  .dark-text .scene-play { background: rgba(255, 255, 255, 0.45); color: var(--text-dark); }
  /* The gallery: three of its pictures overlapping; a suggestion: a stack of cards. */
  .dots-three { display: flex; height: var(--art); align-items: center; }
  .dots-three span { width: 32px; height: 32px; border-radius: 50%; margin-left: -8px; box-shadow: -2px 0 6px rgba(0, 0, 0, 0.35); }
  .dots-three span:first-child { margin-left: 0; box-shadow: none; }
  .tile-card.gallery-card { box-shadow: inset 0 0 0 1.5px var(--fill-light); background: transparent; }
  /* A suggestion: the top of a stack of cards, tinted with its scene's colors; a new one
     rises from the stack. */
  .tile-card.suggested { margin-left: 8px;
    background: linear-gradient(160deg, color-mix(in srgb, var(--tint-a, var(--surface-2)) 26%, var(--surface)),
      color-mix(in srgb, var(--tint-b, var(--surface-2)) 16%, var(--bg)));
    box-shadow: -4px 0 0 -1px color-mix(in srgb, var(--tint-a, var(--surface-2)) 18%, #303032),
      -8px 0 0 -2px color-mix(in srgb, var(--tint-b, var(--surface-2)) 12%, #29292b), var(--shadow-raised);
    animation: from-stack 0.42s var(--ease) both; }
  @keyframes from-stack { from { transform: translate(-8px, 6px) scale(0.92); opacity: 0.3; } }
  .tile-card.suggested .sub { opacity: 0.6; }
  .sync-meta svg { width: 14px; height: 14px; }

  /* rooms and zones */
  .notice { display: flex; align-items: center; gap: 10px; width: 100%; margin: 14px 0 0; padding: 12px 14px; border: none;
            border-radius: var(--r-m); cursor: pointer; text-align: left; font-size: var(--fs-callout); line-height: 1.35;
            background: var(--info-tint); }
  .notice svg { flex: none; color: var(--info); }
  .notice .grow { flex: 1; min-width: 0; }
  .notice .go { flex: none; font-weight: 500; color: var(--info); }
  .notice:active { transform: scale(var(--press-row)); }
  /* A Sync Box drives lights: the Hue app's "Hue Sync is active" bar with its Stop button. */
  .sync-banner { display: flex; align-items: center; gap: 14px; margin: 14px 0 0; padding: 10px 10px 10px 18px; border-radius: var(--r-full);
                 cursor: pointer; background: var(--fill-soft); box-shadow: var(--shadow-raised);
                 transition: transform var(--t-press) var(--ease); }
  .sync-banner:active { transform: scale(var(--press-row)); }
  .sync-banner > svg { flex: none; width: 24px; height: 24px; }
  .sync-banner .grow { flex: 1; min-width: 0; }
  .sync-banner .title { font-size: var(--fs-callout); font-weight: 500; line-height: 1.3; }
  .sync-banner .sub { font-size: var(--fs-callout); line-height: 1.3; color: var(--text-2); }
  /* Settings → Scene gallery: a category's rule opens under its row; whether it shows now. */
  .rule-row .chevron { flex: none; opacity: 0.5; }
  .season-state { flex: none; font-size: var(--fs-caption); font-weight: 500; color: var(--text-2); }
  .season-state.on { color: var(--ok); }
  .lead { margin: 0 var(--text-inset) 10px; font-size: var(--fs-callout); line-height: 1.45; color: var(--text-2); }
  .lead.small { margin-top: 12px; font-size: var(--fs-footnote); }
  .text-link { display: inline; margin-left: 4px; padding: 0; border: none; background: none; cursor: pointer; color: var(--info); font-size: inherit; }
  .rows + .rows { margin-top: 10px; }
  .rows .item ha-icon { color: var(--text-2); }
  .rows button.item { width: 100%; border: none; background: none; cursor: pointer; text-align: left; font: inherit; color: inherit; }
  .rows button.item:active { background: rgba(255, 255, 255, 0.04); }
  .rows .item .chevron { --mdc-icon-size: 20px; }
  .rows .item > svg { color: var(--text-2); }
  .dot-badge { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--info); }
  .rows.plan .item, .rows.conflicts .item { font-size: var(--fs-body); }
  .rows.conflicts ha-icon { color: var(--warn); }
  .select { flex: none; max-width: 46%; height: 34px; padding: 0 10px; border: none; border-radius: var(--r-s); font: inherit; font-size: var(--fs-callout);
            color: inherit; background: var(--fill); }
  .rooms-page .center { margin-top: 18px; }
  .sheet .box.zone-editor { width: min(100%, 440px); }
  .zone-editor h2.label { margin: 18px 16px 8px; }
  .zone-editor .rows { border-radius: 0; background: var(--surface-row); }
  /* A check: one round tick box everywhere (rows, choice lists, the light picker's rooms: all or some). */
  :is(.check, .pick-check) { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; flex: none; box-sizing: border-box;
                             border: 1.5px solid var(--text-3); border-radius: 50%; color: #fff; transition: background 0.2s, border 0.2s; }
  :is(.check, .pick-check) svg { width: 16px; height: 16px; fill: currentColor; opacity: 0; }
  :is(.on > .check, .check.on, .pick-check.all, .pick-check.some) { border-color: var(--accent); background: var(--accent); }
  :is(.on > .check, .check.on, .pick-check.all, .pick-check.some) svg { opacity: 1; }
  /* automations */
  .rows .item .row-open { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 0; border: none; background: none;
                          cursor: pointer; text-align: left; font: inherit; color: inherit; }
  .rows .item .row-open .grow { display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
  .rows .item .row-open .dim.small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* A sensor's settings, like the Hue app's: picture and big name, then full-width rows on phones. */
  .sensor-edit { padding-bottom: calc(28px + var(--safe-bottom)); }
  .sensor-hero { padding: 14px 2px 4px; }
  .sensor-hero .pic { display: block; --mdc-icon-size: 44px; }
  .sensor-hero .name-row { margin: 10px 0 10px; }
  .sensor-hero h1.big { white-space: normal; overflow-wrap: anywhere; font-size: var(--fs-large); }
  .sensor-edit .rows { margin-top: 16px; }
  .sensor-edit h2.label + .rows { margin-top: 0; }
  .sensor-edit .rows .item .value { color: var(--text-2); }
  .round.plus-blue { display: flex; align-items: center; justify-content: center; width: var(--control); height: var(--control); background: var(--accent); color: #fff; }
  .sensor-sheet .rows { border-radius: var(--r-m); background: var(--surface-row); }
  .sensor-sheet .form-body { padding-bottom: 16px; }
  .sensor-sheet .hint { margin: 0 2px 12px; font-size: var(--fs-body); }
  /* QR scanner sheet (views/qr-scan.ts): the camera, a frame to aim with, what was read */
  .qr-sheet .qr-camera { position: relative; display: flex; align-items: center; justify-content: center; aspect-ratio: 1; overflow: hidden; background: #000; }
  .qr-sheet .qr-camera video { width: 100%; height: 100%; object-fit: cover; }
  .qr-sheet .qr-frame { position: absolute; inset: 20%; border: 3px solid rgba(255, 255, 255, 0.9); border-radius: var(--r-2xl); box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.35); }
  .qr-sheet .qr-camera p { padding: 24px; }
  .qr-sheet .hint { margin: 14px 16px; font-size: var(--fs-body); }
  .qr-sheet .hint.ok { color: var(--ok); }
  .qr-sheet .center { padding: 0 16px 16px; }
  .sensor-sheet .tick { display: flex; color: var(--accent); }
  .sensor-sheet .big-value { margin: 4px 2px 10px; font-size: var(--fs-title); font-weight: 700; }
  .sensor-sheet .sheet-bar { padding: 12px 16px; font-size: var(--fs-body); }
  .sensor-sheet .sheet-bar .pill.save { padding: 0 16px; }
  /* Phones: the sheet comes up from the bottom, like the Hue app's. */
  .sheet.bottom { align-items: flex-end; padding: 0; }
  .sheet.bottom .box { width: 100%; max-width: none; border-radius: var(--r-2xl) var(--r-2xl) 0 0; animation: rise 0.3s var(--ease); }
  /* A scene's sheet (scene-pick.ts), the Hue app's: picture with name and pencil, colors with
     shuffle, the room or zone it goes to, "Save to my scenes" and "Set once". */
  hue-studio-scene-pick { display: contents; }
  .scene-pick .box { width: min(100%, 440px); padding-bottom: 0; }
  .scene-pick .pic { aspect-ratio: 16 / 9; }
  .scene-pick .pic .round.rename { top: auto; bottom: 12px; }
  .scene-pick .pic .name-input { position: absolute; left: 16px; right: 60px; bottom: 12px; z-index: 1; font-size: var(--fs-title-2); font-weight: 700; }
  .scene-pick .dots { gap: 0; padding: 16px; background: none; }
  .scene-pick .dots .shuffle { margin-left: auto; background: var(--fill-light); color: var(--text); }
  .scene-pick h2.label { margin: 8px 18px 8px; }
  .scene-pick .target-row { display: flex; align-items: center; gap: 24px; width: calc(100% - 32px); margin: 0 16px 18px; min-height: 68px;
                            padding: 0 20px; box-sizing: border-box; border: none; border-radius: var(--r-m); background: var(--surface-2); color: var(--text);
                            font: inherit; font-size: var(--fs-body); text-align: left; cursor: pointer; box-shadow: var(--shadow-raised); }
  .scene-pick .target-row ha-icon { --mdc-icon-size: 28px; }
  .scene-pick .actions { background: var(--bg); padding: 16px; }
  .scene-pick .actions .pill.outline { background: transparent; box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.4); }
  /* An action sheet, the Hue app's: centered rows, the red one, "Cancel" under a line. */
  .sheet.menu.bottom { padding: 0 10px calc(10px + var(--safe-bottom)); }
  .sheet.menu.bottom .box { border-radius: var(--r-2xl); }
  .action-sheet { display: flex; flex-direction: column; padding: 4px 0; background: var(--surface-row); }
  .action-sheet button { min-height: 56px; border: none; background: none; color: var(--text); font: inherit; font-size: var(--fs-body); cursor: pointer; }
  .action-sheet button:active { background: var(--hairline); }
  .action-sheet button.danger { color: var(--danger); }
  .action-sheet button.cancel { border-top: 1px solid rgba(255, 255, 255, 0.1); font-size: var(--fs-body); font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
  .sheet.bottom .sensor-sheet .form-body { padding-bottom: calc(20px + var(--safe-bottom)); }
  @keyframes rise { from { transform: translateY(40%); opacity: 0; } }
  /* Motion sensitivity: the level, a stepped slider with the names under its stops, trying it out. */
  .sens-level { margin: 34px 0 18px; text-align: center; }
  .sens-level .label { font-size: var(--fs-footnote); letter-spacing: 2px; text-transform: uppercase; color: var(--text-2); }
  .sens-level .value { margin-top: 4px; font-size: var(--fs-title-3); font-weight: 500; }
  .sens-slider { --r: 13px; position: relative; padding: 0 8px; }
  .sens-slider input { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 30px; margin: 0; background: none; cursor: pointer; }
  .sens-slider input::-webkit-slider-runnable-track { height: 8px; border-radius: var(--r-full);
    background: linear-gradient(to right, var(--accent) calc(var(--r) + (100% - 2 * var(--r)) * var(--f)), rgba(255, 255, 255, 0.14) 0); }
  .sens-slider input::-moz-range-track { height: 8px; border-radius: var(--r-full);
    background: linear-gradient(to right, var(--accent) calc(var(--r) + (100% - 2 * var(--r)) * var(--f)), rgba(255, 255, 255, 0.14) 0); }
  .sens-slider input::-webkit-slider-thumb { -webkit-appearance: none; width: calc(2 * var(--r)); height: calc(2 * var(--r)); margin-top: calc(4px - var(--r));
    border: none; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4); }
  .sens-slider input::-moz-range-thumb { width: calc(2 * var(--r)); height: calc(2 * var(--r)); border: none; border-radius: 50%; background: #fff; }
  /* Names under the stops (long ones wrap); the outer ones line up with the ends of the track. */
  .sens-slider .ticks { position: relative; height: 38px; margin: 6px calc(8px + var(--r)) 0; font-size: var(--fs-callout); line-height: 1.2; color: var(--text-2); }
  .sens-slider .ticks span { position: absolute; top: 0; left: calc(var(--i) * 100%); width: max-content; max-width: 72px; height: auto;
                             transform: translateX(-50%); text-align: center; }
  .sens-slider .ticks span:first-child { transform: translateX(calc(-1 * var(--r) - 8px)); text-align: left; }
  .sens-slider .ticks span:last-child:not(:first-child) { transform: translateX(calc(-100% + var(--r) + 8px)); text-align: right; }
  .sheet .box.sensor-sheet { width: min(100%, 480px); }
  .sheet.bottom .box.sensor-sheet { width: 100%; }
  .sens-try { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 30px 0 4px; font-size: var(--fs-body); color: var(--text-2); }
  .sens-try .dot { flex: none; width: 22px; height: 22px; border-radius: 50%; background: rgba(255, 255, 255, 0.4); transition: background 0.2s, box-shadow 0.2s; }
  .sens-try.moving { color: var(--text); }
  .sens-try.moving .dot { background: var(--accent); box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 30%, transparent); }
  .sens-try.calibrating .dot { animation: calibrate 1.2s ease-in-out infinite; }
  @keyframes calibrate { 50% { opacity: 0.3; transform: scale(0.8); } }
  @container (max-width: 599px) {
    .sensor-edit .rows, .scene-edit .rows { margin-left: calc(-1 * var(--gutter)); margin-right: calc(-1 * var(--gutter)); border-radius: 0; }
  }
  /* Settings → Devices, like the Hue app's: kinds with their counts, then a kind's devices by
     room under a search field and filters; big pictures, "Unreachable" in orange, separators
     from the text on, full-width rows on phones. */
  .bar.sub .round.plus-blue.add-devices { width: 32px; height: 32px; }
  .round.plus-blue.add-devices svg { width: 24px; height: 24px; }
  .add-devices .dot-badge { position: absolute; top: -1px; right: -1px; border: 2px solid var(--bg); }
  .devices-page .notice .dot-badge { margin: 0 4px; }
  .devices-page .notice .go { --mdc-icon-size: 20px; }
  .devices-page .rows.kinds { margin-top: 16px; }
  .devices-page h2.label + .rows { margin-top: 0; }
  .rows.device-list .item .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rows.device-list .item .small.warn { font-weight: 500; }
  .rows.device-list .item .value { color: var(--text-2); }
  .rows.device-list .item .dot-badge.warn { background: var(--warn); }
  .devices-page .device-search { display: flex; height: 38px; margin-top: 12px; padding: 0 14px; border-radius: var(--r-full); }
  :is(.devices-page, .daylight-page) .section-head { margin: 22px 2px 8px; }
  :is(.devices-page, .daylight-page) .section-head .count { font-size: var(--fs-body); color: var(--text-2); }
  .daylight-page .chips.filters + .hint { margin-top: 12px; }
  .daylight-page .scene-tiles { margin-top: 12px; }
  .chips.filters { gap: 8px; padding-top: 2px; }
  .chip.filter-chip { height: var(--control); gap: 2px; padding: 0 6px 0 12px; border-radius: var(--r-full); border: none; background: var(--fill);
                      font-size: var(--fs-footnote); font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase; }
  .chip.filter-chip span { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip.filter-chip ha-icon { --mdc-icon-size: 18px; }
  .chip.filter-chip.on { background: var(--accent); }
  @container (max-width: 599px) {
    .rows.device-list { margin-left: calc(-1 * var(--gutter)); margin-right: calc(-1 * var(--gutter)); border-radius: 0; }
  }
  /* A device's settings ("Light settings"): the sensor page's layout, a note, "Delete". */
  .sensor-hero > .small.warn { margin-top: -4px; font-size: var(--fs-footnote); font-weight: 500; }
  .device-edit .rows .item .value { max-width: 50%; text-align: right; }
  /* "Delete" at the bottom of an editor: the pill, outlined in red. */
  .delete-btn { min-width: 80px; height: var(--pill); padding: 0 22px; border: 2px solid var(--danger); border-radius: var(--r-full); cursor: pointer;
                background: var(--danger-tint); color: var(--text); font: inherit; font-size: var(--fs-footnote); font-weight: 500;
                transition: transform var(--t-press) var(--ease), background 0.2s; }
  .delete-btn:active { transform: scale(var(--press-tile)); }
  .delete-btn.confirm { border-color: var(--danger-fill); background: var(--danger-fill); }
  .delete-btn:disabled { opacity: 0.5; }
  .delete-area .hint { max-width: 380px; margin: 0; font-size: var(--fs-footnote); line-height: 1.45; text-align: center; }
  /* MotionAware areas: a row that opens the area beside its switch, the new area's steps,
     the art of "leave the room" and "ready", each light's state. */
  .rows .item > .row-link { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 0; border: none; background: none;
                            font: inherit; color: inherit; text-align: left; cursor: pointer; }
  .ma-steps { display: flex; gap: 6px; margin-left: auto; }
  .ma-steps span { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%;
                   background: var(--fill-strong); font-size: var(--fs-caption); font-weight: 500; color: var(--text-2); }
  .ma-steps span.on { background: var(--accent); color: #fff; }
  .ma-page h1.ma-title { margin: 6px 2px 8px; }
  .ma-page .ma-art { --mdc-icon-size: 64px; color: var(--accent); }
  .ma-page .ma-art.ok { color: var(--ok); }
  .ma-page .add-actions.stack { flex-direction: column; align-items: center; }
  .ma-page .add-actions.stack .pill { min-width: 200px; }
  .ma-health { display: inline-flex; align-items: center; gap: 6px; flex: none; font-size: var(--fs-footnote); color: var(--text-2); }
  .ma-health.ready { color: var(--ok); }
  .ma-health.problem { color: var(--warn); }
  .ma-page .steps-list { margin-top: 18px; }
  .sensor-sheet .rows .item.on[aria-disabled] { cursor: default; }
  /* Automation cards, like the Hue app's: picture, "07:00 • Wake up" over "Weekdays", switch. */
  .auto-list { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--card-gap); }
  .auto-list + .rows { margin-top: 10px; }
  /* An automation's card, the Hue app's: 86px tall, a 32px icon, the text from 72px, 17px over 15px. */
  .auto-card { display: flex; align-items: center; gap: 12px; min-height: 72px; padding: 0 16px 0 0; box-sizing: border-box;
               border-radius: var(--r-m); background: var(--surface); box-shadow: var(--shadow-flat); }
  .auto-card .row-open { flex: 1; min-width: 0; align-self: stretch; display: flex; align-items: center; gap: 24px; padding: 14px 0 14px 16px;
                         border: none; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .auto-card .row-open ha-icon { flex: none; --mdc-icon-size: 32px; color: var(--text); }
  .auto-card .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .auto-card .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-body); font-weight: 500; line-height: 1.25; }
  .auto-card .sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-footnote); line-height: 1.3; color: var(--text-2); }
  .auto-card .start { flex: none; width: var(--round-l); height: var(--round-l); background: var(--fill-light); color: var(--text); }
  .auto-card .start svg { width: 18px; height: 18px; }
  .automations-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 0 4px; text-align: center; }
  /* light of the day (natural light, scene of the day) */
  .rows .item .thumb { width: 32px; height: 32px; flex: none; border-radius: 50%; object-fit: cover; }
  .rows .item.wrap { flex-wrap: wrap; }
  .rows .item.wrap .grow { min-width: 140px; }
  .rows .item .plain { padding: 0; border: none; background: none; cursor: pointer; text-align: left; font: inherit; color: inherit; }
  .lead.pad { padding: 0 16px 16px; }
  .seg.three { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 12px; }
  .today span.pic { display: block; }
  .seg button:disabled { opacity: 0.4; }
  .today { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin-top: 14px; padding: 14px; border-radius: var(--r-m);
           background: var(--surface); }
  .today .pic { width: 52px; height: 52px; flex: none; border-radius: 50%; object-fit: cover; box-shadow: var(--shadow-dot); }
  .today .text { flex: 1; min-width: 160px; }
  .today .name { font-size: var(--fs-body); font-weight: 500; margin: 2px 0; }
  .today-actions { display: flex; flex-wrap: wrap; gap: 8px; width: 100%; }
  .empty-today { color: var(--text-2); font-size: var(--fs-callout); }
  .scene-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-top: 10px; }
  .scene-tiles.small { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); }
  /* Height from an in-flow 16:9 spacer, not aspect-ratio: iOS WebKit sizes these grid rows without the ratio (rows one line
     tall, tiles stacked over each other), above all in the scrolling picker. */
  .scene-tiles .tile { aspect-ratio: auto; border: none; padding: 0; text-align: left; font: inherit; color: inherit; }
  .scene-tiles .tile::before { content: ""; display: block; padding-top: 56.25%; }
  .scene-tiles .tile .remove { position: absolute; top: 6px; right: 6px; z-index: 2; }
  .scene-tiles .tile.dimmed { opacity: 0.55; }
  .scene-tiles .tile .tile-open { position: absolute; inset: 0; z-index: 1; padding: 0; border: none; background: none; cursor: pointer; }
  .scene-tiles .tile .tile-open ~ span { pointer-events: none; }
  /* Settings → Light of the day */
  .now-tag { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: var(--r-xs); vertical-align: 1px; font-size: var(--fs-tab); font-weight: 500;
             background: var(--sun); color: var(--text-dark); }
  .sheet .box.tag-editor { width: min(100%, 560px); }
  .tag-editor .sheet-bar { gap: 12px; }
  .tag-editor .tag-pic { width: 36px; height: 36px; flex: none; border-radius: 50%; object-fit: cover; }
  .tag-editor h3.sublabel { margin: 14px 2px 8px; font-size: var(--fs-footnote); font-weight: 500; color: var(--text-2); }
  .tag-editor h3.sublabel:first-child { margin-top: 4px; }
  .tag-editor .chips { padding: 0; }
  .tag-editor .chip:not(.on) { background: var(--fill-soft); }
  .tag-editor .hint { margin: 6px 2px 0; }
  .add-tile { display: grid; grid-template-rows: 1fr auto auto 1fr; justify-items: center; row-gap: 4px; background: transparent !important;
              box-shadow: inset 0 0 0 1.5px var(--outline) !important; color: var(--text-2); }
  .add-tile::before { grid-area: 1 / 1 / 5 / 2; justify-self: stretch; }
  .add-tile > :not(span) { grid-area: 2 / 1; }
  .add-tile > span { grid-area: 3 / 1; }
  .add-tile::after { display: none; }
  .add-tile span { position: static !important; text-shadow: none !important; color: var(--text-2) !important; }
  .picker-grid { max-height: 52vh; overflow-y: auto; padding: 0 16px; margin: 12px 0 0; }
  .picker-grid .tile .check { position: absolute; top: 6px; right: 6px; z-index: 2; background: rgba(0, 0, 0, 0.35);
                              border-color: rgba(255, 255, 255, 0.7); }
  .picker-grid .tile.on { box-shadow: 0 0 0 2px var(--selected); }
  .sheet .box.picker { width: min(100%, 560px); }
  .round.mini-step { width: var(--round-s); height: var(--round-s); font-size: var(--fs-headline); line-height: 1; }
  .round.mini-step:disabled { opacity: 0.35; }
  .round.mini-step svg { width: 16px; height: 16px; }
  /* Below 16px iOS zooms the page in when a field or picker gets focus. */
  @media (pointer: coarse) { .select { font-size: var(--fs-body); } }

  /* arrange lights */
  .room { position: relative; width: min(100%, 560px); aspect-ratio: 1; margin: 14px auto 0; border-radius: var(--r-2xl); touch-action: none;
          background: linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px) 6% 6% / 22% 22%,
                      linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px) 6% 6% / 22% 22%, var(--surface);
          box-shadow: inset 0 0 0 1px var(--separator); }
  .room.locked { opacity: 0.6; }
  .edge-label { margin: 8px 0 0; text-align: center; font-size: var(--fs-tab); letter-spacing: 1.2px; text-transform: uppercase; color: var(--text-2); }
  .edge-label + .room { margin-top: 6px; }
  .room .links { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .room .links line { stroke: rgba(255, 255, 255, 0.45); stroke-width: 0.8; stroke-dasharray: 2 1.5; }
  .spot { position: absolute; width: 38px; height: 38px; margin: -19px 0 0 -19px; padding: 0; border: 2px solid rgba(255, 255, 255, 0.85);
         border-radius: 50%; cursor: grab; display: flex; align-items: center; justify-content: center; background: var(--pin);
         color: #fff; box-shadow: var(--shadow-dot); touch-action: none; transition: transform var(--t-press) var(--ease); }
  .spot ha-icon { --mdc-icon-size: 18px; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6)); }
  .spot.on { transform: scale(1.18); border-color: var(--selected); box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.35), var(--shadow-dot); }
  .spot:active { cursor: grabbing; }
  .rows.height { margin-top: 14px; }
  .height-line { align-items: center; margin-top: 10px; }
  .height-line input { flex: 1; accent-color: #fff; }
  .center-text { text-align: center; margin-top: 12px; }
  .rows button.item:disabled { opacity: 0.5; }
  .seg.two { grid-template-columns: repeat(2, minmax(0, 1fr)); width: min(100%, 260px); }

  .bridge-add .seg.two { width: 100%; box-sizing: border-box; }
  .steps-list { margin: 10px 0 0; padding: 0; list-style: none; }
  .steps-list .item { align-items: flex-start; font-size: var(--fs-body); line-height: 1.4; }
  .step-no { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex: none; margin-top: 1px; border-radius: 50%;
             background: var(--fill-strong); font-size: var(--fs-caption); font-weight: 500; }
  .scan-state { display: inline-flex; align-items: center; gap: 6px; margin-right: 2px; font-size: var(--fs-caption); color: var(--text-2); }
  .spinner { width: 12px; height: 12px; flex: none; box-sizing: border-box; border: 2px solid rgba(235, 235, 245, 0.25); border-top-color: var(--text-2);
             border-radius: 50%; animation: spin 0.9s linear infinite; }
  .spinner.big { width: 28px; height: 28px; border-width: 3px; }
  .bridge-add .item.col .line { align-items: center; margin-top: 0; }
  .bridge-add .item.col .field { flex: 1; min-width: 0; margin-top: 0; font-size: var(--fs-body); }
  .bridge-add .item.col .dim.small { margin-top: 8px; }
  .link-state { display: flex; flex-direction: column; align-items: center; max-width: 420px; margin: 28px auto 0; text-align: center; }
  .link-state .lead { margin: 6px 0 0; }
  .link-title { margin: 18px 0 0; font-size: var(--fs-headline); font-weight: 500; line-height: 1.25; }
  .link-art { width: 132px; height: 132px; }
  .bridge-art { width: 100%; height: 100%; }
  .bridge-art .body { fill: #e9e9ee; }
  .bridge-art .button { fill: #f6f6f9; stroke: rgba(0, 0, 0, 0.08); stroke-width: 1.5; }
  .bridge-art .ring { fill: none; stroke: var(--info); stroke-width: 4; opacity: 0; transform-origin: 60px 60px; }
  .link-art.press .ring { animation: bridge-press 1.6s var(--ease) infinite; }
  @keyframes bridge-press { 0% { opacity: 0.9; transform: scale(0.75); } 100% { opacity: 0; transform: scale(1.35); } }
  @media (prefers-reduced-motion: reduce) { .link-art.press .ring { animation: none; opacity: 0.9; } .spinner { animation-duration: 2.4s; } }
  .countdown { width: min(100%, 260px); height: 4px; margin-top: 22px; border-radius: var(--r-full); overflow: hidden; background: var(--fill-strong); }
  .countdown span { display: block; height: 100%; background: var(--info); transform-origin: left; transition: transform 0.5s linear; }
  .link-icon { display: flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 50%; }
  .link-icon.ok { background: var(--ok); color: #fff; }
  .link-icon.ok svg { width: 34px; height: 34px; fill: currentColor; }
  .link-icon.fail { background: var(--danger-tint); color: var(--danger); }
  .link-icon.fail ha-icon { --mdc-icon-size: 34px; }
  .link-actions { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 26px; }
  .link-actions .pill { min-width: 180px; }
  
  /* banner (controls.ts banner()): the Hue app's, measured on its screenshot */
  .banner { display: flex; align-items: center; gap: 12px; margin: 14px 0 0; padding: 12px 14px 14px 16px; border-radius: var(--r-m);
            border: 1.5px solid var(--info-line); background: var(--info-bg); }
  .banner.link { cursor: pointer; }
  .banner.link:active { transform: scale(var(--press-row)); }
  .banner.warn { border-color: var(--warn-line); background: var(--warn-bg); }
  .banner .grow { flex: 1; min-width: 0; }
  .banner-head { display: flex; align-items: center; gap: 9px; font-size: var(--fs-label); font-weight: 500; letter-spacing: 2px;
                 text-transform: uppercase; color: var(--info-head); }
  .banner.warn .banner-head { color: var(--warn); }
  .banner-mark { flex: none; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
                 background: var(--info-mark); color: #fff; --mdc-icon-size: 14px; }
  .banner.warn .banner-mark { background: var(--warn); color: var(--text-dark); }
  .banner-head .dot-badge { margin: 0 4px; }
  .banner-text { margin-top: 6px; font-size: var(--fs-footnote); line-height: 1.4; color: var(--text-2); }
  .banner-text p { margin: 0; }
  .banner-text p + p { margin-top: 6px; }
  .banner .buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .banner .round.banner-go { color: var(--text); --mdc-icon-size: 22px; }
  .page > .banner:first-child, .rows + .banner { margin-top: 14px; }
  .mismatch { margin: 0 0 10px; padding: 12px 14px; border-radius: var(--r-m); background: var(--warn-tint); }
  .mismatch p { margin: 0; font-size: var(--fs-callout); line-height: 1.4; }
  .mismatch .buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }

  .toast { position: absolute; left: 50%; bottom: 76px; z-index: 20; max-width: calc(100% - 48px); padding: 10px 16px; border-radius: var(--r-m);
           background: rgba(60, 60, 64, 0.96); font-size: var(--fs-callout); transform: translate(-50%, 16px); opacity: 0; pointer-events: none;
           transition: opacity 0.2s, transform 0.25s var(--spring); }
  .toast.on { opacity: 1; transform: translate(-50%, 0); }


  /* Settings and automations, like the Hue app's (the look of Settings → Devices and a
     MotionAware area): big rows, full width on phones, separators from the text on; a row says
     what is chosen and opens the list (views/choice.ts): a sheet for one value, a screen for
     several. */
  /* A list row: at least 68px, a 28px icon in a 32px column, the text from 72px, a medium 15px title over a
     13px regular line, separators from the text on. */
  :is(.settings-page, .sensor-edit, .choice-sheet) .rows .item, .rows.device-list .item {
    min-height: var(--row-h); gap: 28px; padding: 12px 16px 12px 20px; font-size: var(--fs-body); }
  :is(:is(.settings-page, .sensor-edit, .choice-sheet) .rows, .rows.device-list) .item > ha-icon:first-child {
    flex: none; display: flex; justify-content: center; width: var(--row-icon); --mdc-icon-size: var(--row-icon); color: var(--text); }
  .rows.device-list .item { gap: 20px; }
  .rows.device-list .item > ha-icon:first-child { width: 32px; --mdc-icon-size: 32px; }
  :is(:is(.settings-page, .sensor-edit, .choice-sheet) .rows, .rows.device-list) .item :is(.dim.small, .small) { margin-top: 2px; font-size: var(--fs-caption); }
  :is(:is(.settings-page, .sensor-edit, .choice-sheet) .rows, .rows.device-list) .item :is(.value, .value-text) { font-size: var(--fs-footnote); }
  /* Row titles are medium (the Hue app's); what a row says under or beside its title stays regular. */
  :is(.settings-page, .sensor-edit, .choice-sheet) .rows .item, .rows.device-list .item { font-weight: 500; }
  :is(.settings-page, .sensor-edit, .choice-sheet) .rows .item :is(.dim, .small, .value, .value-text, input),
  .rows.device-list .item :is(.dim, .small, .value) { font-weight: 400; }
  :is(:is(.settings-page, .sensor-edit, .choice-sheet) .rows, .rows.device-list) .item + .item { position: relative; border-top: none; }
  :is(:is(.settings-page, .sensor-edit, .choice-sheet) .rows, .rows.device-list) .item + .item::before {
    content: ""; position: absolute; top: 0; left: 16px; right: 0; height: 1px; background: var(--separator); }
  :is(:is(.settings-page, .sensor-edit, .choice-sheet) .rows, .rows.device-list) .item + .item:has(> :is(ha-icon, .row-art, .thumb, .tag-pic):first-child)::before {
    left: var(--row-text); }
  .settings-page .section-head h2.label { margin: 0 var(--text-inset); }
  .settings-page > h2.label:first-child, .settings-page .tab-title + h2.label { margin-top: 18px; }
  .settings-page .lead { font-size: var(--fs-callout); }
  .settings-page .hint { margin: 10px 2px 0; font-size: var(--fs-footnote); line-height: 1.45; color: var(--text-2); }
  .settings-page .hint.warn { color: var(--warn); }
  /* The automation editor's rows have no icons, like the Hue app's; its type's icon sits by the name. */
  .automation-page .rows .item > ha-icon:first-child { display: none; }
  .automation-page .rows:not(.device-list) .item { gap: 16px; padding-left: 16px; }
  .automation-page .rows:not(.device-list) .item + .item::before,
  .automation-page .rows:not(.device-list) .item + .item:has(> :is(ha-icon, .row-art, .thumb, .tag-pic):first-child)::before { left: 16px; }
  .automation-page .name-row .type-icon { --mdc-icon-size: 28px; color: var(--text); }
  /* "+": a picture card for each automation type, like the Hue app's. */
  h1.big.new-question { margin: 8px 2px 18px; font-size: var(--fs-title); }
  .type-cards { display: grid; gap: 12px; }
  main.wide .type-cards { grid-template-columns: 1fr 1fr; }
  .type-card { position: relative; display: block; width: 100%; height: 172px; padding: 0; border: none; border-radius: var(--r-m); overflow: hidden;
               background: var(--bg); color: #fff; font: inherit; text-align: left; cursor: pointer; transition: transform var(--t-press) var(--ease); }
  .type-card:active { transform: scale(var(--press-card)); }
  .type-card svg.art { position: absolute; inset: 0; width: 100%; height: 100%; }
  .type-card::after { content: ""; position: absolute; inset: 30% 0 0; background: linear-gradient(transparent, rgba(0, 0, 0, 0.66)); }
  .type-card .text { position: absolute; left: 16px; right: 16px; bottom: 14px; z-index: 1; display: flex; flex-direction: column; gap: 3px; }
  .type-card .title { font-size: var(--fs-title-3); font-weight: 500; }
  .type-card .sub { font-size: var(--fs-body); line-height: 1.3; color: rgba(255, 255, 255, 0.82); }
  /* The custom one (Home Assistant's editor) stands out: outlined, an arrow out of the panel. */
  .type-card.custom::before { content: ""; position: absolute; inset: 0; z-index: 2; border-radius: inherit; pointer-events: none;
                              border: 1.5px solid rgba(160, 196, 255, 0.95); }
  .type-card .open { position: absolute; top: 12px; right: 12px; z-index: 1; --mdc-icon-size: 20px; color: rgba(255, 255, 255, 0.9); }
  /* The editor's head, like the Hue app's: the type's icon over the name. */
  .automation-page .automation-hero > .type-icon { --mdc-icon-size: 40px; color: var(--text); margin: 4px 0 2px; }
  .automation-page .automation-hero h1.big { font-size: var(--fs-large); }
  .lights-card .lights-head .round.add { background: var(--accent); color: #fff; }
  /* A time of day on its wheels in place (wake up, go to sleep): the title over them. */
  .automation-page .rows .item.time-item { display: block; padding: 12px 8px 6px 16px; }
  .automation-page .rows .item.time-item .wheels { margin: 4px 0 0 -8px; }
  .automation-page .rows .item.time-item .wheels::before { border-radius: var(--r-s); }
  .automation-page .hint + .rows { margin-top: 16px; }
  /* Selected lights, like the Hue app's: a card with its pencil, a tile for each room or zone. */
  .lights-card .item.lights-head { min-height: 60px; }
  .lights-card .lights-head .round { background: var(--fill-light); color: var(--text); }
  .lights-card .lights-head .round svg { width: 18px; height: 18px; }
  .place-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; padding: 2px 12px 14px; }
  .place-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; padding: 14px 14px 12px; border: none;
                border-radius: var(--r-m); background: var(--surface-2); color: var(--text); font: inherit; text-align: left; cursor: pointer;
                transition: transform var(--t-press) var(--ease); }
  .place-tile:active { transform: scale(var(--press-tile)); }
  .place-tile ha-icon { --mdc-icon-size: 28px; margin-bottom: 14px; }
  .place-tile .name { max-width: 100%; font-size: var(--fs-body); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .place-tile .sub { max-width: 100%; font-size: var(--fs-footnote); color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .place-tile.gone .sub { color: var(--warn); }
  .lights-card .lights-empty .warn { font-weight: 400; font-size: var(--fs-body); }
  /* The fade sheet: minutes and the time they lead to, a slider with its scale under it. */
  .fade-sheet .fade-body { padding: 22px 20px calc(22px + var(--safe-bottom)); }
  .fade-values { display: flex; justify-content: space-around; text-align: center; }
  .fade-values .caps { font-size: var(--fs-caption); font-weight: 500; letter-spacing: 1.4px; text-transform: uppercase; color: var(--text-2); }
  .fade-values .big-value { margin-top: 4px; font-size: var(--fs-headline); font-weight: 500; font-variant-numeric: tabular-nums; }
  .fade-sheet .fade-slider { height: 8px; margin: 30px 8px 0; border-radius: var(--r-full); background: rgba(255, 255, 255, 0.16); }
  .fade-sheet .fade-slider .fill { border-radius: var(--r-full); background: linear-gradient(90deg, #0a3fb8, var(--accent)); }
  .fade-sheet .fade-slider .knob { width: 18px; height: 18px; }
  .fade-ticks { display: flex; justify-content: space-between; margin: 14px 0 0; font-size: var(--fs-caption); color: var(--text-2); font-variant-numeric: tabular-nums; }
  .fade-ticks span { width: 16px; text-align: center; }
  /* "Turn off after": the slider sets the row with the tick (every part of the day, or one of them). */
  .off-sheet .fade-body { max-height: min(70dvh, 620px); overflow-y: auto; overscroll-behavior: contain; }
  .off-sheet .off-phases { margin-top: 10px; border-radius: var(--r-m); background: var(--surface-row); }
  .off-sheet .off-phases .item { min-height: 52px; }
  .off-sheet .off-phases .value { color: var(--text-2); }
  .off-sheet .off-phases .value.own { color: var(--text); }
  .off-sheet .center { margin-top: 12px; }
  .off-sheet .hint { margin: 22px 2px 0; }
  /* The light picker ("Edit lights"): a room's check (whole, some, none), its lights in a strip. */
  .sheet .box.lights-sheet { display: flex; flex-direction: column; width: min(100%, 520px); max-height: min(100%, 760px); }
  .sheet.bottom .box.lights-sheet { width: 100%; max-height: calc(100% - var(--safe-top) - 24px); }
  .lights-sheet .lights-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 0 calc(18px + var(--safe-bottom)); }
  .lights-sheet h2.label { margin: 18px 16px 8px; }
  .lights-sheet .rows.pick-rows { border-radius: 0; background: var(--surface-row); }
  .pick-room + .pick-room { border-top: 1px solid var(--separator); }
  .pick-room > .item { display: flex; align-items: center; gap: 4px; min-height: var(--row-h); padding: 0 14px 0 4px; }
  .pick-toggle, .pick-name { border: none; background: none; color: inherit; font: inherit; cursor: pointer; padding: 0; }
  .pick-toggle { display: flex; align-items: center; justify-content: center; width: 52px; height: 52px; flex: none; }
  .pick-name { flex: 1; min-width: 0; height: 68px; display: flex; align-items: center; text-align: left; font-size: var(--fs-body); font-weight: 500; }
  .pick-name .grow { display: flex; flex-direction: column; min-width: 0; }
  .pick-name .dim.small { font-size: var(--fs-footnote); font-weight: 400; }
  .pick-check i { width: 10px; height: 2px; border-radius: var(--r-full); background: #fff; }
  .pick-room .round.expand { background: var(--fill-light); color: var(--text); }
  .pick-room .round.expand ha-icon { --mdc-icon-size: 22px; justify-content: center; transition: transform 0.2s var(--ease); }
  .pick-room .round.expand.open ha-icon { transform: rotate(180deg); }
  .pick-lights { display: flex; gap: 10px; padding: 2px 16px 16px 56px; overflow-x: auto; overscroll-behavior: contain; scrollbar-width: none; }
  .pick-lights::-webkit-scrollbar { display: none; }
  /* The tiles stand out from the sheet: lighter than its rows, a hairline round them. */
  .pick-lights .tile-card { flex: none; width: var(--light-tile); --zone: 44px; background: var(--surface-raised); box-shadow: none;
                            border: 1px solid var(--separator); }
  .pick-lights .tile-card > .switch-zone { background: rgba(0, 0, 0, 0.22); border-top-color: var(--hairline); }
  .pick-lights .tile-card.on { border-color: rgba(10, 98, 255, 0.7); }
  /* Going to sleep: "Start" by the time's switch, always there. */
  .automation-page .rows .item.time-switch { gap: 12px; }
  .automation-page .pill.start { display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 14px 0 10px; }
  .automation-page .pill.start svg { width: 16px; height: 16px; }
  /* Before arriving and leaving: a checklist of what HA needs. */
  .presence-rows { margin-top: 14px; }
  .presence-rows .item .pill { flex: none; height: 32px; }
  .presence-rows .check-ok { display: flex; flex: none; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%;
                             background: var(--ok); color: #fff; }
  .presence-rows .check-ok svg { width: 16px; height: 16px; }
  .presence-rows .check-warn { flex: none; --mdc-icon-size: 24px; color: var(--warn); }
  .settings-page .rows + .rows { margin-top: 16px; }
  .rows .item .value { flex: none; max-width: 48%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; color: var(--text-2); }
  .rows .item.nav .chevron, .settings-page .rows .item .chevron { flex: none; margin: 0 -6px 0 -8px; --mdc-icon-size: 20px; color: var(--text-2); }
  .rows .item .row-art { flex: none; width: 24px; height: 24px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15); }
                            font-variant-numeric: tabular-nums; text-align: right; color-scheme: dark; cursor: pointer; }
  .choice-list .item .tick, .moment-list .item .tick { display: flex; flex: none; color: var(--accent); }
  .moment-list .item .tick svg { width: 22px; height: 22px; fill: currentColor; }
  /* Time screen (momentChoice): the wheels under the chosen kind, one band across them. */
  .moment-list .item.wheels-item { display: block; padding: 6px 8px 10px; min-height: 0; }
  .wheels { position: relative; display: flex; justify-content: center; gap: 28px; overflow: hidden; touch-action: pan-y; }
  .wheels::before { content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 36px; transform: translateY(-50%);
                    border-radius: var(--r-s); background: var(--fill-soft); pointer-events: none; }
  hue-studio-wheel { position: relative; display: block; flex: 1; min-width: 0; }
  /* Hours and minutes close together, like the Hue app's. */
  .wheels.time { gap: 6px; }
  .wheels.time hue-studio-wheel { flex: none; width: 40px; }
  .wheel-scroll { height: 160px; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; scroll-snap-type: y mandatory; scrollbar-width: none;
                  padding: 64px 0; box-sizing: border-box; perspective: 260px; -webkit-mask-image: linear-gradient(transparent, #000 25%, #000 75%, transparent);
                  mask-image: linear-gradient(transparent, #000 25%, #000 75%, transparent); }
  .wheel-scroll::-webkit-scrollbar { display: none; }
  .wheel-opt { height: 32px; display: flex; align-items: center; justify-content: center; scroll-snap-align: center; cursor: pointer;
               font-size: var(--fs-body); color: var(--text-2); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .wheel-opt.on { font-size: var(--fs-headline); font-weight: 500; color: var(--text); }
  .choice-list .item .tick svg { width: 22px; height: 22px; fill: currentColor; }
  .choice-list .item .check { margin-left: 4px; }
  .choice-sheet .form-body { max-height: min(70vh, 640px); overflow: auto; overscroll-behavior: contain; }
  .choice-sheet .rows + h2.label { margin-top: 20px; }
  .choice-page .rows.choice-list { margin-top: 12px; }
  .choice-page h2.label + .hint + .rows, .choice-page h2.label + .rows { margin-top: 0; }
  .choice-page .hint + .rows { margin-top: 12px; }
  .rows .item.date-row { position: relative; cursor: pointer; }
  .rows .item.date-row input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
  .rule-page .lead { margin-top: 14px; }
  /* A screen's own header picture and name (an automation): the sensor page's hero. */
  .settings-page .sensor-hero .kind { margin-top: -6px; font-size: var(--fs-footnote); color: var(--text-2); }
  /* Days of the week: round toggles in a row of their own. */
  .rows .item.days-item, .settings-page .rows .item.days-item { flex-direction: column; align-items: stretch; gap: 4px; padding-top: 0; padding-bottom: 0; }
  .rows .item.days-item:has(> .days-row) { padding-bottom: 18px; }
  .days-item > .line { display: flex; align-items: center; gap: 12px; min-height: var(--row-h); }
  /* The days spread evenly over the row, as in the Hue app. */
  .days-row { display: flex; justify-content: space-between; }
  .days-row button { width: var(--control); height: var(--control); padding: 0; border: none; border-radius: 50%; cursor: pointer; background: var(--fill-soft);
                     color: var(--text-2); font: inherit; font-size: var(--fs-footnote); font-weight: 500; transition: background 0.2s, color 0.2s, transform var(--t-press) var(--ease); }
  .days-row button.on { background: var(--accent); color: #fff; }
  .days-row button:active { transform: scale(var(--press-round)); }
  /* Under a screen's rows: its main button, then "Open in Home Assistant" and "Delete". */
  .settings-page .save-area { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-top: 30px; }
  .settings-page .save-area .pill.apply { min-width: 180px; background: var(--accent); color: #fff; }
  .settings-page .save-area .lead { margin: 4px 0 0; text-align: center; }
  @container (max-width: 599px) {
    .settings-page .rows { margin-left: calc(-1 * var(--gutter)); margin-right: calc(-1 * var(--gutter)); border-radius: 0; }
    .settings-page .scene-tiles, .settings-page .today { margin-left: 0; margin-right: 0; }
  }

  @container (min-width: 600px) {
    .cards { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
    .grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
    .tiles { grid-auto-flow: row; grid-template-rows: none; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
             overflow: visible; margin: 0; padding: 0; }
    .searching { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); }
    .grid.inputs { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .sync-hero { padding: 24px; }
    .tile:hover, .card:hover, .tile-card:hover, .control-card:hover { transform: translateY(-1px); }
    h1.big { font-size: var(--fs-large); }
    /* Room header: a card in the column instead of a sheet glued to the top edge. */
    .page > .hero:first-child { position: relative; margin: 20px 0 0; padding: 4px 20px 18px; border-radius: var(--r-3xl); }
  }
`;
