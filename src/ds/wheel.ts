// A picker wheel like the Hue app's (and iOS's): the options scroll under a band in the
// middle, the ones away from it turn away like on a drum and fade. Native scrolling with
// scroll snapping does the physics (momentum on phones), so it feels like the system's.
// The value changes once the wheel comes to rest; a click on an option turns it there.

import { html, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";

import { haptic } from "../core/ha-internals.ts";
import { LightElement } from "./ui.ts";

/** Height of one option (px); the wheel shows five. */
const ROW = 32;

export interface WheelOption {
  value: string;
  label: string;
}

@customElement("hue-studio-wheel")
export class Wheel extends LightElement {
  @property({ attribute: false }) accessor options: WheelOption[] = [];
  @property() accessor value = "";
  @property({ attribute: false }) accessor change: (value: string) => void = () => {};

  /** The option in the band while scrolling (for the tick of haptics). */
  private shown = -1;
  private frame = 0;
  private rest?: ReturnType<typeof setTimeout>;

  private get scroller(): HTMLElement | null {
    return this.querySelector(":scope > .wheel-scroll");
  }

  private get index(): number {
    return Math.max(0, this.options.findIndex((o) => o.value === this.value));
  }

  protected override render() {
    return html`<div class="wheel-scroll" @scroll=${this.onScroll}>
      ${this.options.map((o, i) => html`<div class="wheel-opt" @click=${() => this.turnTo(i)}>${o.label}</div>`)}
    </div>`;
  }

  protected override updated(changed: PropertyValues): void {
    const scroller = this.scroller;
    if (!scroller) return;
    // Our own value or a new list: show it in the band (not while the user turns the wheel).
    if ((changed.has("value") || changed.has("options")) && Math.round(scroller.scrollTop / ROW) !== this.index) {
      scroller.scrollTop = this.index * ROW;
    }
    this.paint();
  }

  private onScroll = (): void => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.paint());
    clearTimeout(this.rest);
    this.rest = setTimeout(() => this.settle(), 120);
  };

  /** The drum: options turn away and fade with their distance from the band. */
  private paint(): void {
    const scroller = this.scroller;
    if (!scroller) return;
    const center = scroller.scrollTop / ROW;
    scroller.querySelectorAll<HTMLElement>(".wheel-opt").forEach((el, i) => {
      const d = Math.max(-3, Math.min(3, i - center));
      el.style.transform = `rotateX(${(-d * 24).toFixed(1)}deg)`;
      el.style.opacity = String(Math.max(0.12, 1 - Math.abs(d) * 0.32));
      el.classList.toggle("on", Math.abs(d) < 0.5);
    });
    const shown = Math.round(center);
    if (shown !== this.shown) {
      if (this.shown >= 0) haptic("selection");
      this.shown = shown;
    }
  }

  private settle(): void {
    const scroller = this.scroller;
    if (!scroller || !this.options.length) return;
    const i = Math.max(0, Math.min(this.options.length - 1, Math.round(scroller.scrollTop / ROW)));
    const value = this.options[i].value;
    if (value !== this.value) {
      this.value = value;
      this.change(value);
    }
  }

  private turnTo(i: number): void {
    this.scroller?.scrollTo({ top: i * ROW, behavior: "smooth" });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    cancelAnimationFrame(this.frame);
    clearTimeout(this.rest);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-wheel": Wheel;
  }
}
