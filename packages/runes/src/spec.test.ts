import { describe, it, expect } from "vitest";
import { isWalkthroughSpec } from "./spec";

const valid = {
  version: 1 as const,
  pr: { url: "https://github.com/a/b/pull/1", owner: "a", repo: "b", number: 1 },
  generatedAt: "2025-01-01T00:00:00.000Z",
  steps: [{ id: "s1", title: "t", body: "b", file: "f.ts", anchor: "diff-x" }],
};

describe("isWalkthroughSpec", () => {
  it("accepts a well-formed spec", () => {
    expect(isWalkthroughSpec(valid)).toBe(true);
  });

  it("rejects wrong version, missing pr, malformed steps, and non-objects", () => {
    expect(isWalkthroughSpec({ ...valid, version: 2 })).toBe(false);
    expect(isWalkthroughSpec({ ...valid, pr: undefined })).toBe(false);
    expect(isWalkthroughSpec({ ...valid, steps: [{ id: "x" }] })).toBe(false);
    expect(isWalkthroughSpec({ ...valid, steps: "nope" })).toBe(false);
    expect(isWalkthroughSpec({ ...valid, steps: [] })).toBe(false);
    expect(isWalkthroughSpec(null)).toBe(false);
    expect(isWalkthroughSpec("nope")).toBe(false);
  });
});
