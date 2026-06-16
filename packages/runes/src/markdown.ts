// Minimal, safe markdown → HTML for assistant messages. Escapes first (no raw
// HTML from the model), then renders fenced code blocks, inline code, bold, and
// paragraph/line breaks. Deliberately tiny — no external lib.

export const escapeHtml = (s: string): string =>
  (s || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** escapeHtml leaves quotes alone (fine for text nodes); when a value lands in a
 * double-quoted attribute an unescaped quote ends the attribute and lets the next
 * token become a new attribute (e.g. an event handler). Encode both quote chars. */
const escapeAttribute = (s: string): string => s.replaceAll('"', "&quot;").replaceAll("'", "&#39;");

/** A link target is emitted as an href only if it parses as an http(s) URL; anything
 * else (javascript:/data:/relative/garbage) returns null and collapses to its label. */
const httpHref = (url: string): string | null => {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

// Private-use codepoint U+E000 used to fence parked code blocks. Built from its
// char code so the source stays pure ASCII; it is stripped from input (see below)
// so model/PR text can never forge a placeholder.
const SENTINEL = String.fromCodePoint(Number.parseInt("e000", 16));
const PLACEHOLDER = new RegExp(String.raw`${SENTINEL}B(\d+)${SENTINEL}`, "g");
const WRAPPED_PLACEHOLDER = new RegExp(String.raw`<p>${SENTINEL}B(\d+)${SENTINEL}</p>`, "g");

export function renderMarkdown(source: string): string {
  // Strip the sentinel from input first: the code-block splice below parks blocks
  // behind sentinel-delimited placeholders and trusts them, so model/PR text must
  // not be able to forge one and duplicate/relocate a block.
  let s = escapeHtml(source.replaceAll(SENTINEL, ""));
  const blocks: string[] = [];
  // Code blocks are parked behind placeholders so the inline/bold/paragraph passes
  // can't rewrite their contents, then spliced back at the end. The opening fence
  // must end in a newline (CommonMark) — a mandatory boundary that also stops the
  // info-string quantifiers from backtracking against the body (ReDoS-safe).
  s = s.replaceAll(/```([^\n]*)\n([\s\S]*?)```/g, (_m: string, info: string, code: string) => {
    const index = blocks.length;
    const lang = /[\w.+#-]+/.exec(info)?.[0] ?? "";
    const label = lang ? `<span class="kvasir-code-lang">${lang}</span>` : "";
    blocks.push(`<pre class="kvasir-code">${label}<code>${code.replace(/\n+$/, "")}</code></pre>`);
    return `${SENTINEL}B${index}${SENTINEL}`;
  });
  s = s.replaceAll(/`([^`\n]+)`/g, '<code class="kvasir-inline">$1</code>');
  s = s.replaceAll(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // Links: real http(s) links become anchors; any other target (a repo-relative
  // path or GitHub #L url the model wrapped a code ref in) collapses to its label,
  // so the chat's citation linkifier can turn a bare path:line into a jump-to-code
  // link instead of leaving "(source/…#L64)" visible. The URL is protocol-checked
  // and attribute-escaped so a quote in it can't break out of the href.
  s = s.replaceAll(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m: string, label: string, url: string) => {
    const href = httpHref(url);
    return href === null
      ? label
      : `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  s = s.replaceAll(/\[([^\]\n]+)\]\([^)\n]+\)/g, "$1");
  s = s
    .split(/\n{2,}/)
    .map((p) => (p.trim() ? `<p>${p.replaceAll("\n", "<br>")}</p>` : ""))
    .join("");
  return s
    .replaceAll(WRAPPED_PLACEHOLDER, (_m: string, index: string) => blocks[+index] ?? "")
    .replaceAll(PLACEHOLDER, (_m: string, index: string) => blocks[+index] ?? "");
}
