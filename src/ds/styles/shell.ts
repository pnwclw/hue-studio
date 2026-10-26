// Part of the stylesheet (joined in index.ts): the page: the host, resets, screens and their glow, sheets and pickers, headers and bars.

import { tokensCss } from "../tokens.ts";

export const SHELL_CSS = `
  :host {
    ${tokensCss()}
    /* HA does not size custom panels: take the viewport ourselves (fitToViewport refines the
       height). Safe areas are ours (handle_safe_area), padded with HA's own variables;
       --hue-top/--hue-bottom are what HA covers around us anyway, if it does. */
    --safe-top: max(0px, calc(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) - var(--hue-top, 0px)));
    --safe-bottom: max(0px, calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) - var(--hue-bottom, 0px)));
    position: relative; display: flex; flex-direction: column; height: 100vh; height: 100dvh; overflow: hidden;
    background: var(--bg);
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
  /* A picker comes up from the bottom over the screen it was opened from and goes back down
     over the one it returns to (the Hue app's: about a quarter of a second, slowing down). */
  main.under { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
  main.current { position: relative; z-index: 1; }
  main.rise { animation: sheet-up var(--t-sheet-up) var(--decelerate) both; }
  main.fall { position: absolute; inset: 0; z-index: 3; pointer-events: none; animation: sheet-down var(--t-sheet-down) var(--decelerate) both; }
  @keyframes sheet-up { from { transform: translateY(100%); } }
  @keyframes sheet-down { to { transform: translateY(100%); } }
  @media (prefers-reduced-motion: reduce) { main.rise, main.fall { animation: none; } }
  /* The page's glow (the Hue app's): Home and a room fade from their lit lights' color at the
     top to the page at the bottom; Automations (its sheets and the gallery too) and Sync have
     their own at the top. On a sheet it is the sheet's. */
  main.glow-light:not(.as-sheet), main.as-sheet.glow-light > * {
    background: linear-gradient(color-mix(in srgb, var(--glow) 10%, var(--bg)), var(--bg)); }
  main.glow-blue:not(.as-sheet), main.as-sheet.glow-blue > * {
    background: radial-gradient(60% 300px at 40% 0, var(--glow-blue), transparent), linear-gradient(var(--glow-blue-wash), transparent 330px), var(--bg); }
  main.glow-violet:not(.as-sheet), main.as-sheet.glow-violet > * {
    background: radial-gradient(55% 260px at 50% 0, var(--glow-violet), transparent), linear-gradient(var(--glow-violet-wash), transparent 300px), var(--bg); }
  /* An editor as a sheet (phones): it starts under the status bar with its top corners rounded,
     the screen behind it dimmed. */
  main.as-sheet { background: linear-gradient(var(--scrim), var(--scrim)), var(--bg); }
  main.as-sheet > * { margin-top: calc(var(--safe-top) + 8px); border-radius: var(--r-m) var(--r-m) 0 0; overflow: hidden; background: var(--bg); }
  main.as-sheet .screen-head { padding-top: 6px; }
  /* A picker (the gallery, a new automation's types): a deep blue top, the page a rounded panel
     over it with a light edge; the bar's buttons sit on the blue. */
  main.picker { background: linear-gradient(100deg, var(--picker-top), var(--picker-top-2) 60%); }
  main.picker .screen-head, main.picker .screen-head:has(> .bar.sub) { background: none; border: none; box-shadow: none;
                                                                      -webkit-backdrop-filter: none; backdrop-filter: none; }
  main.picker .screen-head + .screen-body > .page, main.picker .screen-head:has(> .bar.sub) + .screen-body > .page { min-height: 100%; padding: 20px 20px 28px; border-radius: var(--r-2xl) var(--r-2xl) 0 0;
                                     background: var(--bg); box-shadow: inset 0 1px 0 var(--surface-low); }
  main.picker .screen-head:has(> .tab-head) + .screen-body > .page { margin-top: var(--head-h, 56px); padding-top: 20px; }
  main.picker .page > h1.big:first-child { margin-top: 6px; margin-left: var(--text-inset); margin-right: var(--text-inset); }
  main.picker .screen-body { scrollbar-width: none; }
  .screen-head { flex: none; padding: max(6px, var(--safe-top)) 16px 6px; background: rgba(24, 24, 26, 0.62);
                 -webkit-backdrop-filter: saturate(1.8) blur(24px); backdrop-filter: saturate(1.8) blur(24px); border-bottom: 1px solid var(--hairline); z-index: 3; }
  .screen-head > * { max-width: 928px; margin-left: auto; margin-right: auto; }
  /* A sub screen's header, the Hue app's: a solid bar a shade over the rows, a long shadow under it. */
  .screen-head:has(> .bar.sub) { position: relative; background: var(--surface-bar); -webkit-backdrop-filter: none; backdrop-filter: none;
                                 border-bottom: none; box-shadow: var(--shadow-bar); }
  .screen-head:empty { display: none; }
  .screen-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  .screen-body > .page { padding-top: 10px; }
  /* Under a sub screen's bar the first group of rows starts 20px down (the Hue app's). */
  .screen-head:has(> .bar.sub) + .screen-body > .page { padding-top: 4px; }
  .screen-head:has(> .bar.sub) + .screen-body > .page > :is(p, .lead, .rows):first-child { margin-top: 16px; }
  .bar { display: flex; align-items: center; gap: 8px; min-height: 44px; }
  .bar.sub .title { flex: 1; min-width: 0; font-size: var(--fs-body); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Everything in a header is 32px tall: round buttons, switches, pills, the search field. */
  :is(.bar, .topbar, .cv-bar, .sheet-bar, .tab-head, .sync-banner) .pill { height: var(--control); padding: 0 14px; background: var(--surface-2);
                                                                       letter-spacing: 0.3px; text-transform: uppercase; }
  /* A header's pill is grey even for the main action ("SAVE"), the Hue app's. */
  :is(.bar, .topbar, .cv-bar, .sheet-bar, .tab-head) .pill.apply { background: var(--surface-2); color: var(--text); }
  /* Nothing to save yet: the pill stays, its word goes grey (the Hue app's). */
  :is(.bar, .topbar, .cv-bar, .sheet-bar) .pill:disabled { opacity: 1; color: var(--text-3); }
  /* A bar's title after its back or close button starts where list rows' text does (72px), the Hue app's. */
  :is(.bar, .topbar) > .round:first-child + :is(.title, .grow) { margin-left: 16px; }
  .sheet-bar > .round:first-child + .grow { margin-left: 12px; }
  /* A tab's header floats: the body scrolls under it. On phones it is a bar over a large
     title (iOS): clear at the top; once the title went under the bar, the bar shows it (the
     room header's size) and blurs what scrolls below. A search field takes the title's place. */
  main > * { position: relative; }
  /* A name page opened over a screen ("Save current settings"): it covers that screen. */
  hue-studio-new-scene { position: absolute; inset: 0; z-index: 31; display: flex; flex-direction: column; background: var(--bg); }
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
           display: flex; align-items: center; justify-content: center; background: var(--round);
           transition: background 0.2s, transform var(--t-press) var(--ease); }
  .round::after { content: ""; position: absolute; inset: -5px; }
  .round > svg { width: 22px; height: 22px; }
  .round:active { transform: scale(var(--press-round)); }
  .round[hidden] { display: none; }
`;
