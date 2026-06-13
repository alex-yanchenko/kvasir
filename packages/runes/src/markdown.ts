// Minimal, safe markdown → HTML for assistant messages. Escapes first (no raw
// HTML from the model), then renders fenced code blocks, inline code, bold, and
// paragraph/line breaks. Deliberately tiny — no external lib.

export const escapeHtml = (s: string): string =>
  (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderMarkdown(src: string): string {
  let s = escapeHtml(src);
  const blocks: string[] = [];
  // Code blocks are parked behind NUL-delimited placeholders so the inline/bold/
  // paragraph passes can't rewrite their contents, then spliced back at the end.
  s = s.replace(/```[ \t]*([\w.+#-]*)\n?([\s\S]*?)```/g, (_m: string, lang: string, code: string) => {
    const i = blocks.length;
    const label = lang ? `<span class="prw-code-lang">${lang}</span>` : "";
    blocks.push(`<pre class="prw-code">${label}<code>${code.replace(/\n+$/, "")}</code></pre>`);
    return `\u0000B${i}\u0000`;
  });
  s = s.replace(/`([^`\n]+)`/g, '<code class="prw-inline">$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // Links: real http(s) links become anchors; any other link target (e.g. a
  // repo-relative path or GitHub #L url the model wrapped a code ref in) collapses
  // to just its label, so the chat's citation linkifier can turn a bare path:line
  // into a jump-to-code link instead of leaving "(src/…#L64)" visible.
  s = s.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  s = s.replace(/\[([^\]\n]+)\]\([^)\n]+\)/g, "$1");
  s = s
    .split(/\n{2,}/)
    .map((p) => (p.trim() ? `<p>${p.replace(/\n/g, "<br>")}</p>` : ""))
    .join("");
  return s
    .replace(/<p>\u0000B(\d+)\u0000<\/p>/g, (_m: string, i: string) => blocks[+i])
    .replace(/\u0000B(\d+)\u0000/g, (_m: string, i: string) => blocks[+i]);
}
