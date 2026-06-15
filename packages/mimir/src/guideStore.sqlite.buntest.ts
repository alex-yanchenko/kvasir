// Runs under `bun test` (NOT vitest) — bun:sqlite is Bun-only. Verifies the SQL
// store matches createMemoryGuideStore's contract: version bump on change,
// idempotent re-push, soft-delete (retained but read-absent), newest-first, and
// durability across a reopen of the same file.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Review } from "@prw/runes";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { reviewToRecord } from "./guideStore";
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
});
