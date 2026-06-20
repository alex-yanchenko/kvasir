import { describe, it, expect } from "vitest";
import { escapeHtml, renderMarkdown } from "./markdown";

describe("escapeHtml", () => {
  it("escapes &, <, > and leaves other text intact", () => {
    expect(escapeHtml(`a & b <c> "d"`)).toBe(`a &amp; b &lt;c&gt; "d"`);
  });

  it("returns an empty string for empty input", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("renderMarkdown", () => {
  it("escapes raw HTML before rendering (no model-supplied markup survives)", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("renders bold and inline code inside a paragraph", () => {
    expect(renderMarkdown("**bold** and `code`")).toBe(
      `<p><strong>bold</strong> and <code class="kvasir-inline">code</code></p>`,
    );
  });

  it("splits blank-line-separated blocks into paragraphs and single newlines into <br>", () => {
    expect(renderMarkdown("one\ntwo\n\nthree")).toBe("<p>one<br>two</p><p>three</p>");
  });

  it("renders a fenced code block with a language label", () => {
    expect(renderMarkdown("```ts\nconst x = 1;\n```")).toBe(
      `<pre class="kvasir-code"><span class="kvasir-code-lang">ts</span><code>const x = 1;</code></pre>`,
    );
  });

  it("renders a fenced code block without a language label", () => {
    expect(renderMarkdown("```\nhi\n```")).toBe(`<pre class="kvasir-code"><code>hi</code></pre>`);
  });

  it("renders an http(s) link as an anchor opening in a new tab", () => {
    expect(renderMarkdown("see [the docs](https://x.com/a)")).toBe(
      '<p>see <a href="https://x.com/a" target="_blank" rel="noopener noreferrer">the docs</a></p>',
    );
  });

  it("collapses a non-http link to its label so a bare path:line can be linkified later", () => {
    expect(renderMarkdown("[apply.ts:64](src/apply.ts#L64)")).toBe("<p>apply.ts:64</p>");
  });

  it("does not apply inline/bold rendering inside a code block", () => {
    expect(renderMarkdown("```\n**x** and `y`\n```")).toBe(
      `<pre class="kvasir-code"><code>**x** and \`y\`</code></pre>`,
    );
  });

  it("attribute-escapes a double-quote in a link URL so it cannot break out of the href", () => {
    const out = renderMarkdown('[x](https://a.com/"onmouseover="alert(1))');
    // The quote is encoded inside the attribute value — no second, injected attribute.
    expect(out).not.toContain('"onmouseover');
    expect(out).toBe(
      '<p><a href="https://a.com/&quot;onmouseover=&quot;alert(1" target="_blank" rel="noopener noreferrer">x</a>)</p>',
    );
  });

  it("collapses a javascript: link to its label (only http/https become anchors)", () => {
    expect(renderMarkdown("[click](javascript:void)")).toBe("<p>click</p>");
  });

  it("collapses an http(s) match that is not a parseable URL to its label", () => {
    expect(renderMarkdown("[x](https://[)")).toBe("<p>x</p>");
  });

  it("strips a forged sentinel so model text cannot reference a real code block", () => {
    const sentinel = String.fromCodePoint(0xe000);
    const out = renderMarkdown("```\nSECRET\n```\n\n" + sentinel + "B0" + sentinel);
    expect(out.match(/SECRET/g) ?? []).toHaveLength(1);
  });
});
