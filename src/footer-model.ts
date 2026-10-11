// The experimental "Liquid Glass" footer: which tabs it shows, which one is active and
// where it is shown. Pure functions, no DOM.

import type { HassPanel } from "./types.ts";

export interface FooterTab {
  /** The panel's url path ("lovelace", "hue", "dashboard-x", …). */
  path: string;
  label: string;
  icon: string;
}

export const FOOTER_MAX_TABS = 5;
/** Without a choice: the default dashboard and the Hue panel. */
export const DEFAULT_TABS = ["lovelace", "hue"];
/** HA's own breakpoint: narrower than this, the sidebar becomes a drawer. */
export const NARROW_WIDTH = 870;
/** Height the footer takes at the bottom of the screen (bar + gap), in px. */
export const FOOTER_SPACE = 76;

/** A panel's icon (dashboards without one get a generic one). */
export const panelIcon = (panel: HassPanel): string => panel.icon || (panel.url_path === "lovelace" ? "mdi:view-dashboard" : "mdi:view-grid");

/** A panel's name as HA's sidebar shows it (`localize`: HA's own translations). */
export function panelLabel(panel: HassPanel, localize?: (key: string) => string): string {
  if (panel.url_path === "lovelace" && !panel.title) return localize?.("panel.states") || "Overview";
  return (panel.title && localize?.(`panel.${panel.title}`)) || panel.title || panel.url_path;
}

/** Panels a tab can open: everything with a title or the default dashboard, not Settings. */
export function choosablePanels(panels: Record<string, HassPanel> | undefined): HassPanel[] {
  return Object.values(panels || {}).filter((p) => p.url_path !== "config" && (p.title || p.url_path === "lovelace"));
}

/** The chosen tabs that exist (or the defaults), at most FOOTER_MAX_TABS. */
export function footerTabs(
  panels: Record<string, HassPanel> | undefined,
  chosen: string[] | undefined,
  localize?: (key: string) => string,
): FooterTab[] {
  const paths = chosen?.length ? chosen : DEFAULT_TABS;
  return paths
    .map((path) => panels?.[path])
    .filter((p): p is HassPanel => !!p && p.url_path !== "config")
    .slice(0, FOOTER_MAX_TABS)
    .map((p) => ({ path: p.url_path, label: panelLabel(p, localize), icon: panelIcon(p) }));
}

/** The tab of the page at `pathname` (its first segment), or null. */
export function activeTab(pathname: string, tabs: FooterTab[]): string | null {
  const first = pathname.split("/").filter(Boolean)[0] || "lovelace";
  return tabs.find((t) => t.path === first)?.path ?? null;
}

/** Shown on phones only, and never on HA's own settings pages. */
export const footerVisible = (pathname: string, width: number): boolean => width < NARROW_WIDTH && !/^\/config(\/|$)/.test(pathname);

/** Move a chosen tab one place up (-1) or down (+1). */
export function moveTab(tabs: string[], path: string, by: -1 | 1): string[] {
  const i = tabs.indexOf(path);
  const j = i + by;
  if (i < 0 || j < 0 || j >= tabs.length) return tabs;
  const next = [...tabs];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
