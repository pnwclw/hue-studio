// Builds the frontend: src/entries/*.ts -> custom_components/hue_studio/frontend/ (served by panel.py),
// plus the dev harness fixture. Usage: node scripts/build-frontend.mjs [--watch] [--dev]
//   --watch  rebuild on change (implies --dev)
//   --dev    no minification

import { readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const outdir = `${root}custom_components/hue_studio/frontend`;
const watch = process.argv.includes("--watch");
const dev = watch || process.argv.includes("--dev");

// Old builds leave hashed chunks behind; gallery/ (generated data) is kept.
for (const name of await readdir(outdir)) {
  if (/\.(js|js\.map|LEGAL\.txt)$/.test(name)) await rm(`${outdir}/${name}`);
}

const common = {
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: !dev,
  sourcemap: "linked",
  legalComments: "linked",
  logLevel: "info",
};

const contexts = [
  // The entries share chunks, so custom elements are defined exactly once.
  await esbuild.context({
    ...common,
    entryPoints: [`${root}src/entries/hue-studio-panel.ts`, `${root}src/entries/hue-studio-more-info.ts`, `${root}src/entries/hue-studio-extra.ts`],
    outdir,
    splitting: true,
    chunkNames: "chunk-[hash]",
  }),
  await esbuild.context({
    ...common,
    entryPoints: [`${root}dev/fixture.ts`],
    outdir: `${root}dev/build`,
    minify: false,
  }),
];

if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
}
