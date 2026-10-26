// Part of the stylesheet (joined in index.ts): wide screens (600px and more).

export const WIDE_CSS = `
    .tiles { grid-auto-flow: row; grid-template-rows: none; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
             overflow: visible; margin: 0; padding: 0; }
    .searching { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); }
    .tile:hover, .card:hover, .tile-card:hover, .control-card:hover { transform: translateY(-1px); }
    h1.big { font-size: var(--fs-large); }
    /* Room header: a card in the column instead of a sheet glued to the top edge. */
    .page > .hero:first-child { position: relative; margin: 20px 0 0; padding: 4px 20px 18px; border-radius: var(--r-3xl); }
  }
`;
