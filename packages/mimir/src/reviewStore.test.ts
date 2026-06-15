import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Review } from "@prw/runes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileReviewStore, createMemoryReviewStore, toReviewSummary } from "./reviewStore";

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

describe("toReviewSummary", () => {
  it("summarizes title/source/steps and the distinct repos", () => {
    expect(toReviewSummary(mkReview())).toEqual({
      id: "auth-flow-abc",
      title: "Auth flow",
      source: "chat",
      generatedAt: "2026-01-02T00:00:00Z",
      steps: 2,
      repos: ["acme/web", "acme/api"],
    });
  });

  it("defaults a missing id to '' and omits absent source/generatedAt", () => {
    expect(toReviewSummary(mkReview({ id: undefined, source: undefined, generatedAt: undefined }))).toEqual({
      id: "",
      title: "Auth flow",
      steps: 2,
      repos: ["acme/web", "acme/api"],
    });
  });
});

describe("createMemoryReviewStore", () => {
  it("puts, gets, and lists newest-first; a missing id is null", () => {
    const store = createMemoryReviewStore();
    expect(store.get("nope")).toBeNull();
    store.put(mkReview({ id: "x", generatedAt: "2026-01-01T00:00:00Z" }));
    store.put(mkReview({ id: "y", title: "Newer", generatedAt: "2026-02-01T00:00:00Z" }));
    expect(store.get("x")?.id).toBe("x");
    store.put(mkReview({ id: undefined })); // id-less put is ignored
    expect(store.list().map((summary) => summary.id)).toEqual(["y", "x"]);
  });

  it("seeds from an array, skipping id-less reviews", () => {
    const store = createMemoryReviewStore([mkReview({ id: "s" }), mkReview({ id: undefined })]);
    expect(store.list().map((summary) => summary.id)).toEqual(["s"]);
  });
});

describe("createFileReviewStore", () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "kv-reviews-"));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("persists a review to disk and reads it back across a fresh store", () => {
    createFileReviewStore(directory).put(mkReview({ id: "r1" }));
    expect(createFileReviewStore(directory).get("r1")).toEqual(mkReview({ id: "r1" }));
  });

  it("lists summaries newest-first and skips corrupt files", () => {
    const store = createFileReviewStore(directory);
    store.put(mkReview({ id: "old", generatedAt: "2026-01-01T00:00:00Z" }));
    store.put(mkReview({ id: "new", generatedAt: "2026-03-01T00:00:00Z" }));
    writeFileSync(path.join(directory, "junk.json"), "not json"); // JSON.parse throws
    writeFileSync(path.join(directory, "wrong.json"), JSON.stringify({ hello: "world" })); // fails the schema
    expect(store.list().map((summary) => summary.id)).toEqual(["new", "old"]);
  });

  it("sorts date-less reviews last and ignores non-json files", () => {
    const store = createFileReviewStore(directory);
    store.put(mkReview({ id: "newer", generatedAt: "2026-06-01T00:00:00Z" }));
    store.put(mkReview({ id: "older", generatedAt: "2026-01-01T00:00:00Z" }));
    store.put(mkReview({ id: "undated", generatedAt: undefined }));
    writeFileSync(path.join(directory, "notes.txt"), "ignored");
    const ids = store.list().map((summary) => summary.id);
    expect(ids).toEqual(["newer", "older", "undated"]); // newest-first; missing date last, .txt skipped
  });

  it("returns null for a missing/unsafe id and refuses to write an unsafe id", () => {
    const store = createFileReviewStore(directory);
    expect(store.get("missing")).toBeNull();
    expect(store.get("../escape")).toBeNull();
    store.put(mkReview({ id: "../escape" }));
    expect(store.list()).toEqual([]);
  });

  it("list() returns [] when the directory has gone away", () => {
    const store = createFileReviewStore(directory);
    rmSync(directory, { recursive: true, force: true });
    expect(store.list()).toEqual([]);
  });

  it("list() skips entries it can't read (e.g. a directory named *.json)", () => {
    const store = createFileReviewStore(directory);
    store.put(mkReview({ id: "real" }));
    mkdirSync(path.join(directory, "not-a-file.json"));
    expect(store.list().map((summary) => summary.id)).toEqual(["real"]);
  });
});
