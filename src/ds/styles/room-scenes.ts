// Part of the stylesheet (joined in index.ts): a room's scenes: columns, the empty room, the active scene, the gallery stack, suggestions.

export const ROOM_SCENES_CSS = `
  /* A room's scenes, the Hue app's: columns of two that scroll sideways, cards as wide as the
     light cards; narrow columns beside the active scene (edit, "⋯") and the suggestion (shuffle). */
  .scene-cols { overflow-x: auto; margin: -8px calc(-1 * var(--gutter)); padding: 8px var(--gutter); scroll-padding: 0 var(--gutter); scrollbar-width: none;
                scroll-snap-type: x proximity; overscroll-behavior-x: contain; }
  .scene-cols::-webkit-scrollbar { display: none; }
  /* A room without scenes, the Hue app's: what scenes are, then a suggestion and the gallery, centered. */
  .first-scene { padding: 18px 8px 4px; text-align: center; }
  .first-scene h3 { margin: 0; font-size: var(--fs-title-2); font-weight: 500; }
  .first-scene p { margin: 12px auto 22px; max-width: 420px; font-size: var(--fs-body); line-height: 1.45; color: var(--text-2); }
  .first-scene-cards { display: flex; align-items: stretch; justify-content: center; gap: 12px; }
  .first-scene-cards .tile-card { width: var(--light-tile); }
  .first-scene-cards .scene-side { align-self: center; height: auto; }
  .scene-grid { display: grid; grid-template-columns: max-content max-content; gap: var(--tile-gap); width: max-content; }
  .scene-line { display: flex; gap: var(--tile-gap); }
  .scene-cols .tile-card { width: var(--light-tile); }
  .scene-cell { display: flex; scroll-snap-align: start; }
  /* The active scene's buttons (and the shuffle) come in softly while the cards slide aside. */
  .scene-side { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; width: 32px;
                animation: side-in 0.36s var(--ease) both; }
  @keyframes side-in { from { opacity: 0; transform: scale(0.6); } }
  .scene-side .round { background: var(--fill-light); color: var(--text); }
  .scene-side .round svg { width: 18px; height: 18px; }
  .scene-cols.locked .scene { opacity: 0.45; cursor: default; }
  .scene-cols.locked .scene:active { transform: none; }
  /* A dynamic active scene: play/stop in place of its picture. */
  .scene-play { width: var(--art); height: var(--art); border: none; border-radius: 50%; padding: 0; display: flex; align-items: center;
                justify-content: center; background: rgba(255, 255, 255, 0.3); color: #fff; cursor: pointer; transition: transform 0.2s var(--spring);
                box-shadow: var(--shadow-dot); }
  .scene-play:active { transform: scale(var(--press-round)); }
  .scene-play svg { width: 22px; height: 22px; }
  .dark-text .scene-play { background: rgba(255, 255, 255, 0.45); color: var(--text-dark); }
  /* The gallery: three of its pictures overlapping; a suggestion: a stack of cards. */
  .dots-three { display: flex; height: var(--art); align-items: center; }
  .dots-three span { width: 32px; height: 32px; border-radius: 50%; margin-left: -8px; box-shadow: -2px 0 6px rgba(0, 0, 0, 0.35); }
  .dots-three span:first-child { margin-left: 0; box-shadow: none; }
  .tile-card.gallery-card { box-shadow: inset 0 0 0 1.5px var(--fill-light); background: transparent; }
  /* A suggestion: the top of a stack of cards, tinted with its scene's colors; a new one
     rises from the stack. */
  .tile-card.suggested { margin-left: 8px;
    background: linear-gradient(160deg, color-mix(in srgb, var(--tint-a, var(--surface-2)) 26%, var(--surface)),
      color-mix(in srgb, var(--tint-b, var(--surface-2)) 16%, var(--bg)));
    box-shadow: -4px 0 0 -1px color-mix(in srgb, var(--tint-a, var(--surface-2)) 18%, #303032),
      -8px 0 0 -2px color-mix(in srgb, var(--tint-b, var(--surface-2)) 12%, #29292b), var(--shadow-raised);
    animation: from-stack 0.42s var(--ease) both; }
  @keyframes from-stack { from { transform: translate(-8px, 6px) scale(0.92); opacity: 0.3; } }
  .tile-card.suggested .sub { opacity: 0.6; }
  .sync-meta svg { width: 14px; height: 14px; }

`;
