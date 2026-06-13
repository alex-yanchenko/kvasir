// Allowlist-sanitize spec HTML (step body/detail). The spec is authored by the
// user's own Claude session, but a malicious PR could try to prompt-inject that
// session into emitting hostile markup — so keep only inline formatting tags and
// strip every attribute (no on*, href, src, style). Parsing happens in an inert
// <template>, so nothing loads or executes while sanitizing.
const SPEC_ALLOWED = new Set(["B", "I", "EM", "STRONG", "CODE", "BR", "P", "UL", "OL", "LI", "SPAN", "DIV"]);

export function sanitizeSpecHtml(html: unknown): string {
  const t = document.createElement("template");
  // eslint-disable-next-line no-unsanitized/property -- this IS the sanitizer: untrusted HTML is parsed into an inert, detached <template> (never the live DOM) and allowlist-stripped below before it's returned.
  t.innerHTML = typeof html === "string" ? html : ""; // only real strings; never "[object Object]"
  for (let pass = 0; pass < 2; pass++) {
    for (const el of t.content.querySelectorAll("*")) {
      if (SPEC_ALLOWED.has(el.tagName)) {
        for (const a of el.attributes) el.removeAttribute(a.name);
      } else {
        el.replaceWith(...el.childNodes);
      }
    }
  }
  return t.innerHTML;
}
