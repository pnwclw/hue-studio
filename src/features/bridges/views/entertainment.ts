// Settings → Entertainment areas: the bridge's entertainment areas (what the Sync Box, the
// Hue app's sync or a game streams to). They are not rooms or zones: their own sets of
// lights with places. List, create, rename, change type and lights, arrange, delete.

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import type { StringKey } from "../../../i18n/index.ts";
import { friendlyName, lightIcon } from "../../../core/model.ts";
import type { EntertainmentArea, EntertainmentMessage } from "../../../core/types.ts";
import { icon } from "../../../ds/ui.ts";
import { StudioView } from "../../../ds/base.ts";
import { bridgeRow, navRow, single } from "../../../ds/choice.ts";

const TYPES: EntertainmentArea["type"][] = ["screen", "monitor", "music", "3dspace", "other"];
const TYPE_ICONS: Record<EntertainmentArea["type"], string> = {
  screen: "mdi:television",
  monitor: "mdi:monitor",
  music: "mdi:music",
  "3dspace": "mdi:cube-outline",
  other: "mdi:shape-outline",
};

/** The editor: a new area (id null) or one of the bridge's. */
interface Draft {
  id: string | null;
  bridge: string | null;
  name: string;
  type: EntertainmentArea["type"];
  lights: string[];
}

@customElement("hue-studio-entertainment-view")
export class EntertainmentView extends StudioView {
  /** null: the list; "new": a new area; else the area to edit. */
  @property() accessor area: string | null = null;
  @state() private accessor data: EntertainmentMessage | null = null;
  @state() private accessor draft: Draft | null = null;
  @state() private accessor busy = false;
  private stop?: () => void;

  override connectedCallback(): void {
    super.connectedCallback();
    this.stop = this.ctx.watch<EntertainmentMessage>("hue_studio/entertainment/subscribe", (m) => (this.data = m));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop?.();
  }

  private find(id: string): [string, EntertainmentArea] | null {
    for (const [bridge, b] of Object.entries(this.data || {})) {
      const area = b.areas.find((a) => a.id === id);
      if (area) return [bridge, area];
    }
    return null;
  }

  protected override renderPage() {
    const { ctx } = this;
    const { t } = ctx;
    if (!this.data) return this.screen(this.subHead(t("settings.entertainment"), () => ctx.go("/settings")), html`<p class="empty">${t("rooms.loading")}</p>`);
    if (this.area === null) return this.list(this.data);
    const found = this.area === "new" ? null : this.find(this.area);
    if (this.area !== "new" && !found) {
      return this.screen(this.subHead(t("settings.entertainment"), () => ctx.go("/settings/entertainment")), html`<p class="empty">${t("ent.not_found")}</p>`);
    }
    // The draft starts from the area (or empty for a new one) and follows the user's edits.
    const draft = this.draft ?? (found
      ? { id: found[1].id, bridge: found[0], name: found[1].name, type: found[1].type, lights: Object.keys(found[1].lights) }
      : { id: null, bridge: Object.keys(this.data)[0] ?? null, name: "", type: "screen" as const, lights: [] });
    return this.editor(draft, found?.[1] ?? null);
  }

  private list(data: EntertainmentMessage) {
    const { ctx } = this;
    const { t } = ctx;
    const syncedBy = (id: string) =>
      Object.values(ctx.boxes)
        .filter((b) => b.area === id)
        .map((b) => b.name || "Sync Box");
    // Several bridges: each area says whose it is (an area holds one bridge's lights).
    const several = Object.keys(data).length > 1;
    const areas = Object.values(data).flatMap((b) => b.areas.map((a) => ({ ...a, bridgeName: several ? b.name : "" })));
    return this.screen(
      this.subHead(t("settings.entertainment"), () => ctx.go("/settings")),
      html`<p class="lead">${t("ent.intro")}</p>
        <div class="rows">
          ${areas.map((a) => {
            const boxes = syncedBy(a.id);
            const sub = [
              t(`ent.type_${a.type}` as StringKey),
              t("ent.lights_count", { count: Object.keys(a.lights).length }),
              a.bridgeName,
              a.streaming ? t("ent.streaming") : "",
              boxes.length ? t("ent.used_by", { name: boxes.join(", ") }) : "",
            ].filter(Boolean);
            return html`<button class="item" @click=${() => ctx.go(`/settings/entertainment/${encodeURIComponent(a.id)}`)}>
              <ha-icon icon=${TYPE_ICONS[a.type] || TYPE_ICONS.other}></ha-icon>
              <div class="grow">${a.name}<div class="dim small">${sub.join(" · ")}</div></div>
              ${a.streaming ? html`<span class="dot-badge live" aria-hidden="true"></span>` : nothing}
              <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
            </button>`;
          })}
          <button class="item" @click=${() => ctx.go("/settings/entertainment/new")}>
            <ha-icon icon="mdi:plus"></ha-icon><div class="grow">${t("ent.new")}</div>
          </button>
        </div>`,
      "settings-page",
    );
  }

