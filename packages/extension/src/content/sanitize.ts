// Allowlist-sanitize spec HTML (step body/detail). The spec is authored by the
// user's own Claude session, but a malicious PR could try to prompt-inject that
// session into emitting hostile markup — so keep only inline formatting tags and
// strip every attribute (no on*, href, src, style). Parsing happens in an inert
// <template>, so nothing loads or executes while sanitizing.
const SPEC_ALLOWED = new Set(["B", "I", "EM", "STRONG", "CODE", "BR", "P", "UL", "OL", "LI", "SPAN", "DIV"]);

export function sanitizeSpecHtml(html: unknown): string {
  const t = document.createElement("template");
  t.innerHTML = typeof html === "string" ? html : ""; // only real strings; never "[object Object]"
  for (let pass = 0; pass < 2; pass++) {
    t.content.querySelectorAll("*").forEach((el) => {
      if (!SPEC_ALLOWED.has(el.tagName)) el.replaceWith(...el.childNodes);
      else [...el.attributes].forEach((a) => el.removeAttribute(a.name));
    });
  }
  return t.innerHTML;
}
