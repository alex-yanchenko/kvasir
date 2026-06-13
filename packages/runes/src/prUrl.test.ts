import { describe, it, expect } from "vitest";
import { parsePrUrl, prKey, PR_URL_RE } from "./prUrl";

describe("parsePrUrl", () => {
  it("parses a valid PR url", () => {
    expect(parsePrUrl("https://github.com/acme/widget-api/pull/42")).toEqual({
      owner: "acme",
      repo: "widget-api",
      number: 42,
    });
  });

  it("ignores trailing path / query / hash", () => {
    expect(parsePrUrl("https://github.com/a/b/pull/7/files?diff=split#top").number).toBe(7);
  });

  it("rejects non-PR and non-GitHub urls", () => {
    for (const u of [
      "http://github.com/a/b/pull/1", // not https
      "https://evil.com/a/b/pull/1", // wrong host
      "https://github.com/a/b/issues/1", // not a PR
      "https://github.com/a/pull/1", // missing repo
      "not a url",
    ]) {
      expect(() => parsePrUrl(u)).toThrow();
    }
  });

  it("rejects path traversal in owner/repo", () => {
    expect(() => parsePrUrl("https://github.com/../b/pull/1")).toThrow();
    expect(() => parsePrUrl("https://github.com/a/../pull/1")).toThrow();
  });
});

describe("prKey", () => {
  it("builds <owner>/<repo>#<number>", () => {
    expect(prKey("https://github.com/acme/widget-api/pull/42")).toBe("acme/widget-api#42");
  });
});

describe("PR_URL_RE", () => {
  it("matches valid PR urls and rejects foreign origins", () => {
    expect(PR_URL_RE.test("https://github.com/a/b/pull/1")).toBe(true);
    expect(PR_URL_RE.test("https://evil.com/a/b/pull/1")).toBe(false);
    expect(PR_URL_RE.test("http://github.com/a/b/pull/1")).toBe(false);
  });
});
