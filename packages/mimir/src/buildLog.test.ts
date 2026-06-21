import type { WalkthroughSpec } from "@kvasir/runes";
import { describe, it, expect } from "vitest";
import { buildLogFileName, composeBuildLog } from "./buildLog";
import type { PrManifest } from "./manifest";

const PR = "https://github.com/acme/web/pull/7";

const mkManifest = (over: Partial<PrManifest> = {}): PrManifest => ({
  owner: "acme",
  repo: "web",
  number: 7,
  title: "Auth flow",
  author: "dev",
  description: "d",
  headSha: "sha1",
  files: [
    { path: "src/a.ts", anchor: "x", status: "modified", additions: 40, deletions: 5 },
    { path: "src/b.ts", anchor: "y", status: "modified", additions: 10, deletions: 1 },
  ],
  discussion: [],
  ...over,
});

const mkSpec = (files: string[]): WalkthroughSpec => ({
  version: 1,
  pr: { url: PR, owner: "acme", repo: "web", number: 7 },
  generatedAt: "t",
  steps: files.map((file, index) => ({ id: `s${index}`, title: "T", body: "b", file, anchor: "a" })),
});

describe("buildLogFileName", () => {
  it("makes a filesystem-safe name from the pr key", () => {
    expect(buildLogFileName(PR)).toBe("acme-web-7.md");
  });
});

describe("composeBuildLog", () => {
  it("renders facts + rationale when the significant file is covered", () => {
    const log = composeBuildLog({
      pr: PR,
      depth: "heavy",
      rationale: "read callers of foo()",
      manifest: mkManifest(),
      spec: mkSpec(["src/a.ts"]),
      now: "2026-06-16T00:00:00Z",
    });
    expect(log).toContain("## Kvasir build log — acme/web#7");
    expect(log).toContain("depth: heavy");
    expect(log).toContain(`PR: ${PR}`);
    expect(log).toContain("**Change:** 2 files, +50 / -6");
    expect(log).toContain("**Walkthrough:** 1 steps; covers 1/1 significant files");
    expect(log).not.toContain("Uncovered significant files");
    expect(log).toContain("read callers of foo()");
  });

  it("lists uncovered significant files when a step is missing", () => {
    const log = composeBuildLog({
      pr: PR,
      depth: "heavy",
      rationale: "x",
      manifest: mkManifest(),
      spec: mkSpec(["src/b.ts"]),
      now: "t",
    });
    expect(log).toContain("covers 0/1 significant files");
    expect(log).toContain("**Uncovered significant files:**");
    expect(log).toContain("  - src/a.ts");
  });

  it("degrades gracefully with no manifest and notes a missing rationale", () => {
    const log = composeBuildLog({
      pr: PR,
      depth: "light",
      rationale: "   ",
      manifest: null,
      spec: mkSpec(["src/a.ts", "src/b.ts"]),
      now: "t",
    });
    expect(log).toContain("**Change:** (no manifest — start_walkthrough was not recorded)");
    expect(log).toContain("**Walkthrough:** 2 steps");
    expect(log).toContain("_(no rationale recorded)_");
  });

  it("counts zero steps when there is no spec", () => {
    const log = composeBuildLog({
      pr: PR,
      depth: "light",
      rationale: "diff only",
      manifest: mkManifest(),
      spec: null,
      now: "t",
    });
    expect(log).toContain("**Walkthrough:** 0 steps; covers 0/1 significant files");
    expect(log).toContain("  - src/a.ts");
  });
});
