// The Hue app's light icons as the `hue-studio:` icon set (from elax46/custom-brand-icons,
// MIT, see NOTICE; built by scripts/build_hue_icons.py). The paths load on first use.

import { type CustomIcon, registerIconset } from "./ha-internals.ts";
import { ARCHETYPE_ICONS, PRODUCT_ICONS } from "./model.ts";

export const ICON_PREFIX = "hue-studio";

const names = [...new Set([...Object.values(ARCHETYPE_ICONS), ...PRODUCT_ICONS.map(([, icon]) => icon)])].map((icon) =>
  icon.slice(ICON_PREFIX.length + 1),
);

async function getIcon(name: string): Promise<CustomIcon | undefined> {
  const { HUE_ICONS } = await import("./hue-icons-data.ts");
  const icon = HUE_ICONS[name];
  return icon && { viewBox: icon[0], path: icon[1] };
}

export function registerHueIcons(): void {
  registerIconset(ICON_PREFIX, getIcon, names);
}
