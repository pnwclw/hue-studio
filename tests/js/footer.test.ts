import assert from "node:assert/strict";
import test from "node:test";

import { activeTab, choosablePanels, footerTabs, footerVisible, moveTab, panelLabel, tabTarget } from "../../src/footer-model.ts";
import type { HassPanel } from "../../src/types.ts";

const panels: Record<string, HassPanel> = {
  lovelace: { url_path: "lovelace", title: null, icon: null },
  hue: { url_path: "hue", title: "Hue", icon: "mdi:lightbulb-group" },
  map: { url_path: "map", title: "map", icon: "mdi:map" },
  config: { url_path: "config", title: "config", icon: "mdi:cog" },
  "dashboard-x": { url_path: "dashboard-x", title: "X", icon: null },
  hidden: { url_path: "hidden", title: null, icon: null },
};

test("tabs: chosen ones that exist, defaults otherwise, never Settings", () => {
  assert.deepEqual(footerTabs(panels, []).map((t) => t.path), ["lovelace", "hue"]);
  const tabs = footerTabs(panels, ["map", "gone", "config", "dashboard-x"]);
  assert.deepEqual(tabs.map((t) => t.path), ["map", "dashboard-x"]);
  assert.equal(tabs[1].icon, "mdi:view-grid");
  assert.equal(footerTabs(panels, ["hue", "map", "dashboard-x", "lovelace", "hue", "map"]).length, 5);
  assert.deepEqual(choosablePanels(panels).map((p) => p.url_path), ["lovelace", "hue", "map", "dashboard-x"]);
});

test("active tab and where the footer shows", () => {
  const tabs = footerTabs(panels, ["lovelace", "hue"]);
  assert.equal(activeTab("/hue/room/area.office", tabs), "hue");
  assert.equal(activeTab("/", tabs), "lovelace");
  assert.equal(activeTab("/map", tabs), null);
  assert.equal(footerVisible("/hue", 430), true);
  assert.equal(footerVisible("/hue", 1440), false);
  assert.equal(footerVisible("/config/integrations", 430), false);
  assert.equal(footerVisible("/configurator", 430), true);
});

test("a tab goes back to the page it showed last; the shown tab goes to its start", () => {
  const last = { hue: "/hue/room/area.office", lovelace: "/lovelace/2" };
  assert.equal(tabTarget(last, "hue", "lovelace", "/hue"), "/hue/room/area.office");
  assert.equal(tabTarget(last, "hue", "hue", "/hue"), "/hue");
  assert.equal(tabTarget(last, "map", "hue", "/map"), "/map");
});

test("moving tabs", () => {
  assert.deepEqual(moveTab(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveTab(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
});

test("labels: dashboards by title, built-in panels translated", () => {
  const localize = (key: string) => ({ "panel.map": "Mapa", "panel.states": "Przegląd" })[key] || "";
  assert.equal(panelLabel(panels.map, localize), "Mapa");
  assert.equal(panelLabel(panels.lovelace, localize), "Przegląd");
  assert.equal(panelLabel(panels["dashboard-x"], localize), "X");
  assert.equal(panelLabel(panels.lovelace), "Overview");
});
