import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// The plugin (plugin/) is served from the committed repo, so it ships COPIES of the repo's
// USER-facing skills rather than referencing them. That is a SUBSET of .claude/skills/* —
// kvasir-reflect is a contributor-only skill (it edits kvasir's own source) and stays out.
// The copies must be byte-identical to their canonical source: if you edit a shipped skill,
// re-copy it into plugin/skills/<name>/. Anchor on the repo root via import.meta so it reads
// the same files under vitest (cwd = repo root) and the pre-push `bun test` (cwd = mimir).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CANONICAL = path.join(ROOT, ".claude/skills");
const PLUGIN = path.join(ROOT, "plugin/skills");
const SHIPPED = ["kvasir"]; // the user-facing skills bundled in the plugin
const read = (root: string, name: string): string => readFileSync(path.join(root, name, "SKILL.md"), "utf8");

describe("plugin skill parity", () => {
  it("ships exactly the user-facing skills, byte-identical to canonical", () => {
    // both directions: no shipped skill missing its copy, and no orphan left behind
    expect(readdirSync(PLUGIN).sort()).toEqual([...SHIPPED].sort());
    const canonical = SHIPPED.map((name) => ({ name, content: read(CANONICAL, name) }));
    const shipped = SHIPPED.map((name) => ({ name, content: read(PLUGIN, name) }));
    expect(shipped).toEqual(canonical);
  });
});
