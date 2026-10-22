# Design system

One set of parts for every screen of Hue Studio: the `/hue` panel, the more-info dialog
and sheets, and the dashboard cards. The reference is the Philips Hue app (its dark look,
measured on its screenshots at 1pt ≈ 2.09px); the system is built on Home Assistant's
model and its own needs where the Hue app has no counterpart.

- **Tokens** live in `src/tokens.ts` (pure, so tests and a future dashboard theme can read
  them). `styles.ts` turns them into CSS variables on every shadow root (`tokensCss()`).
- **Components** are CSS classes in `src/styles.ts` plus the template helpers that render
  them (`controls.ts`, `ui.ts`, `views/base.ts`, `views/choice.ts`, `wheel.ts`).
- **The rule:** a new screen is made of these parts. A part that is missing is added here
  (token or component, with where it is used) before the screen uses it. One-off sizes,
  colors and fonts don't go into views or styles.
- **Enforced** by `tests/js/styles.test.ts` for `styles.ts` and the CSS of cards, sheets
  and the dialog: type sizes only from the scale, weights 400/500/700 only, radii only from
  the scale (circles and a pin's drop aside), the named colors only through tokens, and
  every token a stylesheet uses must exist.

## Tokens

### Color

The Hue app's dark look whatever HA's theme is. Cards (`cards.ts`) map `--bg`, `--surface`,
`--surface-2`, `--text` and `--text-2` onto the dashboard's theme; everything else stays.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#1c1c1e` | page background (under a warm glow at the top) |
| `--surface` | `#2c2c2e` | cards, tiles, groups of rows |
| `--surface-2` | `#3a3a3c` | tiles on a surface, place tiles, step numbers |
| `--surface-sheet` | `#333336` | rows and bars inside a sheet |
| `--surface-raised` | `#4a4a4e` | tiles on a sheet's rows; empty picture placeholders |
| `--text` | `#fff` | text and icons |
| `--text-2` | 60% white | secondary text, values, subtitles, inactive tabs |
| `--text-3` | 30% white | outlines of checks and radios, faint text |
| `--text-dark` | `#1c1c1e` | text on light surfaces (a lit room in a light color, white buttons) |
| `--fill` | grey 28% | round buttons, pills, filter chips |
| `--fill-soft` | grey 24% | fields, search, segments, the wheels' band, days off |
| `--fill-strong` | grey 36% | a switch's track when off, step dots |
| `--fill-light` | 12% white | round buttons on tinted or colored surfaces |
| `--segment-on` | `#636366` | the chosen segment |
| `--separator` | 8% white | lines between rows, hairline borders |
| `--hairline` | 6% white | bar borders, pressed rows |
| `--outline` | grey 45% | outlined "add" tiles |
| `--selected` | `#fff` | ring of a chosen tile, chip or mode |
| `--accent` | `#0a62ff` | switches on, checks, the main button, "+" |
| `--info`, `--info-head`, `--info-mark`, `--info-line`, `--info-bg`, `--info-tint` | blues | links and info icons; the info banner (head, mark, border, background); info notes |
| `--warn`, `--warn-line`, `--warn-bg`, `--warn-tint` | amber | "Unreachable", warnings; the warning banner; mismatch notes |
| `--danger`, `--danger-fill`, `--danger-tint` | red | "Delete" and errors; a confirmed delete; the delete pill's fill |
| `--ok` | `#30d158` | motion now, ready, linked, done |
| `--sun` | warm yellow | active badges in a room's header, "now" tags |
| `--sync-tint` | violet | lights a Sync Box drives |

Picture art (the color wheel, mode discs, brightness gradients, Sync mode glows, automation
pictures) keeps its own colors: those are drawings, not interface.

### Type

Roboto from HA (`--ha-font-family-body`), the system font in the harness. **Weights 400,
500 and 700 only**: HA loads Roboto as separate files, so 600 renders as 700.

| Token | px | Use |
|---|---|---|
| `--fs-tab` | 10 | tab bar labels (uppercase) |
| `--fs-micro` | 11 | numbers over sliders, edge labels, a card's category |
| `--fs-caption` | 12 | section titles (uppercase, 1.4px tracking), a tile's lines under its name, meta |
| `--fs-footnote` | 13 | row subtitles, pills (uppercase), hints, banner heads, chips |
| `--fs-callout` | 14 | tile and scene names, leads, notes |
| `--fs-body` | 15 | row titles (500), banner text, the panel's default |
| `--fs-name` | 16 | home's room and zone names (a step above everything else); fields (iOS zooms in below 16) |
| `--fs-headline` | 17 | bar titles, automation card titles, action sheet rows, the chosen value on a wheel |
| `--fs-title-3` | 20 | big numbers, picture card titles |
| `--fs-title-2` | 22 | sheet titles, a name being edited |
| `--fs-title-1` | 24 | a tab's title in the desktop bar |
| `--fs-title` | 28 | the name on a thing's own screen (scene, sensor, device, automation); "+" questions |
| `--fs-large` | 30 | a tab's large title on phones |
| `--fs-display` | 34 | large titles on wide screens, an effect's screen |

### Radius

`--r-xs` 8 · `--r-s` 10 (fields, segments, menu rows) · `--r-m` 12 (gallery tiles, rows
inside sheets, place tiles) · `--r-l` 14 (groups of rows, flat cards) · `--r-xl` 16 (floating
cards: rooms, tiles, banners, automation cards) · `--r-2xl` 18 (sheets, dialogs) · `--r-3xl` 22
(a room's header, heroes) · `--r-full` (pills, switches, chips, tracks). Circles are `50%`.

### Shadow

`--shadow-flat` (rows, small cards, gallery tiles) · `--shadow-raised` (tiles, room cards,
heroes, sheet buttons) · `--shadow-overlay` (menus, sheets, the brightness track) ·
`--shadow-dot` (round pictures and discs). Pins and knobs keep their own small shadows.

### Size

| Token | px | |
|---|---|---|
| `--gutter` | 16 | a page's side margin |
| `--section-gap`, `--title-gap` | 22, 8 | a section title sits 22px under what is before it, 8px over its cards |
| `--control` | 32 | everything in a header: round buttons, the switch, header pills, search |
| `--round-s`, `--round-l` | 28, 40 | small round buttons (steppers, on tiles); large (play, flip) |
| `--pill` | 34 | an action button |
| `--switch-w`, `--knob` | 52, 24 | the switch: 52×32, a 24px knob 4px inside |
| `--row-h`, `--row-text`, `--row-icon` | 68, 72, 28 | a list row: its height, where its text starts, its icon |
| `--row-h-compact` | 52 | a row of controls inside a sheet |
| `--card-gap`, `--tile-gap` | 12, 10 | between cards; between tiles of a grid |
| `--light-tile` | 104 | a light or scene tile's width in rows that scroll sideways |

### Motion

`--ease` (most transitions), `--spring` (knobs, pins, sheets popping in), `--t-press`
(0.15s, a press). A pressed part sinks to `--press-round` (0.92, round buttons),
`--press-tile` (0.96, tiles, pills, small cards), `--press-card` (0.98, wide cards) or
`--press-row` (0.99, rows and banners). Everything that loops (dynamic scenes, sync glow,
spinners) stops or slows under `prefers-reduced-motion`.

## Components

Each part: its class (and helper), its measures, where it is used.

### Frame

- **Screen** (`StudioView.screen`, `.screen-head` + `.screen-body`): a fixed header over a
  body that scrolls on its own (`overflow: auto; overscroll-behavior: contain`). The panel
  never scrolls; sheets render outside the scrolling body.
- **Tab header** (`tabScreen`, `.tab-head`): on phones a clear bar over a large title
  (`--fs-large`); once the title scrolls under, the bar shows it (`--fs-headline`) and blurs.
  On desktop one row as tall as HA's sidebar header (`main.wide`), the title `--fs-title-1`.
- **Sub header** (`subHead`, `.bar.sub`): back (or close) round button, title `--fs-headline`,
  actions at the end ("Save" here, a grey pill). Everything in it is 32px tall.
- **Tab bar** (`nav.tabs`): icons 26px over `--fs-tab` labels; on top while the experimental
  footer is at the bottom. Hidden while the keyboard is up.
- **Page** (`.page`): max 960px, `--gutter` sides, a container for `@container` rules
  (600px: phones vs wide).

### Text

- **Large title** `h1.big` (`--fs-large`, 700; `--fs-display` from 600px).
- **Hero name** (`.scene-top`, `.sensor-hero`, `.automation-hero` h1.big): `--fs-title`;
  editable in place with `.name-input` (`--fs-title-2`) and a round pencil.
- **Section title** `h2.label`: `--fs-caption`, 500, uppercase, 1.4px tracking, `--text-2`;
  `--section-gap` above, `--title-gap` below. With a count or button: `.section-head`.
- **Lead** `.lead` (`--fs-callout`, `--text-2`) under a title; **hint** `.hint`
  (`--fs-footnote`) under rows; **empty** `.empty`.

### Buttons

- **Pill** `.pill`: 34px, `--fs-footnote` 500 uppercase, `--fill`; 32px in headers and
  banners. Variants: `.go` (white, the screen's primary action on dark), `.apply` (accent,
  under a settings screen's rows), `.outline`, `.danger` (red text), `.shuffle` (icon +
  text), `.reset` (min 180px wide). No bigger or smaller pills.
- **Delete** `.delete-btn`: the pill outlined in red at the bottom of an editor
  (`.delete-area`), confirm turns it solid.
- **Round** `.round`: 32px circle, `--fill`; `.mini` 28, `.mini-step` 28, `--round-l` 40
  (automation card's start, gradient flip); `.plus-blue` (accent "+"). Icons 22px (18 on small).
- **Text link** `.text-link` in `--info`.

### Inputs

- **Switch** `toggle()` / `.toggle`: 52×32, 24px knob, accent when on (dark translucent on a
  lit surface); one size everywhere. `lockedToggle()` when it can't be used.
- **Check** `.check` / `.pick-check`: a 24px round tick box (accent when on; `.some` for part
  of a room). **Radio** `.radio`: 24px ring.
- **Field** `.field` (44px, `--fs-headline`), **search** `.search-field` (32px),
  `.name-input`. All at least 16px.
- **Slider** `hue-studio-slider` / `.slider`: a 6px track, 16px knob (the Hue app's); the
  room/scene brightness, sheets. **Stepped slider** `.sens-slider` with names under its stops;
  **fade slider** on the fade and "Turn off after" sheets.
- **Brightness button** `.bri` (a pill you drag, opening `.bri-track` over a dim screen) on
  the color screen.
- **Wheels** `hue-studio-wheel` (`.wheels`, `.wheel-opt`): times are chosen on wheels, never
  the system picker (`momentChoice`, `timeChoice`, `timeWheels`).
- **Days** `.days-row`: seven 32px round toggles spread over a row.
- **Segments** `.seg`: up to four equal buttons (`.two`, `.three`) — used only where the Hue
  app has them (Sync intensity, connection type); a choice inside a section is a row that
  opens a list instead (`views/choice.ts`).
- **Chips** `.chip` (32px, a scene's room, the Sync Box picker), **filter chips**
  `.chip.filter-chip` (30px, uppercase; Devices, Light of the day).

### Rows

- **Group of rows** `.rows`: `--surface`, `--r-l`; full width on phones in settings,
  editors and device lists.
- **List row** (`.rows .item` inside `.settings-page`, `.sensor-edit`, `.choice-sheet`, and
  `.rows.device-list`): ≥ `--row-h`, a `--row-icon` icon in a 32px column, text from
  `--row-text`, a 500 `--fs-body` title over a 400 `--fs-footnote` line, the value on the
  right in `--text-2`, a chevron when it opens something; separators from the text on. In the
  automation editor rows have no icons (its type's icon sits by the name).
- **Compact row** (`.rows .item` elsewhere): ≥ `--row-h-compact`, for controls in a sheet.
- **Choice row** (`navRow`, `choiceRows`): a row with its value opens the list to pick from —
  a sheet for one value, a screen for several; the chosen one gets a tick.

### Cards and tiles

- **Room card** `.card.surface` (home): `--r-xl`, padding 18px, icon in its own column,
  name `--fs-name`, meta, switch, slider; tinted by the lights (`.surface.lit`, `--lit-bg`),
  drifting while dynamic.
- **Room header** `.hero`: the room's colors as a sheet glued to the top on phones, a card
  (`--r-3xl`) on wide screens.
- **Tile card** `tileCard()` / `.tile-card`: the one card layout for lights, scenes and
  sensors — picture 44px at a fixed distance from the top, a text block of fixed height
  (`--fs-callout` name, `--fs-caption` lines), an optional switch zone at the bottom; every
  tile as tall as any other; `--light-tile` wide in rows that scroll sideways.
- **Control card** `.control-card` (148×106, a room's "Controls": sensors).
- **Automation card** `automationCard()` / `.auto-card`: 86px tall, a 32px icon, text from
  72px, a `--fs-headline` title over a `--fs-body` line, the switch.
- **Type card** `.type-card`: an automation type's picture card (172px) on "+".
- **Gallery tile** `.tile`: 16:9 picture, name over a shade; rows that scroll sideways
  (`.tiles`), grids on wide screens and in pickers (`.scene-tiles`).
- **Place tile** `.place-tile` (a room or zone in the light picker), **kind tile**
  `.kind-tile` ("Add devices"), **mode tile** `.mode-tile` and **input tile** `.input-tile`
  (Sync), **effect tile** `.fx`.
- Rows of cards that scroll sideways keep their shadows' room inside (8px padding) and give
  it back outside (negative margin), so section titles stay `--title-gap` above them.

### Notes

- **Banner** `banner()` / `.banner`: the Hue app's — a 1.5px blue border (amber `.warn`), a
  round "i" and a spaced capital title, `--fs-body` grey text, own buttons, a round chevron
  when it leads somewhere. A Sync Box's is `syncBanner` (`.sync-banner`).
- **Note** `.sync-note` (info tint, 13px; `.all` centered for a screen that is locked),
  `.mismatch` (warn tint), `.power-cycle` (a step's art and text, info tint). Prefer a banner
  for anything new.
- **Toast** `.toast` at the bottom.

### Overlays

- **Sheet** `.sheet` + `.box`: centered card (`--r-2xl`, max 400–560px) on wide screens,
  from the bottom on phones (`.sheet.bottom`); bar `.sheet-bar` (`--surface-sheet`, title
  `--fs-name` 500, "Save" pill). Never inside a scrolling element.
- **Action sheet** `.sheet.menu.bottom` + `.action-sheet`: centered rows (`--fs-headline`),
  the red one, "Cancel" under a line.
- **Menu** `.menu`: a dropdown from a "⋯" button.
- **Scene sheet** (`scene-pick.ts`): picture with name and pencil, colors and shuffle, room,
  "Save to my scenes", "Set once".
- **Dialog** (`hue-studio-more-info.ts`) and **more-info sheets** (`automation-sheet.ts`,
  `scene-sheet.ts`): full screen from the bottom on phones, a card on wide screens.

### Color screen

Wheel `.wheel` (≤440px, the dock's leftover height) with pins `.pin` (42px drops; `.dot`
22px for other lights; `.stack` with a count; `.round` spread on a disc), mode discs
`.modes`, brightness `.bri`, gradient style sheet `.style-sheet`, effects rows `.fx-row`.

## Inventory

### The Hue app (reference)

Measured so far (on its screenshots, at 1pt ≈ 2.09px; phones are iPhone 17 Pro 402pt and
17 Pro Max 440pt):

| Screen | What is measured |
|---|---|
| Home | room and zone cards: names 16px (a step above everything else), padding 18px, icon column, name ~66px from the card's edge; switch 52×32 |
| Room | tiles 14px names; scenes in two rows of columns; lights row; "Controls"; slider under the bar |
| Scene editor, scene sheet | picture, name and pencil, brightness card, lights with shuffle; sheet with colors, room, two buttons |
| Automations | cards 86px, a 32px icon, text from 72px, 17px medium over 15px |
| Settings, devices, sensors, editors, choice sheets | list rows ≥68px, 28px icons, text from 72px, 15px medium over 13px regular |
| Time screens | "Start at": kinds as rows with a tick, the chosen one's wheels under it, "Done" in the header |
| Banners | 1.5px border, round "i", spaced capital title, 15px grey text, round chevron |

Still to measure, with the app's screenshots side by side: the color wheel and its dock,
effects, the gallery, Sync (modes, intensity, inputs, entertainment area), add devices,
bridges, MotionAware, sheets and pickers. Screenshots of the Hue app stay out of the
repository (git-ignored `reference/`).

### Hue Studio against it

| Screen (view) | Parts | Against the Hue app |
|---|---|---|
| Home (`home`) | tab header, room cards, banner, zones | matches |
| Room (`room`) | room header, tile cards (scenes, lights), control cards, chips, Sync card, banner | matches; sensor chips and the Sync card are ours |
| Color (`color`, `effects`, `effect-sheet`) | wheel, pins, modes, brightness, effect tiles, style sheet | matches; gradient style sheet is ours |
| Scene editor, new scene, scene sheet (`scene`, `new-scene`, `scene-pick`) | hero, rows, tile cards, sheet | matches |
| Gallery (`gallery`, `gallery-settings`) | tiles, search, list rows | gallery matches; seasonal rules are ours |
| Automations (`automations`, `automation-edit`, `automation-parts`, `choice`, `day-parts`, `daylight-settings`) | automation cards, type cards, list rows, wheels, days, sliders on sheets, place tiles | matches; light of the day is ours |
| Sync (`sync`) | hero, mode tiles, segments, input tiles, rows | ours, to be redone on the Hue app's Sync screens (roadmap S) |
| Settings (`settings`, `integration`, `rooms`, `experimental`) | list rows, banners | matches; rooms and zones, integration and experimental are ours |
| Devices (`devices`, `device`, `device-add`, `qr-scan`, `sensor`) | list rows, filter chips, search, kind tiles, steps, delete | matches |
| Bridges, MotionAware, entertainment (`bridges`, `bridge-add`, `motion-area`, `entertainment`, `space`) | list rows, steps, art, arrange view | matches; arranging lights without a Bridge Pro is ours |
| Moving between bridges (`bridge-move`, `lost`) | — | dropped (roadmap K), not maintained |
| More-info dialog and sheets, dashboard cards | the same parts | cards follow the dashboard's theme colors |

### Brought in line (2026-10-22)

- Every color, type size, radius and the common shadows moved to tokens; sizes merged onto
  the scale (18 → 17, 19 → 20, 26 → 28, 32 → 30/28, 36 → 34; radii 9/11 → 10, 13 → 14,
  half-height radii → full).
- One hero name size (`--fs-title`) for scene, sensor, device and automation screens (the
  sensor page was 24px by accident of a rule meant for the automation editor; the scene
  editor 32px).
- One list row for settings, editors, sensors, device lists and choice sheets (device rows
  were 70px with 30px icons, choice sheets 60px with 24px icons); compact rows 15px.
- Section titles 22px under what is before them everywhere (settings and sensor pages had 28px).
- One pill: the 40px "reset" pill, the 36px delete button, 30px banner pills and the
  14px header pills are gone; "Delete" is the pill outlined in red.
- One check (24px) for rows, choice lists and the light picker; radios 24px.
- `.sync-note` and `.check` were each defined twice; dead rules removed.
