// Runs under `bun test` (NOT vitest) — bun:sqlite is Bun-only. Verifies the SQL
// store matches createMemoryGuideStore's contract: version bump on change,
// idempotent re-push, soft-delete (retained but read-absent), newest-first, and
// durability across a reopen of the same file.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Review, type WalkthroughSpec } from "@kvasir/runes";
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { reviewToRecord, specToRecord } from "./guideStore";
import { createSqliteGuideStore } from "./guideStore.sqlite";

const mkReview = (over: Partial<Review> = {}): Review => ({
  version: 1,
  id: "auth-flow-abc",
  title: "Auth flow",
  source: "chat",
  generatedAt: "2026-01-02T00:00:00Z",
  steps: [
    { id: "a", title: "Guard", body: "b", repo: { owner: "acme", name: "web" }, file: "src/a.ts" },
    { id: "b", title: "API", body: "b", repo: { owner: "acme", name: "api" }, file: "src/b.ts" },
  ],
  ...over,
});

// Monotonic clock so updatedAt ordering is deterministic.
const mkSpec = (over: Partial<WalkthroughSpec> = {}): WalkthroughSpec => ({
  version: 1,
  pr: {
    url: "https://github.com/acme/web/pull/7",
    owner: "acme",
    repo: "web",
    number: 7,
    title: "Add rate limit",
    author: "alice",
  },
  generatedAt: "2026-02-01T00:00:00Z",
  steps: [{ id: "s1", title: "Limiter", body: "b", file: "src/x.ts", anchor: "diff-abc" }],
  ...over,
});

const clock = () => {
  let t = 0;
  return () => ++t;
};

describe("createSqliteGuideStore (in-memory)", () => {
  it("inserts at version 1, gets the live payload, missing id is null", () => {
    const store = createSqliteGuideStore(":memory:", clock());
    expect(store.get("x")).toBeNull();
    const summary = store.put(reviewToRecord(mkReview({ id: "x" })));
    expect(summary.version).toBe(1);
    expect(summary.kind).toBe("code");
    expect(store.get("x")).toEqual({ kind: "code", payload: mkReview({ id: "x" }) });
  });

  it("lists live rows newest-changed first", () => {
    const store = createSqliteGuideStore(":memory:", clock());
    store.put(reviewToRecord(mkReview({ id: "x" })));
    store.put(reviewToRecord(mkReview({ id: "y" })));
    expect(store.list().map((entry) => entry.id)).toEqual(["y", "x"]);
  });

  it("is idempotent on unchanged content: version held, no re-sort", () => {
    const store = createSqliteGuideStore(":memory:", clock());
    store.put(reviewToRecord(mkReview({ id: "x" })));
    store.put(reviewToRecord(mkReview({ id: "y" })));
    const again = store.put(reviewToRecord(mkReview({ id: "x" })));
    expect(again.version).toBe(1);
    expect(store.list().map((entry) => entry.id)).toEqual(["y", "x"]);
  });

  it("bumps version and lifts to top when content changes", () => {
    const store = createSqliteGuideStore(":memory:", clock());
    store.put(reviewToRecord(mkReview({ id: "x" })));
    store.put(reviewToRecord(mkReview({ id: "y" })));
    const changed = store.put(reviewToRecord(mkReview({ id: "x", title: "v2" })));
    expect(changed.version).toBe(2);
    expect(store.list().map((entry) => entry.id)).toEqual(["x", "y"]);
  });

  it("omits absent source/generatedAt in the summary", () => {
    const store = createSqliteGuideStore(":memory:", clock());
    const summary = store.put(
      reviewToRecord(mkReview({ id: "x", source: undefined, generatedAt: undefined })),
    );
    expect(summary.source).toBeUndefined();
    expect(summary.generatedAt).toBeUndefined();
    expect(store.list()[0]?.source).toBeUndefined();
  });

  it("soft-deletes: absent from get + list, retained, second delete false", () => {
    const store = createSqliteGuideStore(":memory:", clock());
    store.put(reviewToRecord(mkReview({ id: "x" })));
    expect(store.softDelete("x")).toBe(true);
    expect(store.get("x")).toBeNull();
    expect(store.list()).toEqual([]);
    expect(store.softDelete("x")).toBe(false);
    expect(store.softDelete("missing")).toBe(false);
  });

  it("resurrects a soft-deleted row on re-push, holding the version for unchanged content", () => {
    const store = createSqliteGuideStore(":memory:", clock());
    store.put(reviewToRecord(mkReview({ id: "x" })));
    store.softDelete("x");
    const resurrected = store.put(reviewToRecord(mkReview({ id: "x" })));
    expect(resurrected.version).toBe(1);
    expect(store.list().map((entry) => entry.id)).toEqual(["x"]);
  });

  it("persists author and derives the PR number from the id (pr entry)", () => {
    const store = createSqliteGuideStore(":memory:", clock());
    store.put(specToRecord(mkSpec()));
    const entry = store.list()[0];
    expect(entry?.kind).toBe("pr");
    expect(entry?.prNumber).toBe(7);
    expect(entry?.author).toBe("alice");
  });

  it("still derives the PR number when the spec carries no author", () => {
    const store = createSqliteGuideStore(":memory:", clock());
    store.put(specToRecord(mkSpec({ pr: { ...mkSpec().pr, author: undefined } })));
    const entry = store.list()[0];
    expect(entry?.prNumber).toBe(7);
    expect(entry?.author).toBeUndefined();
  });
});

describe("createSqliteGuideStore (file-backed durability)", () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "kvasir-db-"));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("persists rows across a fresh store on the same file", () => {
    const dbPath = path.join(directory, "kvasir.db");
    createSqliteGuideStore(dbPath, clock()).put(reviewToRecord(mkReview({ id: "r1" })));
    const reopened = createSqliteGuideStore(dbPath, clock());
    expect(reopened.get("r1")).toEqual({ kind: "code", payload: mkReview({ id: "r1" }) });
    expect(reopened.list().map((entry) => entry.id)).toEqual(["r1"]);
  });

  it("migrates a db created before the author column existed", () => {
    const dbPath = path.join(directory, "kvasir.db");
    const old = new Database(dbPath, { create: true });
    old.run(
      "CREATE TABLE entries (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, source TEXT," +
        " steps INTEGER NOT NULL, url TEXT NOT NULL, repos TEXT NOT NULL, payload TEXT NOT NULL," +
        " version INTEGER NOT NULL, content_hash TEXT NOT NULL, generated_at TEXT, created_at INTEGER NOT NULL," +
        " updated_at INTEGER NOT NULL, deleted_at INTEGER) STRICT;",
    );
    old.close();
    const store = createSqliteGuideStore(dbPath, clock());
    store.put(reviewToRecord(mkReview({ id: "x" }))); // upsert must succeed post-ALTER
    expect(store.list().map((entry) => entry.id)).toEqual(["x"]);
  });
});
