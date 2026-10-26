// Part of the stylesheet (joined in index.ts): the scene editor, a new scene, moving steps, a room's "+" picker, text fields.

export const EDITORS_CSS = `
  /* Scene editor, the Hue app's: the top (header, picture, name, brightness) tinted with the
     scene's colors, fading into the page; the rows below on their own. */
  .scene-edit { padding-bottom: calc(28px + var(--safe-bottom)); }
  .scene-tint { position: absolute; top: 0; left: 0; right: 0; height: 460px; z-index: 0; pointer-events: none; background: var(--scene-tint);
                -webkit-mask-image: linear-gradient(#000 40%, transparent); mask-image: linear-gradient(#000 40%, transparent); }
  hue-studio-scene-view > .screen-body { position: relative; z-index: 1; }
  .screen-head.scene-head, .screen-head.scene-head:has(> .bar.sub) { background: rgba(255, 255, 255, 0.07); border-bottom-color: var(--hairline); }
  .scene-head .bar .pill { background: var(--fill-light); }
  .scene-top { padding: 16px 2px 6px; }
  .scene-top .name-row { margin: 14px 0 12px; }
  .scene-top h1.big { font-size: var(--fs-large); }
  .scene-top .round.rename { background: rgba(255, 255, 255, 0.14); color: var(--text); }
  .scene-edit .dot.big { width: 48px; height: 48px; border-radius: 50%; background: var(--surface-raised) center / cover no-repeat;
                         box-shadow: var(--shadow-dot); }
  .rows.scene-brightness { background: rgba(255, 255, 255, 0.09); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
  .scene-brightness .item.col { display: block; padding: 30px 16px 32px; }
  .scene-brightness .line { display: flex; justify-content: space-between; font-size: var(--fs-body); font-weight: 500; }
  .scene-brightness .line .dim { font-weight: 400; color: var(--text-2); }
  .scene-brightness .slider { margin-top: 30px; }
  .scene-edit .rows.scene-lights { margin-top: 22px; }
  .scene-lights .light-row { margin: 0; padding: 0 var(--gutter) 20px; }
  .scene-lights .lights-head .pill.shuffle { display: inline-flex; align-items: center; gap: 8px; height: 32px; }
  .scene-lights .lights-head .pill.shuffle svg { width: 18px; height: 18px; }
  /* A new scene (the Hue app's "Custom scene"): on a picker's panel, its cards rounded and 20px in,
     "Save" (the accent) at the bottom over a line. */
  .scene-new .scene-top { padding: 12px var(--text-inset) 6px; }
  .page.scene-new .rows { margin-left: 0; margin-right: 0; border-radius: var(--r-m); }
  .page.scene-new .rows.scene-lights { margin-top: 20px; }
  .page.scene-new > .hint { margin: 16px var(--text-inset) 0; }
  .screen-foot { flex: none; display: flex; justify-content: center; padding: 15px 16px calc(16px + var(--safe-bottom));
                 border-top: 1px solid var(--separator); background: var(--bg); }
  .name-sheet .name-field { position: relative; display: flex; align-items: center; }
  .name-sheet .name-field .field { padding-right: 44px; }
  .name-sheet .name-field .round { position: absolute; right: 8px; }
  .scene-edit > .center { margin-top: 40px; }
  .scene-edit > .center + .delete-area { margin-top: 12px; }
  .name-row { display: flex; align-items: center; gap: 12px; margin: 10px 0 18px; }
  .name-row h1.big { flex: 1; min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; }
  .name-input { flex: 1; min-width: 0; height: 42px; padding: 0 12px; border: none; border-radius: var(--r-m); font: inherit; font-size: var(--fs-title-2);
                font-weight: 700; color: inherit; background: rgba(0, 0, 0, 0.25); outline: none; }
  .hero.dark-text .name-input { background: rgba(255, 255, 255, 0.4); }
  .section-head { display: flex; align-items: center; justify-content: space-between; margin-top: 22px; }
  .section-head h2.label { margin: 0 var(--text-inset); }
  /* The room's bridge, with several bridges: next to "Lights". */
    background: var(--info-tint); text-align: center; }
  .rows .item > .spinner { flex: none; margin: 0 2px; }
  .sheet .sheet-actions { padding: 14px 0 0; }
  .notice.warn ha-icon { flex: none; color: var(--warn); }
  .zone-bridges { margin: 14px 16px 0; }
  .pill.shuffle { display: inline-flex; align-items: center; gap: 8px; }
  .pill.shuffle svg { width: 18px; height: 18px; }
  .section-head + .grid { margin-top: 10px; }
  .center { display: flex; justify-content: center; margin-top: 28px; }
  .pill.reset.confirm { background: var(--danger-fill); }
  .center.stack { flex-direction: column; align-items: center; gap: 12px; }
  .pill.reset.danger { color: var(--danger); }
  .pill.reset.danger.confirm { color: #fff; }
  .sheet .form-body { padding: 16px 16px 0; }
  /* A room's "+" (the Hue app's): a picker over the whole panel, the question over picture tiles. */
  main > :has(.add-picker) { position: static; }
  .add-picker { position: absolute; inset: 0; z-index: 30; display: flex; flex-direction: column;
                background: linear-gradient(100deg, var(--picker-top), var(--picker-top-2) 60%); }
  .add-picker > .bar { flex: none; padding: max(6px, var(--safe-top)) 16px 6px; }
  .add-panel { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 20px 20px calc(28px + var(--safe-bottom));
               border-radius: var(--r-2xl) var(--r-2xl) 0 0; background: var(--bg); box-shadow: inset 0 1px 0 var(--surface-low); }
  .add-panel > * { max-width: 560px; margin-left: auto; margin-right: auto; }
  .add-panel h1.big { margin: 6px var(--text-inset) 0; font-size: var(--fs-title); }
  .add-panel .lead { margin: 12px var(--text-inset) 0; font-size: var(--fs-body); color: var(--text-2); }
  .pick-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--card-gap); margin-top: 24px; }
  .pick-tile { display: flex; flex-direction: column; align-items: center; height: 156px; padding: 16px 12px 0; border: none; border-radius: var(--r-m);
              background: var(--surface); box-shadow: var(--shadow-flat); color: var(--text); font: inherit; cursor: pointer;
              transition: transform var(--t-press) var(--ease); }
  .pick-tile:active { transform: scale(var(--press-tile)); }
  .pick-tile .disc { flex: none; display: flex; align-items: center; justify-content: center; width: 72px; height: 72px; border-radius: 50%; background: var(--bar-bottom); }
  .pick-tile .disc ha-icon { --mdc-icon-size: 40px; }
  .pick-tile .name { flex: 1; display: flex; align-items: center; text-align: center; font-size: var(--fs-body); font-weight: 500; line-height: 1.2; }
  /* A scene's ways: the picture at the top left, the name at the bottom. */
  .pick-tile.way { align-items: flex-start; justify-content: space-between; height: 108px; padding: 16px; }
  .pick-tile.way .art { display: flex; height: 32px; align-items: center; }
  .pick-tile.way .art ha-icon { --mdc-icon-size: 28px; }
  .pick-tile.way .dots-three { height: 32px; }
  .pick-tile.way .name { flex: none; text-align: left; font-size: var(--fs-callout); }
  .sheet .field, .page .field { width: 100%; box-sizing: border-box; height: 44px; padding: 0 12px; border: none; border-radius: var(--r-m); font: inherit;
                  font-size: var(--fs-headline); color: inherit; background: var(--fill-soft); outline: none; }
  /* The Hue app's text field (a name, an address, a code): 46px, outlined, on a surface. */
  .field.outlined { height: 46px; border: 1.5px solid var(--outline); border-radius: var(--r-xs); background: var(--surface); font-size: var(--fs-body); }
  .sheet .hint { margin: 10px 2px 0; font-size: var(--fs-footnote); line-height: 1.45; color: var(--text-2); }

`;
