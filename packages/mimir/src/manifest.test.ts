import { anchorFor } from "@kvasir/runes";
import { describe, it, expect } from "vitest";
import {
  buildDiscussion,
  buildManifest,
  COVERAGE_MIN_ADDS,
  renderManifest,
  significantFiles,
  uncoveredFiles,
  type GhInline,
  type GhIssueComment,
  type GhReview,
  type PrManifest,
} from "./manifest";

const mkManifest = (files: Partial<PrManifest["files"][number]>[]): PrManifest => ({
  owner: "a",
  repo: "b",
  number: 1,
  title: "t",
  author: "a",
  description: "",
  headSha: "sha",
  discussion: [],
  files: files.map((f, i) => ({
    path: f.path ?? `f${i}.ts`,
    anchor: f.anchor ?? `diff-${i}`,
    status: f.status ?? "modified",
    additions: f.additions ?? 0,
    deletions: f.deletions ?? 0,
    ...(f.patch !== undefined ? { patch: f.patch } : {}),
  })),
});

describe("significantFiles", () => {
  it("lists files >= COVERAGE_MIN_ADDS, excluding small/removed/generated/test files", () => {
    const m = mkManifest([
      { path: "src/a.ts", additions: 40 },
      { path: "src/small.ts", additions: 5 }, // below the threshold
      { path: "package-lock.json", additions: 200 }, // generated
      { path: "src/a.spec.ts", additions: 90 }, // unit test
      { path: "test/unit/b.unit.spec.ts", additions: 90 }, // test dir + .spec
      { path: "src/c.e2e-spec.ts", additions: 90 }, // e2e spec
      { path: "src/d.ts", additions: 50, status: "removed" }, // removed
    ]);
    expect(significantFiles(m)).toEqual(["src/a.ts"]);
  });
});

describe("uncoveredFiles", () => {
  it("flags a significant changed file with no step", () => {
    const m = mkManifest([{ path: "src/big.ts", additions: COVERAGE_MIN_ADDS }]);
    expect(uncoveredFiles(m, [])).toEqual(["src/big.ts"]);
  });

  it("clears a file once a step covers it (exact or boundary-lenient path match)", () => {
    const m = mkManifest([{ path: "src/big.ts", additions: 100 }]);
    expect(uncoveredFiles(m, ["src/big.ts"])).toEqual([]);
    expect(uncoveredFiles(m, ["big.ts"])).toEqual([]); // step used the short path
  });

  it("ignores small, removed, and generated/lockfile changes", () => {
    const m = mkManifest([
      { path: "src/tiny.ts", additions: COVERAGE_MIN_ADDS - 1 }, // below threshold
      { path: "src/gone.ts", additions: 500, status: "removed" }, // deleted
      { path: "package-lock.json", additions: 5000 }, // lockfile
      { path: "dist/bundle.js", additions: 9000 }, // generated dir
      { path: "app.min.js", additions: 2000 }, // minified
    ]);
    expect(uncoveredFiles(m, [])).toEqual([]);
  });

  it("returns only the still-uncovered significant files", () => {
    const m = mkManifest([
      { path: "src/a.ts", additions: 40 },
      { path: "src/b.ts", additions: 60 },
      { path: "src/c.ts", additions: 80 },
    ]);
    expect(uncoveredFiles(m, ["src/b.ts"])).toEqual(["src/a.ts", "src/c.ts"]);
  });
});

