import type { Review } from "@prw/runes";
import { describe, it, expect } from "vitest";
import { parseReviewInput, reviewLandingUrl } from "./review";

const review = (over: Partial<Review> = {}): Review => ({
  version: 1,
  title: "Auth flow",
  steps: [
    {
      id: "s1",
      title: "Guard",
      body: "b",
      repo: { owner: "acme", name: "web" },
      ref: "main",
      file: "src/auth/guard.ts",
      lines: { start: 10, end: 20 },
    },
  ],
  ...over,
});

describe("parseReviewInput", () => {
  it("accepts a review object", () => {
    expect(parseReviewInput(review())).toEqual({ ok: true, review: review() });
  });

  it("accepts a JSON-stringified review", () => {
    expect(parseReviewInput(JSON.stringify(review()))).toEqual({ ok: true, review: review() });
  });

  it("rejects a string that is not valid JSON", () => {
    expect(parseReviewInput("not json {")).toEqual({
      ok: false,
      error: "review arrived as a string but was not valid JSON",
    });
  });

  it("reports the exact failing fields for an invalid review", () => {
    const result = parseReviewInput({ version: 1, title: "x", steps: [{ id: "s1" }] });
    expect(result.ok).toBe(false);
    const error = result.ok ? "" : result.error;
    expect(error).toContain("steps.0.body: ");
    expect(error).toContain("steps.0.repo: ");
    expect(error).toContain("steps.0.file: ");
  });

  it("labels a root-level type failure (root) for a non-object", () => {
    const result = parseReviewInput("42");
    const error = result.ok ? null : result.error;
    expect(error).toMatch(/^\(root\): .*expected object/);
  });
});

describe("reviewLandingUrl", () => {
  it("builds a blob URL with the line range and the ?prw id", () => {
    expect(reviewLandingUrl(review({ id: "rid" }))).toBe(
      "https://github.com/acme/web/blob/main/src/auth/guard.ts?prw=rid#L10-L20",
    );
  });

  it("omits the line hash when the step has no line range", () => {
    const r = review({ id: "rid", steps: [{ ...review().steps[0]!, lines: undefined }] });
    expect(reviewLandingUrl(r)).toBe("https://github.com/acme/web/blob/main/src/auth/guard.ts?prw=rid");
  });

  it("falls back to the repo root when the step has no ref, and tolerates a missing id", () => {
    const r = review({ steps: [{ ...review().steps[0]!, ref: undefined }] }); // no id, no ref
    expect(reviewLandingUrl(r)).toBe("https://github.com/acme/web?prw=");
  });
});
