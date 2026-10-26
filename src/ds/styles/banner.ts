// Part of the stylesheet (joined in index.ts): the banner.

export const BANNER_CSS = `
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
  .page > .banner:first-child, .rows + .banner, .banner + .rows { margin-top: 14px; }
  .mismatch { margin: 0 0 10px; padding: 12px 14px; border-radius: var(--r-m); background: var(--warn-tint); }
  .mismatch p { margin: 0; font-size: var(--fs-callout); line-height: 1.4; }
  .mismatch .buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }

  .toast { position: absolute; left: 50%; bottom: 76px; z-index: 20; max-width: calc(100% - 48px); padding: 10px 16px; border-radius: var(--r-m);
           background: rgba(60, 60, 64, 0.96); font-size: var(--fs-callout); transform: translate(-50%, 16px); opacity: 0; pointer-events: none;
           transition: opacity 0.2s, transform 0.25s var(--spring); }
  .toast.on { opacity: 1; transform: translate(-50%, 0); }


`;
