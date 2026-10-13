// "New scene" sheet (a room, the color screen's "Save"): a name, saved from what the lights
// show now as a scene of the group's Hue room/zone on the bridge, so the Hue app has it too.
// A group without one is offered a zone of its lights on the bridge. Fires `close`.

import { html } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { friendlyName, type Group } from "../model.ts";
import { icon } from "../ui.ts";
import { StudioView } from "./base.ts";

@customElement("hue-studio-new-scene")
export class NewSceneSheet extends StudioView {
  @property({ attribute: false }) accessor group: Group | null = null;

  @state() private accessor name = "";
  @state() private accessor busy = false;

  override firstUpdated(): void {
    this.querySelector<HTMLInputElement>("input")?.focus();
  }

  private close = (): void => {
    this.dispatchEvent(new Event("close"));
  };

  protected override render() {
    const { ctx, group: g } = this;
    const { t } = ctx;
    if (!g) return html``;
    const name = this.name.trim();
    const save = async () => {
      if (!g.group || !name || this.busy) return;
      this.busy = true;
      const ok = await ctx.call("hue_studio", "create_scene", { entity_id: g.group, name }, { optimistic: false });
      this.busy = false;
      if (ok) {
        this.close();
        ctx.toast(t("room.scene_created", { name }));
      }
    };
    const createZone = async () => {
      if (this.busy) return;
      this.busy = true;
      const ok = await ctx.call("hue_studio", "create_zone", { entity_id: g.lights, name: g.name }, { optimistic: false });
      this.busy = false;
      if (ok) ctx.toast(t("room.zone_created", { name: g.name }));
    };
    return html`<div class="sheet" @click=${(e: Event) => e.target === e.currentTarget && this.close()}>
      <div class="box form" role="dialog" aria-label=${t("room.new_scene")}>
        <div class="sheet-bar"><div class="grow">${t("room.new_scene")}</div>
          <button class="round close" aria-label=${t("common.close")} @click=${this.close}>${icon("close")}</button>
        </div>
        ${g.group
          ? html`<div class="form-body">
                <input
                  class="field"
                  maxlength="32"
                  placeholder=${t("room.new_scene_name")}
                  aria-label=${t("room.new_scene_name")}
                  .value=${this.name}
                  @input=${(e: InputEvent) => (this.name = (e.target as HTMLInputElement).value)}
                  @keydown=${(e: KeyboardEvent) => e.key === "Enter" && save()}
                />
                <p class="hint">${t("room.new_scene_hint", { room: friendlyName(ctx.hass, g.group) })}</p>
              </div>
              <div class="actions"><button class="pill apply" ?disabled=${!name || this.busy} @click=${save}>${t("scene.save")}</button></div>`
          : html`<div class="form-body"><p class="hint">${t("room.no_group", { room: g.name })}</p></div>
              <div class="actions">
                <button class="pill apply" ?disabled=${this.busy} @click=${createZone}>${t("room.create_zone")}</button>
                <button class="pill" @click=${() => ctx.go("/settings/integration")}>${t("room.mapping")}</button>
              </div>`}
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-new-scene": NewSceneSheet;
  }
}
