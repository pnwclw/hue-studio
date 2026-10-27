# Documentation

This site is built with [MkDocs Material](https://squidfunk.github.io/mkdocs-material/)
from `docs/` and `mkdocs.yml`, and published to GitHub Pages by
`.github/workflows/docs.yml` on every push to `dev` that touches it. Pull requests build it
too, with `--strict`, so a broken link fails the check.

## Preview

```bash
uv run --group docs mkdocs serve
```

Then open <http://127.0.0.1:8000/hue-studio/>. `uv run --group docs mkdocs build --strict`
builds it as CI does.

## The services reference

[Services](../reference/services.md) is generated at build time from `services.yaml` and
`translations/en.json` by the hook `scripts/mkdocs_services.py`: names, descriptions,
targets and fields come from there, so they match what the automation editor shows.
`docs/reference/services.md` holds only the prose — groups, notes, examples — and a
marker per service:

```markdown
<!-- service: apply_palette -->
```

A new service needs its marker on that page: a service without one (or a marker without a
service) fails the strict build.

## Screenshots

Screenshots come from the harness (fake demo data, so nothing of a real home), taken with
headless Chrome:

```bash
npm run build
uv run python scripts/docs_screenshots.py            # every shot
uv run python scripts/docs_screenshots.py home room  # some of them
```

They are written to `docs/assets/screenshots/<name>.webp`; the list of shots (route and
size) is at the top of the script. Phone shots are 402 px wide (iPhone 17 Pro) with its
safe areas, desktop shots 1440 × 900. Retake the affected ones when a screen changes.

## Writing

- English only, and no personal details: use the harness's demo names (`living_room`,
  `light.example_lamp`) in examples.
- A screen in a guide page gets a screenshot: phones side by side in
  `<div class="shots" markdown>`, each image with `{ .shot }`.
- Link to services as `../reference/services.md#<service>`.
