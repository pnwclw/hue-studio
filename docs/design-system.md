# Design system

One set of parts for every screen of Hue Studio: the `/hue` panel, the more-info dialog
and sheets, and the dashboard cards. The reference is the Philips Hue app, measured on the
app itself (6.3, Android, in an emulator: sizes in dp, which are px here); the system is
built on Home Assistant's model and its own needs where the Hue app has no counterpart.

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
| `--bg` | `#181b1f` | page background (under a warm glow at the top) |
| `--surface` | `#34353a` | cards and tiles: rooms, scenes, lights, automations, controls |
| `--surface-2` | `#36383c` | tiles on a surface, header pills |
| `--surface-row` | `#24262a` | list rows, sheets, action sheets, a sub screen's header bar |
| `--surface-raised` | `#47484c` | round buttons on a bar, tiles on a sheet's rows |
| `--text` | `#fff` | text and icons |
| `--text-2` | `#babbbc` | secondary text, values, subtitles, section titles |
| `--text-3` | `#818385` | outlines of checks and radios, faint text |
| `--text-dark` | `#1c1c1e` | text on light surfaces (a lit room in a light color, white buttons) |
| `--fill` | grey 28% | round buttons, pills, filter chips |
| `--fill-soft` | grey 24% | fields, search, segments, the wheels' band, days off |
| `--fill-strong` | grey 36% | step dots |
| `--fill-light` | 12% white | round buttons on tinted or colored surfaces |
| `--switch-off` | `#5e5e61` | a switch's track when off |
| `--segment-on` | `#636366` | the chosen segment |
| `--separator` | 10% white | lines between rows, hairline borders |
| `--hairline` | 6% white | bar borders, pressed rows |
| `--scrim` | 55% black | under every overlay, with a 14px blur (sheets, popovers, the brightness slider) |
| `--outline` | grey 45% | outlined "add" tiles |
| `--selected` | `#fff` | ring of a chosen tile or mode |
| `--accent` | `#006aff` | switches on, checks, the main button, "+", a chosen chip's ring |
| `--bar-bottom`, `--tab-off` | `#0d1013`, `#404345` | the tab bar; its tabs that are not chosen |
| `--info`, `--info-head`, `--info-mark`, `--info-line`, `--info-bg`, `--info-tint` | blues | links and info icons; the info banner (title, mark and border in the accent, `#171f2a` inside); info notes |
| `--warn`, `--warn-line`, `--warn-bg`, `--warn-tint` | amber | "Unreachable", warnings; the warning banner; mismatch notes |
| `--danger`, `--danger-fill`, `--danger-tint` | `#e63535` | "Delete" and errors; a confirmed delete; the delete pill's fill |
| `--ok` | `#30d158` | motion now, ready, linked, done |
| `--sun` | warm yellow | active badges in a room's header, "now" tags |
| `--sync-tint` | violet | lights a Sync Box drives |

Picture art (the color wheel, mode discs, brightness gradients, Sync mode glows, automation
pictures) keeps its own colors: those are drawings, not interface.

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

