// @vitest-environment jsdom
import type { ReviewSummary } from "@prw/runes/review";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { api } from "../api";
import { storeGet, storeSet } from "../muninn";
import { reviewsStore } from "./reviews";
import { state } from "./store";

const sum = (over: Partial<ReviewSummary> = {}): ReviewSummary => ({
  id: "a",
  title: "Auth flow",
  source: "chat",
  steps: 2,
  repos: ["acme/web"],
  url: "https://github.com/acme/web/blob/main/a.ts?prw=a",
  ...over,
});

beforeEach(() => {
  state.reviews = null;
  state.reviewsQuery = "";
  vi.mocked(storeGet).mockResolvedValue(undefined);
  vi.mocked(api).mockResolvedValue({ ok: false });
});

describe("reviewsStore filter + query", () => {
  it("returns all with no term, then filters by title, repo, and source", () => {
    state.reviews = [
      sum({ id: "a", title: "Auth flow", source: undefined }),
      sum({ id: "b", title: "Billing", source: "notes", repos: ["acme/api"] }),
    ];
    expect(reviewsStore.filtered().map((review) => review.id)).toEqual(["a", "b"]);
    reviewsStore.setQuery("auth");
    expect(reviewsStore.filtered().map((review) => review.id)).toEqual(["a"]);
    reviewsStore.setQuery("api"); // repo match
    expect(reviewsStore.filtered().map((review) => review.id)).toEqual(["b"]);
    reviewsStore.setQuery("notes"); // source match
    expect(reviewsStore.filtered().map((review) => review.id)).toEqual(["b"]);
    expect(reviewsStore.query()).toBe("notes");
  });

  it("filtered() is empty and all() is null before the first load", () => {
    expect(reviewsStore.filtered()).toEqual([]);
    expect(reviewsStore.all()).toBeNull();
  });
});

describe("reviewsStore.load", () => {
  it("paints from cache, then refreshes from the bridge and re-caches", async () => {
    vi.mocked(storeGet).mockResolvedValue([sum({ id: "cached" })]);
    vi.mocked(api).mockResolvedValue({ ok: true, data: { reviews: [sum({ id: "fresh" })] } });
    await reviewsStore.load();
    expect(reviewsStore.all()?.map((review) => review.id)).toEqual(["fresh"]);
    expect(storeSet).toHaveBeenCalledWith("prw:reviews", [sum({ id: "fresh" })]);
  });

  it("keeps the cached list when the fetch fails", async () => {
    vi.mocked(storeGet).mockResolvedValue([sum({ id: "cached" })]);
    vi.mocked(api).mockResolvedValue({ ok: false });
    await reviewsStore.load();
    expect(reviewsStore.all()?.map((review) => review.id)).toEqual(["cached"]);
  });

  it("ignores a malformed response (no reviews key, or not a summary list)", async () => {
    vi.mocked(api).mockResolvedValue({ ok: true, data: { nope: 1 } });
    await reviewsStore.load();
    expect(reviewsStore.all()).toBeNull();
    vi.mocked(api).mockResolvedValue({ ok: true, data: { reviews: "bad" } });
    await reviewsStore.load();
    expect(reviewsStore.all()).toBeNull();
  });
});

describe("reviewsStore.open", () => {
  it("navigates to the review url", () => {
    const assign = vi.fn();
    Object.defineProperty(globalThis, "location", { value: { assign }, writable: true });
    reviewsStore.open("https://x/?prw=a");
    expect(assign).toHaveBeenCalledWith("https://x/?prw=a");
  });
});
