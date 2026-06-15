import { type Review, stepBlobUrl, type WalkthroughSpec } from "@prw/runes";
import { describe, expect, it } from "vitest";
import {
  contentHash,
  createMemoryGuideStore,
  reviewToRecord,
  specToRecord,
  toEntrySummary,
} from "./guideStore";

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

const mkSpec = (over: Partial<WalkthroughSpec> = {}): WalkthroughSpec => ({
  version: 1,
  pr: {
    url: "https://github.com/acme/web/pull/7",
    owner: "acme",
    repo: "web",
    number: 7,
    title: "Add rate limit",
    headSha: "deadbeef",
  },
  generatedAt: "2026-02-01T00:00:00Z",
  steps: [{ id: "s1", title: "Limiter", body: "b", file: "src/x.ts", anchor: "diff-abc" }],
  ...over,
});

describe("contentHash", () => {
  it("is stable for equal payloads and differs for changed ones", () => {
    expect(contentHash(mkReview())).toBe(contentHash(mkReview()));
    expect(contentHash(mkReview())).not.toBe(contentHash(mkReview({ title: "Other" })));
  });
});

describe("reviewToRecord", () => {
  it("maps a review to a code record with distinct repos and the blob landing url", () => {
    expect(reviewToRecord(mkReview())).toEqual({
      kind: "code",
      id: "auth-flow-abc",
      title: "Auth flow",
      source: "chat",
      generatedAt: "2026-01-02T00:00:00Z",
      steps: 2,
      repos: ["acme/web", "acme/api"],
      url: stepBlobUrl(mkReview().steps[0], "auth-flow-abc"),
      payload: mkReview(),
    });
  });

  it("defaults a missing id to '' and omits absent source/generatedAt", () => {
    expect(reviewToRecord(mkReview({ id: undefined, source: undefined, generatedAt: undefined }))).toEqual({
      kind: "code",
      id: "",
      title: "Auth flow",
      steps: 2,
      repos: ["acme/web", "acme/api"],
      url: stepBlobUrl(mkReview().steps[0], undefined),
      payload: mkReview({ id: undefined, source: undefined, generatedAt: undefined }),
    });
  });
});

describe("specToRecord", () => {
  it("maps a spec to a pr record keyed by prKey, opening on the Files tab", () => {
    expect(specToRecord(mkSpec())).toEqual({
      kind: "pr",
      id: "acme/web#7",
      title: "Add rate limit",
      steps: 1,
      repos: ["acme/web"],
      url: "https://github.com/acme/web/pull/7/files",
      payload: mkSpec(),
      generatedAt: "2026-02-01T00:00:00Z",
    });
  });

  it("falls back to owner/repo#number when the pr title is absent", () => {
    expect(specToRecord(mkSpec({ pr: { ...mkSpec().pr, title: undefined } })).title).toBe("acme/web#7");
  });
});

describe("toEntrySummary", () => {
  it("projects a record + version/updatedAt, omitting absent optional fields", () => {
    const record = reviewToRecord(mkReview({ source: undefined, generatedAt: undefined }));
    expect(toEntrySummary(record, 3, 1000)).toEqual({
      kind: "code",
      id: "auth-flow-abc",
      title: "Auth flow",
      repos: ["acme/web", "acme/api"],
      steps: 2,
      url: stepBlobUrl(mkReview().steps[0], "auth-flow-abc"),
      version: 3,
      updatedAt: 1000,
    });
  });
});

describe("createMemoryGuideStore", () => {
  // Deterministic, monotonic clock so updatedAt ordering is exact.
  const clock = () => {
    let t = 0;
    return () => ++t;
  };

  it("inserts at version 1, gets a live payload, and a missing id is null", () => {
    const store = createMemoryGuideStore(clock());
    expect(store.get("nope")).toBeNull();
    const summary = store.put(reviewToRecord(mkReview({ id: "x" })));
    expect(summary).toEqual(toEntrySummary(reviewToRecord(mkReview({ id: "x" })), 1, summary.updatedAt));
    expect(store.get("x")).toEqual({ kind: "code", payload: mkReview({ id: "x" }) });
  });

  it("lists live rows newest-changed first", () => {
    const store = createMemoryGuideStore(clock());
    store.put(reviewToRecord(mkReview({ id: "x" })));
    store.put(reviewToRecord(mkReview({ id: "y" })));
    expect(store.list().map((entry) => entry.id)).toEqual(["y", "x"]);
  });

  it("is idempotent on unchanged content: no version bump, no re-sort", () => {
    const store = createMemoryGuideStore(clock());
    store.put(reviewToRecord(mkReview({ id: "x" })));
    store.put(reviewToRecord(mkReview({ id: "y" })));
    const again = store.put(reviewToRecord(mkReview({ id: "x" }))); // unchanged
    expect(again.version).toBe(1);
    expect(store.list().map((entry) => entry.id)).toEqual(["y", "x"]); // x not lifted to top
  });

  it("bumps version and lifts to top when content changes", () => {
    const store = createMemoryGuideStore(clock());
    store.put(reviewToRecord(mkReview({ id: "x" })));
    store.put(reviewToRecord(mkReview({ id: "y" })));
    const changed = store.put(reviewToRecord(mkReview({ id: "x", title: "Auth flow v2" })));
    expect(changed.version).toBe(2);
    expect(store.list().map((entry) => entry.id)).toEqual(["x", "y"]);
  });

  it("soft-deletes: gone from get + list, and a second delete returns false", () => {
    const store = createMemoryGuideStore(clock());
    store.put(reviewToRecord(mkReview({ id: "x" })));
    expect(store.softDelete("x")).toBe(true);
    expect(store.get("x")).toBeNull();
    expect(store.list()).toEqual([]);
    expect(store.softDelete("x")).toBe(false);
    expect(store.softDelete("missing")).toBe(false);
  });

  it("resurrects a soft-deleted row on re-push (same content keeps the version)", () => {
    const store = createMemoryGuideStore(clock());
    store.put(reviewToRecord(mkReview({ id: "x" })));
    store.softDelete("x");
    const resurrected = store.put(reviewToRecord(mkReview({ id: "x" })));
    expect(resurrected.version).toBe(1); // unchanged content -> version held
    expect(store.list().map((entry) => entry.id)).toEqual(["x"]);
  });
});