  /**
   * Which bridge's lights the area holds, with several bridges: picked for a new area
   * (its lights start over), shown for an existing one.
   */
  private bridgePick(draft: Draft, set: (patch: Partial<Draft>) => void): TemplateResult | typeof nothing {
    const { t } = this.ctx;
    const bridges = Object.entries(this.data || {});
    if (bridges.length < 2) return nothing;
    if (draft.id)
      return html`<div class="item">
        <ha-icon icon="mdi:router-wireless"></ha-icon><div class="grow">${t("add_device.bridge")}</div>
        <span class="value">${this.data?.[draft.bridge ?? ""]?.name ?? ""}</span>
      </div>`;
    return bridgeRow(t("add_device.bridge"), bridges.map(([id, b]) => [id, b.name]), draft.bridge, (c) => this.choose(c), (id) => id !== draft.bridge && set({ bridge: id, lights: [] }));
  }

  private editor(draft: Draft, area: EntertainmentArea | null) {
    const { ctx } = this;
    const { t } = ctx;
    const set = (patch: Partial<Draft>) => (this.draft = { ...(this.draft ?? draft), ...patch });
    const streaming = !!area?.streaming;
    const candidates = draft.bridge ? this.data?.[draft.bridge]?.lights || [] : [];
    const flip = (id: string) => {
      const current = (this.draft ?? draft).lights;
      set({ lights: current.includes(id) ? current.filter((l) => l !== id) : [...current, id] });
    };
    const valid = draft.name.trim().length > 0 && draft.lights.length > 0;
    const save = async () => {
      if (!valid || this.busy) return;
      this.busy = true;
      const d = this.draft ?? draft;
      const ok = d.id
        ? await ctx.ws({ type: "hue_studio/entertainment/update", area_id: d.id, name: d.name, area_type: d.type, lights: d.lights })
        : await ctx.ws({ type: "hue_studio/entertainment/create", hue_entry_id: d.bridge, name: d.name, area_type: d.type, lights: d.lights });
      this.busy = false;
      if (ok) {
        this.draft = null;
        ctx.toast(t("ent.saved", { name: d.name }));
        if (!d.id) ctx.go("/settings/entertainment");
      }
    };
    const remove = async () => {
      if (await ctx.ws({ type: "hue_studio/entertainment/delete", area_id: draft.id })) ctx.go("/settings/entertainment");
    };
    const changed = !area || this.draft !== null;
    return this.screen(
      this.subHead(area ? area.name : t("ent.new"), () => ctx.go("/settings/entertainment"),
        html`<button class="pill apply" ?disabled=${!valid || !changed || streaming || this.busy} @click=${save}>${t("zone.save")}</button>`),
      html`${streaming ? html`<p class="sync-note">${icon("sync")}<span>${t("space.streaming", { name: area!.name })}</span></p>` : nothing}
        <div class="rows">
          <div class="item col">
            <input class="field" maxlength="32" placeholder=${t("ent.name")} aria-label=${t("ent.name")} .value=${draft.name}
              ?disabled=${streaming} @input=${(e: InputEvent) => set({ name: (e.target as HTMLInputElement).value })} />
          </div>
        </div>
        <div class="rows">
          ${this.bridgePick(draft, set)}
          ${navRow({ icon: TYPE_ICONS[draft.type], title: t("ent.type"), value: t(`ent.type_${draft.type}` as StringKey), disabled: streaming }, () =>
            this.choose(single(t("ent.type"), TYPES.map((type) => ({ value: type, label: t(`ent.type_${type}` as StringKey), icon: TYPE_ICONS[type] })), draft.type, (type) => set({ type: type as Draft["type"] }))),
          )}
        </div>
        <h2 class="label">${t("ent.lights")}</h2>
        <p class="lead small">${t("ent.lights_hint")}</p>
        <div class="rows">
          ${candidates.map(
            (id) => html`<button class="item" role="checkbox" aria-checked=${draft.lights.includes(id)} ?disabled=${streaming} @click=${() => flip(id)}>
              <ha-icon icon=${lightIcon(ctx.hass, id, ctx.lightInfo[id])}></ha-icon>
              <div class="grow">${friendlyName(ctx.hass, id)}</div>
              <span class=${classMap({ check: true, on: draft.lights.includes(id) })}>${draft.lights.includes(id) ? icon("check") : nothing}</span>
            </button>`,
          )}
        </div>
        ${area
          ? html`<div class="rows" style="margin-top:16px">
                <button class="item" ?disabled=${streaming || this.draft !== null} @click=${() => ctx.go(`/settings/entertainment/${encodeURIComponent(area.id)}/arrange`)}>
                  <ha-icon icon="mdi:floor-plan"></ha-icon><div class="grow">${t("space.arrange")}<div class="dim small">${t("ent.arrange_sub")}</div></div>
                  <ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>
                </button>
              </div>
              <div class="delete-area">
                <button class="delete-btn" ?disabled=${streaming} @click=${() => this.askDelete(t("ent.delete_note"), t("ent.delete"), () => void remove())}>
                  ${t("ent.delete")}
                </button>
              </div>`
          : nothing}`,
      "settings-page",
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-entertainment-view": EntertainmentView;
  }
}
