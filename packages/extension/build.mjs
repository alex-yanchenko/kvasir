// esbuild pipeline for the extension. Phase 4a stands this up against the
// existing plain-JS sources with no behavior change: content.js and
// background.js are bundled as self-contained IIFEs into dist/, and overlay.css
// is copied alongside. manifest.json points at dist/, so the unpacked extension
// loads the bundled output rather than raw src/.
//
// Run `node build.mjs` for a one-shot build, or `node build.mjs --watch` to
// rebuild on change (keeps the edit -> reload loop fast).

import { context } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "src");
const dist = resolve(here, "dist");
const watch = process.argv.includes("--watch");

// Copy overlay.css on every successful build so --watch keeps it in sync.
const copyAssets = {
  name: "copy-assets",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      await mkdir(dist, { recursive: true });
      await copyFile(resolve(src, "overlay.css"), resolve(dist, "overlay.css"));
    });
  },
};

const ctx = await context({
  entryPoints: [resolve(src, "content.js"), resolve(src, "background.js")],
  outdir: dist,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome111"],
  sourcemap: watch,
  logLevel: "info",
  plugins: [copyAssets],
});

if (watch) {
  await ctx.watch();
  console.log("watching for changes…");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
