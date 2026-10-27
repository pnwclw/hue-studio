# Installation

## Requirements

- Home Assistant **2026.10.0** or newer.
- The [Philips Hue](https://www.home-assistant.io/integrations/hue/) integration set up
  with a bridge on API v2 (Hue Bridge v2 or Bridge Pro).

Hue Studio reads each bridge's address and app key from its Philips Hue config entry, so
there is no second pairing with the bridge button. Its connection to a bridge follows that
entry: it opens when the entry is loaded, closes when it is unloaded or removed, and
retries while the bridge does not answer.

## HACS (custom repository)

1. HACS → ⋮ → **Custom repositories** → add `https://github.com/pnwclw/hue-studio`,
   category **Integration**.
2. Every release is an alpha for now: on Hue Studio's page in HACS, turn on **Show beta
   versions**.
3. Install **Hue Studio** and restart Home Assistant.

## Manual

Download `hue_studio.zip` from the latest
[release](https://github.com/pnwclw/hue-studio/releases), unpack it into
`<config>/custom_components/hue_studio/` and restart Home Assistant.

!!! note
    The repository itself does not contain the built panel: copying
    `custom_components/hue_studio` from a clone gives you an integration without its
    frontend. Use the release zip, or [build it](../development/index.md) first.

## Adding Hue Studio

**Settings → Devices & services → Add integration → Hue Studio**, then pick **Hue Studio
for your Hue bridges**.

- Hue Studio is added **once**: it uses every bridge of the Philips Hue integration, also
  one added there later.
- Each bridge shows up as a service of the Hue Studio entry, linked to its device in the
  Philips Hue integration; its "Visit" link opens the panel.
- **Hue** appears in the sidebar. Everything is set up there: the integration has no
  options dialog in Home Assistant's settings.

A Hue Play HDMI Sync Box is added the same way later (**Add integration → Hue Studio →
Hue Play HDMI Sync Box**), see [Sync Box](sync-box.md).

## Next

- [The panel](../guide/panel.md) — a tour of what is where.
- [Rooms and zones](../guide/rooms-and-zones.md) — if the Hue rooms on your bridge differ
  from your Home Assistant areas, the panel shows it on Home.
