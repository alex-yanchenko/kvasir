import { anchorFor, type Depth } from "@kvasir/runes";
import { describe, it, expect } from "vitest";
import type { PrManifest } from "./manifest";
import { preparePublish, type PublishState } from "./publish";

const NOW = "2026-06-04T12:00:00.000Z";

type StepSpec = { file: string; lines?: { side: "R" | "L"; start: number; end: number } };
const spec = (steps: StepSpec[] = [{ file: "src/a.ts" }]) => ({
  version: 1,
  pr: { url: "https://github.com/acme/widget/pull/1", owner: "acme", repo: "widget", number: 1 },
  generatedAt: "2026-01-01T00:00:00.000Z", // overwritten on publish
  overview: "Adds a thing.",
  steps: steps.map((s, i) => ({
    id: `s${i}`,
    title: "t",
    body: "<p>b</p>",
    file: s.file,
    anchor: `diff-${i}`,
    lines: s.lines ?? { side: "R", start: 1, end: 1 },
  })),
});

const manifestWith = (files: { path: string; additions: number; patch?: string }[]): PrManifest => ({
  owner: "acme",
  repo: "widget",
  number: 1,
  title: "t",
  author: "octocat",
  description: "",
  headSha: "sha",
  discussion: [],
  files: files.map((f) => ({
    path: f.path,
    anchor: "x",
    status: "modified",
    additions: f.additions,
    deletions: 0,
    ...(f.patch !== undefined ? { patch: f.patch } : {}),
  })),
});

