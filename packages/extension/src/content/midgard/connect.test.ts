// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createBifrost } from "../bifrost";
import { connectMidgard } from "./connect";
import { rowsOf } from "./diff";

function buildContainer(): Element {
  document.body.innerHTML = `
    <div id="diff-abc123" aria-labelledby="h1">
      <h1 id="h1">Collapse filesrc/app.ts</h1>
      <table aria-label="Diff for: src/app.ts">
        <tbody>
          <tr class="diff-line-row"><td class="diff-text-cell" data-line-number="10">+const a = 1;\n</td></tr>
          <tr class="diff-line-row"><td class="diff-text-cell" data-line-number="11">-const b = 2;\n</td></tr>
          <tr class="diff-line-row"><td class="diff-text-cell" data-line-number="12">context line\n</td></tr>
        </tbody>
      </table>
    </div>`;
  return document.getElementById("diff-abc123")!;
}

let scrolls: ReturnType<typeof vi.fn>;
beforeEach(() => {
  scrolls = vi.fn();
  Element.prototype.scrollIntoView = scrolls;
  document.body.innerHTML = "";
  delete document.body.dataset.prwTheme;
  delete document.body.dataset.prwHl;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const lined = (c: Element) => rowsOf(c).filter((r) => r.classList.contains("prw-line"));
const picked = (c: Element) => rowsOf(c).filter((r) => r.classList.contains("prw-pick"));

describe("connectMidgard command handling", () => {
  it("highlight:step paints the step's rows without scrolling when they're already in view", () => {
    const b = createBifrost();
    connectMidgard(b);
    const c = buildContainer();
    b.send("highlight:step", { anchor: "diff-abc123", lines: { start: 10, end: 11 }, highlight: null });
    expect(lined(c)).toEqual(rowsOf(c).slice(0, 2));
    expect(scrolls).not.toHaveBeenCalled(); // jsdom rows sit at top 0 → in view → no re-jump
  });

  it("centers an off-screen range that fits the viewport (so every line shows)", () => {
    const b = createBifrost();
    connectMidgard(b);
    const c = buildContainer();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: -999,
      bottom: -980,
    } as DOMRect);
    b.send("highlight:step", { anchor: "diff-abc123", lines: { start: 10, end: 11 }, highlight: null });
    expect(lined(c)).toEqual(rowsOf(c).slice(0, 2));
    expect(scrolls).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });

  it("top-aligns an off-screen range taller than the viewport", () => {
    const b = createBifrost();
    connectMidgard(b);
    buildContainer();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: -5000,
      bottom: -2000,
    } as DOMRect);
    b.send("highlight:step", { anchor: "diff-abc123", lines: { start: 10, end: 12 }, highlight: null });
    expect(scrolls).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("highlight:step keeps retrying until a lazy-rendered file appears", () => {
    vi.useFakeTimers();
    const b = createBifrost();
    connectMidgard(b);
    b.send("highlight:step", { anchor: "diff-abc123", lines: { start: 12, end: 12 }, highlight: null });
    const c = buildContainer(); // the file "renders" after the first attempt
    vi.advanceTimersByTime(40);
    expect(lined(c)).toEqual([rowsOf(c)[2]]);
  });

  it("highlight:step gives up quietly when the file never renders", () => {
    vi.useFakeTimers();
    const b = createBifrost();
    connectMidgard(b);
    b.send("highlight:step", { anchor: "diff-never", lines: { start: 1, end: 1 }, highlight: null });
    expect(() => vi.advanceTimersByTime(40 * 25)).not.toThrow();
  });

  it("highlight:clear removes the step highlight", () => {
    const b = createBifrost();
    connectMidgard(b);
    const c = buildContainer();
    b.send("highlight:step", { anchor: "diff-abc123", lines: { start: 10, end: 12 }, highlight: null });
    b.send("highlight:clear", undefined);
    expect(lined(c)).toEqual([]);
  });

  it("pick:rehighlight repaints a stored selection by text, scrolling only when asked", () => {
    const b = createBifrost();
    connectMidgard(b);
    const c = buildContainer();
    b.send("pick:rehighlight", { file: "src/app.ts", text: "const b = 2;" });
    expect(picked(c)).toEqual([rowsOf(c)[1]]);
    const before = scrolls.mock.calls.length;
    b.send("pick:rehighlight", { file: "src/app.ts", text: "const b = 2;", scroll: true });
    expect(scrolls.mock.calls.length).toBeGreaterThan(before);
  });

  it("pick:clear removes the selection highlight", () => {
    const b = createBifrost();
    connectMidgard(b);
    const c = buildContainer();
    b.send("pick:rehighlight", { file: "src/app.ts", text: "context line" });
    b.send("pick:clear", undefined);
    expect(picked(c)).toEqual([]);
  });

  it("jump:ref paints a cited line; a missing file is reported as ref:missing", () => {
    const b = createBifrost();
    connectMidgard(b);
    const c = buildContainer();
    const missing = vi.fn();
    b.on("ref:missing", missing);
    b.send("jump:ref", { file: "src/app.ts", start: 12, end: null });
    expect(picked(c)).toEqual([rowsOf(c)[2]]);
    expect(missing).not.toHaveBeenCalled();
    b.send("jump:ref", { file: "gone.ts", start: 1, end: null });
    expect(missing).toHaveBeenCalledWith({ file: "gone.ts" });
    expect(missing).toHaveBeenCalledTimes(1);
  });

  it("theme:apply reflects both choices onto the body for the github-side CSS", () => {
    const b = createBifrost();
    connectMidgard(b);
    b.send("theme:apply", { theme: "dark", hlStyle: "github" });
    expect(document.body.dataset.prwTheme).toBe("dark");
    expect(document.body.dataset.prwHl).toBe("github");
  });

  it("disconnect() detaches every handler", () => {
    const b = createBifrost();
    const disconnect = connectMidgard(b);
    const c = buildContainer();
    disconnect();
    b.send("highlight:step", { anchor: "diff-abc123", lines: { start: 10, end: 12 }, highlight: null });
    b.send("theme:apply", { theme: "light", hlStyle: "tint" });
    expect(lined(c)).toEqual([]);
    expect(document.body.dataset.prwTheme).toBeUndefined();
  });
});
