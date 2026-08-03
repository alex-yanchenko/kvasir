import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packageExtension, referencedAssets } from "./packageExtension";

// Anchor on the repo root via import.meta so it reads the same manifest under vitest
// (cwd = repo root) and the pre-push `bun test` (cwd = packages/mimir).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const zipEntries = (zip: string): string[] =>
  execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter((entry) => entry.length > 0 && !entry.endsWith("/"))
    .sort();

describe("referencedAssets", () => {
  it("enumerates every asset the shipped MV3 manifest references, plus the manifest", () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, "packages/extension/manifest.json"), "utf8"));
    expect(referencedAssets(manifest)).toEqual([
      "dist/content.js",
      "dist/huginn.js",
      "dist/mermaid.mjs",
      "dist/midgard.css",
      "icons/icon-128.png",
      "icons/icon-16.png",
      "icons/icon-32.png",
      "icons/icon-48.png",
      "manifest.json",
    ]);
  });

  it("tolerates a minimal manifest with no referenced assets", () => {
    expect(referencedAssets({})).toEqual(["manifest.json"]);
  });

  it("reads action.default_icon paths not already covered by icons", () => {
    expect(
      referencedAssets({
        icons: { "16": "icons/icon-16.png" },
        action: { default_icon: { "128": "icons/icon-128-mono.png" } },
      }),
    ).toEqual(["icons/icon-128-mono.png", "icons/icon-16.png", "manifest.json"]);
  });

  it("includes a nested action.default_popup asset", () => {
    expect(referencedAssets({ action: { default_popup: "popup.html" } })).toEqual([
      "manifest.json",
      "popup.html",
    ]);
  });
});

describe("packageExtension", () => {
  let extensionDirectory: string;
  let outputZip: string;
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(path.join(tmpdir(), "kvasir-pkg-"));
    extensionDirectory = path.join(sandbox, "extension");
    outputZip = path.join(sandbox, "out", "kvasir-extension.zip");
    mkdirSync(path.join(extensionDirectory, "dist"), { recursive: true });
    mkdirSync(path.join(extensionDirectory, "icons"), { recursive: true });
    writeFileSync(
      path.join(extensionDirectory, "manifest.json"),
      JSON.stringify({
        content_scripts: [{ js: ["dist/content.js"], css: ["dist/midgard.css"] }],
        icons: { "16": "icons/icon-16.png" },
      }),
    );
    writeFileSync(path.join(extensionDirectory, "dist/content.js"), "// content");
    writeFileSync(path.join(extensionDirectory, "dist/midgard.css"), "/* css */");
    writeFileSync(path.join(extensionDirectory, "icons/icon-16.png"), "png");
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("zips exactly the referenced files with manifest.json at the archive root", () => {
    const archived = packageExtension(extensionDirectory, outputZip);
    expect(archived).toEqual(["dist/content.js", "dist/midgard.css", "icons/icon-16.png", "manifest.json"]);
    expect(existsSync(outputZip)).toBe(true);
    expect(zipEntries(outputZip)).toEqual([
      "dist/content.js",
      "dist/midgard.css",
      "icons/icon-16.png",
      "manifest.json",
    ]);
  });

  it("refuses to package when the build omitted a referenced asset", () => {
    rmSync(path.join(extensionDirectory, "dist/content.js"));
    expect(() => packageExtension(extensionDirectory, outputZip)).toThrow(/ENOENT|no such file/i);
    expect(existsSync(outputZip)).toBe(false);
  });

  it("refuses a manifest with an unmodeled asset-bearing top-level key", () => {
    writeFileSync(
      path.join(extensionDirectory, "manifest.json"),
      JSON.stringify({ options_page: "options.html" }),
    );
    expect(() => packageExtension(extensionDirectory, outputZip)).toThrow(/unmodeled manifest key/i);
    expect(existsSync(outputZip)).toBe(false);
  });

  it("refuses a manifest whose modeled field has the wrong shape", () => {
    writeFileSync(
      path.join(extensionDirectory, "manifest.json"),
      JSON.stringify({ icons: ["not-a-record"] }),
    );
    expect(() => packageExtension(extensionDirectory, outputZip)).toThrow();
    expect(existsSync(outputZip)).toBe(false);
  });
});
