// Part of the stylesheet (joined in index.ts): the QR scanner, sheet sizes, a scene's sheet, the action sheet.

export const OVERLAYS_CSS = `
  /* QR scanner sheet (features/devices/views/qr-scan.ts): the camera, a frame to aim with, what was read */
  .qr-sheet .qr-camera { position: relative; display: flex; align-items: center; justify-content: center; aspect-ratio: 1; overflow: hidden; background: #000; }
  .qr-sheet .qr-camera video { width: 100%; height: 100%; object-fit: cover; }
  .qr-sheet .qr-frame { position: absolute; inset: 20%; border: 3px solid rgba(255, 255, 255, 0.9); border-radius: var(--r-2xl); box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.35); }
  .qr-sheet .qr-camera p { padding: 24px; }
  .qr-sheet .hint { margin: 14px 16px; font-size: var(--fs-body); }
  .qr-sheet .hint.ok { color: var(--ok); }
  .qr-sheet .center { padding: 0 16px 16px; }
  .sensor-sheet .tick { display: flex; color: var(--accent); }
  .sensor-sheet .big-value { margin: 4px 2px 10px; font-size: var(--fs-title); font-weight: 700; }
  .sensor-sheet .sheet-bar { padding: 12px 16px; font-size: var(--fs-body); }
  .sensor-sheet .sheet-bar .pill.save { padding: 0 16px; }
  /* Phones: the sheet comes up from the bottom, like the Hue app's. */
  .sheet.bottom { align-items: flex-end; padding: 0; }
  .sheet.bottom .box { width: 100%; max-width: none; border-radius: var(--r-m) var(--r-m) 0 0; animation: rise 0.3s var(--ease); }
  /* A sheet that fills the screen under the status bar (the Hue app's "Power on", "Device info"). */
  .sheet.bottom.tall { align-items: stretch; padding-top: calc(var(--safe-top) + 8px); }
  .sheet.bottom.tall .box { height: 100%; }
  main.as-sheet .sheet.bottom.tall { padding-top: 0; }
  /* A scene's card (scene-pick.ts), the Hue app's (measured on its gallery's at 411): 26 from the
     screen's sides; the picture 16:9 with the name and close; the colors on a lighter strip (72)
     with shuffle and the pencil; "Save to my scenes" and "Set once" on the rows' grey, 32px
     pills in capitals as wide as the wider one. "Copy to…" adds the room or zone between them. */
  hue-studio-scene-pick { display: contents; }
  .sheet.scene-pick { padding: 16px 26px; }
  .scene-pick .box { width: min(100%, 420px); padding-bottom: 0; }
  .scene-pick .pic { aspect-ratio: 16 / 9; }
  .scene-pick .pic h3 { font-size: var(--fs-title-1); }
  .scene-pick .pic .name-input { position: absolute; left: 16px; right: 60px; bottom: 12px; z-index: 1; font-size: var(--fs-title-1); font-weight: 700; }
  .scene-pick .dots { gap: 8px; height: 72px; padding: 0 12px; box-sizing: border-box; background: var(--surface-low); }
  .scene-pick .dots i { width: 32px; height: 32px; margin-left: -18px; }
  .scene-pick .dots i:first-child { margin-left: 0; }
  .scene-pick .dots .round { flex: none; background: var(--round); color: var(--text); }
  .scene-pick .dots .shuffle { margin-left: auto; }
  .scene-pick h2.label { margin: 16px 18px 8px; }
  .scene-pick .target-row { display: flex; align-items: center; gap: 24px; width: calc(100% - 32px); margin: 0 16px 18px; min-height: 68px;
                            padding: 0 20px; box-sizing: border-box; border: none; border-radius: var(--r-m); background: var(--surface-2); color: var(--text);
                            font: inherit; font-size: var(--fs-body); text-align: left; cursor: pointer; box-shadow: var(--shadow-raised); }
  .scene-pick .target-row ha-icon { --mdc-icon-size: 28px; }
  .scene-pick .actions { display: grid; grid-template-columns: max-content; justify-content: center; gap: 12px; padding: 12px; background: var(--surface-row); }
  .scene-pick .actions .pill { width: 100%; min-width: 0; height: var(--control); padding: 0 14px; background: var(--round); letter-spacing: 0.3px; text-transform: uppercase; }
  .scene-pick .actions .pill.outline { background: transparent; box-shadow: inset 0 0 0 2px var(--separator); }
  /* An action sheet, the Hue app's: centered rows, the red one, "Cancel" under a line. */
  /* An action sheet over the screen blurred and dimmed (the Hue app's; other sheets are a plain dim). */
  .sheet.menu { background: var(--scrim-blur); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); }
  .sheet.menu.bottom { padding: 0 var(--gutter) calc(10px + var(--safe-bottom)); }
  .sheet.menu.bottom .box { border-radius: var(--r-2xl); }
  .action-sheet { display: flex; flex-direction: column; padding: 4px 0; background: var(--surface-row); }
  .action-sheet button { min-height: 56px; border: none; background: none; color: var(--text); font: inherit; font-size: var(--fs-body); cursor: pointer; }
  .action-sheet button:active { background: var(--hairline); }
  /* Centered rows across the sheet (not a dropdown menu's). */
  .menu .action-sheet button { justify-content: center; padding: 0 16px; border-radius: 0; text-align: center; }
  .action-sheet button.danger { color: var(--danger); }
  .action-sheet .note { margin: 0; padding: 14px 16px; border-bottom: 1px solid var(--separator); font-size: var(--fs-footnote); line-height: 1.4;
                        color: var(--text-2); text-align: center; }
  .action-sheet button.cancel { border-top: 1px solid var(--separator); font-size: var(--fs-footnote); font-weight: 500; text-transform: uppercase; letter-spacing: 0.3px; }
  .sheet.bottom .sensor-sheet .form-body { padding-bottom: calc(20px + var(--safe-bottom)); }
  @keyframes rise { from { transform: translateY(40%); opacity: 0; } }
`;
