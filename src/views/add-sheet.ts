// "+" of a room or zone, like the Hue app's: a picker (a deep blue top, the page a rounded
// panel over it) asking what to add, as picture tiles. A scene (from the Hue scene gallery,
// a custom one set light by light, from what the lights show now, or an all-day scene: a
// schedule showing the scene of the day), a device ("Add devices", the room's area picked) or an automation of the room.
// Fires `close`.

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";

import { paletteArt } from "../color.ts";
import { thumbUrl } from "../gallery-data.ts";
import { haptic } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import { friendlyName, type Group } from "../model.ts";
import { icon } from "../ui.ts";
import { StudioView } from "./base.ts";
import "./new-scene.ts";

@customElement("hue-studio-add-sheet")
export class AddSheet extends StudioView {
  @property({ attribute: false }) accessor group: Group | null = null;

  @state() private accessor step: "menu" | "scene" | "current" = "menu";

  private close = (): void => {
    this.dispatchEvent(new Event("close"));
  };

  protected override render() {
    const { ctx, group: g } = this;
    const { t } = ctx;
    if (!g) return nothing;
    if (this.step === "current") return html`<hue-studio-new-scene .ctx=${ctx} .rev=${this.rev} .group=${g} @close=${this.close}></hue-studio-new-scene>`;
    const room = encodeURIComponent(g.key);
    const go = (path: string) => {
      this.close();
      ctx.go(path);
    };
    const next = (step: "menu" | "scene" | "current") => {
      haptic("selection");
      this.step = step;
    };
    // The menu's tiles: a big dark disc with the icon over the name (the Hue app's).
    const big = (glyph: string, title: StringKey, act: () => void) =>
      html`<button class="pick-tile" @click=${act}><span class="disc"><ha-icon icon=${glyph}></ha-icon></span><span class="name">${t(title)}</span></button>`;
    // A scene's ways: the picture at the top left, the name at the bottom.
    const small = (art: TemplateResult, title: StringKey, act: () => void) =>
      html`<button class="pick-tile way" @click=${act}><span class="art">${art}</span><span class="name">${t(title)}</span></button>`;
    const scene = this.step === "scene";
    const three = (ctx.gallery?.scenes ?? []).filter((_, i, all) => i % Math.max(1, Math.floor(all.length / 3)) === 0).slice(0, 3);
    const name = g.group ? friendlyName(ctx.hass, g.group) : g.name;
    return html`<div class="add-picker" role="dialog" aria-label=${scene ? t("add.scene_title") : t("add.title")}>
      <div class="bar">
        ${scene
          ? html`<button class="round back" aria-label=${t("common.back")} @click=${() => next("menu")}>${icon("back")}</button>`
          : html`<button class="round close" aria-label=${t("common.close")} @click=${this.close}>${icon("close")}</button>`}
      </div>
      <div class="add-panel">
        ${scene
          ? html`<h1 class="big">${t("add.scene_title")}</h1>
              <p class="lead">${t("add.scene_lead")}</p>
              <div class="pick-tiles">
                ${small(
                  html`<span class="dots-three">${three.map((s) => html`<span style=${styleMap({ background: `url("${thumbUrl(s.id)}") center / cover, ${paletteArt(s)}` })}></span>`)}</span>`,
                  "add.gallery",
                  () => go(`/gallery?room=${room}`),
                )}
                ${small(html`<ha-icon icon="mdi:pencil"></ha-icon>`, "add.custom", () => go(`/room/${room}/scene/new`))}
                ${small(html`<ha-icon icon="mdi:check"></ha-icon>`, "add.current", () => next("current"))}
                ${small(html`<ha-icon icon="mdi:clock-time-four"></ha-icon>`, "add.all_day", () => go(`/automations/new/schedule?room=${room}&preset=all_day`))}
              </div>`
          : html`<h1 class="big">${t("add.question", { room: name })}</h1>
              <div class="pick-tiles">
                ${big("mdi:palette", "add.add_scene", () => next("scene"))}
                ${big("mdi:lightbulb-on", "add.add_devices", () => go(`/settings/devices/add?room=${room}`))}
                ${big("mdi:lightning-bolt", "add.add_automation", () => go(`/automations/new?room=${room}`))}
              </div>`}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-add-sheet": AddSheet;
  }
}
