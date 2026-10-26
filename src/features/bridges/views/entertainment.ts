// Settings → Entertainment areas: the bridge's entertainment areas (what the Sync Box, the
// Hue app's sync or a game streams to). They are not rooms or zones: their own sets of
// lights with places. List, create, rename, change type and lights, arrange, delete; an
// area's editor is the Hue app's (a sheet on phones).

import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { haptic } from "../../../core/ha-internals.ts";
import type { StringKey } from "../../../i18n/index.ts";
import { banner } from "../../../ds/controls.ts";
import { addLightsSheet, type LightRoom, lightsCard } from "../../../ds/lights.ts";
import { lightsByArea } from "../../rooms/rooms.ts";
import type { EntertainmentArea, EntertainmentMessage } from "../../../core/types.ts";
import { icon } from "../../../ds/ui.ts";
import { StudioView } from "../../../ds/base.ts";
import { navRow, single } from "../../../ds/choice.ts";

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
  @state() private accessor editingName = false;
  /** "Add lights to …" is open: what is checked there, the rooms open. */
  @state() private accessor adding: { picked: string[]; open: string[] } | null = null;
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
              Object.keys(a.lights).length === 1 ? t("rooms.one_light") : t("ent.lights_count", { count: Object.keys(a.lights).length }),
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
    const current = this.data?.[draft.bridge ?? ""]?.name ?? "";
    if (draft.id)
      return html`<div class="item">
        <div class="grow">${t("add_device.bridge")}</div>
        <span class="value">${current}</span>
      </div>`;
    const options = bridges.map(([id, b]) => ({ value: id, label: b.name, icon: "mdi:router-wireless" }));
    return navRow({ title: t("add_device.bridge"), value: current, bare: true }, () =>
      this.choose(single(t("add_device.bridge"), options, draft.bridge ?? "", (id) => id !== draft.bridge && set({ bridge: id, lights: [] }))),
    );
  }

  /** The rooms (HA areas) with lights of the area's bridge that can stream and are not in it. */
  private rooms(draft: Draft): LightRoom[] {
    const { ctx } = this;
    const candidates = new Set(draft.bridge ? this.data?.[draft.bridge]?.lights || [] : []);
    return lightsByArea(ctx.hass)
      .map(([area, ids]): LightRoom => ({
        key: area ?? "",
        name: area ? ctx.hass.areas?.[area]?.name || area : ctx.t("home.no_room"),
        icon: (area && ctx.hass.areas?.[area]?.icon) || (area ? "mdi:sofa-outline" : "mdi:home-off-outline"),
        lights: ids.filter((id) => candidates.has(id) && !draft.lights.includes(id)),
      }))
      .filter((r) => r.lights.length);
  }

  /**
   * An area's editor, the Hue app's: its type's glyph and its name (the pencil renames it in
   * place), its lights as a "Lights" card ("+" opens "Add lights to …", a card's "−" takes one
   * out; ds/lights.ts), its type and where its lights stand, "Delete" at the bottom. "SAVE"
   * stays grey until something changed.
   */
  private editor(draft: Draft, area: EntertainmentArea | null) {
    const { ctx } = this;
    const { t } = ctx;
    const set = (patch: Partial<Draft>) => (this.draft = { ...(this.draft ?? draft), ...patch });
    const streaming = !!area?.streaming;
    const valid = draft.name.trim().length > 0 && draft.lights.length > 0;
    const changed = !area || this.draft !== null;
    const back = () => ctx.go("/settings/entertainment");
    const save = async () => {
      if (!valid || this.busy) return;
      this.busy = true;
      const d = this.draft ?? draft;
      const ok = d.id
        ? await ctx.ws({ type: "hue_studio/entertainment/update", area_id: d.id, name: d.name.trim(), area_type: d.type, lights: d.lights })
        : await ctx.ws({ type: "hue_studio/entertainment/create", hue_entry_id: d.bridge, name: d.name.trim(), area_type: d.type, lights: d.lights });
      this.busy = false;
      if (!ok) return;
      haptic("success");
      this.draft = null;
      this.editingName = false;
      ctx.toast(t("ent.saved", { name: d.name.trim() }));
      back();
    };
    const remove = async () => {
      if (await ctx.ws({ type: "hue_studio/entertainment/delete", area_id: draft.id })) back();
    };
    const rooms = this.rooms(draft);
    const head = this.subHead(
      t(area ? "ent.edit" : "ent.new"),
      () => this.confirmLeave(area ? this.draft !== null : !!(draft.name.trim() || draft.lights.length), back),
      html`<button class="pill save" ?disabled=${!valid || !changed || streaming || this.busy} @click=${save}>${t("scene.save")}</button>`,
      nothing,
      true,
    );
    const editing = this.editingName || !area;
    const body = html`<div class="sensor-hero">
        <ha-icon class="pic" icon=${TYPE_ICONS[draft.type] || TYPE_ICONS.other}></ha-icon>
        <div class="name-row">
          ${editing
            ? html`<input class="name-input" maxlength="32" .value=${draft.name} placeholder=${t("ent.name")} aria-label=${t("ent.name")}
                ?disabled=${streaming} @input=${(e: InputEvent) => set({ name: (e.target as HTMLInputElement).value })}
                @keydown=${(e: KeyboardEvent) => e.key === "Enter" && draft.name.trim() && (this.editingName = false)} />`
            : html`<h1 class="big">${draft.name}</h1>`}
          ${area
            ? html`<button class="round rename" ?disabled=${streaming} aria-label=${t("ent.name")} @click=${() => {
                this.editingName = !this.editingName;
                if (this.editingName) void this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".name-input")?.focus());
              }}>${icon("pencil")}</button>`
            : nothing}
        </div>
      </div>
      ${streaming ? banner({ title: t("ent.streaming"), text: t("space.streaming", { name: area!.name }), warn: true }) : nothing}
      ${lightsCard(ctx, {
        lights: draft.lights,
        locked: streaming,
        add: () => (this.adding = { picked: [], open: rooms.map((r) => r.key) }),
        remove: (id) => set({ lights: (this.draft ?? draft).lights.filter((l) => l !== id) }),
      })}
      <p class="hint">${t("ent.lights_hint")}</p>
      <div class="rows list">
        ${this.bridgePick(draft, set)}
        ${navRow({ title: t("ent.type"), value: t(`ent.type_${draft.type}` as StringKey), disabled: streaming, bare: true }, () =>
          this.choose(single(t("ent.type"), TYPES.map((type) => ({ value: type, label: t(`ent.type_${type}` as StringKey), icon: TYPE_ICONS[type] })), draft.type, (type) => set({ type: type as Draft["type"] }))),
        )}
        ${area
          ? navRow({ title: t("space.arrange"), sub: t("ent.arrange_sub"), disabled: streaming || this.draft !== null, bare: true }, () =>
              ctx.go(`/settings/entertainment/${encodeURIComponent(area.id)}/arrange`),
            )
          : nothing}
      </div>
      ${area
        ? html`<div class="delete-area">
            <button class="delete-btn" ?disabled=${streaming} @click=${() => this.askDelete(t("ent.delete_note"), t("ent.delete"), () => void remove())}>
              ${t("devices.delete")}
            </button>
          </div>`
        : nothing}`;
    return html`${this.screen(head, body, "sensor-edit ent-edit")}
      ${this.adding ? this.addSheet(draft, rooms, set) : nothing}`;
  }

  private addSheet(draft: Draft, rooms: LightRoom[], set: (patch: Partial<Draft>) => void) {
    const { ctx } = this;
    const adding = this.adding!;
    return addLightsSheet(ctx, {
      title: ctx.t("lights.add_to", { name: draft.name.trim() || ctx.t("ent.new") }),
      rooms,
      picked: adding.picked,
      open: adding.open,
      flip: (id) => (this.adding = { ...adding, picked: adding.picked.includes(id) ? adding.picked.filter((l) => l !== id) : [...adding.picked, id] }),
      fold: (key) => (this.adding = { ...adding, open: adding.open.includes(key) ? adding.open.filter((k) => k !== key) : [...adding.open, key] }),
      close: () => (this.adding = null),
      done: () => {
        set({ lights: [...(this.draft ?? draft).lights, ...adding.picked] });
        this.adding = null;
      },
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-entertainment-view": EntertainmentView;
  }
}
