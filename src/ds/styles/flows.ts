// Part of the stylesheet (joined in index.ts): flows ("Add devices", a new bridge, a MotionAware area) and their footers.

export const FLOWS_CSS = `
  /* "Add devices": what is added, the steps to get it ready, the search. */
  /* A flow ("Add devices", a new bridge, a MotionAware area; the Hue app's): a picker whose art (a picture, or the search's ring with a
     badge once it is over) sits on the blue over the rounded panel; buttons in the footer. */
  main.picker .screen-head + .screen-body > .page.flow { padding: 0; background: none; box-shadow: none; border-radius: 0;
                                                             display: flex; flex-direction: column; }
  .flow .flow-art { flex: none; display: flex; align-items: center; justify-content: center; height: clamp(200px, 40dvh, 378px); }
  .flow .flow-panel { flex: 1; padding: 20px 20px 28px; border-radius: var(--r-2xl) var(--r-2xl) 0 0; background: var(--bg);
                          box-shadow: inset 0 1px 0 var(--surface-low); }
  .flow .flow-title { margin: 6px var(--text-inset) 0; font-size: var(--fs-title); }
  .flow .flow-lead { margin: 12px var(--text-inset) 0; font-size: var(--fs-body); color: var(--text-2); line-height: 1.35; }
  .flow .flow-lead.small { font-size: var(--fs-footnote); }
  .flow .flow-title + .rows, .flow .flow-title + h2.label { margin-top: 40px; }
  .flow .outlined { margin-top: 24px; }
  .flow .art-icon { --mdc-icon-size: 140px; color: var(--text); filter: drop-shadow(0 0 36px var(--glow-blue)); }
  .flow .rows.inset { border-radius: var(--r-m); box-shadow: var(--shadow-row); }
  .flow .rows.inset .item { min-height: var(--row-h); gap: 24px; padding: 12px 16px; font-size: var(--fs-body); font-weight: 500; }
  .flow .rows.inset .item > ha-icon:first-child { width: 32px; justify-content: center; --mdc-icon-size: 28px; }
  .flow .rows.inset .item .plus-blue { flex: none; }
  .flow .pick-tiles { margin-top: 0; }
  .pick-tile.plain { justify-content: center; gap: 16px; padding: 16px 12px; }
  .pick-tile.plain > ha-icon { --mdc-icon-size: 64px; }
  .pick-tile.plain .name { flex: none; }
  .pick-tile.wide { grid-column: 1 / -1; }
  .flow-ring { position: relative; display: flex; align-items: center; justify-content: center; width: min(300px, 32dvh + 40px); aspect-ratio: 1; }
  .flow-ring > svg { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
  .flow-ring circle { fill: none; stroke-width: 3; }
  .flow-ring .track { stroke: var(--outline); }
  .flow-ring .bar { stroke: var(--accent); stroke-linecap: round; transition: stroke-dashoffset 0.5s linear; filter: drop-shadow(0 0 6px var(--accent)); }
  .flow-ring > .art-icon { --mdc-icon-size: 128px; }
  .flow-ring:not(.over) > .art-icon { animation: breathe 2s ease-in-out infinite; }
  .flow-ring .badge { position: absolute; top: 9%; right: 9%; box-sizing: border-box; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px;
                      border-radius: 50%; color: var(--text); box-shadow: var(--shadow-dot); }
  .flow-ring .badge svg { width: 26px; height: 26px; }
  .flow-ring .badge.ok { background: var(--ok); }
  .flow-ring .badge.fail { background: var(--danger); }
  .flow-ring.alarm .track { stroke: var(--danger); filter: drop-shadow(0 0 8px var(--danger)); }
  .dev-tiles { display: grid; grid-template-columns: repeat(auto-fill, 120px); gap: var(--tile-gap); margin-top: 20px; }
  h2.label + .dev-tiles { margin-top: 0; }
  .dev-tile { position: relative; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; height: 115px; padding: 12px;
              border: none; border-radius: var(--r-m); background: var(--surface); box-shadow: var(--shadow-flat); color: var(--text); font: inherit; text-align: left; }
  button.dev-tile { cursor: pointer; transition: transform var(--t-press) var(--ease); }
  button.dev-tile:active { transform: scale(var(--press-tile)); }
  .dev-tile > ha-icon { --mdc-icon-size: 32px; }
  .dev-tile .name { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font-size: var(--fs-callout); font-weight: 500; line-height: 1.25; }
  .dev-tile .tick { position: absolute; top: 12px; right: 12px; display: flex; align-items: center; justify-content: center; width: 20px; height: 20px;
                    border-radius: 50%; background: var(--accent); }
  .dev-tile .tick svg { width: 14px; height: 14px; }
  /* A name step of a flow (a device's, a new room's): the glyph over the field, rows 20 under it. */
  .flow-panel .name-pic { display: flex; justify-content: center; padding: 4px 0 16px; }
  .flow-panel .name-pic ha-icon { --mdc-icon-size: 48px; }
  .flow-panel .name-field + .rows { margin-top: 20px; }
  .add-steps { margin: 6px 0 16px; padding: 0; list-style: none; counter-reset: step; }
  .add-steps li { position: relative; padding: 10px 4px 10px 44px; font-size: var(--fs-body); line-height: 1.45; counter-increment: step; }
  .add-steps li::before { content: counter(step); position: absolute; left: 4px; top: 8px; width: 28px; height: 28px; border-radius: 50%;
                          display: flex; align-items: center; justify-content: center; background: var(--surface-2); font-size: var(--fs-callout); font-weight: 500; }
  .add-steps.tips li::before { content: "•"; background: none; font-size: var(--fs-title-3); }
  /* A footer's buttons one over the other (the Hue app's flows), the main one last. */
  .screen-foot.stack { flex-direction: column; align-items: center; gap: 12px; }
  .pill.outline { background: transparent; box-shadow: inset 0 0 0 1.5px var(--outline); }
  @keyframes breathe { 50% { opacity: 0.45; } }
  .rows .item.fresh { animation: pop 0.35s var(--ease); }
  .actions-row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
  .item.col .field { margin-top: 10px; }
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
`;
