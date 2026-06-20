// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createBifrost } from "../bifrost";
import { rowsOf } from "./diff";
import { connectGrip } from "./grip";

// connectGrip binds document-level listeners once; build it once for the file and
// give every test a fresh diff container (the grip/askbar elements persist in the
// body exactly like they do on a real page).
const bifrost = createBifrost();
connectGrip(bifrost);

function buildContainer(): Element {
  document.getElementById("diff-abc123")?.remove();
  const host = document.createElement("div");
  host.innerHTML = `
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
  document.body.append(host.firstElementChild!);
  return document.getElementById("diff-abc123")!;
}

const grip = () => document.querySelector<HTMLElement>(".kvasir-grip");
const askbar = () => document.querySelector<HTMLElement>(".kvasir-askbar");
const picked = (c: Element) => rowsOf(c).filter((r) => r.classList.contains("kvasir-pick"));

function hoverRow(row: Element): void {
  row.querySelector("td")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
}
// jsdom has no layout, so every row band is {top:0,bottom:0} and a mouseup at
// clientY 0 deterministically resolves to the FIRST row — drags select from the
// hovered row up to row 0.
function dragFrom(row: Element): void {
  hoverRow(row);
  grip()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  document.dispatchEvent(new MouseEvent("mouseup", { clientY: 0 }));
}

let container: Element;
beforeEach(() => {
  container = buildContainer();
  bifrost.send("grip:context", { hasActiveStep: false });
  bifrost.send("pick:clear", undefined);
});

describe("grip hover", () => {
  it("shows the grip on hovering a diff row and hides it off the diff", () => {
    hoverRow(rowsOf(container)[1]);
    expect(grip()!.style.display).toBe("flex");
    document.body.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(grip()!.style.display).toBe("none");
  });
});

describe("drag select", () => {
  it("tracks the cursor during the drag, repainting the span on every move", () => {
    hoverRow(rowsOf(container)[2]);
    grip()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientY: 0 }));
    // mid-drag: span from the hovered row up to the row at the cursor (row 0)
    expect(picked(container)).toEqual(rowsOf(container));
    document.dispatchEvent(new MouseEvent("mouseup", { clientY: 0 }));
    expect(picked(container)).toEqual(rowsOf(container));
  });

  it("selects the row span, paints kvasir-pick, and reports selection:completed as data", () => {
    const completed = vi.fn();
    const off = bifrost.on("selection:completed", completed);
    dragFrom(rowsOf(container)[1]);
    expect(picked(container)).toEqual(rowsOf(container).slice(0, 2));
    expect(completed).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledWith({
      selectionId: "src/app.ts::const a = 1;\nconst b = 2;",
      file: "src/app.ts",
      text: "const a = 1;\nconst b = 2;",
      lines: { start: 10, end: 11 },
      rect: expect.objectContaining({ top: 0, left: 0 }),
    });
    off();
  });
});

describe("ask bar", () => {
  it("shows one plain ask button without step context, and reports withStep:false on click", () => {
    const ask = vi.fn();
    const off = bifrost.on("selection:ask", ask);
    dragFrom(rowsOf(container)[0]);
    const buttons = askbar()!.querySelectorAll("button");
    expect(buttons.length).toBe(1);
    buttons[0].click();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ withStep: false, file: "src/app.ts", text: "const a = 1;" }),
    );
    expect(askbar()!.style.display).toBe("none");
    off();
  });

  it("adds the context-chat button when a step is active, reporting withStep:true", () => {
    const ask = vi.fn();
    const off = bifrost.on("selection:ask", ask);
    bifrost.send("grip:context", { hasActiveStep: true });
    dragFrom(rowsOf(container)[0]);
    const buttons = askbar()!.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    buttons[0].click(); // the context button is leftmost
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ withStep: true }));
    expect(ask).toHaveBeenCalledTimes(1);
    off();
  });
});

describe("pick:clear", () => {
  it("hides the ask bar, drops the selection, and reports selection:cleared", () => {
    const cleared = vi.fn();
    const ask = vi.fn();
    const offC = bifrost.on("selection:cleared", cleared);
    const offA = bifrost.on("selection:ask", ask);
    dragFrom(rowsOf(container)[0]);
    bifrost.send("pick:clear", undefined);
    expect(askbar()!.style.display).toBe("none");
    expect(cleared).toHaveBeenCalled();
    // the dropped selection means a stale ask click does nothing
    askbar()!.querySelector("button")?.click();
    expect(ask).not.toHaveBeenCalled();
    offC();
    offA();
  });
});

describe("grip ignores non-code rows", () => {
  it("does not move the grip for a row without a line number", () => {
    const table = container.querySelector("tbody")!;
    const hunk = document.createElement("tr");
    hunk.className = "diff-line-row";
    hunk.innerHTML = "<td>@@ hunk @@</td>";
    table.append(hunk);
    hoverRow(rowsOf(container)[0]); // place the grip on a real row first
    const before = grip()!.style.top;
    hunk.querySelector("td")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(grip()!.style.top).toBe(before); // unchanged — no grip for a numberless row
  });
  it("self-hover on the grip/askbar and mid-drag hovers do not collapse the affordances", () => {
    hoverRow(rowsOf(container)[0]);
    expect(grip()!.style.display).toBe("flex");
    grip()!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); // hovering the grip itself
    expect(grip()!.style.display).toBe("flex");

    dragFrom(rowsOf(container)[0]);
    expect(askbar()!.style.display).toBe("flex");
    askbar()!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); // hovering the ask bar
    expect(askbar()!.style.display).toBe("flex");

    // a mouseover fired mid-drag (picking guard) is ignored — the grip doesn't reposition
    hoverRow(rowsOf(container)[1]);
    grip()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const top = grip()!.style.top;
    rowsOf(container)[0]
      .querySelector("td")!
      .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(grip()!.style.top).toBe(top);
    document.dispatchEvent(new MouseEvent("mouseup", { clientY: 0 }));
  });
});
