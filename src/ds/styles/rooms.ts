// Part of the stylesheet (joined in index.ts): rooms and zones, the Sync bar, the gallery's rules, the check.

export const ROOMS_CSS = `
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
  /* A check: one round tick box everywhere (rows, choice lists, the light picker's rooms: all or some). */
  :is(.check, .pick-check) { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; flex: none; box-sizing: border-box;
                             border: 1.5px solid var(--text-3); border-radius: 50%; color: #fff; transition: background 0.2s, border 0.2s; }
  :is(.check, .pick-check) svg { width: 16px; height: 16px; fill: currentColor; opacity: 0; }
  :is(.on > .check, .check.on, .pick-check.all, .pick-check.some) { border-color: var(--accent); background: var(--accent); }
  :is(.on > .check, .check.on, .pick-check.all, .pick-check.some) svg { opacity: 1; }
`;
