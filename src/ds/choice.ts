// Choices like the Hue app's: a row says what is chosen ("Fade in · 30 min ›") and opens the
// list to choose from — a sheet for one value (from the bottom on phones), a screen of its
// own for several values or several lists, and times on a screen of wheels (momentChoice)
// or, a plain time of day, on wheels in place (timeWheels).
// Sections never hold a <select>, a segmented control or chips: the row tells, the list
// chooses.

import { html, nothing, type TemplateResult } from "lit";
import { classMap } from "lit/directives/class-map.js";

import { icon } from "./ui.ts";

export interface ChoiceOption {
  value: string;
  label: string;
  sub?: string;
  icon?: string;
  /** A CSS background for a round picture instead of the icon (a white, a scene's thumbnail). */
  art?: string;
  disabled?: boolean;
}

export interface ChoiceList {
  label?: string;
  hint?: string;
  options: ChoiceOption[];
  selected: string[];
  /** Several values (checks) instead of one (a tick). */
  multi?: boolean;
  /** Several values: the fewest that may stay chosen. */
  min?: number;
  pick: (values: string[]) => void;
}

export interface Choice {
  title: string;
  hint?: string;
  lists: ChoiceList[];
  /** A screen of its own (default: when it has several values or several lists). */
  screen?: boolean;
  /** A button under the lists (a screen of its own), e.g. back to the defaults. */
  action?: { label: string; run: () => void };
  /** A time screen instead of lists (momentChoice). */
  moment?: Moment;
}

/** One value out of `options`: a sheet that closes once picked. */
export function single(title: string, options: ChoiceOption[], current: string, pick: (value: string) => void, hint?: string): Choice {
  return { title, hint, lists: [{ options, selected: [current], pick: ([v]) => pick(v) }] };
}

/** Several values out of `options`: a screen of its own, every tap counts at once. */
export function several(
  title: string,
  options: ChoiceOption[],
  selected: string[],
  pick: (values: string[]) => void,
  { hint, min = 0 }: { hint?: string; min?: number } = {},
): Choice {
  return { title, hint, lists: [{ options, selected, multi: true, min, pick }] };
}

export const isScreen = (c: Choice): boolean => c.screen ?? (c.lists.length > 1 || c.lists.some((l) => l.multi));

/** The picture of a row or an option: a round art, an icon, or nothing. */
function lead(glyph?: string, art?: string): TemplateResult | typeof nothing {
  if (art) return html`<span class="row-art" style="background:${art}"></span>`;
  return glyph ? html`<ha-icon icon=${glyph}></ha-icon>` : nothing;
}

export interface Row {
  icon?: string;
  art?: string;
  title: string;
  sub?: string;
  /** What is chosen, on the right. */
  value?: string;
  /** The sub line in orange (something is missing). */
  warn?: boolean;
  disabled?: boolean;
  /** No chevron (the Hue app's lists that only lead on, e.g. a Sync Box's settings). */
  bare?: boolean;
}

/** A row that opens something: picture, title (and its line), the value, a chevron. */
export function navRow(row: Row, open: () => void): TemplateResult {
  return html`<button class="item nav" ?disabled=${row.disabled} @click=${open}>
    ${lead(row.icon, row.art)}
    <div class="grow">${row.title}${row.sub ? html`<div class=${classMap({ "dim small": true, warn: !!row.warn })}>${row.sub}</div>` : nothing}</div>
    ${row.value ? html`<span class="value">${row.value}</span>` : nothing}
    ${row.bare ? nothing : html`<ha-icon class="chevron" icon="mdi:chevron-right"></ha-icon>`}
  </button>`;
}

/** A kind of moment on a time screen: a time of day, or an offset from sunrise/sunset ("sun"); "none" shows no wheel. */
export interface MomentKind {
  value: string;
  label: string;
  wheel: "time" | "sun" | "none";
}

export interface MomentValue {
  kind: string;
  /** "HH:MM". */
  time: string;
  /** Minutes from sunrise/sunset (negative: before). */
  offset: number;
}

/**
 * A time screen like the Hue app's "Start at": each kind a row with a tick, the chosen one
 * opening its wheels under it (hours and minutes, or minutes before/after the sun). "Done"
 * in the header keeps what the wheels show, the close button leaves it as it was.
 */
export interface Moment extends MomentValue {
  kinds: MomentKind[];
  offsets: number[];
  offsetLabel: (kind: string, minutes: number) => string;
  done: (value: MomentValue) => void;
}

/** A time screen (a choice of its own). */
export function momentChoice(title: string, moment: Moment, hint?: string): Choice {
  return { title, hint, lists: [], screen: true, moment };
}

/** Just a time of day ("06:45") on a time screen. */
export function timeChoice(title: string, value: string, change: (hhmm: string) => void, hint?: string): Choice {
  return momentChoice(
    title,
    {
      kinds: [{ value: "time", label: title, wheel: "time" }],
      kind: "time",
      time: value,
      offset: 0,
      offsets: [],
      offsetLabel: () => "",
      done: (v) => change(v.time),
    },
    hint,
  );
}

const pad = (n: number): string => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: pad(h), label: pad(h) }));
const MINUTES = Array.from({ length: 60 }, (_, m) => ({ value: pad(m), label: pad(m) }));

/** Hours and minutes on two wheels side by side, one band across them ("HH:MM" in and out). */
export function timeWheels(value: string, change: (hhmm: string) => void): TemplateResult {
  const [h = "00", min = "00"] = value.split(":");
  return html`<div class="wheels time">
    <hue-studio-wheel .options=${HOURS} .value=${h} .change=${(v: string) => change(`${v}:${min}`)}></hue-studio-wheel>
    <hue-studio-wheel .options=${MINUTES} .value=${min} .change=${(v: string) => change(`${h}:${v}`)}></hue-studio-wheel>
  </div>`;
}

/** One list of a choice: its options with a tick (one value) or a check (several). */
export function choiceRows(list: ChoiceList, flip: (value: string) => void): TemplateResult {
  return html`${list.label ? html`<h2 class="label">${list.label}</h2>` : nothing}
    ${list.hint ? html`<p class="hint">${list.hint}</p>` : nothing}
    <div class="rows choice-list" role=${list.multi ? "group" : "radiogroup"}>
      ${list.options.map((o) => {
        const on = list.selected.includes(o.value);
        return html`<button class=${classMap({ item: true, on })} role=${list.multi ? "checkbox" : "radio"} aria-checked=${on}
          ?disabled=${o.disabled} @click=${() => flip(o.value)}>
          ${lead(o.icon, o.art)}
          <div class="grow">${o.label}${o.sub ? html`<div class="dim small">${o.sub}</div>` : nothing}</div>
          ${list.multi ? html`<span class="check">${icon("check")}</span>` : on ? html`<span class="tick">${icon("check")}</span>` : nothing}
        </button>`;
      })}
    </div>`;
}

/** With several bridges: the one something goes on, as a row opening the list of them. */
export function bridgeRow(
  title: string,
  bridges: [string, string][],
  current: string | null | undefined,
  choose: (choice: Choice) => void,
  pick: (id: string) => void,
): TemplateResult {
  const glyph = "mdi:router-wireless";
  return navRow({ icon: glyph, title, value: bridges.find(([id]) => id === current)?.[1] ?? "" }, () =>
    choose(single(title, bridges.map(([id, name]) => ({ value: id, label: name, icon: glyph })), current ?? "", pick)),
  );
}
