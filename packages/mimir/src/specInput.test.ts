import { describe, it, expect } from "vitest";
import { parseSpecInput } from "./specInput";

const validSpec = {
  version: 1,
  pr: { url: "https://github.com/acme/widget/pull/1", owner: "acme", repo: "widget", number: 1 },
  generatedAt: "2026-01-01T00:00:00.000Z",
  steps: [{ id: "s1", title: "t", body: "<p>b</p>", file: "src/a.ts", anchor: "diff-a" }],
};

describe("parseSpecInput", () => {
  it("accepts a spec object", () => {
    const result = parseSpecInput(validSpec);
    expect(result).toEqual({ ok: true, spec: { ...validSpec } });
  });

  it("accepts a JSON-stringified spec (the untyped-param-over-the-wire case)", () => {
    const result = parseSpecInput(JSON.stringify(validSpec));
    expect(result).toEqual({ ok: true, spec: { ...validSpec } });
  });

  it("labels a root-level type failure (root) when the value is not an object", () => {
    const result = parseSpecInput("42"); // valid JSON, but a number, not the spec object
    const error = result.ok ? null : result.error;
    expect(error).toMatch(/^\(root\): .*expected object/);
  });

  it("rejects a string that is not valid JSON", () => {
    expect(parseSpecInput("not json {")).toEqual({
      ok: false,
      error: "spec arrived as a string but was not valid JSON",
    });
  });

  it("reports the exact failing fields for an invalid spec", () => {
    const result = parseSpecInput({
      version: 1,
      pr: { url: "u" },
      steps: [{ id: "s1", file: "f", anchor: "a" }],
    });
    expect(result).toEqual({
      ok: false,
      error:
        "pr.owner: Invalid input: expected string, received undefined; " +
        "pr.repo: Invalid input: expected string, received undefined; " +
        "pr.number: Invalid input: expected number, received undefined; " +
        "generatedAt: Invalid input: expected string, received undefined; " +
        "steps.0.title: Invalid input: expected string, received undefined; " +
        "steps.0.body: Invalid input: expected string, received undefined",
    });
  });
});
