// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { chatsKey, genKey, onFilesTab, prUrl, specKey, tourKey } from "./keys";

describe("storage keys", () => {
  it("embed the PR url per concern", () => {
    const pr = "https://github.com/acme/widget-api/pull/7";
    expect(chatsKey(pr)).toBe(`prw:chats:${pr}`);
    expect(specKey(pr)).toBe(`prw:spec:${pr}`);
    expect(tourKey(pr)).toBe(`prw:tour:${pr}`);
    expect(genKey(pr)).toBe(`prw:gen:${pr}`);
  });
});

describe("location readers", () => {
  it("prUrl extracts the canonical PR url from any PR sub-page", () => {
    history.replaceState(null, "", "/acme/widget-api/pull/7/files#diff-x");
    Object.defineProperty(window, "location", {
      value: new URL("https://github.com/acme/widget-api/pull/7/files#diff-x"),
      writable: true,
    });
    expect(prUrl()).toBe("https://github.com/acme/widget-api/pull/7");
    expect(onFilesTab()).toBe(true);
  });

  it("returns null / false away from a PR diff", () => {
    Object.defineProperty(window, "location", {
      value: new URL("https://github.com/acme/widget-api/issues"),
      writable: true,
    });
    expect(prUrl()).toBeNull();
    expect(onFilesTab()).toBe(false);
  });
});
