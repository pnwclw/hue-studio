// Part of the stylesheet (joined in index.ts): arranging lights, a bridge's link pictures.

export const SPACE_CSS = `
  /* arrange lights */
  .room { position: relative; width: min(100%, 560px); aspect-ratio: 1; margin: 14px auto 0; border-radius: var(--r-2xl); touch-action: none;
          background: linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px) 6% 6% / 22% 22%,
                      linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px) 6% 6% / 22% 22%, var(--surface);
          box-shadow: inset 0 0 0 1px var(--separator); }
  .room.locked { opacity: 0.6; }
  .edge-label { margin: 8px 0 0; text-align: center; font-size: var(--fs-tab); letter-spacing: 1.2px; text-transform: uppercase; color: var(--text-2); }
  .edge-label + .room { margin-top: 6px; }
  .room .links { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .room .links line { stroke: rgba(255, 255, 255, 0.45); stroke-width: 0.8; stroke-dasharray: 2 1.5; }
  .spot { position: absolute; width: 38px; height: 38px; margin: -19px 0 0 -19px; padding: 0; border: 2px solid rgba(255, 255, 255, 0.85);
         border-radius: 50%; cursor: grab; display: flex; align-items: center; justify-content: center; background: var(--pin);
         color: #fff; box-shadow: var(--shadow-dot); touch-action: none; transition: transform var(--t-press) var(--ease); }
  .spot ha-icon { --mdc-icon-size: 18px; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6)); }
  .spot.on { transform: scale(1.18); border-color: var(--selected); box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.35), var(--shadow-dot); }
  .spot:active { cursor: grabbing; }
  .rows.height { margin-top: 14px; }
  .height-line { align-items: center; margin-top: 10px; }
  .height-line input { flex: 1; accent-color: #fff; }
  .center-text { text-align: center; margin-top: 12px; }
  .rows button.item:disabled { opacity: 0.5; }

  .steps-list { margin: 10px 0 0; padding: 0; list-style: none; }
  .steps-list .item { align-items: flex-start; font-size: var(--fs-body); line-height: 1.4; }
  .step-no { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex: none; margin-top: 1px; border-radius: 50%;
             background: var(--fill-strong); font-size: var(--fs-caption); font-weight: 500; }
  .spinner { width: 12px; height: 12px; flex: none; box-sizing: border-box; border: 2px solid rgba(235, 235, 245, 0.25); border-top-color: var(--text-2);
             border-radius: 50%; animation: spin 0.9s linear infinite; }
  .spinner.big { width: 28px; height: 28px; border-width: 3px; }
  .link-state { display: flex; flex-direction: column; align-items: center; max-width: 420px; margin: 28px auto 0; text-align: center; }
  .link-state .lead { margin: 6px 0 0; }
  .link-title { margin: 18px 0 0; font-size: var(--fs-headline); font-weight: 500; line-height: 1.25; }
  .bridge-art { width: 100%; height: 100%; }
  .bridge-art .body { fill: #e9e9ee; }
  .bridge-art .button { fill: #f6f6f9; stroke: rgba(0, 0, 0, 0.08); stroke-width: 1.5; }
  .bridge-art .ring { fill: none; stroke: var(--info); stroke-width: 4; opacity: 0; transform-origin: 60px 60px; }
  .flow-ring > span.art-icon { display: block; width: 150px; height: 150px; }
  .flow-ring > span.art-icon.press .ring { animation: bridge-press 1.6s var(--ease) infinite; }
  /* Searching without a known end: the accent arc goes round. */
  .flow-ring.spin > svg { animation: spin 1.4s linear infinite; }
  @keyframes bridge-press { 0% { opacity: 0.9; transform: scale(0.75); } 100% { opacity: 0; transform: scale(1.35); } }
  @media (prefers-reduced-motion: reduce) { .art-icon.press .ring { animation: none; opacity: 0.9; } .spinner, .flow-ring.spin > svg { animation-duration: 2.4s; } }
  .link-icon { display: flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 50%; }
  .link-icon.ok { background: var(--ok); color: #fff; }
  .link-icon.ok svg { width: 34px; height: 34px; fill: currentColor; }
  .link-icon.fail { background: var(--danger-tint); color: var(--danger); }
  .link-icon.fail ha-icon { --mdc-icon-size: 34px; }
  .link-actions { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 26px; }
  .link-actions .pill { min-width: 180px; }
  
`;
