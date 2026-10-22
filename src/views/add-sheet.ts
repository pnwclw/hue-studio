// "+" of a room or zone, like the Hue app's: what to add. A scene (from the Hue scene
// gallery, from what the lights show now, or an all-day scene: a schedule showing the scene
// of the day), an automation of the room, or a device ("Add devices", the room's area picked).
// Fires `close`.

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { haptic } from "../ha-internals.ts";
import type { StringKey } from "../i18n.ts";
import type { Group } from "../model.ts";
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
    const next = (step: "scene" | "current") => {
      haptic("selection");
      this.step = step;
    };
    const row = (glyph: string, title: StringKey, sub: StringKey, act: () => void, more = true) =>
      html`<button class="item" @click=${act}>
        <ha-icon icon=${glyph}></ha-icon>
        <div class="grow">${t(title)}<div class="dim small">${t(sub)}</div></div>
        ${more ? html`<ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>` : nothing}
      </button>`;
    const scene = this.step === "scene";
    return html`<div class="sheet" @click=${(e: Event) => e.target === e.currentTarget && this.close()}>
      <div class="box form add-sheet" role="dialog" aria-label=${t(scene ? "room.new_scene" : "add.title")}>
        <div class="sheet-bar">
          ${scene
            ? html`<button class="round back" aria-label=${t("common.back")} @click=${() => (this.step = "menu")}>${icon("back")}</button>`
            : nothing}
          <div class="grow">${scene ? t("room.new_scene") : t("add.title")}</div>
          <button class="round close" aria-label=${t("common.close")} @click=${this.close}>${icon("close")}</button>
        </div>
        <div class="rows">
          ${scene
            ? html`${row("mdi:image-multiple-outline", "add.gallery", "add.gallery_sub", () => go(`/gallery?room=${encodeURIComponent(g.key)}`))}
              ${row("mdi:palette-outline", "add.current", "add.current_sub", () => next("current"))}
              ${row("mdi:weather-sunset", "add.all_day", "add.all_day_sub", () => go(`/automations/new/schedule?room=${room}&preset=all_day`))}`
            : html`${row("mdi:palette-swatch-outline", "add.scene", "add.scene_sub", () => next("scene"))}
              ${row("mdi:lightning-bolt", "add.automation", "add.automation_sub", () => go(`/automations/new?room=${room}`))}
              ${row("mdi:lightbulb-on-outline", "add.device", "add.device_sub", () => go(`/settings/devices/add?room=${room}`))}`}
        </div>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-add-sheet": AddSheet;
  }
}
