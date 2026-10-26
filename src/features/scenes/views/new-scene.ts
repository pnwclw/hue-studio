// "Save current settings" (a room's "+", the color screen's "Save"): a name page over the
// screen it was opened from (never a dialog), saved from what the lights show now as a scene of
// the group's Hue room/zone on the bridge, so the Hue app has it too. A group without one is
// offered a zone of its lights on the bridge. Fires `close`.

import { html } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { friendlyName, type Group } from "../../../core/model.ts";
import { haptic } from "../../../core/ha-internals.ts";
import { StudioView } from "../../../ds/base.ts";

@customElement("hue-studio-new-scene")
export class NewSceneSheet extends StudioView {
  @property({ attribute: false }) accessor group: Group | null = null;

  @state() private accessor name: string | null = null;
  @state() private accessor busy = false;

  private close = (): void => {
    this.dispatchEvent(new Event("close"));
  };

  protected override renderPage() {
    const { ctx, group: g } = this;
    const { t } = ctx;
    if (!g) return html``;
    const name = this.name ?? t("room.new_scene");
    if (!g.group) {
      // No Hue room or zone to hold it: a zone of these lights first.
      const createZone = async () => {
        if (this.busy) return;
        this.busy = true;
        const ok = await ctx.call("hue_studio", "create_zone", { entity_id: g.lights, name: g.name }, { optimistic: false });
        this.busy = false;
        if (ok) ctx.toast(t("room.zone_created", { name: g.name }));
      };
      return this.screen(
        this.subHead(t("add.current"), this.close),
        html`<p class="lead">${t("room.no_group", { room: g.name })}</p>
          <div class="center">
            <button class="pill apply" ?disabled=${this.busy} @click=${createZone}>${t("room.create_zone")}</button>
            <button class="pill" @click=${() => ctx.go("/settings/integration")}>${t("room.mapping")}</button>
          </div>`,
        "settings-page name-page",
      );
    }
    const save = async () => {
      const value = name.trim();
      if (!value || this.busy) return;
      this.busy = true;
      const ok = await ctx.call("hue_studio", "create_scene", { entity_id: g.group!, name: value }, { optimistic: false });
      this.busy = false;
      if (!ok) return;
      haptic("success");
      this.close();
      ctx.toast(t("room.scene_created", { name: value }));
    };
    return this.nameScreen({
      title: t("add.current"),
      value: name,
      max: 32,
      label: t("room.new_scene_name"),
      input: (value) => (this.name = value),
      done: () => void save(),
      doneLabel: t("scene.save"),
      canDone: !!name.trim() && !this.busy,
      back: this.close,
      hint: t("room.new_scene_hint", { room: friendlyName(ctx.hass, g.group!) }),
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-new-scene": NewSceneSheet;
  }
}
