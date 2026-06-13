import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { anchorFor } from "./anchor";

describe("anchorFor", () => {
  it("is diff- + sha256(path)", () => {
    const p = "src/middleware/rate-limit.ts";
    expect(anchorFor(p)).toBe("diff-" + createHash("sha256").update(p).digest("hex"));
  });

  it("pins the GitHub anchor contract for a known path", () => {
    // If this ever changes, GitHub changed its anchoring scheme (or we broke ours).
    expect(anchorFor("package.json")).toBe(
      "diff-7ae45ad102eab3b6d7e7896acd08c427a9b25b346470d7bc6507b6481575d519",
    );
  });
});
