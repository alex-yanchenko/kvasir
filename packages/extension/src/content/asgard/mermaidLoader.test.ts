import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { MERMAID_INIT_CONFIG, PANEL_FONT_STACK } from "./mermaidLoader";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("mermaid init config", () => {
  it("initializes with strict sanitization, the neutral theme, and the panel font", () => {
    expect(MERMAID_INIT_CONFIG).toEqual({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
      fontFamily: PANEL_FONT_STACK,
    });
  });

  // PANEL_FONT_STACK must equal --font-sans so mermaid measures labels in the same
  // font the panel renders them in; a divergence sizes node rects from the wrong
  // metrics and clips the labels. This fails if the CSS token and the constant drift.
  it("keeps PANEL_FONT_STACK byte-identical to --font-sans in tailwind.css", () => {
    const css = readFileSync(path.join(here, "tailwind.css"), "utf8");
    const match = /--font-sans:([^;]+);/.exec(css);
    expect(match?.[1]?.trim()).toBe(PANEL_FONT_STACK);
  });
});