describe("buildDiscussion", () => {
  it("merges the three sources oldest → newest, tagging kind, author, and bot", () => {
    const comments: GhIssueComment[] = [
      { user: { login: "carol", type: "User" }, body: "third", created_at: "2026-03-03" },
    ];
    const reviews: GhReview[] = [
      {
        user: { login: "bot-ci", type: "Bot" },
        body: "first",
        state: "COMMENTED",
        submitted_at: "2026-03-01",
      },
    ];
    const inline: GhInline[] = [
      {
        user: { login: "bob", type: "User" },
        body: "second",
        path: "src/x.ts",
        line: 12,
        position: 4,
        created_at: "2026-03-02",
      },
    ];
    expect(buildDiscussion(comments, reviews, inline)).toEqual([
      { kind: "review", author: "bot-ci", bot: true, state: "COMMENTED", body: "first" },
      { kind: "inline", author: "bob", bot: false, file: "src/x.ts", line: 12, body: "second" },
      { kind: "comment", author: "carol", bot: false, body: "third" },
    ]);
  });

  it("skips empty/whitespace bodies and omits a review's absent state", () => {
    const reviews: GhReview[] = [
      { user: { login: "ann" }, body: "   ", submitted_at: "2026-01-01" }, // blank → dropped
      { user: { login: "ann" }, body: "looks good", submitted_at: "2026-01-02" }, // no state
    ];
    expect(buildDiscussion([], reviews, [])).toEqual([
      { kind: "review", author: "ann", bot: false, body: "looks good" },
    ]);
  });

  it("drops outdated inline comments (null/undefined position) and falls back line → original_line", () => {
    const inline: GhInline[] = [
      { user: { login: "x" }, body: "gone", path: "a.ts", position: null, created_at: "2026-01-01" },
      { user: { login: "x" }, body: "also gone", path: "a.ts", created_at: "2026-01-02" }, // no position
      {
        user: { login: "x" },
        body: "kept",
        path: "a.ts",
        original_line: 7,
        position: 1,
        created_at: "2026-01-03",
      },
    ];
    expect(buildDiscussion([], [], inline)).toEqual([
      { kind: "inline", author: "x", bot: false, file: "a.ts", line: 7, body: "kept" },
    ]);
  });

  it("falls back to 'unknown' author and null line when fields are missing", () => {
    const inline: GhInline[] = [{ body: "orphan", position: 2, created_at: "2026-01-01" }];
    expect(buildDiscussion([], [], inline)).toEqual([
      { kind: "inline", author: "unknown", bot: false, line: null, body: "orphan" },
    ]);
  });

  it("skips comment and inline entries with missing or blank bodies", () => {
    const comments: GhIssueComment[] = [
      { user: { login: "a" }, created_at: "2026-01-01" }, // no body → dropped
      { user: { login: "b" }, body: "   ", created_at: "2026-01-02" }, // blank → dropped
      { user: { login: "c" }, body: "keep", created_at: "2026-01-09" },
    ];
    const inline: GhInline[] = [
      { user: { login: "d" }, position: 1, created_at: "2026-01-03" }, // no body → dropped
      { user: { login: "e" }, body: "keep-inline", position: 1, created_at: "2026-01-08" },
    ];
    expect(buildDiscussion(comments, [], inline)).toEqual([
      { kind: "inline", author: "e", bot: false, line: null, body: "keep-inline" },
      { kind: "comment", author: "c", bot: false, body: "keep" },
    ]);
  });

  it("treats a missing timestamp as earliest (at defaults to '') across all three sources", () => {
    const comments: GhIssueComment[] = [{ user: { login: "c" }, body: "undated comment" }];
    const reviews: GhReview[] = [{ user: { login: "r" }, body: "undated review" }];
    const inline: GhInline[] = [{ user: { login: "i" }, body: "undated inline", position: 1 }];
    // all at="" → stable sort keeps concat order (comment, review, inline)
    expect(buildDiscussion(comments, reviews, inline)).toEqual([
      { kind: "comment", author: "c", bot: false, body: "undated comment" },
      { kind: "review", author: "r", bot: false, body: "undated review" },
      { kind: "inline", author: "i", bot: false, line: null, body: "undated inline" },
    ]);
  });

  it("truncates an over-long body with an ellipsis (CAP_ITEM)", () => {
    const comments: GhIssueComment[] = [{ user: { login: "ann" }, body: "y".repeat(801), created_at: "x" }];
    expect(buildDiscussion(comments, [], [])).toEqual([
      { kind: "comment", author: "ann", bot: false, body: "y".repeat(800) + "…" },
    ]);
  });

  it("drops the oldest items until under the total budget", () => {
    const body = "x".repeat(800); // CAP_ITEM — 21 of these (16800) exceed CAP_TOTAL (16000) by one
    const comments: GhIssueComment[] = Array.from({ length: 21 }, (_unused, i) => ({
      user: { login: `a${i}` },
      body,
      created_at: `2026-01-${String(i + 1).padStart(2, "0")}`,
    }));
    const survivors = buildDiscussion(comments, [], []).map((d) => d.author);
    expect(survivors).toEqual(Array.from({ length: 20 }, (_unused, i) => `a${i + 1}`)); // a0 (oldest) dropped
  });
});

