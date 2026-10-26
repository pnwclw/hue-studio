// Part of the stylesheet (joined in index.ts): rows that open, a sensor's settings.

export const SENSOR_CSS = `
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
  .sensor-sheet .rows { margin: 0 -16px; border-radius: 0; background: var(--surface-row); }
  .sensor-sheet .form-body { padding-bottom: 16px; }
  .sensor-sheet .hint { margin: 8px 0 24px; font-size: var(--fs-body); }
`;
