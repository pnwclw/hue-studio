// Settings → Bridges (what each bridge is, its Sync Boxes) and Settings → MotionAware
// areas (lights as motion sensors, set up in the Hue app; here: health, on/off).

import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { StringKey } from "../i18n.ts";
import { friendlyName } from "../model.ts";
import type { BridgesMessage, MotionArea } from "../types.ts";
import { toggle } from "../ui.ts";
import { StudioView } from "./base.ts";

@customElement("hue-studio-bridges-view")
export class BridgesView extends StudioView {
  /** "bridges" or "motion" (MotionAware areas). */
  @property() accessor mode: "bridges" | "motion" = "bridges";
  @state() private accessor bridges: BridgesMessage | null = null;
  private stop?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.stop = this.ctx.watch<BridgesMessage>("hue_studio/bridges/subscribe", (m) => (this.bridges = m));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop?.();
  }

  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    const motion = this.mode === "motion";
    return this.screen(
      this.subHead(t(motion ? "settings.motionaware" : "settings.bridges"), () => ctx.go("/settings")),
      !this.bridges ? html`<p class="empty">${t("rooms.loading")}</p>` : motion ? this.motionAreas(this.bridges) : this.bridgeList(this.bridges),
      "settings-page",
    );
  }

  private bridgeList(bridges: BridgesMessage) {
    const { ctx } = this;
    const { t } = ctx;
    const fact = (label: StringKey, value: string | null) =>
      value ? html`<div class="item"><div class="grow">${t(label)}</div><span class="dim">${value}</span></div>` : nothing;
    const boxes = Object.entries(ctx.boxes);
    return html`${Object.values(bridges).map(
        (b) => html`<h2 class="label">${b.name}</h2>
          <div class="rows">
            ${fact("bridges.model", b.model)} ${fact("bridges.address", b.host)} ${fact("bridges.software", b.software)} ${fact("bridges.id", b.id)}
          </div>`,
      )}
      ${boxes.length
        ? html`<h2 class="label">${t("bridges.sync_boxes")}</h2>
            <div class="rows">
              ${boxes.map(
                ([id, box]) => html`<button class="item" @click=${() => ctx.go(`/sync?box=${encodeURIComponent(id)}`)}>
                  <ha-icon icon="mdi:television-box"></ha-icon>
                  <div class="grow">${box.name || "Sync Box"}<div class="dim small">${box.model || ""} · ${t(box.features?.length ? "bridges.box_direct" : "bridges.box_link")}</div></div>
                  <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
                </button>`,
              )}
            </div>`
        : nothing}
      <p class="lead small">${t("bridges.hint")}</p>`;
  }

  private motionAreas(bridges: BridgesMessage) {
    const { t } = this.ctx;
    const all = Object.values(bridges).flatMap((b) => b.motion_areas || []);
    const none = Object.values(bridges).every((b) => b.motion_areas === null);
    return html`<p class="lead">${t("motion.intro")}</p>
      ${all.length
        ? html`<div class="rows">${all.map((a) => this.motionArea(a))}</div>`
        : html`<p class="lead small center-text">${t(none ? "motion.unsupported" : "motion.none")}</p>`}`;
  }

  private motionArea(a: MotionArea) {
    const { ctx } = this;
    const { t } = ctx;
    const lights = a.lights.map((l) => (l.entity_id ? friendlyName(ctx.hass, l.entity_id) : "?")).join(", ");
    const health = ["healthy", "degraded", "recovering", "unrecoverable", "not_running"].includes(a.health) ? a.health : "unknown";
    return html`<div class="item">
      <ha-icon icon=${a.enabled ? "mdi:motion-sensor" : "mdi:motion-sensor-off"}></ha-icon>
      <div class="grow">${a.name}
        <div class="dim small">${[a.group, t(`motion.health_${health}` as StringKey), lights].filter(Boolean).join(" · ")}</div>
      </div>
      ${toggle(a.enabled, a.name, () => ctx.ws({ type: "hue_studio/bridges/motion_area", area_id: a.id, enabled: !a.enabled }))}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-bridges-view": BridgesView;
  }
}
