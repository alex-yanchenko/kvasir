// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  cleanLine,
  codeForRows,
  diffContainerOf,
  filePathFromContainer,
  lineOfRow,
  lineRangeOf,
  rowAtY,
  rowForLine,
  rowForText,
  rowRect,
  rowsBetween,
  rowsInRange,
  rowsOf,
  changedFilePaths,
} from "./diff";
import type { RowBand } from "./diff";

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

  it("snaps to the nearest row by band center when y falls in a gap", () => {
    const rows = rowsOf(container);
    // gap is (10, 20); 12 is nearer row 0's center (5) than row 1's (25)
    expect(rowAtY(bands(), 12, rows[0])).toBe(rows[0]);
    // 22 is nearer row 1's center
    expect(rowAtY(bands(), 22, rows[0])).toBe(rows[1]);
  });

  it("returns the fallback row when there are no bands", () => {
    const fallback = rowsOf(container)[0];
    expect(rowAtY([], 5, fallback)).toBe(fallback);
  });
});

describe("lineRangeOf", () => {
  it("reads the covered line range from cells the Range intersects", () => {
    const range = document.createRange();
    range.selectNodeContents(container.querySelector("tbody")!);
    expect(lineRangeOf(container, range)).toEqual({ start: 10, end: 12 });
  });

  it("returns null when the Range touches no numbered cell, or without a container", () => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("h1")!);
    expect(lineRangeOf(container, range)).toBeNull();
    expect(lineRangeOf(null, range)).toBeNull();
  });
});

describe("changedFilePaths", () => {
  it("lists every readable diff container path, skipping unreadable ones", () => {
    const extra = document.createElement("div");
    extra.id = "diff-extra";
    extra.innerHTML = '<span data-tagsearch-path="src/other.ts"></span>';
    document.body.append(extra);
    const unreadable = document.createElement("div");
    unreadable.id = "diff-unreadable";
    document.body.append(unreadable);
    expect(changedFilePaths()).toEqual(["src/app.ts", "src/other.ts"]);
    extra.remove();
    unreadable.remove();
  });
});

describe("rowForText misses", () => {
  it("returns null when no text cell contains the substring", () => {
    expect(rowForText(container, "not present anywhere")).toBeNull();
  });
});

describe("reader edge branches", () => {
  it("filePathFromContainer falls back to a descendant data-tagsearch-path, then to null", () => {
    container.removeAttribute("aria-labelledby");
    container.querySelector("table")!.removeAttribute("aria-label");
    expect(filePathFromContainer(container)).toBeNull(); // nothing left to read
    const legacy = document.createElement("div");
    legacy.setAttribute("data-tagsearch-path", "src/app.ts");
    container.append(legacy);
    expect(filePathFromContainer(container)).toBe("src/app.ts"); // the old-UI attribute
  });

  it("filePathFromContainer ignores an empty aria-labelledby heading", () => {
    document.getElementById("h1")!.textContent = "Collapse file";
    expect(filePathFromContainer(container)).toBe("src/app.ts"); // table aria-label fallback
  });

  it("rowForLine returns null for a line not in the diff", () => {
    expect(rowForLine(container, 999)).toBeNull();
  });

  it("lineOfRow and cleanLine handle rows without a numbered text cell", () => {
    const bare = document.createElement("tr");
    expect(lineOfRow(bare)).toBeNull();
    expect(cleanLine(bare)).toBe("");
  });

  it("rowRect returns the off-screen fallback rect when there is no row", () => {
    expect(rowRect(null)).toEqual({ left: 60, top: 90, bottom: 114, height: 24 });
  });
});
