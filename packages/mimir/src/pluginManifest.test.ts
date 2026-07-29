import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { VERSION } from "./version";

// The plugin manifests are release-please-managed alongside version.ts, but nothing else
// asserts they actually agree — this guards a manual edit or a release-please misconfiguration.
// Anchor on the repo root via import.meta so it reads the same files under vitest (cwd = repo
// root) and the pre-push `bun test` (cwd = packages/mimir).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));

describe("plugin manifest", () => {
  it("plugin.json version tracks VERSION — one version train", () => {
    expect(readJson("plugin/.claude-plugin/plugin.json").version).toBe(VERSION);
  });

  it("the marketplace entry and plugin.json describe the plugin identically", () => {
    const marketplace = readJson(".claude-plugin/marketplace.json");
    const plugin = readJson("plugin/.claude-plugin/plugin.json");
    const listed = (marketplace.plugins as Array<{ name: string; description: string }>).find(
      (entry) => entry.name === "kvasir",
    );
    expect(listed?.description).toBe(plugin.description);
  });
});
