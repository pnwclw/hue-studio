// "+" of a room or zone, like the Hue app's: a picker (a deep blue top, the page a rounded
// panel over it) asking what to add, as picture tiles. A scene (from the Hue scene gallery,
// a custom one set light by light, from what the lights show now, or an all-day scene: a
// schedule showing the scene of the day, or one from a Hue app link: fires `shared` with it), a
// device ("Add devices", the room's area picked) or an automation of the room. Fires `close`.

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import { paletteArt } from "../../../core/color.ts";
import { thumbUrl } from "../../scenes/gallery-data.ts";
import { haptic } from "../../../core/ha-internals.ts";
import type { StringKey } from "../../../i18n/index.ts";
import { friendlyName, type Group } from "../../../core/model.ts";
import { icon } from "../../../ds/ui.ts";
import { StudioView } from "../../../ds/base.ts";
import "../../scenes/views/new-scene.ts";
import { readShareLink } from "../../scenes/share.ts";

@customElement("hue-studio-add-sheet")
export class AddSheet extends StudioView {
  @property({ attribute: false }) accessor group: Group | null = null;

  @state() private accessor step: "menu" | "scene" | "current" | "link" = "menu";
  /** The link being pasted, and whether it was read as no scene. */
  @state() private accessor link = "";
  @state() private accessor badLink = false;

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
    const next = (step: "menu" | "scene" | "current" | "link") => {
      haptic("selection");
      this.step = step;
    };
    // The menu's tiles: a big dark disc with the icon over the name (the Hue app's).
    const big = (glyph: string, title: StringKey, act: () => void) =>
      html`<button class="pick-tile" @click=${act}><span class="disc"><ha-icon icon=${glyph}></ha-icon></span><span class="name">${t(title)}</span></button>`;
    // A scene's ways: the picture at the top left, the name at the bottom.
    const small = (art: TemplateResult, title: StringKey, act: () => void) =>
      html`<button class="pick-tile way" @click=${act}><span class="art">${art}</span><span class="name">${t(title)}</span></button>`;
    const scene = this.step === "scene" || this.step === "link";
    const three = (ctx.gallery?.scenes ?? []).filter((_, i, all) => i % Math.max(1, Math.floor(all.length / 3)) === 0).slice(0, 3);
    const name = g.group ? friendlyName(ctx.hass, g.group) : g.name;
    return html`<div class="add-picker" role="dialog" aria-label=${scene ? t("add.scene_title") : t("add.title")}>
      <div class="bar">
        ${scene
          ? html`<button class="round back" aria-label=${t("common.back")} @click=${() => next(this.step === "link" ? "scene" : "menu")}>${icon("back")}</button>`
          : html`<button class="round close" aria-label=${t("common.close")} @click=${this.close}>${icon("close")}</button>`}
      </div>
      <div class="add-panel">
        ${this.step === "link"
          ? this.linkPage()
          : scene
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
                ${small(html`<ha-icon icon="mdi:link-variant"></ha-icon>`, "share.from_link", () => {
                  this.link = "";
                  this.badLink = false;
                  next("link");
                })}
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

  /** "Scene link", a page of the picker (never a dialog): a link someone shared from the Hue
   *  app (or Hue Studio), pasted; "Open" opens its card. */
  private linkPage() {
    const { ctx } = this;
    const { t } = ctx;
    const open = async () => {
      const scene = await readShareLink(this.link);
      if (!scene) {
        haptic("warning");
        this.badLink = true;
        return;
      }
      haptic("success");
      this.dispatchEvent(new CustomEvent("shared", { detail: scene }));
      this.close();
    };
    return html`<h1 class="big">${t("share.link")}</h1>
      <p class=${classMap({ lead: true, warn: this.badLink })}>${t(this.badLink ? "share.bad_link" : "share.link_hint")}</p>
      <label class="name-field">
        <input
          class="field outlined"
          type="url"
          inputmode="url"
          autocomplete="off"
          placeholder="https://scenesharing.meethue.com/…"
          aria-label=${t("share.link")}
          .value=${this.link}
          @input=${(e: InputEvent) => {
            this.link = (e.target as HTMLInputElement).value;
            this.badLink = false;
          }}
          @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this.link.trim() && void open()}
        />
        ${this.link
          ? html`<button class="round mini" aria-label=${t("common.clear")} @click=${(e: Event) => {
              e.preventDefault();
              this.link = "";
              this.badLink = false;
              this.querySelector<HTMLInputElement>(".name-field input")?.focus();
            }}>${icon("close")}</button>`
          : nothing}
      </label>
      <div class="center"><button class="pill apply" ?disabled=${!this.link.trim()} @click=${() => void open()}>${t("share.open")}</button></div>`;
  }

  protected override updated(changed: Map<PropertyKey, unknown>): void {
    super.updated(changed);
    // The link page comes up ready to paste into.
    if (changed.has("step") && this.step === "link") this.querySelector<HTMLInputElement>(".add-panel .name-field input")?.focus();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-add-sheet": AddSheet;
  }
}
