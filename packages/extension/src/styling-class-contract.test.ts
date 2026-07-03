import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// Guard: every `kvasir-*` class the extension APPLIES to an element must be
// defined as a selector in one of the hand-authored stylesheets. A class string
// that no stylesheet backs renders unstyled with no other signal — this is
// exactly how the chat thread shipped unstyled for the project's whole React life
// (`kvasir-message*` in TSX vs `kvasir-msg*` in CSS). jsdom coverage can't catch
// it because it asserts structure, not paint; this string contract can.
//
// Scope is deliberately class-*application* sites only (`className=`,
// `.className =`, `classList.*()`), not id selectors (`#kvasir-root`),
// `data-kvasir-*` attributes, storage keys, or querySelector strings — so an
// unrelated change can't trip it with a false positive.

const srcDir = dirname(fileURLToPath(import.meta.url));

// Classes intentionally applied without a stylesheet rule — each element is
// styled by other means (co-located Tailwind utilities, injected SVG) and the
// class exists only as a stable query/test hook, so "no selector" is correct.
const MARKER_CLASSES = new Set<string>([
  // wraps mermaid's self-styled SVG; layout comes from the injected <svg>, not us
  "kvasir-diagram",
  // panel root: visual is the adjacent Tailwind utilities; class is a query hook
  "kvasir-panel",
]);

const CSS_SOURCES = [join(srcDir, "content/asgard/asgard.css"), join(srcDir, "midgard.css")];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

// A kvasir-* identifier is "defined" if a stylesheet either has a class selector
// for it or declares it as a @keyframes animation — Tailwind arbitrary values
// reference keyframes by name inside a className (`[animation:kvasir-tab-in_…]`),
// so both forms are legitimate targets a className token can resolve to.
function definedNames(): Set<string> {
  const defined = new Set<string>();
  for (const file of CSS_SOURCES) {
    const css = readFileSync(file, "utf8");
    for (const match of css.matchAll(/\.(kvasir-[a-z0-9-]+)/g)) defined.add(match[1]);
    for (const match of css.matchAll(/@keyframes\s+(kvasir-[a-z0-9-]+)/g)) defined.add(match[1]);
  }
  return defined;
}

// Capture the value of each class-application site, then pull every kvasir-*
// token out of it. Matching the whole value (not a single token) means ternaries
// and template literals — `className={open ? "kvasir-srow-open" : ""}`,
// `` className={`kvasir-srow ${x}`} `` — yield all their literal classes.
const CLASS_SITE = new RegExp(
  [
    // className="..." | '...' | {...}  and  el.className = "..."
    String.raw`className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{((?:[^{}]|\{[^{}]*\})*)\})`,
    // classList.add|remove|toggle|replace|contains(...)
    String.raw`classList\.(?:add|remove|toggle|replace|contains)\(([^)]*)\)`,
  ].join("|"),
  "g",
);

function usedClasses(): Map<string, string> {
  const used = new Map<string, string>(); // class -> first file that uses it
  for (const file of walk(srcDir)) {
    const source = readFileSync(file, "utf8");
    for (const site of source.matchAll(CLASS_SITE)) {
      const value = site[1] ?? site[2] ?? site[3] ?? site[4] ?? "";
      for (const token of value.matchAll(/kvasir-[a-z0-9-]+/g)) {
        const cls = token[0].replace(/-+$/, ""); // strip a trailing `-${expr}` remnant
        if (!used.has(cls)) used.set(cls, file.slice(srcDir.length + 1));
      }
    }
  }
  return used;
}

describe("styling class contract", () => {
  it("defines a stylesheet selector for every applied kvasir-* class", () => {
    const defined = definedNames();
    const undefinedUses = [...usedClasses()]
      .filter(([cls]) => !defined.has(cls) && !MARKER_CLASSES.has(cls))
      .map(([cls, file]) => `${cls} (used in ${file})`);
    expect(undefinedUses).toEqual([]);
  });

  it("scans a meaningful number of sites (guards against the regex silently matching nothing)", () => {
    expect(usedClasses().size).toBeGreaterThan(20);
  });
});
