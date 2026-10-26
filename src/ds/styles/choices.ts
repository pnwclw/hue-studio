// Part of the stylesheet (joined in index.ts): choice rows, the time screen and its wheels, a screen's hero, days, the save area.

export const CHOICES_CSS = `
  /* A row that opens a choice: its title over one caption line, the value cut short before either wraps. */
  .rows .item.nav .grow { min-width: 0; }
  .rows .item.nav .grow > .small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rows .item.nav .value { max-width: 42%; }
  .rows .item.nav .chevron, .settings-page .rows .item .chevron { flex: none; margin: 0 -6px 0 -8px; --mdc-icon-size: 20px; color: var(--text-2); }
  .rows .item .row-art { flex: none; width: 24px; height: 24px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15); }
  /* A choice's 40px picture (the Hue app's "Power on"): its text still at 72. */
  .rows .item .row-art.pic { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: var(--bar-bottom); box-shadow: none; }
  .rows .item .row-art.pic ha-icon { --mdc-icon-size: 24px; }
  :is(.choice-sheet, .sensor-sheet) .rows .item:has(> .row-art.pic) { gap: 16px; padding-left: 16px; }
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
  .settings-page .save-area .pill.apply { min-width: 180px; }
  .settings-page .save-area .lead { margin: 4px 0 0; text-align: center; }
  @container (max-width: 599px) {
    .settings-page .rows { margin-left: calc(-1 * var(--gutter)); margin-right: calc(-1 * var(--gutter)); border-radius: 0; }
    .settings-page .scene-tiles, .settings-page .today { margin-left: 0; margin-right: 0; }
  }

  @container (min-width: 600px) {
    .cards { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
    .grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
`;
