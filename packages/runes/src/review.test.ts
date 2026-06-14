import { describe, it, expect } from "vitest";
import { isReview } from "./review";

const valid = {
  version: 1,
  title: "Auth flow",
  steps: [{ id: "s1", title: "Guard", body: "b", repo: { owner: "acme", name: "web" }, file: "src/a.ts" }],
};

describe("isReview", () => {
  it("accepts a minimal valid review (one step, optional fields absent)", () => {
    expect(isReview(valid)).toBe(true);
  });

  it("rejects a review with no steps, a wrong version, or a malformed step", () => {
    expect(isReview({ ...valid, steps: [] })).toBe(false);
    expect(isReview({ ...valid, version: 2 })).toBe(false);
    expect(isReview({ ...valid, steps: [{ id: "s1" }] })).toBe(false);
    expect(isReview("nope")).toBe(false);
  });
});
