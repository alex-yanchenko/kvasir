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

  it("maps a non-JSON (HTML error page) bridge response to actionable restart copy", () => {
    // the raw V8 JSON.parse text an older channel surfaced on an HTML body
    expect(
      friendlyError({ error: `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON` }),
    ).toMatch(/Restart kvasir/);
    // the worker's cleaned signal, and the data-carried form
    expect(friendlyError({ error: "non-JSON response from the channel" })).toMatch(/Restart kvasir/);
    expect(friendlyError({ data: { error: "non-JSON response from the channel" } })).toMatch(
      /unexpected response/,
    );
  });

  it("a caller-supplied fallback replaces the default no-answer copy only when nothing matched", () => {
    expect(friendlyError({}, "pairing request failed")).toBe("pairing request failed");
    expect(friendlyError({ error: "failed to fetch" }, "pairing request failed")).toMatch(
      /Claude session running/,
    );
  });
});
