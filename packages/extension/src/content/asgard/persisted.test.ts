import type { Review } from "@prw/runes/review";
import { describe, it, expect } from "vitest";
import { parseReviewCache } from "./persisted";

const review: Review = {
  version: 1,
  id: "rev-1",
  title: "Auth flow",
  steps: [{ id: "a", title: "Guard", body: "b", repo: { owner: "acme", name: "web" }, file: "src/a.ts" }],
};

describe("parseReviewCache", () => {
  it("returns the step + review from a valid cache object", () => {
    expect(parseReviewCache({ step: 2, review })).toEqual({ step: 2, review });
  });

  it("defaults the step to 0 when it's missing or not a number", () => {
    expect(parseReviewCache({ review })).toEqual({ step: 0, review });
    expect(parseReviewCache({ step: "x", review })).toEqual({ step: 0, review });
  });

  it("drops an invalid review and yields step 0 for non-objects", () => {
    expect(parseReviewCache({ step: 3, review: { not: "a review" } })).toEqual({ step: 3, review: null });
    expect(parseReviewCache(null)).toEqual({ step: 0, review: null });
    expect(parseReviewCache(42)).toEqual({ step: 0, review: null });
  });
});
