// Allowlist-sanitize spec HTML (step body/detail). The spec is authored by the
// user's own Claude session, but a malicious PR could try to prompt-inject that
// session into emitting hostile markup — so keep only inline formatting tags and
// strip every attribute (no on*, href, source, style). A <template> parses the
// markup as an inert, detached fragment — nothing loads or executes, and (unlike
// DOMParser) there's no head/body hoisting, so a top-level <script> stays inline
// to be unwrapped to its text rather than silently relocated.
const SPEC_ALLOWED = new Set(["B", "I", "EM", "STRONG", "CODE", "BR", "P", "UL", "OL", "LI", "SPAN", "DIV"]);

export function sanitizeSpecHtml(html: unknown): string {
  const t = document.createElement("template");
  // eslint-disable-next-line no-unsanitized/property -- this IS the sanitizer: untrusted markup is parsed into an inert, detached <template> (never the live DOM) and allowlist-stripped below before it's returned. <template> is the correct fragment-parse primitive; DOMParser would hoist <script>/<style> into <head> and drop them.
  t.innerHTML = typeof html === "string" ? html : ""; // only real strings; never "[object Object]"
  // querySelectorAll is a static snapshot of every descendant, so unwrapping a
  // disallowed element never hides its (already-listed) children from iteration —
  // one pass covers the whole tree.
  for (const element of t.content.querySelectorAll("*")) {
    if (SPEC_ALLOWED.has(element.tagName)) {
      // getAttributeNames() is a static array; iterating the live `attributes`
      // NamedNodeMap while removing shifts indices and skips alternating entries.
      for (const name of element.getAttributeNames()) element.removeAttribute(name);
    } else {
      element.replaceWith(...element.childNodes);
    }
  }
  return t.innerHTML;
}
