# Design system

One set of parts for every screen of Hue Studio: the `/hue` panel, the more-info dialog
and sheets, and the dashboard cards. The reference is the Philips Hue app, measured on the
app itself (6.3, Android, in an emulator: sizes in dp, which are px here); the system is
built on Home Assistant's model and its own needs where the Hue app has no counterpart.

- **Tokens** live in `src/ds/tokens.ts` (pure, so tests and a future dashboard theme can read
  them). The stylesheet turns them into CSS variables on every shadow root (`tokensCss()`).
- **Components** are CSS classes in the stylesheet, `src/ds/styles/` (one sheet split by area,
  joined in order by `index.ts`: the cascade depends on that order), plus the template helpers
  that render them (`controls.ts`, `ui.ts`, `base.ts`, `choice.ts`, `wheel.ts`, all in `src/ds/`).
- **The rule:** a new screen is made of these parts. A part that is missing is added here
  (token or component, with where it is used) before the screen uses it. One-off sizes,
  colors and fonts don't go into views or styles.
- **Enforced** by `tests/js/styles.test.ts` for the stylesheet and the CSS of cards, sheets
  and the dialog: type sizes only from the scale, weights 400/500/700 only, radii only from
  the scale (circles and a pin's drop aside), the named colors only through tokens, and
  every token a stylesheet uses must exist.

## How the Hue app was measured

The Hue app is a Flutter app with its own design system (`hux`) and the Söhne typeface:
Buch (400) for text, Kräftig (500) for titles and labels, Breit Halbfett (wide, 600) for
large titles. Söhne's cap height is 0.718 em, Roboto's 0.711, so a size measured as cap
height ÷ 0.718 carries over to Roboto as it is; Roboto 700 stands in for Söhne Breit.

Screens were captured from the app in the Android emulator (`adb exec-out screencap`, 1080
px at 420 dpi: 1dp = 2.625 px), element boxes read with `uiautomator dump` where it answers
(it can stall a Flutter app: use it sparingly), and text measured by the height of its
first capital, colors by the brightest pixel of a text or a sample of a surface, radii by
fitting the curve of a corner. Navigation was read-only: no switch, slider or scene was
touched (a scene, even from the gallery, shows on the lights). The screenshots stay in the
git-ignored `reference/hue-app/` (they show a real home).

## Tokens

### Color

The Hue app's dark look whatever HA's theme is. Cards (`cards.ts`) map `--bg`, `--surface`,
`--surface-2`, `--surface-row`, `--text` and `--text-2` onto the dashboard's theme;
everything else stays.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#181b1f` | page background (under the page's glow, below) |
| `--surface` | white 12% | cards and tiles: rooms, scenes, lights, controls; over the page, so they take its glow (`#34353a` on the plain page) |
| `--surface-low` | white 10% | automation cards, chips and filter chips (`#2f3235` on the plain page) |
| `--surface-2` | `#36383c` | tiles on a surface, header pills |
| `--surface-row` | `#24262a` | groups of list rows (in sheets too), action sheets |
| `--surface-bar` | `#26282c` | header bars: a sheet's and a sub screen's, a shade over the rows (Hue app, measured) |
| `--surface-raised` | `#47484c` | round buttons on a bar, tiles on a sheet's rows |
| `--text` | `#fff` | text and icons |
| `--text-2` | `#babbbc` | secondary text, values, subtitles, section titles |
| `--text-3` | `#818385` | outlines of checks and radios, faint text |
| `--text-dark` | `#1c1c1e` | text on light surfaces (a lit room in a light color, white buttons) |
| `--fill` | grey 28% | round buttons, pills, filter chips |
| `--fill-soft` | grey 24% | fields, search, the wheels' band, days off |
| `--fill-strong` | grey 36% | step dots |
| `--fill-light` | 12% white | round buttons on tinted or colored surfaces, a header pill on a tinted bar |
| `--round` | 15% white | round buttons (`#47484c` on a bar), an automation card's play |
| `--switch-off` | `#5e5e61` | a switch's track when off |
| `--separator` | 10% white | lines between rows, hairline borders |
| `--hairline` | 6% white | bar borders, pressed rows |
| `--scrim` | 70% black | under every overlay (sheets, popovers, the brightness slider): a plain dim, no blur (Hue app, measured) |
| `--scrim-blur` | 50% black | under an action sheet (a question: leave, delete, a scene's "⋯"), over a 16px blur (Hue app, measured) |
| `--outline` | grey 45% | outlined "add" tiles |
| `--selected` | `#fff` | ring of a chosen tile or mode |
| `--accent` | `#006aff` | switches on, checks, the main button, "+", a chosen chip's ring |
| `--bar-bottom`, `--tab-off`, `--tab-on` | `#0d1013`, `#404345`, `#b9baba` | the tab bar (the page fading into it); its tabs that are not chosen; the chosen one (grey, not white) |
| `--glow-blue`, `--glow-blue-wash` | blues | Automations' glow at the top of the page |
| `--glow-violet`, `--glow-violet-wash` | violets | the empty Sync tab's glow (no box yet: the onboarding) |
| `--picker-top`, `--picker-top-2` | `#08225d`, `#091b40` | a picker's deep blue top (gallery, a new automation's types, a room's "+") |
| `--info`, `--info-head`, `--info-mark`, `--info-line`, `--info-bg`, `--info-tint` | blues | links and info icons; the info banner (title, mark and border in the accent, `#171f2a` inside); info notes |
| `--warn`, `--warn-line`, `--warn-bg`, `--warn-tint` | amber | "Unreachable", warnings; the warning banner; mismatch notes |
| `--danger`, `--danger-fill`, `--danger-tint` | `#e63535` | "Delete" and errors; a confirmed delete; the delete pill's fill |
| `--ok` | `#30d158` | motion now, ready, linked, done |
| `--sun` | warm yellow | active badges in a room's header, "now" tags |
| `--sync-tint` | violet | lights a Sync Box drives |

Picture art (the color wheel, mode discs, brightness gradients, Sync mode glows, automation
pictures) keeps its own colors: those are drawings, not interface.

**The page's glow** (`main.glow-*`, the panel picks it per screen): Home and a room fade from
their lit lights' mean color (10% over the page, `glowColor` in `model.ts`) at the top to the
page at the bottom, over the whole height, and have none when nothing is lit; Automations has
a blue glow at the top (gone by ~330px), the empty Sync tab a violet one; Settings and sub screens have
none. On a sheet the glow is the sheet's.

### Type

Roboto from HA (`--ha-font-family-body`), the system font in the harness. **Weights 400,
500 and 700 only**: HA loads Roboto as separate files, so 600 renders as 700.

| Token | px | Use (Hue app measure) |
|---|---|---|
| `--fs-label` | 10 | section titles (500, uppercase, 1.4px tracking), banner titles, small capitals over a value |
| `--fs-tab` | 11 | tab bar labels (uppercase), numbers under a slider |
| `--fs-caption` | 12 | row subtitles, a tile's lines under its name, hints in sheets, meta |
| `--fs-footnote` | 13 | values on the right of a row, pills, chips, banner text, gallery tile names, "Delete" |
| `--fs-callout` | 14 | light and scene tile names, notes |
| `--fs-body` | 16 | row titles (500), room and zone names, bar and sheet titles, automation card titles, leads, the panel's default; fields (iOS zooms in below 16) |
| `--fs-headline` | 17 | action sheet rows, the chosen value on a wheel, fields |
| `--fs-title-3` | 20 | big numbers, picture card titles |
| `--fs-title-2` | 22 | a name being edited |
| `--fs-title-1` | 24 | a tab's title in the desktop bar |
| `--fs-title` | 28 | a sheet's question or title ("What kind of automation…", "Hue scene gallery") |
| `--fs-large` | 34 | a tab's large title and the name on a thing's own screen (scene, sensor, device, automation): Söhne Breit in the Hue app, Roboto 700 here |

### Radius

`--r-xs` 8 · `--r-s` 10 (fields, menu rows) · `--r-m` 12 (every card and tile:
rooms, scenes, lights, automations, gallery, banners, groups of rows) · `--r-2xl` 18
(sheets, dialogs) · `--r-3xl` 22 (a room's header on wide screens, heroes) · `--r-full`
(pills, switches, chips, tracks). Circles are `50%`.

### Shadow

`--shadow-row` (a group of rows, in sheets too: short and dense, the Hue app's) ·
`--shadow-bar` (under a header bar, a sheet's or a sub screen's: long and soft) ·
`--shadow-flat` (small cards, gallery tiles, pills such as Sync's) · `--shadow-raised`
(tiles, room cards, heroes, sheet buttons, the Sync picture and dock) · `--shadow-overlay`
(menus, sheets, popovers, the brightness track) · `--shadow-dot` (round pictures and discs,
round buttons standing on their own like the Sync dock's). The Hue app's cards cast almost no shadow; ours
are kept soft. Pins and knobs keep their own small shadows.

### Size

| Token | px | |
|---|---|---|
| `--gutter`, `--text-inset` | 12, 4 | cards sit 12px from the screen's edge; section titles and leads 4px further in (16) |
| `--section-gap`, `--title-gap` | 32, 8 | a section title sits 32px under the cards before it, 8px over its own |
| `--control` | 32 | everything in a header: round buttons, the switch, header pills, search; chips |
| `--round-s`, `--round-l` | 28, 40 | small round buttons (steppers, on tiles); large (play, flip) |
| `--pill` | 36 | an action button |
| `--switch-w`, `--knob` | 52, 24 | the switch: 52×32, a 24px knob 4px inside |
| `--row-h`, `--row-text`, `--row-icon` | 72, 72, 28 | a list row: its height, where its text starts, its icon (centered 32px in: an MDI glyph at 28 fills 24 like the Hue app's; 32px in device lists) |
| `--row-h-compact` | 52 | a row of controls inside a sheet |
| `--card-gap`, `--tile-gap` | 12, 12 | between cards; between tiles |
| `--light-tile` | 102 | a light or scene tile's width |

### Motion

`--ease` (most transitions), `--spring` (knobs, pins, sheets popping in), `--t-press`
(0.15s, a press). A pressed part sinks to `--press-round` (0.92, round buttons),
`--press-tile` (0.96, tiles, pills, small cards), `--press-card` (0.98, wide cards) or
`--press-row` (0.99, rows and banners). Everything that loops (dynamic scenes, sync glow,
spinners) stops or slows under `prefers-reduced-motion`.

Measured on the Hue app from 60 fps screen recordings (frame by frame, the edge of the
moving part against time):

- **A picker comes and goes as a sheet** (`main.rise`, `main.fall`): up from the bottom over
  the screen it was opened from in `--t-sheet-up` (0.22s), back down over the screen it
  returns to in `--t-sheet-down` (0.24s), both on `--decelerate` (an ease-out cubic: half
  the way in a fifth of the time). The screen under it stays as it was (the same element,
  its scroll too); nothing dims.
- **A scene's card** slides up from 55% of the screen's height at an even speed
  (`--t-card-in`, 0.17s, linear) while the dim fades in (`--t-dim-in`, 0.17s,
  `--decelerate`); it goes down off the screen at the same speed (`--t-card-out`, 0.2s)
  while the dim fades out after it (`--t-dim-out`, 0.28s, `--accelerate`). The cards swipe
  sideways one at a time (scroll snapping, the browser's own settling); a card beside the
  middle one brings itself to the middle when tapped.
- The card in the middle shows on the room's lights (the Hue app's): as the card opens,
  then each card a swipe brings there once it has settled; closing it without "Save to my
  scenes" or "Set once" puts the lights back as they were (scenes/preview.py).
- Shuffle does not move the dots in the Hue app (it deals the colors to the lights anew);
  here the dots take the new order too, and the lights follow.
- Under `prefers-reduced-motion` the sheets and cards appear and go without sliding.

## Components

Each part: its class (and helper), its measures, where it is used.

### Frame

- **Screen** (`StudioView.screen`, `.screen-head` + `.screen-body`): a fixed header over a
  body that scrolls on its own (`overflow: auto; overscroll-behavior: contain`). The panel
  never scrolls; sheets render outside the scrolling body.
- **Sub screen header** (`.screen-head` with `.bar.sub`): a solid bar in `--surface-bar` with
  `--shadow-bar` under it, the Hue app's (not translucent, no hairline). The first group of
  rows starts 20px under it (a lead 32px).
- **Editor as a sheet** (`main.as-sheet`, phones): an editor (scene, automation, zone, a
  device's, sensor's, bridge's or Sync Box's settings) starts 8px under the status bar with its top
  corners `--r-m`, the screen behind it dimmed (`--scrim`), no tab bar; its bar's first button
  closes it (`subHead(…, close)`). Its "SAVE" stays grey until something changed; closing it
  with changes asks "Close and don't save" (`confirmLeave` / `leaveSheet` in `base.ts`).
- **Picker** (`main.picker`; the room's "+" `.add-picker`): the gallery, a new automation's
  types and a room's "+" — a deep blue top (`--picker-top`) with the close or back button on
  it and the page as a panel over it from 80px: corners `--r-2xl`, a 1px light edge
  (`--surface-low`), 20px in, its title (`--fs-title`) 24px in.
- **Tab header** (`tabScreen`, `.tab-head`): on phones a clear bar over a large title
  (`--fs-large`); once the title scrolls under, the bar shows it (`--fs-body`) and blurs.
  On desktop one row as tall as HA's sidebar header (`main.wide`), the title `--fs-title-1`.
- **Sub header** (`subHead`, `.bar.sub`): back (or close) round button at 16, title
  `--fs-body` 500 at 72 (where list rows' text starts; so in every bar and sheet bar), actions at the end ("Save" here, an uppercase grey pill). Everything
  in it is 32px tall.
- **Tab bar** (`nav.tabs`): the page fading into `--bar-bottom` over 40px (no line), icons
  26px over `--fs-tab` labels, the chosen tab in `--tab-on`, the others in `--tab-off`. Hidden while the keyboard is up, under a
  sheet that fills the screen and under the room's "+"; dimmed under any other sheet (and
  blurred under an action sheet), like the screen.
- **Page** (`.page`): max 960px, `--gutter` sides, a container for `@container` rules
  (600px: phones vs wide).

### Text

- **Large title** `h1.big` (`--fs-large`, 700).
- **Hero name** (`.scene-top`, `.sensor-hero`, `.automation-hero` h1.big): `--fs-large`,
  wrapping; editable in place with `.name-input` (`--fs-title-2`) and a round pencil.
- **Section title** `h2.label`: `--fs-label`, 500, uppercase, 1.4px tracking, `--text-2`;
  `--section-gap` above, `--title-gap` below, `--text-inset` in. With a count or button:
  `.section-head`.
- **Lead** `.lead` (`--fs-callout`, `--text-2`) under a title; **hint** `.hint`
  (`--fs-footnote`) under rows; **empty** `.empty`.

### Buttons

- **Pill** `.pill`: 36px, `--fs-footnote` 500 in sentence case, 24px of room on each side,
  `--surface-raised`; in headers and banners 32px, 14px of room, `--surface-2` and uppercase
  ("SAVE", "DONE"; `--fill-light` on a tinted bar), grey even for the main action. `.apply`
  is the screen's main action everywhere else (the accent); there is no white pill. Variants: `.go` (white, the screen's primary
  action on dark), `.apply` (accent, a screen's main button), `.outline`, `.danger` (red
  text), `.shuffle` (icon + text), `.reset` (min 180px wide). No other sizes.
- **Delete** `.delete-btn`: the pill with a 2px red border and a red tint (`--danger-tint`),
  centered 40px under an editor's rows (`.delete-area`; a scene's "Reset" over it, 12px
  apart), "Delete" in sentence case; confirm turns it solid.
- **Round** `.round`: 32px circle, `--round`; `.mini` 28, `.mini-step` 28, `--round-l` 40
  (automation card's start, gradient flip); `.plus-blue` (accent "+"). Icons 22px (18 on small).
- **Text link** `.text-link` in `--info`.

### Inputs

- **Switch** `toggle()` / `.toggle`: 52×32, 24px knob, `--switch-off` track, accent when on
  (dark translucent on a lit surface); one size everywhere. `lockedToggle()` when it can't
  be used.
- **Check** `.check` / `.pick-check`: a 24px round tick box (accent when on; `.some` for part
  of a room). **Radio** `.radio`: 24px ring.
- **Field** `.field` (44px, `--fs-headline`); **filled field** `.field.filled` (48px,
  `--surface`, no border: a Sync Box input's name); **icon grid** `.icon-grid` / `.icon-opt`
  (three columns of 128px cells, a 40px disc over the name, the accent when chosen);
  **outlined field** `.field.outlined`, the Hue
  app's (46px, a 1.5px `--outline` border, `--r-xs`, `--surface`, 16px: names on sheets,
  addresses and codes in flows, a zone's name); **search** `.search-field` (32px),
  `.name-input`. All at least 16px.
- **Slider** `hue-studio-slider` / `.slider`: an 8px track, 16px knob (the Hue app's), 12px
  in from a card's edges; the room/scene brightness, sheets. **Stepped slider**
  `.sens-slider` with names under its stops; **fade slider** on the fade and "Turn off
  after" sheets.
- **Brightness button** `BrightnessControl` (controls.ts) / `.bri`: a pill you drag, its value
  (or a caption) over it, opening `.bri-track` over a dimmed screen; the color screen (a group
  of lights) and the Sync screen (the box) feed it a `BrightnessSource`.
- **Wheels** `hue-studio-wheel` (`.wheels`, `.wheel-opt`): times are chosen on wheels, never
  the system picker (`momentChoice`, `timeChoice`, `timeWheels`).
- **Days** `.days-row`: seven 32px round toggles spread over a row.
- **Chips** `.chip` (32px, 13px, `--surface-low` with a flat shadow, grey text; the chosen one
  white on `--info-tint`, ringed 2px in the accent: a scene's room, a bridge, the Sync Box
  picker), **filter chips** `.chip.filter-chip` (32px, 13px grey capitals not spaced, a white
  24px chevron; Devices, Light of the day). A section's count beside its title is 12px.

### Rows

- **Group of rows** `.rows`: `--surface-row`, `--r-m`; full width on phones in settings,
  editors and device lists; the first one 20 under a sub screen's bar, one after a hint 20
  under it. **Row disc** `.row-art.disc`: a 48px disc at 12 (`--surface-raised`), text at 72;
  a picture on it (today's scene of the light of the day and of an automation, its actions
  as pills under the group).
- **List row** (`.rows .item` inside `.settings-page`, `.sensor-edit`, `.choice-sheet`, and
  `.rows.device-list`): ≥ `--row-h`, a `--row-icon` (28) icon centered 32px in, so an MDI
  glyph is as big as the Hue app's 24px ones (32px icons at 16 in device lists), text from `--row-text`, a 500 `--fs-body` title over a 400 `--fs-caption` line,
  the value on the right in `--fs-footnote` `--text-2`, a chevron when it opens something;
  separators from the text on. In the automation editor rows have no icons and their text
  starts at 16 (its type's icon sits by the name).
- **Compact row** (`.rows .item` elsewhere): ≥ `--row-h-compact`, for controls in a sheet.
  Choices in a device's or sensor's sheet (`.sensor-sheet`) are list rows; a choice with a
  picture (`.row-art.pic`, 40px: its light on a disc, or its sign on a dark one) keeps its
  text at 72. A device's facts ("Device info") are rows with the value under the title.
- **Choice row** (`navRow`, `choiceRows`): a row with its value opens the list to pick from —
  (`bare`: no chevron, for lists that only lead on, as a Sync Box's settings) —
  a sheet for one value, a screen for several; the chosen one gets a tick. Its caption keeps
  to one line and its value to 42% of the row, both cut short with an ellipsis.

### Cards and tiles

- **Room card** `.card.surface` (home): 96px, `--r-m`, padding 18px, a 28px icon 18px in,
  the name (`--fs-body` 500) 73px from the edge, the switch, the slider; tinted by the
  lights (`.surface.lit`, `--lit-bg`), drifting while dynamic.
- **Room header** `.hero`: the room's colors as a sheet glued to the top on phones (its
  bottom corners `--r-m`), a card (`--r-3xl`) on wide screens.
- **Tile card** `tileCard()` / `.tile-card`: the one card layout for lights, scenes and
  sensors — 102px wide, a 48px picture 12px from the top, a text block of fixed height
  (`--fs-callout` name, `--fs-caption` lines), 110px tall, 160px with the switch zone (56px)
  of a light; every tile as tall as any other.
- **Control card** `.control-card` (150×108, a room's "Controls": sensors): a 24px icon 20px
  in and the switch 16px from the top, the name `--fs-callout` 500 over a `--fs-caption` line.
- **Automation card** `automationCard()` / `.auto-card`: ≥72px, `--surface-low`, a 32px
  icon, text from 72px (from 16 without the icon, under its type's header), a `--fs-body`
  title over a `--fs-footnote` line, play (32px) and the switch.
- **Type header** `.auto-type` (the Automations tab): the type's icon in a 32px column at 16,
  its name `--fs-body` 500 at 72, the count (13px) and a round button that folds its cards;
  48px tall, 24px under the cards before it.
- **New scene** (`scene.ts`, `/room/<key>/scene/new`, the Hue app's "Custom scene"): a
  picker; its name asked first on a name sheet; picture (the lights' colors) 48 and name 34
  12px into the panel, the brightness and lights cards rounded 20px in, 20px apart; "Save"
  in the footer; leaving asks "Close and don't save" on an action sheet.
- **Flow** (`.flow`: `flow()`, `flowTitle()` and `flowRing()` in `base.ts`; "Add devices",
  "Add a bridge", a new MotionAware area; the Hue app's): every step a picker; steps with a
  picture show it on the blue (`.flow-art`, up to 378px, the panel under it), the others
  start the panel at the top; a 28px title (`.flow-title`), a 16px grey lead, the buttons
  in a stacked footer (`.screen-foot.stack`: grey or outlined ones over the accent one).
  The search is a 300px ring (`.flow-ring`, a 3px track, the accent arc; a short arc going
  round while the end is not known) around the kind's picture, a 40px badge at its top right
  once over (green tick, red cross; the ring red too when nothing was found). Devices as
  tiles (`.dev-tile`: 120×115, a 32px icon at the top left, the name 14 at the bottom, a
  blue tick when found); rooms as rows in a rounded group (`.rows.inset`) under their
  bridge's name, "Create new room" with the accent "+".
- **Pick tile** `.pick-tile` (a room's "+"): two columns 12px apart, 156px tall, a 72px dark
  disc with a 40px icon over the name (`--fs-body` 500); `.way` (a scene's ways) 108px, the
  picture at the top left, the name (`--fs-callout` 500) at the bottom.
- **Type card** `.type-card`: an automation type's picture card on "+".
- **Gallery tile** `.tile`: 16:9 picture (147×83 in the Hue app), name over a shade; rows
  that scroll sideways (`.tiles`), grids on wide screens and in pickers (`.scene-tiles`).
- **Place tile** `.place-tile` (a room or zone in the light picker), **kind tile**
  `.kind-tile` ("Add devices"), **mode tile** `.mode-tile` and **input tile** `.input-tile`
  (Sync), **effect tile** `.fx`.
- Rows of cards that scroll sideways keep their shadows' room inside (8px padding) and give
  it back outside (negative margin), so section titles stay `--title-gap` above them.

### Notes

- **Banner** `banner()` / `.banner`: the Hue app's — a 1.5px border (the accent, amber
  `.warn`), a round "i" and a spaced capital title (`--fs-label`), `--fs-footnote` grey text,
  own buttons, a round chevron when it leads somewhere; 14px from the banners and rows
  around it. A Sync Box's is `syncBanner` (`.sync-banner`).
- **Note** `.sync-note` (info tint, 13px; `.all` centered for a screen that is locked),
  `.mismatch` (warn tint), `.power-cycle` (a step's art and text, info tint). Prefer a banner
  for anything new.
- **Empty state** `.empty-state` + `.empty-art`: a centered title (`--fs-title`), a
  `--fs-body` grey lead, a round picture; its button in the footer (a Sync Box's "TV remote
  control" with no buttons learned).
- **Toast** `.toast` at the bottom.

### Overlays

- **Scrim**: every overlay (sheet, popover, the brightness slider) lies over the same
  `--scrim`, a plain 70% dim with no blur, as in the Hue app.

- **Sheet** `.sheet` + `.box`: centered card (`--r-m`, max 400–560px) on wide screens, from
  the bottom on phones (`.sheet.bottom`, top corners `--r-m`). Three layers, the Hue app's
  (measured on its "Function" sheet): the bar `.sheet-bar` (56px, `--surface-bar`,
  `--shadow-bar`; close round button, title `--fs-body` 500, "DONE"/"SAVE" pill), the body
  in the page's color (`--bg`) with its hint in `--fs-body` `--text-2` (24px above the
  rows), and groups of rows across the whole sheet (`--surface-row`, no radius,
  `--shadow-row`). Never inside a scrolling element.
- **Action sheet** `.sheet.menu.bottom` + `.action-sheet`: 12px from the edges, an optional
  note on top (`.note`, 13px grey, centered, a line under it), 56px centered rows
  (`--fs-body`), the red one, "CANCEL" (13px capitals) under a line, over the screen
  blurred and dimmed (`--scrim-blur`). Questions use it through `askSheet` (`base.ts`):
  leaving with changes (`confirmLeave`) and every delete (`askDelete`: "By deleting this
  light, it can no longer be controlled." / "Delete light"), never a button that turns into
  "Tap again".
- **Tall sheet** (`.sheet.bottom.tall`): fills the screen under the status bar ("Power on",
  "Device info", a scene's picture); the shorter choices ("Function", "Room") rise from the bottom as tall as
  their rows.
- **Name sheet** (`.name-sheet`): "Scene name" in the sheet bar with close and "DONE", the
  name in a 46px field with a 1.5px `--outline` border and a round clear button.
- **Footer** `.screen-foot`: a line over the screen's one action (the accent pill), centered,
  the safe area under it (a new scene's "Save").
- **Menu** `.menu`: a dropdown from a "⋯" button.
- **Scene card** (`scene-pick.ts`, `.scene-pick`): a card 26 from the screen's sides (at
  most 420); the picture 16:9 with the name (`--fs-title-1`, 16 in) and a round close at
  12; the colors on a 72 strip (`--surface-low`): dots 32, 22 apart, from 12, with shuffle
  and the pencil as round buttons (`--round`) 8 apart at the right; "Save to my scenes"
  (outlined, a 2px `--separator` ring) over "Set once" (`--round`) on `--surface-row`, 12
  apart and 12 in: 32px pills in capitals, both as wide as the wider. The gallery's room is
  fixed; "Copy to…" (ours) adds the room or zone as a row between the strip and the pills.
  The gallery's scenes are a row of such cards, 12 apart, the neighbours showing at the
  sides; a swipe brings the next one to the middle (Motion).
- **Dialog** (`hue-studio-more-info.ts`) and **more-info sheets** (`automation-sheet.ts`,
  `scene-sheet.ts`): full screen from the bottom on phones, a card on wide screens.

### Sync

The Hue app's Sync tab and a Sync Box's settings, measured on 2026-10-26 on the Android
app with a live box (HSB2) at 411dp; the iOS screenshots of 2026-10-23 agree (the tab's
parts scale with the width: 238 and 95 at 440). Everything here is made of the parts
above; the Sync tab adds its stage, popovers and dock.

**Tab** (`features/sync/views/sync.ts`): no title; in the header "+" (add a box), "⋯" (the box's
settings) and the box's power switch. The page has no glow (the violet one belongs to the
empty tab, the Hue app's onboarding). Over the controls, centered in the room between the
header and the controls:

- **Picture** `.sync-picture`: what plays, a square 54% of the width (223 at 411, at most
  238), square corners, `--surface` darkening toward the bottom (`#3b3d41` → `#2f3235`),
  `--shadow-raised`; the input's type as a 120px glyph; glowing in the mode's colors while
  syncing.
- **Caption** `.sync-caption`, 20 under it: the box's name in small capitals
  (`--fs-label`), the input (`--fs-title-3`, 500), its status (`--fs-body`, `--text-2`).

Anchored to the bottom:

- **Controls** `.sync-controls`: mode, intensity and brightness as three 48px pills
  (`.sync-pill`, `--surface-raised`; brightness the `BrightnessControl`), each 21.4% of the
  width (88 at 411, at most 95), 24 apart, their 10px capitals 8 above.
- **Dock** `.sync-dock`: 20 under the pills, 20 from the screen's edges (not the gutter),
  114 tall, `--r-2xl`, `--bar-bottom`, 22 over the tab bar. "What" and "Where": 48 round
  buttons (`--surface-raised`) over 10px capitals and the value (`--fs-caption`,
  `--text-2`). **Start** `.dock-go` in the middle, 76 round: grey while the box sleeps
  (`--surface-raised`, the glyph dimmed), ready while it is on (`.ready`: a 4px ring of
  the accent at 65% over the accent at 16%), in the mode's colors while syncing.
- **Popovers** `.pop-card` (mode, intensity): over the scrim (the tab bar under it too),
  20 from the screen's edges, `--surface-row`, `--r-m`, 16 in, the title (`--fs-body`
  500) 20 from the top; three mode tiles 100 tall (`--surface-2`, a 24px glyph over 10px
  capitals) or four intensity pills 48 tall drawn as waves (`--surface-raised`), 12
  apart; the chosen one white with dark ink (`--selected`). Anchored to the button that
  opened it. A box paired directly adds the music palette under music's tile (ours).
- **Brightness**: the color screen's slider rising from the button (88×200, "100%" in a
  small badge over it).

**Sheets of the tab**:

- "What" → **"Sync options"** (`.sheet.bottom.tall`): close, title, the accent "+" (add a
  box) in the bar; section "TV"; a group across the sheet titled by the box's name with
  its inputs as tile cards (102×160) in a row that scrolls, a round check in the switch
  zone.
- "Where" → **"Entertainment area"** (a sheet from the bottom, as tall as its rows): a
  hint, the areas as rows with a tick, "Create an Entertainment area" with the accent "+".

**A box's settings** (`features/sync/views/sync-settings.ts`; "⋯" on the tab, or the box's row in
Settings → Bridges): an editor as a sheet, its pages pushed with a back button. Only a box
paired directly has them; one linked through `huesyncbox` shows Device info and the way
to pair it.

- **Settings**: list rows (72, 24px glyphs at 20, text at 72, chevrons): Device, Change
  Hue Bridge, Change Wi-Fi network, HDMI inputs, TV remote control, Automatic control,
  Advanced, Software updates; then ours, Presets. (Voice assistants is the Hue cloud's:
  not here.)
- **Device**: the hero (the box's glyph, its name `--fs-large` with the round pencil:
  the name sheet), rows: LED indicator brightness (a choice sheet: Normal, Off, Dimmed),
  Automatic updates (a switch, a hint under it), Network info and Device info (tall
  sheets of facts, the value under the title; ours: how the box is connected and its
  device in Home Assistant); "Restart sync box" (`.pill`) over "Remove sync box"
  (`.delete-btn`, asked on an action sheet), centered 40 under the rows, 12 apart.
- **HDMI inputs**: a lead, the inputs as rows with their type on a 48px disc
  (`.row-art.disc`, `--surface-raised`) at 12, the name over "HDMI n". A row opens
  **"Edit name and icon"** (a tall sheet, "DONE" in the bar): the glyph (32) centered, the
  name in a 48px filled field (`.field.filled`, `--surface`, no border), the types as an
  **icon grid** (`.icon-grid`: three columns of 128px cells, a 40px disc in
  `--surface-raised`, the accent when chosen, the name `--fs-footnote` under it) on
  `--surface-row`.
- **TV remote control**: with no buttons learned, the empty state (a picture, a title
  `--fs-title` centered, a `--fs-body` grey lead, the accent "Next" in the footer, which
  starts learning); then the buttons as rows (name over what it does), each opening its
  sheet (name, a choice row for what it does, "Forget").
- **Automatic control**: sections of switch rows, each its own group with its hint under
  it: POWER STATE DETECTION (CEC, Hot-plug detection (HPD), USB, Inactivity detection),
  HDMI DEVICE SWITCHING (HPD, CEC: each a page with a lead and a switch row per input,
  with its glyph, a hint), START LIGHT SYNC (Video signal detected: the same page).
  Ours on top: **HDMI CEC** (a choice row: the box, or Hue Studio); with Hue Studio the
  box's CEC rows are off and locked, and the rows of Hue Studio's own follow: the screen
  and, per input, what its picture starts (its page: action, signal, wake).
- **Advanced**: BACKGROUND LIGHTING (Video, Game: switch rows with the mode's glyph) and
  its hint; AUDIO PASS-THROUGH (ARC/eARC bypass) and its hint.
- **Software updates**: the firmware and what the box last found as facts, an update to
  install or "Check for updates" (`.pill`), Automatic updates repeated as a switch row.
- **Change Hue Bridge** (the bridges as rows with a tick, the move under them) and
  **Change Wi-Fi network** (the box's Bluetooth for the Hue app) are sheets: the Wi-Fi
  itself is changed by the Hue app.
- **Presets** (ours): rows (start one), "Save current" (the name sheet), delete on an
  action sheet.

### Color screen

Wheel `.wheel` (the page's width less 8px, so 16px from the screen's edges, ≤440px, the
dock's leftover height, 24px above its middle; the dock 14px over the safe area) with pins `.pin`
(42px drops; `.dot` 22px for other lights; `.stack` with a count; `.round` spread on a
disc), mode discs `.modes`, brightness `.bri`, gradient style sheet `.style-sheet`. The
white wheel is the Hue app's drawn scale, warmest at the top and coolest at the bottom
(`WHITE_CSS` in `color.ts`: amber, white by four fifths, a cool blue at the end).
**Effects** `.fx-row` / `.fx`: a row per effect (its presets, then its outlined "adjust"
tile with a round "+"), the tiles a scene tile's: 102×110, a 48px picture, name over preset.

## Inventory

### The Hue app (reference, 6.3)

| Screen | Measured |
|---|---|
| Home | the page glows in the lit rooms' color (`#2e2c26` at the top with a yellow room on, to `#181b1f` at the bottom), cards white 12% over it; large title 34 (Söhne Breit); banner 86 tall, 12 from the edges; section titles 10 (cap 7.2); room cards 387×96 at 12 from the edges, 12 apart, radius 12, a 28 icon 18 in, the name 16 at 73 from the card's edge, an 8 track with a 16 knob 12 in from the card's edges, the switch 52×32; tab bar 56 + safe area, labels 11, tabs not chosen `#404345` |
| Room | the page glows in its lit lights' color down to the bottom; header: back 32 at 16, title 16 at 72, "+", "⋯", the switch; slider under it; its bottom corners 12; scene tiles 102×110 with a 48 picture 12 from the top, names 13–14, 12 apart; light tiles 102×160 with a 55 switch zone; controls 150×108 (24 icon 20 in, name 14, line 12); section titles 32 under the cards before them, 8 over their own |
| Room "⋯", leaving without saving | action sheet 12 from the edges, rows 56, red "Delete", "CANCEL" under a line, a blurred screen |
| Room "+", new scene | a picker (a deep blue top `#08225d`, the page a panel from 80 with 18 corners and a light edge): "Tap the item you want to add to …" 28, two-column tiles 180×156 (20 from the edges, 12 apart, a 72 dark disc over the name 16); "Add a scene": a lead 16, tiles 180×108 (picture top left, name 14 at the bottom: gallery, custom scene, save current settings, all-day scene); "Custom scene": a 48 picture, name 34, brightness card, lights card, a blue "Save" pill (36) at the bottom; a name sheet over the keyboard |
| Color | "⋯" and "SAVE" pills, "DONE"; wheel 380 across (16 from the edges, its middle at 336 on a 914 screen), a glow in its colors around it; modes bar 46 with discs; gradient button 48, brightness 72×48 with its value over it; modes at 648 and the tiles at 712; the room's light tiles under it (no room line), the picked one ringed 2 in its own color and the others dimmed; an off light's pin is black, other lights are small dots |
| White wheel | warmest at the top: `#fdb247` → `#fde39f` (40%) → `#fff6d4` (60%) → `#fffcf3` (80%) → `#c7f3fe` at the bottom |
| Effects | large title "Effects"; categories as section titles; a row per effect of tiles 102×110 (48 picture, name 14 over preset 12), 12 apart, two rows per category; "Create" at each row's end: outlined, a 40 round "+" |
| Room, lights off | scenes: "Hue scene gallery" card (three pictures overlapping, outlined) and a suggested scene (a stack, "Suggested", shuffle beside it); an "Automations" section with the room's cards (72, play) |
| Automations | a blue glow at the top (`#11145d` in the middle, gone by ~330); accent "+"; large title; bridge chips 32 (`#2e3134`, grey text; the chosen one white on an accent tint, ringed 2px in the accent); grouped by type: a header row 48 (icon at 16, 16 title at 72, count 13, a 32 round collapse), 24 under the cards before; cards 387×72 (`#2f3235`), no icon, text at 16, 16 titles over 13, play 32, the switch |
| Automation editor | a sheet 37 from the top (corners 12, the screen behind dimmed); sub header bar 56 (`#26282c`: close, title 16, "SAVE"); type icon 24, name 34; rows 72 with no icons, text at 16, values 13 on the right; a lights card with place tiles 144×108; section titles 10 |
| Fade and choice sheets | sheet bar 56 (close, title 16, "DONE"); caps 10 over a 16 value; slider with ticks 11 under it; choice rows 72 with a 40 picture, a tick on the chosen one; hint 12 |
| "Custom scene" | a picker: the "Scene name" sheet first (close, "DONE", a 46 field with a 1.5 light border and a clear button, prefilled "New scene"); then picture 48 at 24 / 112, name 34, pencil 32; "Scene brightness" card 20 in (`#24262a`, 12 corners, 120 tall), "Lights" card 20 under it; a line at the bottom over a centered accent "Save" (36); back asks "Your settings will not be saved…" with a red "Close and don't save" and "CANCEL" (13) |
| A gallery scene's card | over the gallery dimmed, a carousel of cards (the next one 12 to the right); a card 358 at 411 (26 in): the picture 16:9 with the name (cap 16.8 → 24) 16 in and a 32 round close 12 from the corner; a 72 strip `#2f3135`: dots 32, 22 apart from 12, shuffle and pencil 32 (`#4e5053`) 8 apart, 12 from the right; `#24262a` 100: "SAVE TO MY SCENES" (outlined 2 `#3a3c3f`) over "SET ONCE" (`#45474a`), 153×32, 13 capitals, 12 apart; tapping a scene shows it on the room's lights |
| "+" new automation | a picker (deep blue top, the page a panel from 80): no bar title, the question 28 at 24, picture cards 371×159 (20 from the edges, 12 apart), title 16 over two lines of 14 |
| Scene editor | a sheet 37 from the top; picture 48, name 34; the top tinted down through the brightness (label 16, value 13, slider 48 under the label), then 22 of page; "Lights" group (`#24262a`, title row 72, tiles 12 in); "Reset scene" and "Delete scene" centered 40 under it, 12 apart, 24 of room around their words (`#4b4b4b`; the red one `#371f22` with a 2 red border) |
| Settings | large title; rows 72, 24 icons at 20 (the glyph fills the 24: a bulb and a sensor for Devices, the bridge's box, a bulb sending waves for MotionAware, Sync's mark for Entertainment), text at 72, titles 16 (500), subtitles 12, chevrons; separators from the text on; section titles 10 |
| Bridges | accent "+" in the bar; a row per bridge (its box glyph, the name); a bridge's settings a sheet ("SAVE"): its glyph, name 34, INFO (status, ID, software, IP address), SETTINGS |
| "Power on", "Device info" | sheets filling the screen 37 from the top; "Power on": a tip, rows with a 40 picture (Default: warm light, Last on: undo, Power loss recovery: a bolt, Custom: its color), a tick; "Device info": rows with the value 12 under the title 16 |
| Devices, a kind's list | sub header (title 16, accent "+"), the first group 20 under it; bridge chips; "FILTER BY" with a count 12, filter chips 32 (`#2f3235`, 13 grey capitals not spaced, a white chevron 12×7); rooms as section titles with counts; device rows 72 with 32 icons |
| Light, sensor, bridge settings | a sheet 37 from the top; sub header bar 56 with "SAVE" (32, `#36383c`, grey until changed); icon, name 34 (wrapping); rows 72, values 13; info banner (1.5 accent border, `#171f2a`, "i", "INFO" 10, text 12–13); "Delete" 88×36 centered 40 under the rows, 2 red border, 13 in sentence case |
| Motion sensitivity | a sheet: text 12–13, caps 10 over a 16 value, a stepped slider with names 11 under its stops |
| MotionAware, Sync (empty) | an illustration, title 28–30, text, 36 pills (outlined, accent) |
| Add devices | a picker throughout: "Where do you want to add devices?" (rooms by bridge in rounded groups, "Create new Room" with a blue "+"); "Add devices to …" (art on the blue, "Alternative method" / "Scan QR code"); "Benefits of using a QR code" ("Set up without QR code" / "Scan QR code"); "Tap the device you'd like to add" (picture tiles by kind, lights full width); "Add lights to …" (art, "Enter code" / "Next"); "Use setup code" (a field, "Search"); "Searching for lights…" (a 320 ring around the picture, the accent arc; "We found these lights" with tiles 120×115; "Next" dim until something joined); "Success!" (a green tick badge, tiles with a blue tick) or "No lights found" (a red cross; "I need help", "Skip" outlined, "Enter code", "Try again"); "Name your lights" (tiles, "Skip"; a tile opens "Edit name and type"); try scenes; zones; "These devices have been added to …" / "No devices added" ("Add more", "Done") |
| Add a bridge | a picker: "How do you want to connect your Bridge?" (rows: network cable, Wi-Fi); "Connect a Bridge" (the bridge in a ring, "More options" / "Search"); "Searching for Hue Bridge…" (the arc going round); "No Hue Bridge found" (the ring red, a red cross, "Try again"); the camera's QR code first where it may |
| New MotionAware area | the empty list a picker's art ("Create a MotionAware area", "How does it work?" / "Create area"); the bridge on an action sheet with a title; "Before you choose devices…" ×3 (art, "Next"); "Where are the lights that you want to detect motion?" (radio rows by room, "Next") |
| Deleting, a room's "⋯" | action sheets over the screen blurred and dimmed (~50%): a 13px grey note ("By deleting this light, it can no longer be controlled."), the red action ("Delete light", "Delete Room"), "CANCEL" |
| Scene gallery | a picker (deep blue top, the page a panel from 80): title 28 at 24, lead 16, category titles 10, tiles 147×83 (16:9), 12 apart, names 13 |
| Settings, Explore, Sync (tabs) | Settings has no glow; Explore a blue one like Automations; Sync without a box (onboarding) a violet one (`#3f296d` in the middle at the top, gone by ~280), none with a box |
| Sync (411dp, a box on; iOS 440pt the same scaled) | header "+", "⋯", the switch; no title, no glow (violet only on the empty tab); the input's picture a 223 square (54% of the width), square corners, `#3b3d41` → `#2f3235`; "SYNC BOX" 10 capitals 20 under it, the input 20, its status 16 grey; "MODE / INTENSITY / BRIGHTNESS" 10 capitals 8 over pills 88×48 (`#46494c`, brightness white-to-grey), 24 apart; a dock 20 from the edges (371×114, `#0e1115`, radius 18) 20 under the pills and 22 over the tab bar: "WHAT" and "WHERE" 48 round buttons (`#3e4144`) over 10 capitals and a 12 value, a 76 round start in the middle (box on: a 4px ring `#0549a8`, the accent at 65%, over `#0c1e38`, at 16%; box off: grey) |
| Sync popovers | over the dimmed screen and tab bar, 20 from the edges, `#24262a`, radius ~13: "Mode" 16 at 20, three tiles 105×99 (`#3a3c3f`, 24 icon, 10 capitals) 12 apart, 16 in; "Intensity", four pills 76×48 (`#505155`) with waves; the chosen one white with dark ink; brightness: the color screen's slider from the button (88×200) with "100%" in a badge over it |
| Sync sheets | "Sync options" (tall): the accent "+" in the bar, section "TV", a group titled by the box with its inputs as light tiles (102×160) and a round check in the switch zone; "Entertainment area": a hint, rows with a tick, "Create an Entertainment area" with a blue "+"; "⋯" → "Settings" (tall): rows 72 (Device, Change Hue Bridge, Change Wi-Fi network, HDMI inputs, TV remote control, Voice assistants, Automatic control, Advanced, Software updates) |
| Sync Box: Device | hero: the box's glyph, its name 34 (wide), a round pencil; rows LED indicator brightness (Normal / Off / Dimmed on a sheet), Automatic updates (switch, hint under it), Network info (SSID, IP address, Signal quality, Network "Local + Internet"), Device info (Model "HSB2", Manufacturer, Identifier, Firmware): tall sheets with the value under the title; "Restart sync box" (grey pill `#4b4b4b`) over "Remove sync box" (red outlined), 12 apart |
| Sync Box: HDMI inputs | a lead 16 grey; rows 72 with the type on a 48 disc (`#4b4b4b`) at 12, the name over "HDMI n"; "SAVE" in the bar; a row: "Edit name and icon" (tall, "DONE"): the glyph centered, the name in a 48 filled field (`#3b3d41`), the 20 types as a grid of 3 (cells 128×120: a 40 disc `#4b4b4b`, the accent when chosen, the name 13 under it) |
| Sync Box: TV remote control | empty: a title 28 centered ("No remote configured just yet!"), a 16 grey lead, a round picture (the box and a remote), "Next" (accent) in a footer |
| Sync Box: Automatic control | POWER STATE DETECTION: switch rows CEC, Hot-plug detection (HPD), USB, Inactivity detection, each its own group with a 13 hint under it; HDMI DEVICE SWITCHING: HPD and CEC rows with chevrons (a page each: a lead, INPUTS, a switch row per input with its glyph, a hint); START LIGHT SYNC: "Video signal detected" (the same page). On the box: `cecPowersave`, `hpdOutputEnableMs` (1500 on, 0 off), `usbPowersave`, `inactivePowersave` (20 / 0); per input `hpdInputPortSwitch`, `cecInputSwitch`, `linkAutoSync` |
| Sync Box: Advanced, updates, bridge, Wi-Fi | Advanced: BACKGROUND LIGHTING (Video, Game: switch rows with the mode's glyph), a hint; AUDIO PASS-THROUGH (ARC/eARC bypass), a hint. Software updates: a flow ("Checking for updates…" under the box's picture). Change Hue Bridge: a picker, "Which Hue Bridge do you want to use?" over the bridges as rows. Change Wi-Fi network: the pairing flow (hold the button 10 s, "LED is blinking blue"). "+": a picker of six tiles (Sync box, Screen sync, Spotify, LG TV, Samsung TV, PC or Mac) |
| Colors | page `#181b1f`; rows and sheets `#24262a`; cards and tiles white 12% over the page (`#34353a` on the plain page), automation cards and chips 10% (`#2f3235`); header bar `#26282c`; header pills `#36383c`; round buttons white 15% (`#47484c` on a bar); action pills `#4b4b4b`; separators `#3a3c3f`; secondary text `#babbbc`; accent `#006aff`; red `#e63535`; switch off `#5e5e61`; tab bar `#0d1013`, the chosen tab `#b9baba` |

The Sync screens were measured on the Android app with the live box (the emulator bridged
to the home network so the app finds the box), after the iOS screenshots; both measure the
same. Switching the picker between color, white and
effects sends nothing to the light (checked on an off light against HA's state).

### Hue Studio against it

| Screen (view) | Parts | Against the Hue app |
|---|---|---|
| Home (`home`) | tab header, room cards, banner, zones | matches |
| Room (`room`, `add-sheet`) | room header, tile cards (scenes, lights), control cards, chips, Sync card, banner, the "+" picker with pick tiles | matches; sensor chips and the Sync card are ours; "+" offers what Hue Studio adds (no MotionAware or SpatialAware tiles, no "Color palette from photo") |
| Color (`color`, `effects`, `effect-sheet`) | wheel, pins, modes, brightness, effect tiles, style sheet | matches; gradient style sheet is ours |
| Scene editor, new scene, scene sheet (`scene`, `new-scene`, `scene-pick`) | hero, rows, tile cards, sheets, footer, action sheet | matches; "Custom scene" as the Hue app's (a picker, the name first, "Save" at the bottom) |
| Gallery (`gallery`, `gallery-settings`) | tiles, search, list rows | gallery matches; seasonal rules are ours |
| Automations (`automations`, `automation-edit`, `automation-parts`, `choice`, `day-parts`, `daylight-settings`) | automation cards, type headers, type cards, list rows, wheels, days, sliders on sheets, place tiles | matches; light of the day is ours; a room's screen lists its own automations |
| Sync (`sync`, `sync-settings`) | picture, sync pills, popovers, brightness control, dock, sheets with tiles and rows; the box's settings as list rows, switch rows with hints, the hero, choice and fact sheets, the icon grid | matches, the box's settings page by page; the music palette (in the mode popover), presets, HDMI CEC by Hue Studio (its screen, an input's picture, signal and wake) are ours; voice assistants are not here (the Hue cloud) |
| Settings (`settings`, `integration`, `rooms`, `experimental`) | list rows, banners | matches; rooms and zones, integration and experimental are ours |
| Devices (`devices`, `device`, `device-add`, `qr-scan`, `sensor`) | list rows, filter chips, search, kind tiles, steps, delete | matches |
| Bridges, MotionAware, entertainment (`bridges`, `bridge-add`, `motion-area`, `entertainment`, `space`) | list rows, steps, art, arrange view | matches; arranging lights without a Bridge Pro is ours, a Sync Box's row opens its settings (`sync-settings`) |
| More-info dialog and sheets, dashboard cards | the same parts | cards follow the dashboard's theme colors |

### History

- 2026-10-22, first pass: every color, type size, radius and the common shadows moved to
  tokens; one hero name size, one list row, one pill, one check; section titles at one
  distance; duplicate `.sync-note` and `.check` merged; dead rules removed.
- 2026-10-23, measured on the Hue app itself (until then the scale came from screenshots
  read by eye): the blue-grey palette (`#181b1f` page, `#24262a` rows, `#34353a` cards,
  `#babbbc` secondary text, `#006aff` accent); a 12px gutter with titles at 16; section
  titles 10px, 32px under the cards before them; row titles 16 over 12, values 13, rows 72
  with 24px icons; large titles and hero names 34; radius 12 for every card; pills 36 in
  sentence case (capitals only in headers), "Delete" in sentence case; tiles 102×110 / 160
  with 48px pictures; an 8px slider track; banner text 13 under a 10px title; dim inactive
  tabs on a near-black bar. Then the color screen: the white wheel turned the Hue app's way
  (warm at the top) with its drawn colors, effect tiles as scene tiles (102×110, 48px
  pictures), and every bar's title at 72px. Then the Sync screen (roadmap S) as the Hue
  app's, with the brightness control shared with the color screen.
- 2026-10-24, the Sync screens checked against the system: one scrim under every overlay
  (first blurred, a mistake: corrected below), the Sync popovers anchored to their button, their tiles raised;
  groups of rows cast `--shadow-flat` as written (they had none); the Sync picture rounded
  12 with the pills, dock and its round buttons shadowed; a Sync Box page's hints under its
  rows and its row subtitles on one line.
- 2026-10-24, sheets measured on the Hue app (its "Function" sheet, emulator and iOS): the
  scrim a plain 70% dim (no blur); a sheet in three layers, a `--surface-bar` bar with a
  long shadow over a body in the page's color and groups of rows across it with a short
  dense shadow; sheets' corners 12; sub screen headers solid `--surface-bar` with the same
  bar shadow. New tokens `--surface-bar`, `--shadow-row`, `--shadow-bar`.
- 2026-10-24, the whole panel side by side with the Hue app in the emulator at its own width
  (411dp): the page's glow per screen (lit lights' color on Home and a room, blue on
  Automations, violet on Sync, none in Settings and sub screens) with cards and tiles white
  over it; the tab bar fading in from the page, its chosen tab grey; round buttons white 15%;
  pills 24px of room, light grey, header pills darker; chips and filter chips as the Hue
  app's; section counts 12; sub screens' first group 20 under the bar; editors as sheets
  under the status bar; pickers (gallery, a new automation, the room's "+" now picture tiles)
  on a deep blue top; the Automations tab by type under folding headers; the room header's
  corners 12; control cards 150×108; the scene editor's spacing, "Reset" and "Delete"
  centered; the color screen's wheel 16 from the edges, its tiles without a room line in a
  room. New tokens `--surface-low`, `--round`, `--tab-on`, `--glow-*`, `--picker-top*`.
- 2026-10-24, "Custom scene" as the Hue app's: a new scene set light by light from the room's
  "+", its name asked first, "Save" in a footer, leaving confirmed on an action sheet (whose
  rows are now centered, 12px from the edges, "CANCEL" 13px).
- 2026-10-25, the rest of the pass: editors' "SAVE" grey until something changed and "Close
  and don't save" when leaving with changes (scene, automation, device, sensor); the Settings
  rows' glyphs drawn as the Hue app's and every row icon at 28 (an MDI glyph fills 24); the
  bridges' "+" in the bar and a bridge's (or box's) settings as a sheet; "Power on" and
  "Device info" as tall sheets, "Power on" with pictures in the Hue app's order and words,
  device facts with the value under the title.
- 2026-10-25, "Add devices" as the Hue app's flow (run for real on the live bridges: a light
  deleted and found again): a picker through every step, the search ring with its badge,
  device tiles, a stacked footer; questions (leave, delete) on action sheets over a blurred
  screen (`--scrim-blur`), deletes no longer "tap again".
- 2026-10-25, everything on the system's parts: the flow as one part of `base.ts` ("Add
  devices", "Add a bridge" and a new MotionAware area on it, their old step lists, segments
  and rings gone); `.apply` the accent pill everywhere but headers (it was grey outside a
  footer), the white `.go` pill gone; questions only on action sheets (a zone, a Sync preset;
  "Reset scene" acts at once, the Hue app's); the outlined field shared; a zone's editor a
  tall sheet; the tab bar dimmed or hidden under sheets. Segments and `--segment-on` removed.
- 2026-10-26, the Sync screens measured again on the Android app with the live box, every
  page of its settings too: the tab's parts scale with the width (picture 54%, pills
  21.4%), the picture has square corners, the dock sits 20 from the edges with radius 18,
  the start button shows a box that is on (an accent ring), no glow on the tab (it was the
  onboarding's); the box's settings are the Hue app's pages (Device, HDMI inputs with the
  icon grid, TV remote control, Automatic control, Advanced, Software updates), background
  lighting moved there from the mode popover. New parts: `.row-art.disc`, `.field.filled`,
  `.icon-grid`, `.dock-go.ready`.
- 2026-10-26, a gallery scene's card measured on the Android app (the scene shown on the
  lights): the card narrower (26 from the sides), the pencil beside shuffle on the colors'
  strip, the strip lighter and 72 tall, the pills 32 in capitals on the rows' grey, the name
  24; the room row only for "Copy to…". A stray line left from the old time field's rule
  (it hid the ticks' rule of choice lists) removed. With it the inventory is complete.
- 2026-10-26, motion measured from screen recordings of the Hue app: pickers come up and
  go down as sheets (an ease-out cubic, about a quarter of a second) over the screen they
  belong to; a scene's card slides in and out at an even speed under a fading dim, and the
  gallery's scenes swipe as a row of cards. Tokens `--decelerate`, `--accelerate` and the
  `--t-sheet-*`, `--t-card-*`, `--t-dim-*` durations.
- 2026-10-26, off-system parts brought onto it: a zone's editor is an editor screen like a
  device's (a sheet on phones, the name as a hero with its pencil, lights as list rows by
  room with checks, "SAVE" grey until changed, "Delete" at the bottom) instead of a modal
  card; today's scene (Light of the day, an automation's scene of the day) is a row with its
  picture on a disc instead of a card of its own; the light sensor left "Weather and
  season" for its own row ("Daytime brightness"). A scene of your own shows its lights'
  colors (a captured scene has no palette), or a picture of its own: a photo or an icon on
  its colors, picked on a tall sheet from the editor's picture (rows with pictures, the icon
  grid). Adaptive Lighting's badges are gone with its support.
