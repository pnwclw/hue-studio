// Styles. Dark look of the Hue app regardless of the HA theme. One stylesheet for the panel's
// (or dialog's) shadow root: views and controls render into the light DOM below it. Every
// color, type size, radius, shadow and part size comes from the design system's tokens
// (tokens.ts, docs/design-system.md); tests/js/styles.test.ts keeps one-off values out.
// The sheet is split by area into the files here and joined in this order: the cascade
// depends on it (a later rule wins over an earlier one of the same weight), so a rule moves
// from one file to another only with care.

import { AUTOMATION_EDITOR_CSS } from "./automation-editor.ts";
import { AUTOMATIONS_CSS } from "./automations.ts";
import { BANNER_CSS } from "./banner.ts";
import { CHOICES_CSS } from "./choices.ts";
import { COLOR_CSS } from "./color.ts";
import { CONTROLS_CSS } from "./controls.ts";
import { DAYLIGHT_CSS } from "./daylight.ts";
import { DEVICES_CSS } from "./devices.ts";
import { EDITORS_CSS } from "./editors.ts";
import { FLOWS_CSS } from "./flows.ts";
import { GALLERY_CSS } from "./gallery.ts";
import { HOME_CSS } from "./home.ts";
import { OVERLAYS_CSS } from "./overlays.ts";
import { ROOM_CSS } from "./room.ts";
import { ROOM_SCENES_CSS } from "./room-scenes.ts";
import { ROOMS_CSS } from "./rooms.ts";
import { ROWS_CSS } from "./rows.ts";
import { SENSOR_CSS } from "./sensor.ts";
import { SHEETS_CSS } from "./sheets.ts";
import { SHELL_CSS } from "./shell.ts";
import { SPACE_CSS } from "./space.ts";
import { SYNC_CSS } from "./sync.ts";
import { WIDE_CSS } from "./wide.ts";

export const CSS = [
  SHELL_CSS,
  CONTROLS_CSS,
  HOME_CSS,
  ROOM_CSS,
  COLOR_CSS,
  EDITORS_CSS,
  GALLERY_CSS,
  SHEETS_CSS,
  SYNC_CSS,
  FLOWS_CSS,
  ROOM_SCENES_CSS,
  ROOMS_CSS,
  SENSOR_CSS,
  OVERLAYS_CSS,
  DEVICES_CSS,
  AUTOMATIONS_CSS,
  DAYLIGHT_CSS,
  SPACE_CSS,
  BANNER_CSS,
  ROWS_CSS,
  AUTOMATION_EDITOR_CSS,
  CHOICES_CSS,
  WIDE_CSS,
].join("");
