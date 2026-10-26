// Part of the stylesheet (joined in index.ts): the scene gallery.

export const GALLERY_CSS = `
  /* gallery */
  /* In a bar instead of its title (phones), or before the actions (desktop Explore tab). */
  .search-field { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; height: var(--control); margin: 0; padding: 0 10px; box-sizing: border-box;
                  border-radius: var(--r-s); background: var(--fill-soft); color: var(--text-2); cursor: text; animation: field-in 0.25s var(--ease); }
  @keyframes field-in { from { opacity: 0; transform: scaleX(0.96); } }
  .search-field svg { width: 18px; height: 18px; flex: none; }
  .search-field .q { flex: 1; min-width: 0; height: 100%; margin: 0; padding: 0; border: none; background: none; outline: none;
                     font: inherit; font-size: var(--fs-body); color: var(--text); }
  .search-field .q::placeholder { color: var(--text-2); }
  .tab-head.wide .search-field { flex: 0 1 260px; margin: 0; }
  .tiles { display: grid; grid-auto-flow: column; grid-template-rows: repeat(var(--rows, 2), auto); gap: var(--tile-gap);
           grid-auto-columns: calc((100% - 2 * var(--tile-gap)) / 2.6); overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none;
           margin: 0 calc(-1 * var(--gutter)); padding: 0 var(--gutter) 2px; scroll-padding: 0 var(--gutter); overscroll-behavior-x: contain; }
  .tiles::-webkit-scrollbar { display: none; }
  .tile { position: relative; aspect-ratio: 16 / 9; border-radius: var(--r-m); overflow: hidden; scroll-snap-align: start; cursor: pointer;
          background: var(--surface) center / cover no-repeat; box-shadow: var(--shadow-flat); transition: transform var(--t-press) var(--ease); }
  .tile:active { transform: scale(var(--press-tile)); }
  .tile img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .tile::after { content: ""; position: absolute; inset: 40% 0 0; background: linear-gradient(transparent, rgba(0, 0, 0, 0.42)); }
  .tile span { position: absolute; left: 10px; right: 8px; bottom: 7px; z-index: 1; color: #fff; font-size: var(--fs-footnote); font-weight: 500;
               text-shadow: 0 1px 6px rgba(0, 0, 0, 0.4); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .searching { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-top: 14px; }
  .searching section:not([hidden]), .searching .tiles { display: contents; }
  .searching h2 { display: none; }
  section[hidden], .tile[hidden], .note[hidden] { display: none; }
  .note { margin-top: 20px; color: var(--text-2); }

`;
