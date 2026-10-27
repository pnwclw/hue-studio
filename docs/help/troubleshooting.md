# Troubleshooting

## The panel or the dialog does not show

- Hue Studio's frontend comes in the release zip. A copy of `custom_components/hue_studio`
  taken from a clone of the repository has no built frontend: install from HACS or the
  release zip.
- After an update, reload the page (on a phone, pull to refresh or restart the companion
  app) so the browser loads the new frontend.
- If the frontend fails, Hue Studio's dialog steps aside and Home Assistant's own dialog
  opens for every light: you never lose access to a light because of it.

## A bridge shows as not connected

Hue Studio follows the bridge's Philips Hue config entry. Check that entry first: if it is
not loaded, Hue Studio has no connection either, and it reconnects by itself once the
entry is back. Hue Studio needs a bridge on API v2 (Hue Bridge v2 or Bridge Pro).

## A light does not react to a scene or palette

A light that an entertainment area streams to (Sync Box, PC or TV sync) is left alone by
scenes, palettes, gradients and effects: the stream would overwrite them anyway. Stop
syncing first.

## The color on the light differs from the wheel

Each light shows only colors inside its gamut (A, B or C); the wheel clips a point to the
gamut of each light. Two lights with different gamuts can show the same point slightly
differently.

## Commands seem slow with many lights

The bridge takes about 10 commands per second for single lights and about 1 per second
for groups. Hue Studio sends room commands to a Hue room or zone that holds exactly the
room's lights; if there is none, the room's lights get one command each. Align the Hue
rooms with your areas ([Rooms and zones](../guide/rooms-and-zones.md)) so rooms get one
command.

## A service call is refused

Services that delete or reshape things on the bridge or the box need a Home Assistant
administrator ([Services](../reference/services.md)). A script started from a dashboard by
a user who is not an administrator is refused; run it from an automation instead.

## Coming or leaving home stays on a checklist

Home Assistant needs to know who is home: a home zone, and people whose phone shares its
location "Always" in the companion app. The checklist shows what is missing.

## Reporting a problem

Open an [issue](https://github.com/pnwclw/hue-studio/issues) with your Home Assistant and
Hue Studio versions, what you did and what happened, and the log lines that mention
`hue_studio`. A Sync Box's diagnostics (its device page → Download diagnostics) are
redacted and safe to attach. Never post your bridge's app key or Home Assistant tokens.