`--r-xs` 8 · `--r-s` 10 (fields, segments, menu rows) · `--r-m` 12 (every card and tile:
rooms, scenes, lights, automations, gallery, banners, groups of rows) · `--r-2xl` 18
(sheets, dialogs) · `--r-3xl` 22 (a room's header on wide screens, heroes) · `--r-full`
(pills, switches, chips, tracks). Circles are `50%`.

### Shadow

`--shadow-flat` (groups of rows outside sheets, small cards, gallery tiles, pills such as
Sync's) · `--shadow-raised` (tiles, room cards, heroes, sheet buttons, the Sync picture and
dock) · `--shadow-overlay` (menus, sheets, popovers, the brightness track) · `--shadow-dot`
(round pictures and discs, round buttons standing on their own like the Sync dock's). The Hue app's cards cast almost no shadow; ours
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
| `--row-h`, `--row-text`, `--row-icon` | 72, 72, 24 | a list row: its height, where its text starts, its icon (at 20px; 32px in device lists) |
| `--row-h-compact` | 52 | a row of controls inside a sheet |
| `--card-gap`, `--tile-gap` | 12, 12 | between cards; between tiles |
| `--light-tile` | 102 | a light or scene tile's width |

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
  (`--fs-large`); once the title scrolls under, the bar shows it (`--fs-body`) and blurs.
  On desktop one row as tall as HA's sidebar header (`main.wide`), the title `--fs-title-1`.
- **Sub header** (`subHead`, `.bar.sub`): back (or close) round button at 16, title
  `--fs-body` 500 at 72 (where list rows' text starts; so in every bar and sheet bar), actions at the end ("Save" here, an uppercase grey pill). Everything
  in it is 32px tall.
- **Tab bar** (`nav.tabs`): `--bar-bottom`, icons 26px over `--fs-tab` labels, the tabs not
  chosen in `--tab-off`; on top while the experimental footer is at the bottom. Hidden while
  the keyboard is up.
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

- **Pill** `.pill`: 36px, `--fs-footnote` 500 in sentence case, `--fill`; in headers and
  banners 32px and uppercase ("SAVE", "DONE"). Variants: `.go` (white, the screen's primary
  action on dark), `.apply` (accent, a screen's main button), `.outline`, `.danger` (red
  text), `.shuffle` (icon + text), `.reset` (min 180px wide). No other sizes.
- **Delete** `.delete-btn`: the pill with a 2px red border and a red tint at the bottom of
  an editor (`.delete-area`), "Delete" in sentence case; confirm turns it solid.
- **Round** `.round`: 32px circle, `--fill`; `.mini` 28, `.mini-step` 28, `--round-l` 40
  (automation card's start, gradient flip); `.plus-blue` (accent "+"). Icons 22px (18 on small).
- **Text link** `.text-link` in `--info`.

### Inputs

- **Switch** `toggle()` / `.toggle`: 52×32, 24px knob, `--switch-off` track, accent when on
  (dark translucent on a lit surface); one size everywhere. `lockedToggle()` when it can't
  be used.
- **Check** `.check` / `.pick-check`: a 24px round tick box (accent when on; `.some` for part
  of a room). **Radio** `.radio`: 24px ring.
- **Field** `.field` (44px, `--fs-headline`), **search** `.search-field` (32px),
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
- **Segments** `.seg`: up to four equal buttons (`.two`, `.three`) — used only where the Hue
  app has them (Sync intensity, connection type); a choice inside a section is a row that
  opens a list instead (`views/choice.ts`).
- **Chips** `.chip` (32px, 13px, the chosen one ringed 2px in the accent: a scene's room, a
  bridge, the Sync Box picker), **filter chips** `.chip.filter-chip` (32px, uppercase;
  Devices, Light of the day).

### Rows

- **Group of rows** `.rows`: `--surface-row`, `--r-m`; full width on phones in settings,
  editors and device lists.
- **List row** (`.rows .item` inside `.settings-page`, `.sensor-edit`, `.choice-sheet`, and
  `.rows.device-list`): ≥ `--row-h`, a `--row-icon` icon at 20px (32px icons in device
  lists), text from `--row-text`, a 500 `--fs-body` title over a 400 `--fs-caption` line,
  the value on the right in `--fs-footnote` `--text-2`, a chevron when it opens something;
  separators from the text on. In the automation editor rows have no icons and their text
  starts at 16 (its type's icon sits by the name).
- **Compact row** (`.rows .item` elsewhere): ≥ `--row-h-compact`, for controls in a sheet.
- **Choice row** (`navRow`, `choiceRows`): a row with its value opens the list to pick from —
  a sheet for one value, a screen for several; the chosen one gets a tick.

### Cards and tiles

- **Room card** `.card.surface` (home): 96px, `--r-m`, padding 18px, a 28px icon 18px in,
  the name (`--fs-body` 500) 73px from the edge, the switch, the slider; tinted by the
  lights (`.surface.lit`, `--lit-bg`), drifting while dynamic.
- **Room header** `.hero`: the room's colors as a sheet glued to the top on phones, a card
  (`--r-3xl`) on wide screens.
- **Tile card** `tileCard()` / `.tile-card`: the one card layout for lights, scenes and
  sensors — 102px wide, a 48px picture 12px from the top, a text block of fixed height
  (`--fs-callout` name, `--fs-caption` lines), 110px tall, 160px with the switch zone (56px)
  of a light; every tile as tall as any other.
- **Control card** `.control-card` (148×106, a room's "Controls": sensors).
- **Automation card** `automationCard()` / `.auto-card`: ≥72px, a 32px icon, text from
  72px, a `--fs-body` title over a `--fs-footnote` line, the switch.
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
  own buttons, a round chevron when it leads somewhere. A Sync Box's is `syncBanner`
  (`.sync-banner`).
- **Note** `.sync-note` (info tint, 13px; `.all` centered for a screen that is locked),
  `.mismatch` (warn tint), `.power-cycle` (a step's art and text, info tint). Prefer a banner
  for anything new.
- **Toast** `.toast` at the bottom.

### Overlays

- **Scrim**: every overlay (sheet, popover, the brightness slider) lies over the same
  `--scrim` with a 14px blur, so what opens stands apart from the controls under it; never a
  plain dim.

- **Sheet** `.sheet` + `.box`: centered card (`--r-2xl`, max 400–560px, `--surface-row`) on
  wide screens, from the bottom on phones (`.sheet.bottom`); bar `.sheet-bar` (56px, close
  round button, title `--fs-body` 500, "DONE"/"SAVE" pill). Never inside a scrolling element.
- **Action sheet** `.sheet.menu.bottom` + `.action-sheet`: 12px from the edges, 56px centered
  rows (`--fs-body`), the red one, "Cancel" under a line, over a blurred screen.
- **Menu** `.menu`: a dropdown from a "⋯" button.
- **Scene sheet** (`scene-pick.ts`): picture with name and pencil, colors and shuffle, room,
  "Save to my scenes", "Set once".
- **Dialog** (`hue-studio-more-info.ts`) and **more-info sheets** (`automation-sheet.ts`,
  `scene-sheet.ts`): full screen from the bottom on phones, a card on wide screens.

### Sync screen

`views/sync.ts`, the Hue app's Sync tab: no title; in the header "+" (add a box), "⋯" (the
box's settings, presets and remote buttons on a sheet) and the power switch. What plays as
a 238px square picture of the input (`.sync-picture`, glowing in the mode's colors while
syncing), the box's name in small capitals, the input's name (`--fs-title-3`) and status
(`--fs-body`). Mode, intensity and brightness: three 48px pills (`.sync-pill`, the
brightness control) under 10px capitals; mode and intensity open a **popover**
(`.pop-card`, the row surface, a title and the options, the chosen one white) above the
controls over the scrim, anchored to the button that opened it (its bottom 44px above the
button, not measured from the window's height): three mode tiles 100px tall and four
intensity pills drawn as waves of growing height, on `--surface-raised` (tiles on a sheet). The **dock** (`.sync-dock`, the tab bar's near-black, `--r-3xl`):
"What" (the inputs as light tiles with a check, on a sheet), a 76px start/stop button
(in the mode's colors while syncing), "Where" (the entertainment areas with a tick, and a
way to a new one). On shorter screens the picture and the gaps give way so the dock stays
in view.

### Color screen

Wheel `.wheel` (the page's width, ≤440px, the dock's leftover height) with pins `.pin`
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
| Home | large title 34 (Söhne Breit); banner 86 tall, 12 from the edges; section titles 10 (cap 7.2); room cards 387×96 at 12 from the edges, 12 apart, radius 12, a 28 icon 18 in, the name 16 at 73 from the card's edge, an 8 track with a 16 knob 12 in from the card's edges, the switch 52×32; tab bar 56 + safe area, labels 11, tabs not chosen `#404345` |
| Room | header: back 32 at 16, title 16 at 72, "+", "⋯", the switch; slider under it; scene tiles 102×110 with a 48 picture 12 from the top, names 13–14, 12 apart; light tiles 102×160 with a 55 switch zone; controls 150×108; section titles 32 under the cards before them, 8 over their own |
| Room "⋯", leaving without saving | action sheet 12 from the edges, rows 56, red "Delete", "CANCEL" under a line, a blurred screen |
| Room "+", new scene | a sheet over the room's colors: title 28, two-column picture tiles 180×156 (20 from the edges); "Custom scene": a 48 picture, name 34, brightness card, lights card, a blue "Save" pill (36) at the bottom; a name sheet over the keyboard |
| Color | "⋯" and "SAVE" pills, "DONE"; wheel 380 across (16 from the edges); modes bar 46 with discs; gradient button 48, brightness 72×48 with its value over it; the room's light tiles under it, the picked one ringed 2 in white and the others dimmed; an off light's pin is black, other lights are small dots |
| White wheel | warmest at the top: `#fdb247` → `#fde39f` (40%) → `#fff6d4` (60%) → `#fffcf3` (80%) → `#c7f3fe` at the bottom |
| Effects | large title "Effects"; categories as section titles; a row per effect of tiles 102×110 (48 picture, name 14 over preset 12), 12 apart, two rows per category; "Create" at each row's end: outlined, a 40 round "+" |
| Room, lights off | scenes: "Hue scene gallery" card (three pictures overlapping, outlined) and a suggested scene (a stack, "Suggested", shuffle beside it); an "Automations" section with the room's cards (72, play) |
| Automations | large title; bridge chips 32 (the chosen one ringed 2px in the accent); grouped by type: a header row (24 icon, 16 title, count, collapse); cards 387×72, radius 12, 16 titles, play 32, the switch |
| Automation editor | sub header bar 56 (`#26282c`: close, title 16, "SAVE"); type icon 24, name 34; rows 72 with no icons, text at 16, values 13 on the right; a lights card with place tiles 144×108; section titles 10 |
| Fade and choice sheets | sheet bar 56 (close, title 16, "DONE"); caps 10 over a 16 value; slider with ticks 11 under it; choice rows 72 with a 40 picture, a tick on the chosen one; hint 12 |
| "+" new automation | a sheet: title 28, picture cards 371×159 (20 from the edges, 12 apart), title 16 over two lines of 14 |
| Settings | large title; rows 72, 24 icons at 20, text at 72, titles 16 (500), subtitles 12, chevrons; separators from the text on; section titles 10 |
| Devices, a kind's list | sub header (title 16, accent "+"); bridge chips; "FILTER BY" with a count, uppercase filter chips 32; rooms as section titles with counts; device rows 72 with 32 icons |
| Light, sensor, bridge settings | sub header bar 56 with "SAVE" (32); icon, name 34 (wrapping); rows 72, values 13; info banner (1.5 accent border, `#171f2a`, "i", "INFO" 10, text 12–13); "Delete" 80×36, 2 red border, 13 in sentence case |
| Motion sensitivity | a sheet: text 12–13, caps 10 over a 16 value, a stepped slider with names 11 under its stops |
| MotionAware, Sync (empty) | an illustration, title 28–30, text, 36 pills (outlined, accent) |
| Scene gallery | a sheet: title 28, lead 16, category titles 10, tiles 147×83 (16:9), 12 apart, names 13 |
| Sync (iOS, 440pt) | header "+", "⋯", the switch; no title; the input's picture a 238 square (`#3b3d41`); "SYNC BOX" 10 capitals, the input 20, its status 16 grey; "MODE / INTENSITY / BRIGHTNESS" 10 capitals over pills 95×48 (`#47484c`, brightness white-to-grey), 24 apart; a dock 400 wide (`#0d1114`, radius ~22): "WHAT" and "WHERE" 48 round buttons over 10 capitals and a 12 value, a 76 round start in the middle |
| Sync popovers | over a dimmed screen, 20 from the edges, the row surface, radius ~24: "Mode" 16, three tiles 115×100 (24 icon, 10 capitals), "Intensity", four pills 83×48 with waves; the chosen one white with dark ink; brightness: the color screen's slider from the button with "100%" over it |
| Sync sheets | "Sync options": section "TV", a card titled by the box with its inputs as light tiles (102×160) and a round check in the switch zone; "Entertainment area": a hint, rows with a tick, "Create an Entertainment area" with a blue "+"; "⋯" → "Settings": rows 72 (Device, Change Hue Bridge, Wi-Fi, HDMI inputs, TV remote control, voice assistants, shortcuts, automatic control, advanced, updates) |
| Colors | page `#181b1f`; rows and sheets `#24262a`; cards and tiles `#34353a`; header bar `#26282c`; header pills `#36383c`; round buttons on a bar `#47484c`; separators `#3a3c3f`; secondary text `#babbbc`; accent `#006aff`; red `#e63535`; switch off `#5e5e61`; tab bar `#0d1013` |

The Sync screens come from the iOS app (the emulator's copy can't discover a box through
its NAT); iOS and Android measure the same (rows 72, text from 72, titles 16). Not measured
yet: a gallery scene's sheet (it previews on the lights). Switching the picker between color, white and
effects sends nothing to the light (checked on an off light against HA's state).

### Hue Studio against it

| Screen (view) | Parts | Against the Hue app |
|---|---|---|
| Home (`home`) | tab header, room cards, banner, zones | matches |
| Room (`room`) | room header, tile cards (scenes, lights), control cards, chips, Sync card, banner | matches; sensor chips and the Sync card are ours |
| Color (`color`, `effects`, `effect-sheet`) | wheel, pins, modes, brightness, effect tiles, style sheet | matches; gradient style sheet is ours |
| Scene editor, new scene, scene sheet (`scene`, `new-scene`, `scene-pick`) | hero, rows, tile cards, sheet | matches; "Save" sits in the header (ours) where a new scene in the Hue app has it at the bottom |
| Gallery (`gallery`, `gallery-settings`) | tiles, search, list rows | gallery matches; seasonal rules are ours |
| Automations (`automations`, `automation-edit`, `automation-parts`, `choice`, `day-parts`, `daylight-settings`) | automation cards, type cards, list rows, wheels, days, sliders on sheets, place tiles | matches; light of the day is ours; the Hue app groups cards by type with a header row (not yet) |
| Sync (`sync`) | picture, sync pills, popovers, brightness control, dock, sheets with tiles and rows | matches; background lighting and the music palette (in the mode popover), presets and remote buttons ("⋯") are ours |
| Settings (`settings`, `integration`, `rooms`, `experimental`) | list rows, banners | matches; rooms and zones, integration and experimental are ours |
| Devices (`devices`, `device`, `device-add`, `qr-scan`, `sensor`) | list rows, filter chips, search, kind tiles, steps, delete | matches |
| Bridges, MotionAware, entertainment (`bridges`, `bridge-add`, `motion-area`, `entertainment`, `space`) | list rows, steps, art, arrange view | matches; arranging lights without a Bridge Pro is ours, and so is a Sync Box's page beyond the Hue Sync app's (HDMI CEC by Hue Studio, its screen, automatic switching, an input's page with its name and icon, signal and wake): list rows and choice sheets, hints under the rows |
| Moving between bridges (`bridge-move`, `lost`) | — | dropped (roadmap K), not maintained |
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
- 2026-10-24, the Sync screens checked against the system: one scrim (dimmed and blurred)
  under every overlay, the Sync popovers anchored to their button, their tiles raised;
  groups of rows cast `--shadow-flat` as written (they had none); the Sync picture rounded
  12 with the pills, dock and its round buttons shadowed; a Sync Box page's hints under its
  rows and its row subtitles on one line.
