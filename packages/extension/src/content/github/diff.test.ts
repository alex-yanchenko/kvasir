// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import type { RowBand } from "./diff";
import {
  filePathFromContainer,
  diffContainerOf,
  rowsOf,
  lineOfRow,
  cleanLine,
  codeForRows,
  rowsBetween,
  rowsInRange,
  rowForLine,
  rowForText,
  rowAtY,
} from "./diff";

// A minimal stand-in for GitHub's "Files changed" markup: a diff-<hash> container
// whose path lives in an aria-labelledby heading, plus three code rows (an added,
// a deleted, a context line) and one hunk row with no text cell.
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
  container = buildContainer();
});

describe("filePathFromContainer", () => {
  it("reads the path from the aria-labelledby heading, stripping the Collapse prefix", () => {
    expect(filePathFromContainer(container)).toBe("src/app.ts");
  });

  it("falls back to the table[aria-label] 'Diff for:' value", () => {
    container.removeAttribute("aria-labelledby");
    expect(filePathFromContainer(container)).toBe("src/app.ts");
  });

  it("returns null for a missing container", () => {
    expect(filePathFromContainer(null)).toBeNull();
  });
});

describe("diffContainerOf", () => {
  it("walks up from a descendant node to the diff- container", () => {
    const cell = container.querySelector("td.diff-text-cell")!;
    expect(diffContainerOf(cell)).toBe(container);
  });
});

describe("row reads", () => {
  it("rowsOf returns only real code rows (skips the hunk row with no text cell)", () => {
    expect(rowsOf(container).map(cleanLine)).toEqual(["const a = 1;", "const b = 2;", "context line"]);
  });

  it("lineOfRow reads data-line-number; cleanLine strips the +/- marker and newline", () => {
    const rows = rowsOf(container);
    expect(rows.map(lineOfRow)).toEqual([10, 11, 12]);
  });

  it("codeForRows joins cleaned lines with newlines", () => {
    expect(codeForRows(rowsOf(container))).toBe("const a = 1;\nconst b = 2;\ncontext line");
  });

  it("rowForLine finds a row by its data-line-number", () => {
    expect(rowForLine(container, 12)).toBe(rowsOf(container)[2]);
  });

  it("rowForText finds the first row whose text cell contains the substring", () => {
    expect(rowForText(container, "const b")).toBe(rowsOf(container)[1]);
  });
});

describe("rowsBetween (DOM order, not numeric)", () => {
  it("returns the inclusive span and is order-agnostic about its endpoints", () => {
    const rows = rowsOf(container);
    expect(rowsBetween(container, rows[0], rows[2])).toEqual(rows);
    expect(rowsBetween(container, rows[2], rows[0])).toEqual(rows);
  });

  it("returns [] when an endpoint is not among the container's rows", () => {
    const orphan = document.createElement("tr");
    expect(rowsBetween(container, rowsOf(container)[0], orphan)).toEqual([]);
  });
});

describe("rowsInRange (by visible new-side line number)", () => {
  it("returns rows whose line number falls within [start, end]", () => {
    expect(rowsInRange(container, 10, 11).map(cleanLine)).toEqual(["const a = 1;", "const b = 2;"]);
  });

  it("returns [] for a null container", () => {
    expect(rowsInRange(null, 10, 11)).toEqual([]);
  });
});

describe("rowAtY", () => {
  const bands = (): RowBand[] => {
    const rows = rowsOf(container);
    return [
      { row: rows[0], top: 0, bottom: 10 },
      { row: rows[1], top: 20, bottom: 30 },
    ];
  };

  it("returns the row whose band contains y", () => {
    expect(rowAtY(bands(), 5, rowsOf(container)[0])).toBe(rowsOf(container)[0]);
    expect(rowAtY(bands(), 25, rowsOf(container)[0])).toBe(rowsOf(container)[1]);
  });

  it("clamps to the first row above the top and the last row below the bottom", () => {
    const rows = rowsOf(container);
    expect(rowAtY(bands(), -100, rows[2])).toBe(rows[0]);
    expect(rowAtY(bands(), 999, rows[2])).toBe(rows[1]);
  });

  it("returns undefined when y falls in a gap between bands", () => {
    expect(rowAtY(bands(), 15, rowsOf(container)[0])).toBeUndefined();
  });

  it("returns the fallback row when there are no bands", () => {
    const fallback = rowsOf(container)[0];
    expect(rowAtY([], 5, fallback)).toBe(fallback);
  });
});
