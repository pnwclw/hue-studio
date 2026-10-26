// Part of the stylesheet (joined in index.ts): the light of the day and its settings.

export const DAYLIGHT_CSS = `
  /* light of the day (natural light, scene of the day) */
  .rows .item .thumb { width: 32px; height: 32px; flex: none; border-radius: 50%; object-fit: cover; }
  .rows .item.wrap { flex-wrap: wrap; }
  .rows .item.wrap .grow { min-width: 140px; }
  .rows .item .plain { padding: 0; border: none; background: none; cursor: pointer; text-align: left; font: inherit; color: inherit; }
  .lead.pad { padding: 0 16px 16px; }
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

`;
