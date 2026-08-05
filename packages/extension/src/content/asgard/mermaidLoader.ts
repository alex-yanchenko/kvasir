// Lazy-load mermaid from its own web-accessible chunk (dist/mermaid.mjs) the first
// time a diagram is rendered — keeping the ~3 MB library out of the content script
// injected on every GitHub page. The module is cached after first load. Isolated
// here (not inline in the Diagram component) so the component is unit-testable by
// mocking this one function. securityLevel:"strict" sanitizes the model-authored
// mermaid source before it becomes SVG.
interface Mermaid {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, source: string) => Promise<{ svg: string }>;
}

let cached: Mermaid | null = null;

// mermaid measures each label in a detached element using this font, then Diagram
// injects the SVG into the panel where --font-sans applies. If the measuring font and
// the display font differ, every node rect is sized from the wrong metrics and the
// label clips. Keep this byte-identical to --font-sans in content/asgard/tailwind.css
// (mermaidLoader.test.ts guards the two against drift) — it is a system-font stack, so
// it resolves identically in mermaid's light-DOM measuring element and the shadow root.
export const PANEL_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", Arial, sans-serif';

// strict sanitizes the model-authored source into safe SVG; neutral is the theme;
// fontFamily aligns measurement with display so labels don't clip (see PANEL_FONT_STACK).
export const MERMAID_INIT_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict",
  theme: "neutral",
  fontFamily: PANEL_FONT_STACK,
};

const hasDefault = (value: unknown): value is { default: Mermaid } =>
  typeof value === "object" && value !== null && "default" in value;

export async function loadMermaid(): Promise<Mermaid> {
  if (cached) return cached;
  // Non-literal specifier → esbuild leaves this as a runtime dynamic import of the
  // web-accessible ESM chunk, rather than bundling mermaid into content.js.
  const url = chrome.runtime.getURL("dist/mermaid.mjs");
  // eslint-disable-next-line no-unsanitized/method -- url is chrome.runtime.getURL of our own bundled chunk, never user input
  const loaded: unknown = await import(url);
  if (!hasDefault(loaded)) throw new Error("mermaid chunk has no default export"); // allow-bare-error: assertion on our own build output; Diagram catches it into a render fallback
  const mermaid = loaded.default;
  mermaid.initialize(MERMAID_INIT_CONFIG);
  cached = mermaid;
  return mermaid;
}
