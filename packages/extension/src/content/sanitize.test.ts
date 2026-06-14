// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sanitizeSpecHtml } from "./sanitize";

describe("sanitizeSpecHtml", () => {
  it("keeps allowlisted inline formatting tags", () => {
    expect(sanitizeSpecHtml("<strong>a</strong> <code>b</code> <em>c</em>")).toBe(
      "<strong>a</strong> <code>b</code> <em>c</em>",
    );
  });

  it("unwraps a disallowed tag but keeps its text (anchors are not allowed)", () => {
    expect(sanitizeSpecHtml(`<a href="https://evil.test">link</a>`)).toBe("link");
  });

  it("strips every attribute from allowlisted tags, including event handlers", () => {
    expect(sanitizeSpecHtml(`<p class="x" onclick="evil()">hi</p>`)).toBe("<p>hi</p>");
  });

  it("strips ALL attributes off a 4+-attribute tag (no live-NamedNodeMap skip)", () => {
    expect(sanitizeSpecHtml(`<p class="a" onclick="b" style="c" data-x="d">hi</p>`)).toBe("<p>hi</p>");
  });

  it("unwraps a script tag, leaving inert text", () => {
    expect(sanitizeSpecHtml("<script>alert(1)</script>")).toBe("alert(1)");
  });

  it("removes nested disallowed wrappers", () => {
    expect(sanitizeSpecHtml(`<div><a href="x"><b>t</b></a></div>`)).toBe("<div><b>t</b></div>");
  });

  it("coerces nullish input to an empty string", () => {
    expect(sanitizeSpecHtml(null)).toBe("");
    expect(sanitizeSpecHtml(undefined)).toBe("");
  });
});
