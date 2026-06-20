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
  delete document.body.dataset.kvasirTheme;
  delete document.body.dataset.kvasirHl;
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, "elementFromPoint"); // a test may stub it; jsdom has none
});

const lined = (c: Element) => rowsOf(c).filter((r) => r.classList.contains("kvasir-line"));
const picked = (c: Element) => rowsOf(c).filter((r) => r.classList.contains("kvasir-pick"));

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

  it("offsets a top-aligned jump below a sticky overlay bar", () => {
    const b = createBifrost();
    connectMidgard(b);
    buildContainer();
    // a range taller than the viewport → top-align path
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: -5000,
      bottom: -2000,
      left: 0,
    } as DOMRect);
    // a 48px sticky bar covers the top of the viewport (a node outside the diff)
    const bar = document.createElement("div");
    bar.getBoundingClientRect = () => ({ bottom: 48 }) as DOMRect;
    document.elementFromPoint = () => bar; // jsdom doesn't implement it
    let marginAtScroll = "";
    scrolls.mockImplementation(function (this: HTMLElement) {
      marginAtScroll = this.style.scrollMarginTop; // read before the synchronous reset
    });
    b.send("highlight:step", { anchor: "diff-abc123", lines: { start: 10, end: 12 }, highlight: null });
    const first = rowsOf(document.getElementById("diff-abc123")!)[0] as HTMLElement;
    expect(marginAtScroll).toBe("48px"); // overlay offset applied for the scroll
    expect(first.style.scrollMarginTop).toBe(""); // reset after — not left on GitHub's row
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

  it("clicks Load Diff for a large diff, then highlights once it renders", () => {
    vi.useFakeTimers();
    const b = createBifrost();
    connectMidgard(b);
    // a large diff: only a "Load Diff" control, no rows yet — clicking it renders
    document.body.innerHTML = `<div id="diff-abc123"><button type="button">Load Diff</button></div>`;
    document.querySelector("#diff-abc123 button")!.addEventListener("click", () => {
      buildContainer(); // GitHub renders the real diff (same id) on click
    });
    b.send("highlight:step", { anchor: "diff-abc123", lines: { start: 10, end: 10 }, highlight: null });
    vi.advanceTimersByTime(40); // retry clicks Load Diff → diff renders
    vi.advanceTimersByTime(40); // next retry finds the rows
    const c = document.getElementById("diff-abc123")!;
    expect(lined(c)).toEqual([rowsOf(c)[0]]); // line 10 = first row
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
    b.send("pick:rehighlight", { file: "src/app.ts", text: "const b = 2;", scroll: true });
    expect(scrolls).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
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
    expect(document.body.dataset.kvasirTheme).toBe("dark");
    expect(document.body.dataset.kvasirHl).toBe("github");
  });

  it("disconnect() detaches every handler", () => {
    const b = createBifrost();
    const disconnect = connectMidgard(b);
    const c = buildContainer();
    disconnect();
    b.send("highlight:step", { anchor: "diff-abc123", lines: { start: 10, end: 12 }, highlight: null });
    b.send("theme:apply", { theme: "light", hlStyle: "tint" });
    expect(lined(c)).toEqual([]);
    expect(document.body.dataset.kvasirTheme).toBeUndefined();
  });
  it("scrollRowsIntoView settle stops once the container is removed mid-poll", () => {
    vi.useFakeTimers();
    const b = createBifrost();
    connectMidgard(b);
    const c = buildContainer();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: -999,
      bottom: -980,
    } as DOMRect);
    b.send("highlight:step", { anchor: "diff-abc123", lines: { start: 10, end: 11 }, highlight: null });
    const before = scrolls.mock.calls.length;
    c.remove();
    expect(() => vi.advanceTimersByTime(150 * 7)).not.toThrow();
    expect(scrolls.mock.calls.length).toBe(before); // settle bailed on the detached container
  });

  it("jump:ref land() stops retrying when the container is removed mid-poll", () => {
    vi.useFakeTimers();
    const b = createBifrost();
    connectMidgard(b);
    const c = buildContainer();
    b.send("jump:ref", { file: "src/app.ts", start: 999, end: null }); // line absent → polls
    c.remove();
    expect(() => vi.advanceTimersByTime(40 * 42)).not.toThrow();
    expect(picked(c)).toEqual([]);
  });

  it("jump:ref clicks Load Diff for a collapsed file, then highlights once it renders", () => {
    vi.useFakeTimers();
    const b = createBifrost();
    connectMidgard(b);
    document.body.innerHTML = `<div id="diff-abc123" aria-labelledby="h1"><h1 id="h1">Collapse filesrc/app.ts</h1><button type="button">Load Diff</button></div>`;
    const c = document.getElementById("diff-abc123")!;
    c.querySelector("button")!.addEventListener("click", () => {
      c.innerHTML = `<h1 id="h1">Collapse filesrc/app.ts</h1><table aria-label="Diff for: src/app.ts"><tbody><tr class="diff-line-row"><td class="diff-text-cell" data-line-number="10">+const a = 1;</td></tr></tbody></table>`;
    });
    b.send("jump:ref", { file: "src/app.ts", start: 10, end: null });
    vi.advanceTimersByTime(40);
    vi.advanceTimersByTime(40);
    expect(picked(document.getElementById("diff-abc123")!)).toEqual([
      rowsOf(document.getElementById("diff-abc123")!)[0],
    ]);
  });
});
