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

  it("retires a prior-shape spec: any version but the current literal fails validation", () => {
    // Bumping WalkthroughSpecSchema.version is the retire lever for a breaking shape
    // change — old specs stop validating and are dropped on read, so no back-compat
    // reader is ever needed. This locks that behavior.
    expect(isWalkthroughSpec({ ...valid, version: 0 })).toBe(false);
    expect(isWalkthroughSpec({ ...valid, version: 2 })).toBe(false);
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

  it("rejects a step missing each core field specifically (id, file)", () => {
    // Isolate each required core field — a bulk-missing fixture can't tell
    // WHICH absent field failed, so weakening one in step.ts would go unnoticed.
    expect(isWalkthroughSpec({ ...valid, steps: [{ ...valid.steps[0], id: undefined }] })).toBe(false);
    expect(isWalkthroughSpec({ ...valid, steps: [{ ...valid.steps[0], file: undefined }] })).toBe(false);
  });

  it("rejects a file that would path-traverse (guarded in the shared core)", () => {
    expect(isWalkthroughSpec({ ...valid, steps: [{ ...valid.steps[0], file: "a/../../evil" }] })).toBe(false);
    expect(isWalkthroughSpec({ ...valid, steps: [{ ...valid.steps[0], file: "pages/[id].ts" }] })).toBe(true);
  });

  it("rejects step lines missing a side", () => {
    expect(isWalkthroughSpec({ ...valid, steps: [{ ...valid.steps[0], lines: { start: 1, end: 2 } }] })).toBe(
      false,
    );
  });

  it("accepts an optional step group, and a spec without one (back-compat)", () => {
    expect(isWalkthroughSpec({ ...valid, steps: [{ ...valid.steps[0], group: "Foundation" }] })).toBe(true);
    expect(isWalkthroughSpec(valid)).toBe(true); // no group on any step still validates
    expect(isWalkthroughSpec({ ...valid, steps: [{ ...valid.steps[0], group: 5 }] })).toBe(false);
  });

  it("rejects step lines with start > end, accepts start <= end", () => {
    const withLines = (start: number, end: number) => ({
      ...valid,
      steps: [{ ...valid.steps[0], lines: { side: "R", start, end } }],
    });
    expect(isWalkthroughSpec(withLines(5, 3))).toBe(false);
    expect(isWalkthroughSpec(withLines(3, 3))).toBe(true);
  });
});
