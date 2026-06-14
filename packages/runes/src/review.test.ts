import { describe, it, expect } from "vitest";
import { isReview, stepBlobUrl, type ReviewStep } from "./review";

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

describe("stepBlobUrl", () => {
  const step = (over: Partial<ReviewStep> = {}): ReviewStep => ({
    id: "s1",
    title: "t",
    body: "b",
    repo: { owner: "acme", name: "web" },
    ref: "main",
    file: "src/a.ts",
    lines: { start: 10, end: 20 },
    ...over,
  });

  it("builds a blob URL with the line range and ?prw id", () => {
    expect(stepBlobUrl(step(), "rid")).toBe("https://github.com/acme/web/blob/main/src/a.ts?prw=rid#L10-L20");
  });

  it("omits the line hash without a line range", () => {
    expect(stepBlobUrl(step({ lines: undefined }), "rid")).toBe(
      "https://github.com/acme/web/blob/main/src/a.ts?prw=rid",
    );
  });

  it("falls back to the repo root without a ref, and tolerates a missing id", () => {
    expect(stepBlobUrl(step({ ref: undefined }))).toBe("https://github.com/acme/web?prw=");
  });

  it("percent-encodes special chars per path segment (Next.js catch-all routes)", () => {
    expect(stepBlobUrl(step({ file: "pages/api/auth/[...auth0].ts" }), "rid")).toBe(
      "https://github.com/acme/web/blob/main/pages/api/auth/%5B...auth0%5D.ts?prw=rid#L10-L20",
    );
  });
});
