// Loaded on every Home Assistant page (`frontend.add_extra_js_url`). Each part loads on its
// own: if one fails, the others keep working and HA's own dialogs and pages stay as they are.
//   more-info  our dialog instead of HA's more-info for Hue lights
//   cards      dashboard cards (custom:hue-studio-…)
//   footer     the experimental "Liquid Glass" footer (only when turned on)

const parts: [string, () => Promise<unknown>][] = [
  ["more-info", () => import("./hue-studio-more-info.ts")],
  ["cards", () => import("./cards.ts")],
  ["footer", () => import("./footer.ts")],
];
for (const [name, load] of parts) {
  load().catch((err: unknown) => console.error(`hue_studio: ${name} failed to load`, err));
}
