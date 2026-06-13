// The ONE file coupled to GitHub's "Files changed" diff markup. Everything that
// reads selectors, line numbers, row geometry, or file anchors lives here, so a
// GitHub markup change is a one-file fix. Pure readers: they take DOM nodes /
// coords / ranges and return data — no overlay (.prw-*) writes, no app state.

export interface LineRange {
  start: number;
  end: number;
}

// Subset of DOMRect the overlay positions against; also the shape of the
// off-screen fallback rect rowRect returns when no row is available.
export interface RowRect {
  left: number;
  top: number;
  bottom: number;
  height: number;
}

// A row's vertical screen band, snapshotted once at drag-start so the cursor's Y
// can be mapped onto a row without hit-testing (see rowAtY).
export interface RowBand {
  row: Element;
  top: number;
  bottom: number;
}

// Derive the file path from a diff file container. The newer /changes UI has no
// data-tagsearch-path; the path lives in the container's aria-labelledby heading
// (clean) or a table[aria-label] ("Diff for: <path>"). Falls back to the old attr.
export function filePathFromContainer(cont: Element | null): string | null {
  if (!cont) return null;
  const lblId = cont.getAttribute("aria-labelledby");
  const heading = lblId ? document.getElementById(lblId) : null;
  if (heading) {
    const t = (heading.textContent ?? "")
      .replace(/‎/g, "")
      .replace(/^Collapse file/i, "")
      .trim();
    if (t) return t;
  }
  const al = cont.querySelector("table[aria-label]")?.getAttribute("aria-label");
  if (al) return al.replace(/^Diff for:\s*/i, "").trim();
  return cont.querySelector("[data-tagsearch-path]")?.getAttribute("data-tagsearch-path") || null;
}

/** Every changed file currently on the page, by its diff container. Pure read —
 * Asgard uses it to validate file mentions in answers before linkifying them. */
export function changedFilePaths(): string[] {
  const out: string[] = [];
  document.querySelectorAll('[id^="diff-"]').forEach((el) => {
    const path = filePathFromContainer(el);
    if (path) out.push(path);
  });
  return out;
}

export function diffContainerOf(node: Node | null): Element | null {
  let el: Element | null = node instanceof Element ? node : (node?.parentElement ?? null);
  while (el && !(el.id && el.id.startsWith("diff-"))) el = el.parentElement;
  return el || null;
}

// Find a file's diff container by its path (for re-highlighting a reopened chat).
export function containerForFile(file: string | null | undefined): Element | null {
  if (!file) return null;
  for (const c of document.querySelectorAll('[id^="diff-"]')) {
    if (filePathFromContainer(c) === file) return c;
  }
  return null;
}

// New-side line range the selection covers, read from the diff's data-line-number.
// Tiny to send and lets the model locate (and read around) the exact lines itself.
export function lineRangeOf(container: Element | null, range: Range): LineRange | null {
  if (!container) return null;
  let lo = Infinity,
    hi = -Infinity;
  for (const cell of container.querySelectorAll("td.diff-text-cell[data-line-number]")) {
    if (range.intersectsNode(cell)) {
      const n = Number(cell.getAttribute("data-line-number"));
      if (n) {
        lo = Math.min(lo, n);
        hi = Math.max(hi, n);
      }
    }
  }
  return hi >= lo ? { start: lo, end: hi } : null;
}

export function rowForLine(cont: Element, n: number): Element | null {
  const cell = cont.querySelector(`td.diff-text-cell[data-line-number="${n}"]`);
  return cell ? cell.closest("tr.diff-line-row") : null;
}
export function rowForText(cont: Element, text: string): Element | null {
  for (const c of cont.querySelectorAll("td.diff-text-cell")) {
    if (c.textContent?.includes(text)) return c.closest("tr.diff-line-row");
  }
  return null;
}

export const lineOfRow = (row: Element): number | null => {
  const c = row.querySelector("td.diff-text-cell[data-line-number]");
  return c ? Number(c.getAttribute("data-line-number")) : null;
};
// IMPORTANT: select by DOM row order, never by numeric line range. In a unified
// diff, ADDED lines carry NEW line numbers and DELETED lines carry OLD ones, so
// `data-line-number` is neither unique nor monotonic across a hunk — a numeric
// range breaks the moment a selection crosses a delete↔add boundary.
const textCellOf = (row: Element): Element | null => row.querySelector("td.diff-text-cell");
// Only real code rows (skip hunk/expander/spacer rows that have no text cell).
export const rowsOf = (container: Element): Element[] =>
  [...container.querySelectorAll("tr.diff-line-row")].filter(textCellOf);
export const cleanLine = (row: Element): string => {
  const c = textCellOf(row);
  return c ? (c.textContent ?? "").replace(/\n/g, "").replace(/^[+\-] ?/, "") : "";
};
export function rowsBetween(container: Element, rowA: Element, rowB: Element): Element[] {
  const all = rowsOf(container);
  let i = all.indexOf(rowA),
    j = all.indexOf(rowB);
  if (i < 0 || j < 0) return [];
  if (i > j) [i, j] = [j, i];
  return all.slice(i, j + 1);
}
// Rows whose visible line number falls in [start, end]. Used for spec-defined
// step ranges (the generator emits new-side numbers).
export function rowsInRange(container: Element | null, start: number, end: number): Element[] {
  if (!container) return [];
  const lo = Math.min(start, end),
    hi = Math.max(start, end);
  return rowsOf(container).filter((r) => {
    const n = lineOfRow(r);
    return n != null && n >= lo && n <= hi;
  });
}
export const codeForRows = (rows: Element[]): string => rows.map(cleanLine).join("\n");
export const rowRect = (row: Element | null): DOMRect | RowRect =>
  row ? row.getBoundingClientRect() : { left: 60, top: 90, bottom: 114, height: 24 };

// Snapshot every selectable row's vertical band. Resolve the target row by
// GEOMETRY, not hit-testing: GitHub lets clicks on a row's whitespace fall
// through to a wrapper div, so elementFromPoint is unreliable on diff rows.
export const rowBandsOf = (container: Element): RowBand[] =>
  rowsOf(container).map((row) => {
    const b = row.getBoundingClientRect();
    return { row, top: b.top, bottom: b.bottom };
  });

// The row whose band contains y; clamps to the first/last row past the ends, and
// when y falls in a gap between rows, snaps to the row whose band center is
// nearest. Always returns a row (the fallback only covers an empty band list).
export function rowAtY(bands: RowBand[], y: number, fallbackRow: Element): Element {
  const first = bands[0];
  if (!first) return fallbackRow;
  if (y <= first.top) return first.row;
  const last = bands[bands.length - 1];
  if (last && y >= last.bottom) return last.row;
  for (const band of bands) if (y >= band.top && y <= band.bottom) return band.row;
  let best = first;
  let nearest = Infinity;
  for (const band of bands) {
    const d = Math.abs((band.top + band.bottom) / 2 - y);
    if (d < nearest) {
      nearest = d;
      best = band;
    }
  }
  return best.row;
}
