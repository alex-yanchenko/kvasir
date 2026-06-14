import { describe, it, expect } from "vitest";
import type { PrManifest } from "./manifest";
import { preparePublish, type PublishState } from "./publish";

const NOW = "2026-06-04T12:00:00.000Z";

const spec = (steps: { file: string }[] = [{ file: "src/a.ts" }]) => ({
  version: 1,
  pr: { url: "https://github.com/acme/widget/pull/1", owner: "acme", repo: "widget", number: 1 },
  generatedAt: "2026-01-01T00:00:00.000Z", // overwritten on publish
  steps: steps.map((s, i) => ({ id: `s${i}`, title: "t", body: "<p>b</p>", file: s.file, anchor: `diff-${i}` })),
});

const manifestWith = (files: { path: string; additions: number }[]): PrManifest => ({
  owner: "acme",
  repo: "widget",
  number: 1,
  title: "t",
  description: "",
  headSha: "sha",
  discussion: [],
  files: files.map((f) => ({ path: f.path, anchor: "x", status: "modified", additions: f.additions, deletions: 0 })),
});

const state = (over: Partial<PublishState> = {}): PublishState => ({
  manifests: new Map(),
  nudges: new Map(),
  maxNudges: 1,
  now: NOW,
  ...over,
});

const KEY = "acme/widget#1";

describe("preparePublish", () => {
  it("rejects an invalid spec with the failing fields", () => {
    const outcome = preparePublish({ version: 1, pr: { url: "u" }, steps: [] }, state());
    expect(outcome.kind).toBe("invalid");
    const message = outcome.kind === "invalid" ? outcome.message : "";
    expect(message).toMatch(/^spec failed validation — .*pr\.owner/);
  });

  it("publishes (stamped) when there is no manifest to check coverage against", () => {
    const outcome = preparePublish(spec(), state());
    expect(outcome).toEqual({
      kind: "published",
      key: KEY,
      spec: { ...spec(), generatedAt: NOW },
      message: "Published 1 steps. Open the PR; the extension will render it.",
    });
  });

  it("nudges once when a significant file has no step", () => {
    const manifests = new Map([[KEY, manifestWith([{ path: "src/big.ts", additions: 80 }])]]);
    const outcome = preparePublish(spec([{ file: "src/other.ts" }]), state({ manifests }));
    expect(outcome.kind).toBe("nudge");
    const message = outcome.kind === "nudge" ? outcome.message : "";
    expect(message).toContain("NOT published — coverage check");
    expect(message).toContain("  - src/big.ts");
  });

  it("publishes anyway once the nudge budget is spent, noting the gap", () => {
    const manifests = new Map([[KEY, manifestWith([{ path: "src/big.ts", additions: 80 }])]]);
    const nudges = new Map([[KEY, 1]]); // already nudged once
    const outcome = preparePublish(spec([{ file: "src/other.ts" }]), state({ manifests, nudges }));
    expect(outcome).toEqual({
      kind: "published",
      key: KEY,
      spec: { ...spec([{ file: "src/other.ts" }]), generatedAt: NOW },
      message:
        "Published 1 steps. (1 changed file(s) still without a step) Open the PR; the extension will render it.",
    });
  });

  it("publishes with no gap note when every significant file is covered", () => {
    const manifests = new Map([[KEY, manifestWith([{ path: "src/a.ts", additions: 80 }])]]);
    const outcome = preparePublish(spec([{ file: "src/a.ts" }]), state({ manifests }));
    expect(outcome.kind).toBe("published");
    const message = outcome.kind === "published" ? outcome.message : "";
    expect(message).toBe("Published 1 steps. Open the PR; the extension will render it.");
  });

  it("accepts a JSON-stringified spec (the over-the-wire form)", () => {
    const outcome = preparePublish(JSON.stringify(spec()), state());
    expect(outcome.kind).toBe("published");
  });
});
