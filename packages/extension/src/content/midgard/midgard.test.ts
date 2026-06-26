// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { lineOfRow, rowsOf, stepCode } from "./diff";
import {
  clearHL,
  clearPick,
  containerForFileLoose,
  highlightRows,
  highlightStep,
  jumpToRef,
  rehighlightSession,
  showStep,
} from "./midgard";

// A full DOMRect from the four bands the controller reads; the rest are zero. Used
// to spy getBoundingClientRect so jsdom (which has no layout) can drive the
// scroll/in-view geometry branches deterministically.
function rect(top: number, bottom: number): DOMRect {
  return {
    left: 0,
    right: 0,
    width: 0,
    top,
    bottom,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => null,
  };
}

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

const picked = () => rowsOf(container).filter((r) => r.classList.contains("kvasir-pick"));
const lined = () => rowsOf(container).filter((r) => r.classList.contains("kvasir-line"));

describe("highlightStep", () => {
  it("paints kvasir-line on the rows in the step's line range and returns them", () => {
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

  it("highlights the deleted row for a removed-line (side 'L') step when a number collides", () => {
    // new-side 43 (added) and old-side 43 (deleted) share the number 43.
    document.body.innerHTML = `
      <div id="diff-collide">
        <table aria-label="Diff for: x.ts"><tbody>
          <tr class="diff-line-row"><td class="diff-text-cell" data-line-number="43">+added 43\n</td></tr>
          <tr class="diff-line-row"><td class="diff-text-cell" data-line-number="43">-removed 43\n</td></tr>
        </tbody></table>
      </div>`;
    const cont = document.getElementById("diff-collide")!;
    const [added, removed] = rowsOf(cont);
    expect(highlightStep({ anchor: "diff-collide", lines: { side: "L", start: 43, end: 43 } })).toEqual([
      removed,
    ]);
    expect(highlightStep({ anchor: "diff-collide", lines: { side: "R", start: 43, end: 43 } })).toEqual([
      added,
    ]);
  });
});

describe("highlightStep — extra branch arms", () => {
  it("uses the substring path directly when the step carries no line range", () => {
    const rows = highlightStep({ anchor: "diff-abc123", lines: null, highlight: ["context line"] });
    expect(rows).toEqual([rowsOf(container)[2]]);
    expect(lined()).toEqual([rowsOf(container)[2]]);
  });

  it("dedupes when two highlight strings resolve to the same row", () => {
    const rows = highlightStep({
      anchor: "diff-abc123",
      lines: null,
      highlight: ["context", "line"],
    });
    expect(rows).toEqual([rowsOf(container)[2]]);
    expect(lined()).toEqual([rowsOf(container)[2]]);
  });
});

describe("highlightRows / clearPick", () => {
  it("paints kvasir-pick and replaces any previous pick", () => {
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

  it("reuses a still-connected cached container without re-resolving by path", () => {
    const session = { container, file: "does/not/matter.ts", text: "const a = 1;" };
    rehighlightSession(session);
    expect(picked()).toEqual([rowsOf(container)[0]]);
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

  it("anchors duplicate text to the stored start line (picks the right occurrence)", () => {
    // a file where the same line recurs at two different line numbers
    const el = document.createElement("div");
    el.id = "diff-dup";
    const table = document.createElement("table");
    table.setAttribute("aria-label", "Diff for: src/dup.ts");
    const tbody = document.createElement("tbody");
    const addRow = (lineNo: number, text: string): void => {
      const tr = document.createElement("tr");
      tr.className = "diff-line-row";
      const td = document.createElement("td");
      td.className = "diff-text-cell";
      td.setAttribute("data-line-number", String(lineNo));
      td.textContent = text;
      tr.append(td);
      tbody.append(tr);
    };
    addRow(5, "return null;");
    addRow(6, "other");
    addRow(40, "return null;");
    table.append(tbody);
    el.append(table);
    document.body.append(el);

    // No anchor → the first occurrence (line 5).
    expect(lineOfRow(rehighlightSession({ file: "src/dup.ts", text: "return null;" })[0]!)).toBe(5);
    clearPick();
    // Anchored at line 40 → the second occurrence, not the first.
    const anchored = rehighlightSession({
      file: "src/dup.ts",
      text: "return null;",
      lines: { start: 40, end: 40 },
    });
    expect(lineOfRow(anchored[0]!)).toBe(40);
    el.remove();
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

  it("prefers the longest path on a basename collision, and returns null on a true tie", () => {
    const add = (id: string, path: string): Element => {
      const el = document.createElement("div");
      el.id = id;
      const table = document.createElement("table");
      table.setAttribute("aria-label", `Diff for: ${path}`);
      table.append(document.createElement("tbody"));
      el.append(table);
      document.body.append(el);
      return el;
    };
    const longer = add("diff-longer", "web/src/app.ts"); // also ends in app.ts
    // "app.ts" loosely matches both src/app.ts and web/src/app.ts → the longest wins.
    expect(containerForFileLoose("app.ts")).toBe(longer);
    // Two equal-length paths sharing a basename → genuinely ambiguous → null.
    add("diff-tie1", "x/foo.ts");
    add("diff-tie2", "y/foo.ts");
    expect(containerForFileLoose("foo.ts")).toBeNull();
    for (const id of ["diff-longer", "diff-tie1", "diff-tie2"]) document.getElementById(id)?.remove();
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

  it("a line-less ref seats the header under a measured sticky bar until layout settles", () => {
    vi.useFakeTimers();
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    const bar = document.createElement("div");
    document.body.append(bar);
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 0,
      bottom: 48,
      width: 0,
      height: 48,
      x: 0,
      y: 0,
      toJSON: () => null,
    });
    document.elementFromPoint = vi.fn().mockReturnValue(bar); // a sticky bar overlays the top
    expect(jumpToRef("src/app.ts", null, null)).toBe(true);
    expect(picked()).toEqual([]);
    expect(scrollBy).toHaveBeenCalledWith(0, -48); // jsdom zero rect minus the measured bar
    vi.advanceTimersByTime(2000); // jsdom rects never settle, so every retry corrects
    expect(scrollBy).toHaveBeenCalledTimes(8);
    bar.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("a line-less ref leaves a header already at the very top alone when nothing overlays it", () => {
    vi.useFakeTimers();
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    // the probe hits the container itself — no sticky bar engaged near the page top
    document.elementFromPoint = vi.fn().mockImplementation(() => container.firstElementChild);
    expect(jumpToRef("src/app.ts", null, null)).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(scrollBy).not.toHaveBeenCalled(); // zero rect top - zero overlay = seated
    vi.advanceTimersByTime(0);
    document.elementFromPoint = vi.fn().mockReturnValue(null); // probe misses entirely
    expect(jumpToRef("src/app.ts", null, null)).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(scrollBy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("a line-less ref corrects an inner scroller (/changes UI) and flushes it to the viewport top", () => {
    vi.useFakeTimers();
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    document.elementFromPoint = vi.fn().mockReturnValue(null);
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    Object.defineProperty(scroller, "scrollHeight", { value: 1000 });
    Object.defineProperty(scroller, "clientHeight", { value: 100 });
    container.parentElement!.insertBefore(scroller, container);
    scroller.append(container);
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 120, // the scroller sits below the PR header
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 120,
      toJSON: () => null,
    });
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 330, // the file header sits 210px into the scroller's viewport
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 330,
      toJSON: () => null,
    });
    expect(jumpToRef("src/app.ts", null, null)).toBe(true);
    expect(scroller.scrollTop).toBe(210); // inner correction: 330 - 120
    expect(scrollBy).toHaveBeenCalledWith(0, 120); // window flush hides the PR header
    vi.advanceTimersByTime(2000); // mocked rects never settle — every retry re-corrects
    expect(scroller.scrollTop).toBe(210 * 8);
    document.body.append(container); // restore the shared fixture
    scroller.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns false when the cited file is not in the diff", () => {
    expect(jumpToRef("missing.ts", 1, null)).toBe(false);
    expect(jumpToRef("missing.ts", null, null)).toBe(false);
  });
});

describe("scrollRowsIntoView geometry (via jumpToRef)", () => {
  // Drive every row's rect to a fixed band so jsdom's layout-less rects don't all
  // read as on-screen; mounting a separate sticky bar gives a non-zero overlay.
  function mockRows(top: number, bottom: number): void {
    for (const row of rowsOf(container)) {
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue(rect(top, bottom));
    }
  }

  it("top-aligns under the sticky bar when a too-tall range is off-screen, then re-seats until settled", () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const bar = document.createElement("div");
    document.body.append(bar);
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue(rect(0, 48));
    document.elementFromPoint = vi.fn().mockReturnValue(bar);
    mockRows(500, 2000); // taller than the usable viewport and parked below the bar

    expect(jumpToRef("src/app.ts", 10, null)).toBe(true);
    expect(picked()).toEqual([rowsOf(container)[0]]);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });

    vi.advanceTimersByTime(2000); // mocked rects never settle: 1 initial + 6 settle re-seats
    expect(scrollIntoView).toHaveBeenCalledTimes(7);

    bar.remove();
    vi.useRealTimers();
  });

  it("centers a fits-the-viewport range that is scrolled out of view (no overlay)", () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    document.elementFromPoint = vi.fn().mockReturnValue(null); // no sticky bar → overlay 0
    mockRows(900, 924); // short range pushed below the 768px viewport bottom

    expect(jumpToRef("src/app.ts", 10, null)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });

    vi.advanceTimersByTime(2000);
    vi.useRealTimers();
  });

  it("falls back to documentElement.clientHeight then 0 when innerHeight is unset", () => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    document.elementFromPoint = vi.fn().mockReturnValue(null);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(0);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(0);
    mockRows(900, 924);

    expect(jumpToRef("src/app.ts", 10, null)).toBe(true);
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();
  });

  it("stops re-seating once the container detaches mid-settle", () => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    document.elementFromPoint = vi.fn().mockReturnValue(null);
    mockRows(900, 924);

    expect(jumpToRef("src/app.ts", 10, null)).toBe(true);
    container.remove(); // SPA nav detaches the file before the settle timer fires
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();

    document.body.append(container);
    vi.useRealTimers();
  });
});

describe("showStep", () => {
  it("highlights and scrolls when the rows are present on the first try", () => {
    vi.useFakeTimers();
    showStep({ anchor: "diff-abc123", lines: { start: 10, end: 11 } });
    expect(lined()).toEqual(rowsOf(container).slice(0, 2));
    vi.advanceTimersByTime(2000);
    vi.useRealTimers();
  });

  it("polls, clicking Load Diff, until it gives up after 40 tries when rows never render", () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const button = document.createElement("button");
    button.textContent = "Load Diff";
    button.click = click;
    container.append(button);

    showStep({ anchor: "diff-abc123", lines: { start: 90, end: 91 } }); // no such lines
    vi.advanceTimersByTime(40 * 41); // 40 retries then the ++tries < 40 guard ends it
    expect(click).toHaveBeenCalled();
    expect(lined()).toEqual([]);

    button.remove();
    vi.useRealTimers();
  });

  it("cancels its retry loop as soon as a newer showStep supersedes it", () => {
    vi.useFakeTimers();
    showStep({ anchor: "diff-missing", lines: { start: 1, end: 2 } }); // container absent → polls
    showStep({ anchor: "diff-abc123", lines: { start: 10, end: 10 } }); // newer generation
    vi.advanceTimersByTime(2000);
    expect(lined()).toEqual([rowsOf(container).slice(0, 1)[0]]);
    vi.useRealTimers();
  });
});

describe("loadDiffIfPresent (via showStep with a non-button match)", () => {
  it("ignores a Load Diff match that isn't an HTMLElement and keeps polling", () => {
    vi.useFakeTimers();
    // textContent matches the regex but the node is an SVG element, not HTMLElement,
    // so the click guard rejects it (exercises the null-coalesce on textContent too).
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "a");
    svg.setAttribute("role", "button");
    svg.textContent = "load diff";
    container.append(svg);

    showStep({ anchor: "diff-abc123", lines: { start: 90, end: 91 } });
    vi.advanceTimersByTime(40 * 41);
    expect(lined()).toEqual([]);

    svg.remove();
    vi.useRealTimers();
  });
});