const state = (over: Partial<PublishState> = {}): PublishState => ({
  manifests: new Map(),
  depths: new Map(),
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
    const base = spec();
    expect(outcome).toEqual({
      kind: "published",
      key: KEY,
      spec: {
        ...base,
        generatedAt: NOW,
        // anchor is re-derived from the file path, replacing the fixture's "diff-0"
        steps: base.steps.map((step) => ({ ...step, anchor: anchorFor(step.file) })),
      },
      message: "Published 1 steps. Open the PR; the extension will render it.",
    });
  });

  it("overwrites the model-authored anchor with the one derived from the file path", () => {
    // The fixture sends anchor "diff-0" (a stand-in for a truncated/mistyped value);
    // publish must replace it with the canonical diff-<sha256(path)> GitHub uses.
    const outcome = preparePublish(spec([{ file: "src/a.ts" }]), state());
    const anchor = outcome.kind === "published" ? outcome.spec.steps[0].anchor : "";
    expect(anchor).toBe(anchorFor("src/a.ts"));
    expect(anchor).not.toBe("diff-0");
  });

  it("prefers the manifest's recorded anchor over the derived one for the step's file", () => {
    // manifestWith stamps anchor "x"; the authoritative manifest value must win over
    // both the model's "diff-0" and the path-derived sha256 (matters for renames).
    const manifests = new Map([[KEY, manifestWith([{ path: "src/a.ts", additions: 1 }])]]);
    const outcome = preparePublish(spec([{ file: "src/a.ts" }]), state({ manifests }));
    expect(outcome.kind === "published" && outcome.spec.steps[0].anchor).toBe("x");
  });

  it("stamps the PR author from the manifest (not trusting the model-authored spec)", () => {
    const manifests = new Map([[KEY, manifestWith([{ path: "src/a.ts", additions: 1 }])]]);
    const outcome = preparePublish(spec(), state({ manifests }));
    expect(outcome.kind === "published" && outcome.spec.pr.author).toBe("octocat");
  });

  it("stamps the generation depth recorded by /generate (never trusted from the model)", () => {
    const depths = new Map<string, Depth>([[KEY, "light"]]);
    const outcome = preparePublish(spec(), state({ depths }));
    expect(outcome.kind === "published" && outcome.spec.depth).toBe("light");
  });

  it("omits depth entirely when no generate request was recorded (restart, manual publish)", () => {
    const outcome = preparePublish(spec(), state());
    expect(outcome.kind === "published" && "depth" in outcome.spec).toBe(false);
  });

  it("nudges once when a significant file has no step", () => {
    const manifests = new Map([[KEY, manifestWith([{ path: "src/big.ts", additions: 80 }])]]);
    const outcome = preparePublish(spec([{ file: "src/other.ts" }]), state({ manifests }));
    expect(outcome.kind).toBe("nudge");
    const message = outcome.kind === "nudge" ? outcome.message : "";
    expect(message).toContain("NOT published — fix these");
    expect(message).toContain("  - src/big.ts");
  });

  it("publishes anyway once the nudge budget is spent, noting the gap", () => {
    const manifests = new Map([[KEY, manifestWith([{ path: "src/big.ts", additions: 80 }])]]);
    const nudges = new Map([[KEY, 1]]); // already nudged once
    const outcome = preparePublish(spec([{ file: "src/other.ts" }]), state({ manifests, nudges }));
    const base = spec([{ file: "src/other.ts" }]);
    expect(outcome).toEqual({
      kind: "published",
      key: KEY,
      spec: {
        ...base,
        generatedAt: NOW,
        pr: { ...base.pr, author: "octocat" },
        // src/other.ts isn't in the manifest (src/big.ts is), so the anchor derives from the path
        steps: base.steps.map((step) => ({ ...step, anchor: anchorFor(step.file) })),
        coverage: { significant: ["src/big.ts"], uncovered: ["src/big.ts"] },
      },
      message:
        "Published 1 steps. (1 changed file(s) still without a step) Open the PR; the extension will render it.",
    });
  });

  it("stamps coverage (significant files + the uncovered ones) from the manifest", () => {
    const manifests = new Map([
      [
        KEY,
        manifestWith([
          { path: "src/a.ts", additions: 80 },
          { path: "src/b.ts", additions: 80 },
        ]),
      ],
    ]);
    const nudges = new Map([[KEY, 1]]); // budget spent → publishes despite the gap
    const outcome = preparePublish(spec([{ file: "src/a.ts" }]), state({ manifests, nudges }));
    expect(outcome.kind === "published" && outcome.spec.coverage).toEqual({
      significant: ["src/a.ts", "src/b.ts"],
      uncovered: ["src/b.ts"],
    });
  });

  it("omits coverage entirely when no manifest was recorded", () => {
    const outcome = preparePublish(spec(), state());
    expect(outcome.kind === "published" && outcome.spec.coverage).toBeUndefined();
  });

  it("does not nudge for a big test file — tests are excluded from the coverage check", () => {
    const manifests = new Map([
      [
        KEY,
        manifestWith([
          { path: "src/a.ts", additions: 80 },
          { path: "src/a.spec.ts", additions: 200 },
        ]),
      ],
    ]);
    const outcome = preparePublish(spec([{ file: "src/a.ts" }]), state({ manifests }));
    expect(outcome.kind).toBe("published"); // a.ts covered, a.spec.ts ignored → first publish goes through
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

  it("rejects (hard) a step with no lines — it would open to nothing", () => {
    const noLines = {
      ...spec(),
      steps: [{ id: "s0", title: "t", body: "<p>b</p>", file: "src/a.ts", anchor: "diff-0" }],
    };
    const outcome = preparePublish(noLines, state());
    expect(outcome.kind).toBe("invalid");
    const message = outcome.kind === "invalid" ? outcome.message : "";
    expect(message).toContain("Steps with no lines: s0");
  });

  it("rejects a spec with no overview", () => {
    const base = spec();
    const noOverview = {
      version: base.version,
      pr: base.pr,
      generatedAt: base.generatedAt,
      steps: base.steps,
    };
    const outcome = preparePublish(noOverview, state());
    expect(outcome.kind).toBe("invalid");
    const message = outcome.kind === "invalid" ? outcome.message : "";
    expect(message).toContain("set overview");
    expect(message).toContain("HTML summary"); // matches the spec/channel wording, not "plain-text"
    expect(message).not.toContain("plain-text");
  });

  it("nudges when a step's lines fall outside the file's changed hunks", () => {
    const manifests = new Map([
      [KEY, manifestWith([{ path: "src/a.ts", additions: 80, patch: "@@ -0,0 +1,2 @@\n+a\n+b" }])],
    ]);
    const outcome = preparePublish(
      spec([{ file: "src/a.ts", lines: { side: "R", start: 50, end: 60 } }]),
      state({ manifests }),
    );
    expect(outcome.kind).toBe("nudge");
    const message = outcome.kind === "nudge" ? outcome.message : "";
    expect(message).toContain("fall outside their file's changed hunks");
    expect(message).toContain("  - s0 (src/a.ts)");
  });

  it("nudges with both sections when a file is uncovered AND a step is off-target", () => {
    const manifests = new Map([
      [
        KEY,
        manifestWith([
          { path: "src/a.ts", additions: 80, patch: "@@ -0,0 +1,2 @@\n+a\n+b" },
          { path: "src/big.ts", additions: 80, patch: "@@ -0,0 +1,2 @@\n+x\n+y" },
        ]),
      ],
    ]);
    // one step on src/a.ts with off-target lines; src/big.ts is significant but step-less
    const outcome = preparePublish(
      spec([{ file: "src/a.ts", lines: { side: "R", start: 50, end: 60 } }]),
      state({ manifests }),
    );
    expect(outcome.kind).toBe("nudge");
    const message = outcome.kind === "nudge" ? outcome.message : "";
    expect(message).toContain("but no step"); // uncovered section
    expect(message).toContain("fall outside their file's changed hunks"); // off-target section
    expect(message.split("\n\n")).toHaveLength(3); // prefix + both sections
  });

  it("publishes when a step's lines sit at the edge of the changed hunk", () => {
    const manifests = new Map([
      [KEY, manifestWith([{ path: "src/a.ts", additions: 80, patch: "@@ -0,0 +1,3 @@\n+a\n+b\n+c" }])],
    ]);
    // hunk is R 1-3; the step sits on the last changed line — must count as on-target
    const outcome = preparePublish(
      spec([{ file: "src/a.ts", lines: { side: "R", start: 3, end: 3 } }]),
      state({ manifests }),
    );
    expect(outcome.kind).toBe("published");
  });

  it("publishes once the nudge budget is spent for off-target lines", () => {
    const manifests = new Map([
      [KEY, manifestWith([{ path: "src/a.ts", additions: 80, patch: "@@ -0,0 +1,2 @@\n+a\n+b" }])],
    ]);
    const nudges = new Map([[KEY, 1]]); // budget already spent → publishes despite off-target
    const outcome = preparePublish(
      spec([{ file: "src/a.ts", lines: { side: "R", start: 50, end: 60 } }]),
      state({ manifests, nudges }),
    );
    expect(outcome.kind).toBe("published");
  });
});
