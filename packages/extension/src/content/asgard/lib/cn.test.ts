import { describe, it, expect } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins truthy classes, drops falsy ones, and merges conflicting utilities last-wins", () => {
    expect(cn("a", false && "b", undefined, "c")).toBe("a c");
    expect(cn("px-2", "px-4")).toBe("px-4"); // tailwind-merge dedupes the conflict
    expect(cn(["gap-2", { hidden: false, "rounded-md": true }])).toBe("gap-2 rounded-md");
  });
});
