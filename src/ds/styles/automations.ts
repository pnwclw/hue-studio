// Part of the stylesheet (joined in index.ts): automation cards and a type's header.

export const AUTOMATIONS_CSS = `
  /* Automation cards, like the Hue app's: picture, "07:00 • Wake up" over "Weekdays", switch. */
  .auto-list { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--card-gap); }
  .auto-list + .rows { margin-top: 10px; }
  /* An automation's card, the Hue app's: 72px tall, a 32px icon, the text from 72px (16 when its type's
     header shows the icon), 16px over 13px. */
  .auto-card { display: flex; align-items: center; gap: 12px; min-height: 72px; padding: 0 16px 0 0; box-sizing: border-box;
               border-radius: var(--r-m); background: var(--surface-low); box-shadow: var(--shadow-flat); }
  .auto-card .row-open { flex: 1; min-width: 0; align-self: stretch; display: flex; align-items: center; gap: 24px; padding: 14px 0 14px 16px;
                         border: none; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .auto-card .row-open ha-icon { flex: none; --mdc-icon-size: 32px; color: var(--text); }
  .auto-card .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .auto-card .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-body); font-weight: 500; line-height: 1.25; }
  .auto-card .sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-footnote); line-height: 1.3; color: var(--text-2); }
  .auto-card .row-open:not(:has(ha-icon)) { gap: 0; }
  .auto-card .start { flex: none; width: var(--control); height: var(--control); background: var(--round); color: var(--text); }
  /* The Automations tab's header of a type (the Hue app's): its icon in a 32px column at 16, the name
     at 72, the count and a round button that folds the type's cards away. */
  .auto-type { display: flex; align-items: center; gap: 24px; height: 48px; margin: 24px 0 4px; padding: 0 var(--text-inset); }
  .page > .auto-type:first-child { margin-top: 8px; }
  .auto-type > ha-icon { width: 32px; justify-content: center; --mdc-icon-size: 28px; }
  .auto-type .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-body); font-weight: 500; }
  .auto-type .count { font-size: var(--fs-footnote); color: var(--text-2); }
  .auto-type .round ha-icon { --mdc-icon-size: 24px; }
  .auto-card .start svg { width: 16px; height: 16px; }
  .automations-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 0 4px; text-align: center; }
`;
