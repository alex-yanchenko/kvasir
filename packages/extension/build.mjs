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
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import remToPx from "@thedutchcoder/postcss-rem-to-px";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "src");
const dist = resolve(here, "dist");
const watch = process.argv.includes("--watch");

// Compile Asgard's Tailwind entry → asgard.compiled.css, which boot.tsx imports
// as text for shadow-root injection. rem→px keeps Asgard's sizing independent of
// GitHub's <html> font-size (an isolation leak otherwise). Run in esbuild's
// onStart so a one-shot build and every --watch rebuild both regenerate the CSS
// before esbuild reads the import — no compile/read race, no parallel watcher.
const tailwindEntry = resolve(src, "content/asgard/tailwind.css");
const tailwindOut = resolve(src, "content/asgard/asgard.compiled.css");
const cssProcessor = postcss([tailwindcss(), remToPx()]);

const compileTailwind = {
  name: "compile-tailwind",
  setup(build) {
    build.onStart(async () => {
      try {
        const input = await readFile(tailwindEntry, "utf8");
        const result = await cssProcessor.process(input, { from: tailwindEntry, to: tailwindOut });
        await writeFile(tailwindOut, result.css);
      } catch (e) {
        return { errors: [{ text: `Tailwind compile failed: ${e.message}` }] };
      }
    });
  },
};

// Copy midgard.css on every successful build so --watch keeps it in sync.
const copyAssets = {
  name: "copy-assets",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      try {
        await mkdir(dist, { recursive: true });
        await copyFile(resolve(src, "midgard.css"), resolve(dist, "midgard.css"));
      } catch (e) {
        return { errors: [{ text: `asset copy failed: ${e.message}` }] };
      }
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
  // Ship minified. The external sourcemap (~2.6 MB) is dev-only — emitted under
  // --watch so devtools stays debuggable, but kept out of the one-shot/packaged
  // build so it doesn't bloat the published bundle.
  minify: true,
  sourcemap: watch,
  logLevel: "info",
  plugins: [compileTailwind, copyAssets],
});

if (watch) {
  await ctx.watch();
  console.log("watching for changes…");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
