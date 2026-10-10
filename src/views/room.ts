// Room: header with toggle, brightness and Adaptive Lighting; the room's Hue scenes; its lights.

import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";

import { paletteArt } from "../color.ts";
import { groupSlider, metaOf, surfaceOf, toggleGroup } from "../controls.ts";
import { galleryMatch, thumbUrl } from "../gallery-data.ts";
import { type AdaptiveSwitch, adaptiveFor, findGroup, friendlyName, type Group, groupState, lightColors, type Scene } from "../model.ts";
import { icon, toggle } from "../ui.ts";
import { StudioView } from "./base.ts";

const FALLBACK_DOT = "radial-gradient(circle at 30% 30%, #ffe7b8, #f2a65a)";

@customElement("hue-studio-room-view")
export class RoomView extends StudioView {
  @property() accessor key = "";

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const g = findGroup(ctx.home, this.key);
    if (!g) {
      return html`<div class="page">
        <div class="topbar">
          <button class="round back" aria-label=${t("common.back")} @click=${() => ctx.go("")}>${icon("back")}</button>
        </div>
        <p class="empty">${t("room.not_found")}</p>
      </div>`;
    }
    const state = groupState(ctx.hass, g, ctx.lightInfo);
    const surface = surfaceOf(state);
    const room = encodeURIComponent(g.key);

    return html`<div class="page">
      <div class=${classMap({ hero: true, ...surface.classes })} style=${styleMap(surface.style)}>
        <div class="inner">
          <div class="topbar">
            <button class="round back" aria-label=${t("common.back")} @click=${() => ctx.go("")}>${icon("back")}</button>
            <div class="title">${g.name}</div>
            <button class="round add" aria-label=${t("room.gallery")} @click=${() => ctx.go(`/gallery?room=${room}`)}>
              ${icon("plus")}
            </button>
            <button class="round colors" aria-label=${t("room.colors")} @click=${() => ctx.go(`/room/${room}/color`)}>
              ${icon("palette")}
            </button>
            ${toggle(state.on, t("common.toggle"), () => toggleGroup(ctx, g))}
          </div>
          ${metaOf(state)} ${groupSlider(ctx, g, state, t("common.brightness"))}
          <div class="badges">${adaptiveFor(ctx.hass, g).map((al) => this.adaptiveBadge(al))}</div>
        </div>
      </div>
      ${g.scenes.length
        ? html`<h2 class="label">${t("room.scenes")}</h2>
            <div class="grid">${g.scenes.map((s) => this.scene(g, s))}</div>`
        : nothing}
      <h2 class="label">${t("room.lights")}</h2>
      <div class="grid">${g.lights.map((id) => this.light(g, id))}</div>
    </div>`;
  }

  /** Adaptive Lighting badge: toggle the switch, or hand manual lights back to it. */
  private adaptiveBadge(al: AdaptiveSwitch) {
    const { ctx } = this;
    const { t } = ctx;
    const label = !al.on ? t("adaptive.off") : al.manual.length ? t("adaptive.resume") : t("adaptive.on");
    const click = () => {
      if (al.on && al.manual.length) {
        ctx.call(
          "adaptive_lighting",
          "set_manual_control",
          { entity_id: al.switch, lights: al.manual, manual_control: false },
          { optimistic: false },
        );
      } else {
        ctx.call("switch", al.on ? "turn_off" : "turn_on", { entity_id: al.switch }, { optimistic: false });
      }
    };
    return html`<button class=${classMap({ badge: true, on: al.on && !al.manual.length })} @click=${click}>
      ${icon("sun")}${label}
    </button>`;
  }

  /** A scene tile; its dot shows the matching gallery picture (bridge scenes usually come from the gallery). */
  private scene(g: Group, s: Scene) {
    const { ctx } = this;
    const match = galleryMatch(ctx.gallery, s.name);
    const dot = match ? `url("${thumbUrl(match.id)}") center / cover, ${paletteArt(match)}` : FALLBACK_DOT;
    const apply = async () => {
      if (await ctx.call("scene", "turn_on", { entity_id: s.entity_id })) ctx.markManual(g);
    };
    return html`<button class="scene surface" @click=${apply}>
      <div class="dot" style=${styleMap({ background: ctx.gallery ? dot : null })}></div>
      <div class="name">${s.name}</div>
      ${s.group !== g.group ? html`<div class="sub">${friendlyName(ctx.hass, s.group)}</div>` : nothing}
    </button>`;
  }

  private light(g: Group, id: string) {
    const { ctx } = this;
    const state = ctx.hass.states[id];
    const colors = lightColors(ctx.hass, id, ctx.lightInfo[id]);
    const surface = surfaceOf({ on: colors.length > 0, colors, available: !!state && state.state !== "unavailable" });
    const room = encodeURIComponent(g.key);
    return html`<div
      class=${classMap({ light: true, ...surface.classes, off: false })}
      style=${styleMap(surface.style)}
      @click=${() => ctx.go(`/room/${room}/color?light=${encodeURIComponent(id)}`)}
    >
      <ha-icon icon=${ctx.hass.entities?.[id]?.icon || "mdi:lightbulb"}></ha-icon>
      <div class="name">${friendlyName(ctx.hass, id)}</div>
      ${toggle(state?.state === "on", ctx.t("common.toggle"), () => ctx.call("light", "toggle", { entity_id: id }))}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-room-view": RoomView;
  }
}
