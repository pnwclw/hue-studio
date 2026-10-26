// Settings → Experimental: features that are still taking shape. None right now; the
// screen stays so the next one has a place.

import { html } from "lit";
import { customElement } from "lit/decorators.js";

import { StudioView } from "../../../ds/base.ts";

@customElement("hue-studio-experimental-view")
export class ExperimentalView extends StudioView {
  protected override render() {
    const { ctx } = this;
    const { t } = ctx;
    return this.screen(
      this.subHead(t("exp.title"), () => ctx.go("/settings")),
      html`<p class="lead">${t("exp.intro")}</p>
        <p class="lead">${t("exp.none")}</p>`,
      "settings-page",
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hue-studio-experimental-view": ExperimentalView;
  }
}
