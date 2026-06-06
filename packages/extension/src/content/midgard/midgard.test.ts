// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  stepCode,
  clearHL,
  clearPick,
  containerForFileLoose,
  highlightRows,
  highlightStep,
  jumpToRef,
  rehighlightSession,
} from "./midgard";
import { rowsOf } from "./diff";

// Same minimal GitHub-diff stand-in as diff.test.ts: an anchored container whose
// path lives in the aria-labelledby heading, three code rows, one hunk row.
function buildContainer(): Element {
  document.body.innerHTML = `
    <div id="diff-abc123" aria-labelledby="h1">
      <h1 id="h1">Collapse filesrc/app.ts</h1>
      <table aria-label="Diff for: src/app.ts">
        <tbody>
          <tr class="diff-line-row"><td class="diff-text-cell" data-line-number="10">+const a = 1;\n</td></tr>
          <tr class="diff-line-row"><td class="diff-text-cell" data-line-number="11">-const b = 2;\n</td></tr>
          <tr class="diff-line-row"><td class="diff-text-cell" data-line-number="12">context line\n</td></tr>
          <tr class="diff-hunk-row"><td>@@ -10,2 +10,2 @@</td></tr>
        </tbody>
      </table>
    </div>`;
  return document.getElementById("diff-abc123")!;
}

let container: Element;
beforeEach(() => {
  // jsdom doesn't implement scrollIntoView; the controller only fires it as a
  // side effect, so a stub keeps the logic under test.
  Element.prototype.scrollIntoView = vi.fn();
  container = buildContainer();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const picked = () => rowsOf(container).filter((r) => r.classList.contains("prw-pick"));
const lined = () => rowsOf(container).filter((r) => r.classList.contains("prw-line"));

describe("highlightStep", () => {
  it("paints prw-line on the rows in the step's line range and returns them", () => {
    const rows = highlightStep({ anchor: "diff-abc123", lines: { start: 10, end: 11 } });
    expect(lined()).toEqual(rowsOf(container).slice(0, 2));
    expect(rows).toEqual(rowsOf(container).slice(0, 2));
  });

  it("clears the previous step highlight before painting the next", () => {
    highlightStep({ anchor: "diff-abc123", lines: { start: 10, end: 10 } });
    highlightStep({ anchor: "diff-abc123", lines: { start: 12, end: 12 } });
    expect(lined()).toEqual([rowsOf(container)[2]]);
  });

  it("falls back to substring matches when the line range hits nothing", () => {
    const rows = highlightStep({
      anchor: "diff-abc123",
      lines: { start: 90, end: 91 },
      highlight: ["context line"],
    });
    expect(rows).toEqual([rowsOf(container)[2]]);
    expect(lined()).toEqual([rowsOf(container)[2]]);
  });

  it("returns [] when the anchor container is not in the DOM", () => {
    expect(highlightStep({ anchor: "diff-nope", lines: { start: 1, end: 2 } })).toEqual([]);
  });
});

describe("highlightRows / clearPick", () => {
  it("paints prw-pick and replaces any previous pick", () => {
    const rows = rowsOf(container);
    highlightRows([rows[0]]);
    highlightRows([rows[1], rows[2]]);
    expect(picked()).toEqual([rows[1], rows[2]]);
  });

  it("clearPick removes every pick; clearHL removes every line highlight", () => {
    highlightRows(rowsOf(container));
    highlightStep({ anchor: "diff-abc123", lines: { start: 10, end: 12 } });
    clearPick();
    clearHL();
    expect(picked()).toEqual([]);
    expect(lined()).toEqual([]);
  });
});

describe("rehighlightSession", () => {
  it("re-paints a stored selection by matching its code text and caches the container", () => {
    const session: { container?: Element | null; file: string; text: string } = {
      file: "src/app.ts",
      text: "const b = 2;\ncontext line",
    };
    rehighlightSession(session);
    expect(picked()).toEqual(rowsOf(container).slice(1, 3));
    expect(session.container).toBe(container);
  });

  it("re-resolves a disconnected cached container by file path", () => {
    const stale = document.createElement("div");
    const session = { container: stale, file: "src/app.ts", text: "const a = 1;" };
    rehighlightSession(session);
    expect(picked()).toEqual([rowsOf(container)[0]]);
    expect(session.container).toBe(container);
  });

  it("paints nothing when the text no longer matches the live rows", () => {
    rehighlightSession({ file: "src/app.ts", text: "vanished line" });
    expect(picked()).toEqual([]);
  });

  it("paints nothing when the file has no container or the session has no text", () => {
    rehighlightSession({ file: "gone/elsewhere.ts", text: "const a = 1;" });
    rehighlightSession({ file: "src/app.ts", text: "" });
    expect(picked()).toEqual([]);
  });
});

describe("containerForFileLoose", () => {
  it("finds by exact path and by short/long suffix variants", () => {
    expect(containerForFileLoose("src/app.ts")).toBe(container);
    expect(containerForFileLoose("app.ts")).toBe(container);
    expect(containerForFileLoose("repo/src/app.ts")).toBe(container);
  });

  it("returns null for a file not in the diff", () => {
    expect(containerForFileLoose("other/file.ts")).toBeNull();
  });
});

describe("jumpToRef", () => {
  it("highlights and scrolls a single cited line, returning true", () => {
    expect(jumpToRef("src/app.ts", 12, null)).toBe(true);
    expect(picked()).toEqual([rowsOf(container)[2]]);
  });

  it("highlights a cited range", () => {
    expect(jumpToRef("src/app.ts", 10, 11)).toBe(true);
    expect(picked()).toEqual(rowsOf(container).slice(0, 2));
  });

  it("scrolls the container but paints nothing when the cited line is not in the diff", () => {
    expect(jumpToRef("src/app.ts", 999, null)).toBe(true);
    expect(picked()).toEqual([]);
  });

  it("returns false when the cited file is not in the diff", () => {
    expect(jumpToRef("missing.ts", 1, null)).toBe(false);
  });
});

describe("stepCode query", () => {
  it("returns the rendered code + rect for a step's line range", () => {
    const r = stepCode({ anchor: "diff-abc123", lines: { start: 10, end: 11 } });
    expect(r?.text).toBe("const a = 1;\nconst b = 2;");
    expect(r?.rect).toBeTruthy();
  });

  it("returns null when the file is not rendered, or the step has no lines", () => {
    expect(stepCode({ anchor: "diff-missing", lines: { start: 1, end: 2 } })).toBeNull();
    expect(stepCode({ anchor: "diff-abc123", lines: null })).toBeNull();
  });
});
