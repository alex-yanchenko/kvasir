import { describe, it, expect } from "vitest";
import { anchorFor } from "./anchor";

describe("anchorFor", () => {
  it("is diff- + sha256(path), pinned to a hardcoded digest", () => {
    expect(anchorFor("src/middleware/rate-limit.ts")).toBe(
      "diff-5e3f2e0576cb440b38958998c9d5ee80b1c1eb2070f2a95534f878afa762457c",
    );
  });

  it("pins the GitHub anchor contract for a known path", () => {
    // If this ever changes, GitHub changed its anchoring scheme (or we broke ours).
    expect(anchorFor("package.json")).toBe(
      "diff-7ae45ad102eab3b6d7e7896acd08c427a9b25b346470d7bc6507b6481575d519",
    );
  });
});