describe("jumpToRef — extra branch arms", () => {
  it("polls a cited range, clicking Load Diff, and gives up after 40 tries", () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const button = document.createElement("button");
    button.textContent = "Load Diff";
    button.click = click;
    container.append(button);

    expect(jumpToRef("src/app.ts", 90, 91)).toBe(true); // range with no rendered rows
    vi.advanceTimersByTime(40 * 41);
    expect(click).toHaveBeenCalled();
    expect(picked()).toEqual([]);

    button.remove();
    vi.useRealTimers();
  });

  it("stops the land retry loop when the container detaches", () => {
    vi.useFakeTimers();
    expect(jumpToRef("src/app.ts", 90, 91)).toBe(true);
    container.remove();
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    document.body.append(container);
    vi.useRealTimers();
  });

  it("a line-less ref does not flush an inner scroller already flush with the viewport top", () => {
    vi.useFakeTimers();
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    document.elementFromPoint = vi.fn().mockReturnValue(null);
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    Object.defineProperty(scroller, "scrollHeight", { value: 1000 });
    Object.defineProperty(scroller, "clientHeight", { value: 100 });
    container.parentElement!.insertBefore(scroller, container);
    scroller.append(container);
    // scroller top 0 → already flush: the off > 4 inner correction and the flush > 4
    // window correction both no-op, leaving scrollBy untouched.
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(rect(0, 0));
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(0, 0));

    expect(jumpToRef("src/app.ts", null, null)).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(0);

    document.body.append(container);
    scroller.remove();
    vi.useRealTimers();
  });

  it("a line-less ref stops seating once the container detaches", () => {
    vi.useFakeTimers();
    document.elementFromPoint = vi.fn().mockReturnValue(null);
    expect(jumpToRef("src/app.ts", null, null)).toBe(true);
    container.remove();
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    document.body.append(container);
    vi.useRealTimers();
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
