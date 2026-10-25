// The Hue app's light icons as the `hue-studio:` icon set (from elax46/custom-brand-icons,
// MIT, see NOTICE; built by scripts/build_hue_icons.py). The paths load on first use.
// The panel's own glyphs that rows show through <ha-icon> are in it too (`hue-studio:sync`).

import { type CustomIcon, registerIconset } from "./ha-internals.ts";
import { ARCHETYPE_ICONS, PRODUCT_ICONS } from "./model.ts";
import { ICONS } from "./ui.ts";

export const ICON_PREFIX = "hue-studio";

/** Glyphs of the panel's chrome (ui.ts) offered as icons of the set. */
const CHROME = ["sync", "devices", "bridge", "motionaware"] as const;

const names = [...new Set([...Object.values(ARCHETYPE_ICONS), ...PRODUCT_ICONS.map(([, icon]) => icon)])].map((icon) =>
  icon.slice(ICON_PREFIX.length + 1),
).concat(CHROME);

async function getIcon(name: string): Promise<CustomIcon | undefined> {
  if ((CHROME as readonly string[]).includes(name)) return { viewBox: "0 0 24 24", path: ICONS[name as (typeof CHROME)[number]] };
  const { HUE_ICONS } = await import("./hue-icons-data.ts");
  const icon = HUE_ICONS[name];
  return icon && { viewBox: icon[0], path: icon[1] };
}

export function registerHueIcons(): void {
  registerIconset(ICON_PREFIX, getIcon, names);
}
