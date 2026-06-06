// esbuild pipeline for the extension. Two bundles ship to dist/: the content
// script (entry content/index.tsx — boots Heimdall/Asgard and, until the islands
// finish landing, the legacy vanilla world) and Huginn, the background worker.
// midgard.css (light-DOM row styles) is copied alongside and loaded via the
// manifest; Asgard's panel styles are *imported as text* (see the css loader) and
// injected into the shadow root at runtime.
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

// Copy midgard.css on every successful build so --watch keeps it in sync.
const copyAssets = {
  name: "copy-assets",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      await mkdir(dist, { recursive: true });
      await copyFile(resolve(src, "midgard.css"), resolve(dist, "midgard.css"));
    });
  },
};

const ctx = await context({
  entryPoints: [
    { in: resolve(src, "content/index.tsx"), out: "content" },
    { in: resolve(src, "huginn.ts"), out: "huginn" },
  ],
  outdir: dist,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome111"],
  jsx: "automatic",
  // React branches on process.env.NODE_ENV at runtime; a content script has no
  // `process`, so resolve it at build time (also drops React's dev-only code).
  define: { "process.env.NODE_ENV": '"production"' },
  // Imported stylesheets become strings for shadow-root injection; midgard.css is
  // never imported (the manifest loads the copied file into the light DOM).
  loader: { ".css": "text" },
  // With React in the bundle, ship minified + an external sourcemap: the parse
  // cost lands on every PR page, and devtools stays debuggable via the map.
  minify: true,
  sourcemap: true,
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
