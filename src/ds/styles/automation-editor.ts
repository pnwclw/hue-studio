// Part of the stylesheet (joined in index.ts): the automation editor: type cards, its head, times, lights, fades, the light picker, checklists.

export const AUTOMATION_EDITOR_CSS = `
  /* "+": a picture card for each automation type, like the Hue app's. */
  h1.big.new-question { margin: 8px 2px 18px; font-size: var(--fs-title); }
  .type-cards { display: grid; gap: 12px; }
  main.wide .type-cards { grid-template-columns: 1fr 1fr; }
  .type-card { position: relative; display: block; width: 100%; height: 172px; padding: 0; border: none; border-radius: var(--r-m); overflow: hidden;
               background: var(--bg); color: #fff; font: inherit; text-align: left; cursor: pointer; transition: transform var(--t-press) var(--ease); }
  .type-card:active { transform: scale(var(--press-card)); }
  .type-card svg.art { position: absolute; inset: 0; width: 100%; height: 100%; }
  .type-card::after { content: ""; position: absolute; inset: 30% 0 0; background: linear-gradient(transparent, rgba(0, 0, 0, 0.66)); }
  .type-card .text { position: absolute; left: 16px; right: 16px; bottom: 14px; z-index: 1; display: flex; flex-direction: column; gap: 3px; }
  .type-card .title { font-size: var(--fs-title-3); font-weight: 500; }
  .type-card .sub { font-size: var(--fs-body); line-height: 1.3; color: rgba(255, 255, 255, 0.82); }
  /* The custom one (Home Assistant's editor) stands out: outlined, an arrow out of the panel. */
  .type-card.custom::before { content: ""; position: absolute; inset: 0; z-index: 2; border-radius: inherit; pointer-events: none;
                              border: 1.5px solid rgba(160, 196, 255, 0.95); }
  .type-card .open { position: absolute; top: 12px; right: 12px; z-index: 1; --mdc-icon-size: 20px; color: rgba(255, 255, 255, 0.9); }
  /* The editor's head, like the Hue app's: the type's icon over the name. */
  .automation-page .automation-hero > .type-icon { --mdc-icon-size: 40px; color: var(--text); margin: 4px 0 2px; }
  .automation-page .automation-hero h1.big { font-size: var(--fs-large); }
  .lights-card .lights-head .round.add { background: var(--accent); color: #fff; }
  /* A time of day on its wheels in place (wake up, go to sleep): the title over them. */
  .automation-page .rows .item.time-item { display: block; padding: 12px 8px 6px 16px; }
  .automation-page .rows .item.time-item .wheels { margin: 4px 0 0 -8px; }
  .automation-page .rows .item.time-item .wheels::before { border-radius: var(--r-s); }
  .automation-page .hint + .rows { margin-top: 16px; }
  /* A group after a hint (a switch on its own with its hint, the Hue app's): 20 under it. */
  .settings-page .hint + .rows { margin-top: 20px; }
  /* Selected lights, like the Hue app's: a card with its pencil, a tile for each room or zone. */
  .lights-card .item.lights-head { min-height: var(--row-h); }
  .lights-card .lights-head .round { background: var(--round); color: var(--text); }
  .lights-card .lights-head .round svg { width: 18px; height: 18px; }
  .place-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; padding: 2px 12px 14px; }
  .place-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; padding: 14px 14px 12px; border: none;
                border-radius: var(--r-m); background: var(--surface-2); color: var(--text); font: inherit; text-align: left; cursor: pointer;
                transition: transform var(--t-press) var(--ease); }
  .place-tile:active { transform: scale(var(--press-tile)); }
  .place-tile ha-icon { --mdc-icon-size: 28px; margin-bottom: 14px; }
  .place-tile .name { max-width: 100%; font-size: var(--fs-body); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .place-tile .sub { max-width: 100%; font-size: var(--fs-footnote); color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .place-tile.gone .sub { color: var(--warn); }
  .lights-card .lights-empty .warn { font-weight: 400; font-size: var(--fs-body); }
  /* The fade sheet: minutes and the time they lead to, a slider with its scale under it. */
  .fade-sheet .fade-body { padding: 22px 20px calc(22px + var(--safe-bottom)); }
  .fade-values { display: flex; justify-content: space-around; text-align: center; }
  .fade-values .caps { font-size: var(--fs-caption); font-weight: 500; letter-spacing: 1.4px; text-transform: uppercase; color: var(--text-2); }
  .fade-values .big-value { margin-top: 4px; font-size: var(--fs-headline); font-weight: 500; font-variant-numeric: tabular-nums; }
  .fade-sheet .fade-slider { height: 8px; margin: 30px 8px 0; border-radius: var(--r-full); background: rgba(255, 255, 255, 0.16); }
  .fade-sheet .fade-slider .fill { border-radius: var(--r-full); background: linear-gradient(90deg, #0a3fb8, var(--accent)); }
  .fade-sheet .fade-slider .knob { width: 18px; height: 18px; }
  .fade-ticks { display: flex; justify-content: space-between; margin: 14px 0 0; font-size: var(--fs-caption); color: var(--text-2); font-variant-numeric: tabular-nums; }
  .fade-ticks span { width: 16px; text-align: center; }
  /* "Turn off after": the slider sets the row with the tick (every part of the day, or one of them). */
  .off-sheet .fade-body { max-height: min(70dvh, 620px); overflow-y: auto; overscroll-behavior: contain; }
  .off-sheet .off-phases { margin-top: 10px; border-radius: var(--r-m); background: var(--surface-row); }
  .off-sheet .off-phases .item { min-height: 52px; }
  .off-sheet .off-phases .value { color: var(--text-2); }
  .off-sheet .off-phases .value.own { color: var(--text); }
  .off-sheet .center { margin-top: 12px; }
  .off-sheet .hint { margin: 22px 2px 0; }
  /* The light picker ("Edit lights"): a room's check (whole, some, none), its lights in a strip. */
  .sheet .box.lights-sheet { display: flex; flex-direction: column; width: min(100%, 520px); max-height: min(100%, 760px); }
  .sheet.bottom .box.lights-sheet { width: 100%; max-height: calc(100% - var(--safe-top) - 24px); }
  .lights-sheet .lights-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 0 calc(18px + var(--safe-bottom)); }
  .lights-sheet h2.label { margin: 18px 16px 8px; }
  .lights-sheet .rows.pick-rows { border-radius: 0; background: var(--surface-row); }
  .pick-room + .pick-room { border-top: 1px solid var(--separator); }
  .pick-room > .item { display: flex; align-items: center; gap: 4px; min-height: var(--row-h); padding: 0 14px 0 4px; }
  .pick-toggle, .pick-name { border: none; background: none; color: inherit; font: inherit; cursor: pointer; padding: 0; }
  .pick-toggle { display: flex; align-items: center; justify-content: center; width: 52px; height: 52px; flex: none; }
  .pick-name { flex: 1; min-width: 0; height: 68px; display: flex; align-items: center; text-align: left; font-size: var(--fs-body); font-weight: 500; }
  .pick-name .grow { display: flex; flex-direction: column; min-width: 0; }
  .pick-name .dim.small { font-size: var(--fs-footnote); font-weight: 400; }
  .pick-check i { width: 10px; height: 2px; border-radius: var(--r-full); background: #fff; }
  .pick-room .round.expand { background: var(--fill-light); color: var(--text); }
  .pick-room .round.expand ha-icon { --mdc-icon-size: 22px; justify-content: center; transition: transform 0.2s var(--ease); }
  .pick-room .round.expand.open ha-icon { transform: rotate(180deg); }
  .pick-lights { display: flex; gap: 10px; padding: 2px 16px 16px 56px; overflow-x: auto; overscroll-behavior: contain; scrollbar-width: none; }
  .pick-lights::-webkit-scrollbar { display: none; }
  /* The tiles stand out from the sheet: lighter than its rows, a hairline round them. */
  .pick-lights .tile-card { flex: none; width: var(--light-tile); --zone: 44px; background: var(--surface-raised); box-shadow: none;
                            border: 1px solid var(--separator); }
  .pick-lights .tile-card > .switch-zone { background: rgba(0, 0, 0, 0.22); border-top-color: var(--hairline); }
  .pick-lights .tile-card.on { border-color: rgba(10, 98, 255, 0.7); }
  /* Going to sleep: "Start" by the time's switch, always there. */
  .automation-page .rows .item.time-switch { gap: 12px; }
  .automation-page .pill.start { display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 14px 0 10px; }
  .automation-page .pill.start svg { width: 16px; height: 16px; }
  /* Before arriving and leaving: a checklist of what HA needs. */
  .presence-rows { margin-top: 14px; }
  .presence-rows .item .pill { flex: none; height: 32px; }
  .presence-rows .check-ok { display: flex; flex: none; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%;
                             background: var(--ok); color: #fff; }
  .presence-rows .check-ok svg { width: 16px; height: 16px; }
  .presence-rows .check-warn { flex: none; --mdc-icon-size: 24px; color: var(--warn); }
  .settings-page .rows + .rows { margin-top: 16px; }
  .rows .item .value { flex: none; max-width: 48%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; color: var(--text-2); }
`;
