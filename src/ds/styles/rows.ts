// Part of the stylesheet (joined in index.ts): list rows of settings and editors.

export const ROWS_CSS = `
  /* Settings and automations, like the Hue app's (the look of Settings → Devices and a
     MotionAware area): big rows, full width on phones, separators from the text on; a row says
     what is chosen and opens the list (ds/choice.ts): a sheet for one value, a screen for
     several. */
  /* A list row (settings, editors, devices; choices in sheets): at least 72px, its icon centered 32px in (an
     MDI glyph at 28 fills 24 like the Hue app's), the text
     from 72px, a medium 16px title over a 12px regular line, separators from the text on. */
  :is(.settings-page, .sensor-edit, .choice-sheet, .sensor-sheet) .rows .item, .rows.device-list .item {
    min-height: var(--row-h); gap: 26px; padding: 12px 16px 12px 18px; font-size: var(--fs-body); }
  :is(:is(.settings-page, .sensor-edit, .choice-sheet, .sensor-sheet) .rows, .rows.device-list) .item > ha-icon:first-child {
    flex: none; display: flex; justify-content: center; width: var(--row-icon); --mdc-icon-size: var(--row-icon); color: var(--text); }
  .rows.device-list .item { gap: 24px; padding-left: 16px; }
  .rows.device-list .item > ha-icon:first-child { width: 32px; --mdc-icon-size: 32px; }
  :is(:is(.settings-page, .sensor-edit, .choice-sheet, .sensor-sheet) .rows, .rows.device-list) .item :is(.dim.small, .small) { margin-top: 2px; font-size: var(--fs-caption); }
  :is(:is(.settings-page, .sensor-edit, .choice-sheet, .sensor-sheet) .rows, .rows.device-list) .item :is(.value, .value-text) { font-size: var(--fs-footnote); }
  /* Row titles are medium (the Hue app's); what a row says under or beside its title stays regular. */
  :is(.settings-page, .sensor-edit, .choice-sheet, .sensor-sheet) .rows .item, .rows.device-list .item { font-weight: 500; }
  :is(.settings-page, .sensor-edit, .choice-sheet, .sensor-sheet) .rows .item :is(.dim, .small, .value, .value-text, input),
  .rows.device-list .item :is(.dim, .small, .value) { font-weight: 400; }
  :is(:is(.settings-page, .sensor-edit, .choice-sheet, .sensor-sheet) .rows, .rows.device-list) .item + .item { position: relative; border-top: none; }
  :is(:is(.settings-page, .sensor-edit, .choice-sheet, .sensor-sheet) .rows, .rows.device-list) .item + .item::before {
    content: ""; position: absolute; top: 0; left: 16px; right: 0; height: 1px; background: var(--separator); }
  :is(:is(.settings-page, .sensor-edit, .choice-sheet, .sensor-sheet) .rows, .rows.device-list) .item + .item:has(> :is(ha-icon, .row-art, .thumb, .tag-pic):first-child)::before {
    left: var(--row-text); }
  .settings-page .section-head h2.label { margin: 0 var(--text-inset); }
  .settings-page > h2.label:first-child, .settings-page .tab-title + h2.label { margin-top: 18px; }
  .settings-page .lead { font-size: var(--fs-callout); }
  .settings-page .hint { margin: 10px 2px 0; font-size: var(--fs-footnote); line-height: 1.45; color: var(--text-2); }
  .settings-page .hint.warn { color: var(--warn); }
  /* The automation editor's rows have no icons, like the Hue app's; its type's icon sits by the name. */
  .automation-page .rows .item > ha-icon:first-child { display: none; }
  .automation-page .rows:not(.device-list) .item { gap: 16px; padding-left: 16px; }
  .automation-page .rows:not(.device-list) .item + .item::before,
  .automation-page .rows:not(.device-list) .item + .item:has(> :is(ha-icon, .row-art, .thumb, .tag-pic):first-child)::before { left: 16px; }
  .automation-page .name-row .type-icon { --mdc-icon-size: 28px; color: var(--text); }
`;
