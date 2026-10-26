// Part of the stylesheet (joined in index.ts): sheets and dialogs, the scrim.

export const SHEETS_CSS = `
  /* scene sheet / dialogs */
  .sheet { position: absolute; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; padding: 16px; animation: fade 0.2s ease; }
  /* One scrim under every overlay (sheets, popovers, the brightness slider): the Hue app's plain dim, no blur. */
  :is(.sheet, .pop-layer, .bri-layer) { background: var(--scrim); }
  /* A sheet, the Hue app's: its bar a shade lighter with a long shadow over a body in the page's color, groups of rows across it. */
  .sheet .box { width: min(100%, 400px); max-height: 100%; overflow: auto; border-radius: var(--r-m); background: var(--bg);
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

`;
