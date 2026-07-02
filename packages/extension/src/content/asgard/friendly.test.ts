import { describe, it, expect } from "vitest";
import { friendlyError } from "./friendly";

describe("friendlyError", () => {
  it("maps known failures to friendly copy", () => {
    expect(friendlyError({ data: { error: "request timed out" } })).toMatch(/session may be busy/);
    expect(friendlyError({ data: { error: "not paired" } })).toMatch(/open Settings/);
    expect(friendlyError({ error: "extension reloaded — refresh the page" })).toMatch(/refresh the page/);
    expect(friendlyError({ error: "failed to fetch" })).toMatch(/Claude session running/);
    expect(friendlyError({ error: "boom" })).toBe("Something went wrong: boom");
    expect(friendlyError({})).toBe("No answer came back.");
  });

  it("a caller-supplied fallback replaces the default no-answer copy only when nothing matched", () => {
    expect(friendlyError({}, "pairing request failed")).toBe("pairing request failed");
    expect(friendlyError({ error: "failed to fetch" }, "pairing request failed")).toMatch(
      /Claude session running/,
    );
  });
});
