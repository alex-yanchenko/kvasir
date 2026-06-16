// Minimal, safe markdown → HTML for assistant messages. Escapes first (no raw
// HTML from the model), then renders fenced code blocks, inline code, bold, and
// paragraph/line breaks. Deliberately tiny — no external lib.

export const escapeHtml = (s: string): string =>
  (s || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function renderMarkdown(source: string): string {
  let s = escapeHtml(source);
  const blocks: string[] = [];
  // Code blocks are parked behind placeholders delimited by U+E000 (a private-use
  // codepoint that never occurs in real text) so the inline/bold/paragraph passes
  // can't rewrite their contents, then spliced back at the end. The opening fence
  // must end in a newline (CommonMark) — a mandatory boundary that also stops the
  // info-string quantifiers from backtracking against the body (ReDoS-safe).
  s = s.replaceAll(/```([^\n]*)\n([\s\S]*?)```/g, (_m: string, info: string, code: string) => {
    const index = blocks.length;
    const lang = /[\w.+#-]+/.exec(info)?.[0] ?? "";
    const label = lang ? `<span class="kvasir-code-lang">${lang}</span>` : "";
    blocks.push(`<pre class="kvasir-code">${label}<code>${code.replace(/\n+$/, "")}</code></pre>`);
    return `\uE000B${index}\uE000`;
  });
  s = s.replaceAll(/`([^`\n]+)`/g, '<code class="kvasir-inline">$1</code>');
  s = s.replaceAll(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // Links: real http(s) links become anchors; any other link target (e.g. a
  // repo-relative path or GitHub #L url the model wrapped a code ref in) collapses
  // to just its label, so the chat's citation linkifier can turn a bare path:line
  // into a jump-to-code link instead of leaving "(source/…#L64)" visible.
  s = s.replaceAll(
    /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  s = s.replaceAll(/\[([^\]\n]+)\]\([^)\n]+\)/g, "$1");
  s = s
    .split(/\n{2,}/)
    .map((p) => (p.trim() ? `<p>${p.replaceAll("\n", "<br>")}</p>` : ""))
    .join("");
  return s
    .replaceAll(/<p>\uE000B(\d+)\uE000<\/p>/g, (_m: string, index: string) => blocks[+index] ?? "")
    .replaceAll(/\uE000B(\d+)\uE000/g, (_m: string, index: string) => blocks[+index] ?? "");
}