describe("buildManifest", () => {
  const ids = { owner: "acme", repo: "widget", number: 7 };

  it("maps files (with anchors), trims the description, and assembles discussion", () => {
    const result = buildManifest(ids, {
      pull: {
        title: "Add compute",
        body: "  the description  ",
        head: { sha: "abc123" },
        user: { login: "dev" },
      },
      files: [
        { filename: "src/foo.ts", status: "modified", additions: 10, deletions: 2, patch: "@@ -1 +1 @@" },
        { filename: "img.png", status: "added", additions: 0, deletions: 0 }, // no patch → omitted
      ],
      issueComments: [{ user: { login: "ann" }, body: "nice", created_at: "2026-01-01" }],
      reviews: [],
      inlineComments: [],
    });
    expect(result).toEqual({
      owner: "acme",
      repo: "widget",
      number: 7,
      title: "Add compute",
      author: "dev",
      description: "the description",
      headSha: "abc123",
      files: [
        {
          path: "src/foo.ts",
          anchor: anchorFor("src/foo.ts"),
          status: "modified",
          additions: 10,
          deletions: 2,
          patch: "@@ -1 +1 @@",
        },
        { path: "img.png", anchor: anchorFor("img.png"), status: "added", additions: 0, deletions: 0 },
      ],
      discussion: [{ kind: "comment", author: "ann", bot: false, body: "nice" }],
    });
  });

  it("truncates an over-long description (CAP_DESCRIPTION)", () => {
    const result = buildManifest(ids, {
      pull: { title: "t", body: "z".repeat(8001) },
      files: [],
      issueComments: [],
      reviews: [],
      inlineComments: [],
    });
    expect(result.description).toEqual("z".repeat(8000) + "…");
  });

  it("defaults headSha to '' when the pull has no head sha", () => {
    const result = buildManifest(ids, {
      pull: { title: "t" },
      files: [],
      issueComments: [],
      reviews: [],
      inlineComments: [],
    });
    expect(result).toEqual({
      owner: "acme",
      repo: "widget",
      number: 7,
      title: "t",
      author: "unknown",
      description: "",
      headSha: "",
      files: [],
      discussion: [],
    });
  });
});

describe("renderManifest", () => {
  const structural = {
    owner: "a",
    repo: "b",
    number: 1,
    title: "t",
    author: "a",
    headSha: "sha",
    files: [{ path: "src/a.ts", anchor: "diff-0", status: "modified", additions: 40, deletions: 0 }],
  };

  it("keeps structure as JSON and fences the description + every comment body as untrusted data", () => {
    const manifest: PrManifest = {
      ...mkManifest([{ path: "src/a.ts", additions: 40 }]),
      description: "Does X.",
      discussion: [
        { kind: "inline", author: "bot1", bot: true, body: "nit here", file: "src/a.ts", line: 12 },
        { kind: "review", author: "rev", bot: false, body: "looks good", state: "APPROVED" },
        { kind: "comment", author: "dev", bot: false, body: "thanks" },
      ],
    };
    const out = renderManifest(manifest);
    const [jsonPart] = out.split("\n\n--- UNTRUSTED PR PROSE");
    // The JSON the model authors from carries no untrusted free text.
    expect(JSON.parse(jsonPart)).toEqual(structural);
    expect(out).toContain("--- UNTRUSTED PR PROSE");
    expect(out).toContain("PR DESCRIPTION:\nDoes X.");
    expect(out).toContain("bot1 [bot] — inline on src/a.ts:12:\nnit here");
    expect(out).toContain("rev — review APPROVED:\nlooks good");
    expect(out).toContain("dev — comment:\nthanks");
    expect(out).toContain("--- END UNTRUSTED PR PROSE ---");
  });

  it("emits plain JSON with no fence when there is no description and no discussion", () => {
    const out = renderManifest(mkManifest([{ path: "src/a.ts", additions: 40 }]));
    expect(out).not.toContain("UNTRUSTED PR PROSE");
    expect(JSON.parse(out)).toEqual(structural);
  });
});
