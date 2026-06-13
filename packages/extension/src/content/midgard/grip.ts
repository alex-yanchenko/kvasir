// Midgard's selection affordances: the grip that follows the hovered diff line
// (click = one line, drag = a range) and the ask bar that appears on a completed
// selection. Geometry-driven against GitHub's rows on a mousemove hot path, so it
// stays imperative and page-side; the panels only ever hear data —
// selection:completed / selection:ask reports. No text selection happens, so
// GitHub's own (buggy) line selection never triggers; clean code is rebuilt from
// the rows.

import type { Bifrost, SelectionPayload } from "../bifrost";
import {
  codeForRows,
  diffContainerOf,
  filePathFromContainer,
  lineOfRow,
  rowAtY,
  rowBandsOf,
  rowRect,
  rowsBetween,
} from "./diff";
import { highlightRows } from "./midgard";

const BUBBLE = '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>';
const svgIcon = (inner: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

interface Selection {
  container: Element;
  rows: Element[];
}

export function connectGrip(bifrost: Bifrost): void {
  let grip: HTMLButtonElement | null = null;
  let askBtn: HTMLDivElement | null = null;
  let hoverInfo: { row: Element; line: number; container: Element } | null = null;
  let picking = false;
  let sel: Selection | null = null;
  let hasActiveStep = false;

  bifrost.handle("grip:context", (p) => {
    hasActiveStep = p.hasActiveStep;
  });
  // pick:clear (from the app or a new drag) also resets the selection affordances.
  bifrost.handle("pick:clear", () => {
    sel = null;
    if (askBtn) askBtn.style.display = "none";
    bifrost.report("selection:cleared", undefined);
  });

  // The data that crosses the Bifrost — rebuilt from the rows, never the rows.
  // selectionId doubles as the chat-session key (file + leading text).
  function payloadFor(s: Selection): SelectionPayload | null {
    const file = filePathFromContainer(s.container);
    const text = codeForRows(s.rows);
    const first = s.rows[0];
    if (!file || !text || !first) return null;
    const a = lineOfRow(first);
    const b = lineOfRow(s.rows.at(-1) ?? first);
    return {
      selectionId: file + "::" + text.slice(0, 200),
      file,
      text,
      lines: a != null && b != null ? { start: Math.min(a, b), end: Math.max(a, b) } : null,
      rect: rowRect(first),
    };
  }

  function ensureGrip(): void {
    if (grip) return;
    grip = document.createElement("button");
    grip.className = "prw-grip";
    grip.setAttribute("data-prw-tip", "Click to select a line · drag to select a range");
    grip.setAttribute("aria-label", "Select line");
    // eslint-disable-next-line no-unsanitized/property -- static icon markup: svgIcon() wraps a literal path string, no dynamic input.
    grip.innerHTML = svgIcon('<path d="M4 9h16M4 15h16"/>');
    grip.style.display = "none";
    document.body.append(grip);
    grip.addEventListener("mousedown", onGripDown);
  }
  function ensureAskBtn(): HTMLDivElement {
    if (!askBtn) {
      askBtn = document.createElement("div"); // a bar holding 1-2 chat icons
      askBtn.className = "prw-askbar";
      askBtn.style.display = "none";
      document.body.append(askBtn);
    }
    return askBtn;
  }

  function showGripAt(row: Element, container: Element, line: number): void {
    ensureGrip();
    if (!grip) return;
    const r = row.getBoundingClientRect();
    // Over the line-number gutter, so a vertical drag stays atop the diff rows.
    grip.style.left = `${r.left + 10}px`;
    grip.style.top = `${r.top + (r.height - 20) / 2}px`;
    grip.style.display = "flex";
    hoverInfo = { row, line, container };
  }

  function showAskBtn(rows: Element[]): void {
    const bar = ensureAskBtn();
    bar.innerHTML = "";
    const mk = (title: string, withStep: boolean, cls?: string) => {
      const b = document.createElement("button");
      b.className = "prw-askbtn" + (cls ? " " + cls : "");
      b.setAttribute("data-prw-tip", title); // fast custom tooltip
      b.setAttribute("aria-label", title);
      // eslint-disable-next-line no-unsanitized/property -- static icon markup: BUBBLE is a compile-time-constant path string.
      b.innerHTML = svgIcon(BUBBLE);
      b.addEventListener("click", () => {
        const p = sel && payloadFor(sel);
        if (!p) return;
        bar.style.display = "none";
        bifrost.report("selection:ask", { ...p, withStep });
      });
      bar.append(b);
    };
    // Order left→right: context chat on the left, plain chat always rightmost.
    if (hasActiveStep) mk("Ask about these lines — with the current step's context", true, "prw-askbtn-ctx");
    mk("Ask about these lines — plain chat", false);
    const r = rowRect(rows[0] ?? null);
    bar.style.top = `${r.top + (r.height - 22) / 2}px`;
    bar.style.display = "flex";
    // Sit in the empty left margin, ending just before the line-number gutter, so
    // it never covers GitHub's hover "+" (in the gutter) or the code (to the right).
    const bw = bar.offsetWidth || 52;
    bar.style.left = `${Math.max(6, r.left - bw - 8)}px`;
  }

  function onGripDown(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (!hoverInfo) return;
    bifrost.send("pick:clear", undefined); // a new selection replaces the previous one
    document.body.classList.add("prw-noselect");
    globalThis.getSelection?.()?.removeAllRanges?.();
    const container = hoverInfo.container;
    const startRow = hoverInfo.row;
    const bands = rowBandsOf(container);
    picking = true;
    if (grip) grip.style.display = "none";
    highlightRows([startRow]);
    const move = (ev: MouseEvent) => {
      ev.preventDefault();
      // Resolve the row at the cursor's Y and select the DOM range between it and
      // the start row — order-based, so deleted/added/mixed spans all work.
      const row = rowAtY(bands, ev.clientY, startRow);
      if (row && container.contains(row)) highlightRows(rowsBetween(container, startRow, row));
    };
    const up = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.classList.remove("prw-noselect");
      let endRow = rowAtY(bands, ev.clientY, startRow);
      if (!endRow || !container.contains(endRow)) endRow = startRow;
      const rows = rowsBetween(container, startRow, endRow);
      picking = false;
      sel = { container, rows }; // selection set — but don't open chat
      highlightRows(rows);
      const p = payloadFor(sel);
      if (p) bifrost.report("selection:completed", p);
      showAskBtn(rows); // chat icon to ask
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  document.addEventListener("mouseover", (e) => {
    if (picking) return; // mid-drag
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    if (grip && (target === grip || grip.contains(target))) return;
    if (askBtn && (target === askBtn || askBtn.contains(target))) return;
    const row = target.closest("tr.diff-line-row");
    if (row) {
      const container = diffContainerOf(row);
      const line = lineOfRow(row);
      if (container && line != null) showGripAt(row, container, line);
    } else if (grip && !target.closest('[id^="diff-"]')) {
      grip.style.display = "none";
    }
  });
}
