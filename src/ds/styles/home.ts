// Part of the stylesheet (joined in index.ts): home's room cards and the tab bar.

export const HOME_CSS = `
  /* home: room cards */
  .cards { display: grid; gap: var(--card-gap); }
  /* The Hue app's room card: its icon in a column of its own, the name well clear of it. */
  .card > .row { gap: 27px; }
  .card > .row > ha-icon { width: 28px; justify-content: center; --mdc-icon-size: 28px; }
  .card > .slider { margin-top: 20px; }
  .card { padding: 18px 18px 14px; border-radius: var(--r-m); cursor: pointer; box-shadow: var(--shadow-raised);
          transition: transform var(--t-press) var(--ease), color 0.3s var(--ease); }
  .card:active { transform: scale(var(--press-card)); }
  .card.unavailable { opacity: 0.45; }
  .row { display: flex; align-items: center; gap: 12px; }
  .row .text { flex: 1; min-width: 0; }
  .row .name { font-size: var(--fs-body); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { display: flex; align-items: center; gap: 8px; font-size: var(--fs-caption); opacity: 0.7; min-height: 0; }
  .meta:empty { display: none; }
  .meta .motion { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 6px var(--ok); }

  /* tab bar */
  /* The Hue app's: no line, the page fading into the bar's near-black. */
  nav.tabs { flex: none; display: flex; justify-content: center; gap: 4px; padding: 4px 8px max(4px, var(--safe-bottom));
             background: linear-gradient(var(--bg), var(--bar-bottom) 40px); }
  nav.tabs[hidden] { display: none; }
  /* Under a sheet the tab bar is dimmed like the rest (an action sheet's blurred too); a sheet
     that fills the screen covers it. */
  main:has(.sheet) + nav.tabs { pointer-events: none; filter: brightness(0.3); }
  main:has(.sheet.menu) + nav.tabs { filter: brightness(0.5) blur(16px); }
  main:has(:is(.sheet.tall, .add-picker)) + nav.tabs { display: none; }
  /* The on-screen keyboard is up (fitToViewport): it covers the tab bar and the home indicator,
     and dialogs move up so their fields stay above it. */
  :host([keyboard]) { --safe-bottom: 0px; }
  :host([keyboard]) nav.tabs:not(.top) { display: none; }
  :host([keyboard]) .sheet { align-items: flex-start; padding-top: max(16px, calc(var(--safe-top) + 8px)); }
  nav.tabs button { flex: 0 1 120px; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 5px 0 4px; border: none;
                    background: none; cursor: pointer; color: var(--tab-off); font-size: var(--fs-tab); letter-spacing: 0.4px; text-transform: uppercase;
                    transition: color 0.2s; }
  nav.tabs button svg { width: 26px; height: 26px; }
  nav.tabs button.on { color: var(--tab-on); }
  /* tabs on top while the experimental footer sits at the bottom */
  nav.tabs.top { order: -1; gap: 4px;
                 padding: max(8px, var(--safe-top)) 12px 8px; border-top: none; border-bottom: 1px solid var(--hairline); }
  nav.tabs.top button { flex: 1 1 0; min-width: 0; flex-direction: row; justify-content: center; gap: 5px; padding: 7px 8px;
                        border-radius: var(--r-m); font-size: var(--fs-caption); letter-spacing: 0; text-transform: none;
                        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  nav.tabs.top button svg { flex: none; }
  nav.tabs.top button svg { width: 18px; height: 18px; }
  nav.tabs.top button.on { background: var(--surface); }
  main.under-footer { padding-bottom: var(--safe-bottom); }
  main.under-footer .topbar, main.under-footer .screen-head { padding-top: 6px; }

`;
