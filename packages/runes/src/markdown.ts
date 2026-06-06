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
  s = s
    .split(/\n{2,}/)
    .map((p) => (p.trim() ? `<p>${p.replace(/\n/g, "<br>")}</p>` : ""))
    .join("");
  return s
    .replace(/<p>\u0000B(\d+)\u0000<\/p>/g, (_m: string, i: string) => blocks[+i])
    .replace(/\u0000B(\d+)\u0000/g, (_m: string, i: string) => blocks[+i]);
}
