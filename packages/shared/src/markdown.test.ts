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
      `<p><strong>bold</strong> and <code class="prw-inline">code</code></p>`,
    );
  });

  it("splits blank-line-separated blocks into paragraphs and single newlines into <br>", () => {
    expect(renderMarkdown("one\ntwo\n\nthree")).toBe("<p>one<br>two</p><p>three</p>");
  });

  it("renders a fenced code block with a language label", () => {
    expect(renderMarkdown("```ts\nconst x = 1;\n```")).toBe(
      `<pre class="prw-code"><span class="prw-code-lang">ts</span><code>const x = 1;</code></pre>`,
    );
  });

  it("renders a fenced code block without a language label", () => {
    expect(renderMarkdown("```\nhi\n```")).toBe(`<pre class="prw-code"><code>hi</code></pre>`);
  });

  it("does not apply inline/bold rendering inside a code block", () => {
    expect(renderMarkdown("```\n**x** and `y`\n```")).toBe(
      `<pre class="prw-code"><code>**x** and \`y\`</code></pre>`,
    );
  });
});
