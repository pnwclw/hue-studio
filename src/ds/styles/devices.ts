// Part of the stylesheet (joined in index.ts): motion sensitivity, Settings → Devices, filter chips, a device's settings, "Delete", MotionAware.

export const DEVICES_CSS = `
  /* Motion sensitivity: the level, a stepped slider with the names under its stops, trying it out. */
  .sens-level { margin: 34px 0 18px; text-align: center; }
  .sens-level .label { font-size: var(--fs-footnote); letter-spacing: 2px; text-transform: uppercase; color: var(--text-2); }
  .sens-level .value { margin-top: 4px; font-size: var(--fs-title-3); font-weight: 500; }
  .sens-slider { --r: 13px; position: relative; padding: 0 8px; }
  .sens-slider input { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 30px; margin: 0; background: none; cursor: pointer; }
  .sens-slider input::-webkit-slider-runnable-track { height: 8px; border-radius: var(--r-full);
    background: linear-gradient(to right, var(--accent) calc(var(--r) + (100% - 2 * var(--r)) * var(--f)), rgba(255, 255, 255, 0.14) 0); }
  .sens-slider input::-moz-range-track { height: 8px; border-radius: var(--r-full);
    background: linear-gradient(to right, var(--accent) calc(var(--r) + (100% - 2 * var(--r)) * var(--f)), rgba(255, 255, 255, 0.14) 0); }
  .sens-slider input::-webkit-slider-thumb { -webkit-appearance: none; width: calc(2 * var(--r)); height: calc(2 * var(--r)); margin-top: calc(4px - var(--r));
    border: none; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4); }
  .sens-slider input::-moz-range-thumb { width: calc(2 * var(--r)); height: calc(2 * var(--r)); border: none; border-radius: 50%; background: #fff; }
  /* Names under the stops (long ones wrap); the outer ones line up with the ends of the track. */
  .sens-slider .ticks { position: relative; height: 38px; margin: 6px calc(8px + var(--r)) 0; font-size: var(--fs-callout); line-height: 1.2; color: var(--text-2); }
  .sens-slider .ticks span { position: absolute; top: 0; left: calc(var(--i) * 100%); width: max-content; max-width: 72px; height: auto;
                             transform: translateX(-50%); text-align: center; }
  .sens-slider .ticks span:first-child { transform: translateX(calc(-1 * var(--r) - 8px)); text-align: left; }
  .sens-slider .ticks span:last-child:not(:first-child) { transform: translateX(calc(-100% + var(--r) + 8px)); text-align: right; }
  .sheet .box.sensor-sheet { width: min(100%, 480px); }
  .sheet.bottom .box.sensor-sheet { width: 100%; }
  .sens-try { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 30px 0 4px; font-size: var(--fs-body); color: var(--text-2); }
  .sens-try .dot { flex: none; width: 22px; height: 22px; border-radius: 50%; background: rgba(255, 255, 255, 0.4); transition: background 0.2s, box-shadow 0.2s; }
  .sens-try.moving { color: var(--text); }
  .sens-try.moving .dot { background: var(--accent); box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 30%, transparent); }
  .sens-try.calibrating .dot { animation: calibrate 1.2s ease-in-out infinite; }
  @keyframes calibrate { 50% { opacity: 0.3; transform: scale(0.8); } }
  @container (max-width: 599px) {
    .sensor-edit .rows, .scene-edit .rows { margin-left: calc(-1 * var(--gutter)); margin-right: calc(-1 * var(--gutter)); border-radius: 0; }
  }
  /* Settings → Devices, like the Hue app's: kinds with their counts, then a kind's devices by
     room under a search field and filters; big pictures, "Unreachable" in orange, separators
     from the text on, full-width rows on phones. */
  .bar.sub .round.plus-blue.add-devices { width: 32px; height: 32px; }
  .round.plus-blue.add-devices svg { width: 24px; height: 24px; }
  .add-devices .dot-badge { position: absolute; top: -1px; right: -1px; border: 2px solid var(--bg); }
  .devices-page .notice .dot-badge { margin: 0 4px; }
  .devices-page .notice .go { --mdc-icon-size: 20px; }
  .devices-page .rows.kinds { margin-top: 16px; }
  .devices-page h2.label + .rows { margin-top: 0; }
  .rows.device-list .item .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rows.device-list .item .small.warn { font-weight: 500; }
  .rows.device-list .item .value { color: var(--text-2); }
  .rows.device-list .item .dot-badge.warn { background: var(--warn); }
  .devices-page .device-search { display: flex; height: 38px; margin-top: 12px; padding: 0 14px; border-radius: var(--r-full); }
  :is(.devices-page, .daylight-page) .section-head { margin: 22px 2px 8px; }
  :is(.devices-page, .daylight-page) .section-head .count { margin-right: var(--text-inset); font-size: var(--fs-caption); color: var(--text-2); }
  .daylight-page .chips.filters + .hint { margin-top: 12px; }
  .daylight-page .scene-tiles { margin-top: 12px; }
  .chips.filters { gap: 8px; padding-top: 2px; }
  /* The Hue app's filter chips: grey capitals (not spaced), a white chevron. */
  .chip.filter-chip { height: var(--control); gap: 8px; padding: 0 6px 0 12px; border-radius: var(--r-full); border: none; background: var(--surface-low);
                      color: var(--text-2); font-size: var(--fs-footnote); font-weight: 500; text-transform: uppercase; }
  .chip.filter-chip span { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip.filter-chip ha-icon { --mdc-icon-size: 24px; color: var(--text); }
  .chip.filter-chip.on { background: var(--accent); color: var(--text); }
  @container (max-width: 599px) {
    .rows.device-list { margin-left: calc(-1 * var(--gutter)); margin-right: calc(-1 * var(--gutter)); border-radius: 0; }
  }
  /* A device's settings ("Light settings"): the sensor page's layout, a note, "Delete". */
  .sensor-hero > .small.warn { margin-top: -4px; font-size: var(--fs-footnote); font-weight: 500; }
  .device-edit .rows .item .value { max-width: 50%; text-align: right; }
  /* "Delete" at the bottom of an editor: the pill, outlined in red. */
  .delete-btn { min-width: 80px; height: var(--pill); padding: 0 24px; border: 2px solid var(--danger); border-radius: var(--r-full); cursor: pointer;
                background: var(--danger-tint); color: var(--text); font: inherit; font-size: var(--fs-footnote); font-weight: 500;
                transition: transform var(--t-press) var(--ease), background 0.2s; }
  .delete-btn:active { transform: scale(var(--press-tile)); }
  .delete-btn.confirm { border-color: var(--danger-fill); background: var(--danger-fill); }
  .delete-btn:disabled { opacity: 0.5; }
  /* "Delete" (and "Reset") centered under an editor's rows, the Hue app's. */
  .delete-area { display: flex; flex-direction: column; align-items: center; gap: 12px; margin-top: 40px; }
  .delete-area .hint { max-width: 380px; margin: 0; font-size: var(--fs-footnote); line-height: 1.45; text-align: center; }
  /* MotionAware areas: a row that opens the area beside its switch, the new area's steps,
     the art of "leave the room" and "ready", each light's state. */
  .rows .item > .row-link { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 0; border: none; background: none;
                            font: inherit; color: inherit; text-align: left; cursor: pointer; }
  .ma-health { display: inline-flex; align-items: center; gap: 6px; flex: none; font-size: var(--fs-footnote); color: var(--text-2); }
  .ma-health.ready { color: var(--ok); }
  .ma-health.problem { color: var(--warn); }
  .ma-page .steps-list { margin-top: 18px; }
  .sensor-sheet .rows .item.on[aria-disabled] { cursor: default; }
`;
