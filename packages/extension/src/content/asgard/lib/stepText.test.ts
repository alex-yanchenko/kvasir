import { describe, it, expect } from "vitest";
import { clampIndex, guideBackgroundText, stepContextText, whereText } from "./stepText";

describe("clampIndex", () => {
  it("clamps into [0, length-1]", () => {
    expect(clampIndex(-2, 3)).toBe(0);
    expect(clampIndex(1, 3)).toBe(1);
    expect(clampIndex(9, 3)).toBe(2);
  });
});

describe("whereText", () => {
  it("cites path with and without lines, and nothing without a path", () => {
    expect(whereText("src/a.ts", { start: 4, end: 6 })).toBe(" (src/a.ts:4-6)");
    expect(whereText("src/a.ts", null)).toBe(" (src/a.ts)");
    expect(whereText("", { start: 1, end: 2 })).toBe("");
  });
});

describe("stepContextText", () => {
  it("strips markup and appends the detail only when present", () => {
    expect(stepContextText({ title: "T", where: " (a.ts)", body: "<b>x</b>", detail: "<i>d</i>" })).toBe(
      "Step: T (a.ts)\nx\nd",
    );
    expect(stepContextText({ title: "T", where: "", body: "x" })).toBe("Step: T\nx");
  });
});

describe("guideBackgroundText", () => {
  it("builds head + bulleted steps and caps the total", () => {
    expect(
      guideBackgroundText("Head\n\n", [
        { title: "A", where: " (a.ts)", body: "<p>one</p>" },
        { title: "B", where: "", body: "two" },
      ]),
    ).toBe("Head\n\n• A (a.ts)\n  one\n• B\n  two");
    const long = guideBackgroundText("", [{ title: "T", where: "", body: "x".repeat(20_000) }]);
    expect(long.length).toBe(12_000);
  });
});
