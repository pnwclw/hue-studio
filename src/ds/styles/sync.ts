// Part of the stylesheet (joined in index.ts): Sync: the glow, the Sync tab and its dock, popovers, inputs, icon grid, empty state.

export const SYNC_CSS = `
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
  /* Sync (features/sync/views/sync.ts), the Hue app's Sync tab (measured at 411 with a box on): no title, what plays as a
     picture with its name and status centered over the controls; mode / intensity / brightness as three
     pills under small capitals and a dock with what (the HDMI input), start / stop and where (the
     entertainment area) at the bottom. The picture and the pills scale with the width (54% and 21.4%). */
  .page.sync-page > h1.tab-title { display: none; }
  .screen-head:has(+ .screen-body > .page.sync-page) { background-color: transparent; border-bottom-color: transparent;
    -webkit-backdrop-filter: none; backdrop-filter: none; }
  .screen-head:has(+ .screen-body > .page.sync-page) .bar-title { visibility: hidden; }
  /* On shorter screens the picture and the gaps give way, so the dock stays in view. */
  .page.sync-page { display: flex; flex-direction: column; min-height: 100%; padding-bottom: 22px; }
  .sync-stage { --stage-w: calc(100% + 2 * var(--gutter)); display: flex; flex: 1; flex-direction: column; align-items: center; align-self: center;
                width: 100%; max-width: 440px; }
  .sync-stage > .chips.boxes { align-self: stretch; }
  .sync-stage .caps { font-size: var(--fs-label); font-weight: 500; letter-spacing: 1.4px; text-transform: uppercase; color: var(--text-2); }
  .sync-what-plays { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; align-self: stretch; padding: 8px 0 24px; }
  .sync-picture { position: relative; isolation: isolate; overflow: hidden; display: flex; flex: none; align-items: center; justify-content: center;
                  width: min(238px, calc(var(--stage-w) * 0.543), 26dvh); aspect-ratio: 1;
                  background: linear-gradient(transparent, rgba(0, 0, 0, 0.14)), var(--surface); box-shadow: var(--shadow-raised); }
  .sync-picture ha-icon { --mdc-icon-size: 120px; opacity: 0.88; transition: opacity 0.3s; }
  .sync-picture.off ha-icon { opacity: 0.4; }
  .sync-caption { margin-top: 20px; text-align: center; }
  .sync-what { margin-top: 6px; font-size: var(--fs-title-3); font-weight: 500; }
  .sync-status { margin-top: 4px; font-size: var(--fs-body); color: var(--text-2); }
  .sync-controls { display: grid; grid-template-columns: repeat(3, min(95px, calc(var(--stage-w) * 0.214))); justify-content: center; column-gap: 24px;
                   width: 100%; padding-top: 24px; transition: opacity 0.3s; }
  .sync-controls.inert { opacity: 0.4; pointer-events: none; }
  .sync-controls.inert .bri.off { opacity: 1; }
  .sync-ctl { position: relative; display: flex; }
  .sync-ctl .bri-value { font-size: var(--fs-label); font-weight: 500; letter-spacing: 1.4px; text-transform: uppercase; bottom: calc(100% + 8px); }
  .sync-ctl > .bri { flex: 1; margin: 0; }
  .sync-ctl .bri-pill { width: 100%; box-shadow: var(--shadow-flat); }
  .sync-pill { flex: 1; display: flex; align-items: center; justify-content: center; height: 48px; padding: 0; border: none; border-radius: var(--r-full);
               background: var(--surface-raised); color: var(--text); cursor: pointer; box-shadow: var(--shadow-flat); transition: transform var(--t-press) var(--ease); }
  .sync-pill:active { transform: scale(var(--press-tile)); }
  .sync-pill ha-icon { --mdc-icon-size: 28px; }
  svg.wave { width: 28px; height: 28px; }
  /* The dock: 20 from the screen's edges (not the gutter), 114 tall. */
  .sync-dock { display: flex; align-items: center; justify-content: space-around; align-self: stretch; box-sizing: border-box; height: 114px;
               margin: 20px calc(20px - var(--gutter)) 0; padding: 4px 8px 0; border-radius: var(--r-2xl); background: var(--bar-bottom);
               box-shadow: var(--shadow-raised); transition: opacity 0.3s; }
  .sync-dock.inert { opacity: 0.4; pointer-events: none; }
  .dock-side { display: flex; flex-direction: column; align-items: center; gap: 1px; width: 112px; min-width: 0; padding: 0; border: none;
               background: none; color: var(--text); cursor: pointer; }
  .dock-side:disabled { opacity: 0.4; cursor: default; }
  .dock-round { display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; margin-bottom: 8px; border-radius: 50%;
                background: var(--surface-raised); box-shadow: var(--shadow-dot); transition: transform var(--t-press) var(--ease); }
  .dock-side:active .dock-round { transform: scale(var(--press-round)); }
  .dock-round ha-icon { --mdc-icon-size: 26px; }
  .dock-value { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-caption); color: var(--text-2); }
  /* Start: grey while the box sleeps, an accent ring while it is on, the mode's colors while syncing. */
  .dock-go { display: flex; flex: none; align-items: center; justify-content: center; width: 76px; height: 76px; padding: 0; border: none; border-radius: 50%;
             background: var(--surface-raised); color: var(--text); cursor: pointer; box-shadow: var(--shadow-dot); transition: transform var(--t-press) var(--ease), background 0.3s; }
  .dock-go:active { transform: scale(var(--press-round)); }
  .dock-go:disabled { opacity: 0.4; cursor: default; }
  .dock-go svg { width: 40px; height: 40px; }
  .dock-go.ready { background: color-mix(in srgb, var(--accent) 16%, var(--bar-bottom));
                   box-shadow: inset 0 0 0 4px color-mix(in srgb, var(--accent) 65%, var(--bar-bottom)), var(--shadow-dot); }
  .dock-go.on { background: linear-gradient(135deg, var(--g1), var(--g2) 55%, var(--g3)); }
  /* Mode and intensity: a card above the controls over a dimmed screen, 20 from its edges, the chosen option white. */
  .pop-layer { position: fixed; inset: 0; z-index: 20; animation: fade 0.2s ease; }
  .pop-card { position: fixed; box-sizing: border-box; padding: 20px 16px; transform: translate(-50%, -100%);
              border-radius: var(--r-m); background: var(--surface-row); box-shadow: var(--shadow-overlay); animation: pop-up 0.3s var(--spring); }
  @keyframes pop-up { from { opacity: 0; transform: translate(-50%, -100%) scale(0.94) translateY(8px); } }
  .pop-title { margin: 0 0 25px; font-size: var(--fs-body); font-weight: 500; }
  .pop-modes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .pop-mode { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 100px; padding: 0; border: none;
              border-radius: var(--r-m); background: var(--surface-2); color: var(--text); cursor: pointer; font-size: var(--fs-label); font-weight: 500;
              letter-spacing: 1.4px; text-transform: uppercase; box-shadow: var(--shadow-flat); transition: background 0.2s, color 0.2s, transform var(--t-press) var(--ease); }
  .pop-mode ha-icon { --mdc-icon-size: 24px; }
  .pop-mode:active, .pop-wave:active { transform: scale(var(--press-tile)); }
  .pop-mode.unsupported { opacity: 0.4; }
  :is(.pop-mode, .pop-wave).on { background: var(--selected); color: var(--text-dark); }
  .pop-waves { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  .pop-wave { display: flex; align-items: center; justify-content: center; height: 48px; padding: 0; border: none; border-radius: var(--r-full);
              background: var(--surface-raised); color: var(--text); cursor: pointer; box-shadow: var(--shadow-flat); transition: background 0.2s, color 0.2s; }
  .pop-sub { margin: 18px 0 8px; }
  /* "What": the box's inputs as light tiles, a check where the switch would be. */
  .input-row { display: flex; gap: var(--tile-gap); overflow-x: auto; padding: 0 16px 16px; overscroll-behavior-x: contain; scrollbar-width: none; }
  .input-row::-webkit-scrollbar { display: none; }
  .input-row .tile-card { flex: none; width: var(--light-tile); }
  .input-row .tile-card.unplugged { opacity: 0.55; }
  .sync-sheet .form-body { padding-bottom: calc(16px + var(--safe-bottom)); }
  /* A row with a 48px disc at 12 (a Sync Box's HDMI inputs): its text still at 72. */
  .rows .item .row-art.disc { display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; background: var(--surface-raised);
                              box-shadow: none; }
  .rows .item .row-art.disc ha-icon { --mdc-icon-size: 24px; }
  :is(.settings-page, .sensor-edit, .choice-sheet, .sensor-sheet) .rows .item:has(> .row-art.disc) { gap: 12px; padding-left: 12px; }
  /* A filled field (the Hue app's "Edit name and icon"): 48 tall, no border. */
  .field.filled { height: 48px; border: none; border-radius: var(--r-xs); background: var(--surface); font-size: var(--fs-body); }
  /* An input's name page ("Edit name and icon"): the types' grid across the page under the field. */
  .name-page .icon-grid { margin: 24px calc(-1 * var(--gutter)) 0; }
  /* An icon grid: three columns of a 40px disc over its name; the chosen one in the accent. */
  .icon-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0 -16px; padding: 8px 0 calc(16px + var(--safe-bottom));
               background: var(--surface-row); box-shadow: var(--shadow-row); }
  .icon-opt { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; min-width: 0; height: 128px; padding: 0 6px;
              border: none; background: none; color: var(--text); cursor: pointer; font-size: var(--fs-footnote); font-weight: 500; text-align: center; }
  .icon-opt .disc { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%;
                    background: var(--surface-raised); transition: background 0.2s, transform var(--t-press) var(--ease); }
  .icon-opt .disc ha-icon { --mdc-icon-size: 24px; }
  .icon-opt:active .disc { transform: scale(var(--press-round)); }
  .icon-opt.on .disc { background: var(--accent); }
  /* An empty state (the Hue app's "No remote configured just yet!"): a centered title, a lead, a picture; its button in the footer. */
  .empty-state { display: flex; flex-direction: column; align-items: center; padding: 20px 4px 0; text-align: center; }
  .empty-state h1.big { margin: 0; font-size: var(--fs-title); white-space: normal; }
  .empty-state .lead { margin: 12px 0 0; font-size: var(--fs-body); color: var(--text-2); }
  .empty-art { display: flex; align-items: center; justify-content: center; width: min(320px, 78%); aspect-ratio: 1; margin-top: 40px; border-radius: 50%;
               background: radial-gradient(circle at 35% 30%, var(--glow-violet), transparent 70%), var(--bar-bottom); }
  .empty-art ha-icon { --mdc-icon-size: 120px; color: var(--info); }
  .palettes { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .palette { display: flex; align-items: center; gap: 10px; padding: 8px 12px 8px 8px; border-radius: var(--r-m); border: 1.5px solid transparent;
             background: var(--surface); cursor: pointer; font-size: var(--fs-footnote); text-align: left; }
  .palette.on { border-color: var(--selected); }
  .palette .art { width: 34px; height: 34px; flex: none; border-radius: 50%; }
  .chips.wrap { flex-wrap: wrap; overflow: visible; }
  .dot-badge.live { background: var(--ok); }
  .hint.warn, .dim.warn, .small.warn { color: var(--warn); }
  .small.error { color: var(--danger); }
  .pill.danger { color: var(--danger); }
  .pill.danger.confirm { background: var(--danger-fill); color: #fff; }
  .rows .item .value-text { max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
  .settings-page .sensor-hero { padding-bottom: 14px; }
`;
