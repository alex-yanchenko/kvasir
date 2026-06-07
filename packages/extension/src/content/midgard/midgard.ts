// The Midgard controller: every WRITE to GitHub's page lives here — painting the
// walkthrough (prw-line) and selection (prw-pick) highlights onto GitHub's rows,
// and scrolling/jumping the diff. The ./diff readers stay pure; Asgard (the panel
// UI) must never touch the page directly. When the Bifrost lands, these become
// the handlers behind its commands.

import {
  cleanLine,
  codeForRows,
  containerForFile,
  filePathFromContainer,
  rowForLine,
  rowForText,
  rowRect,
  rowsInRange,
  rowsOf,
} from "./diff";

// The subset of a Runes WalkthroughStep the highlighter needs.
interface HighlightableStep {
  anchor: string;
  lines?: { start: number; end: number } | null;
  highlight?: string[] | null;
}

// The subset of a chat session the re-highlighter needs. It caches the resolved
// container back onto the session (legacy behavior kept verbatim for the pure
// move — goes away when sessions become data-only and DOM stops crossing layers).
interface RehighlightableSession {
  container?: Element | null;
  file?: string | null;
  text?: string | null;
}

export const clearHL = (): void =>
  document.querySelectorAll("tr.prw-line").forEach((r) => r.classList.remove("prw-line"));

// Prefer the spec's exact line range; fall back to substring matches. Robust to
// GitHub's lazy rendering — unrendered lines resolve to null and are skipped.
export function highlightStep(step: HighlightableStep): Element[] {
  clearHL();
  const cont = document.getElementById(step.anchor);
  if (!cont) return [];
  const rows: Element[] = [];
  if (step.lines) {
    const { start, end } = step.lines;
    for (let n = start; n <= end; n++) {
      const r = rowForLine(cont, n);
      if (r && !rows.includes(r)) rows.push(r);
    }
  }
  if (!rows.length && Array.isArray(step.highlight)) {
    step.highlight.forEach((t) => {
      const r = rowForText(cont, t);
      if (r && !rows.includes(r)) rows.push(r);
    });
  }
  rows.forEach((r) => r.classList.add("prw-line"));
  return rows;
}

export const clearPick = (): void =>
  document.querySelectorAll("tr.prw-pick").forEach((r) => r.classList.remove("prw-pick"));

export function highlightRows(rows: Element[]): void {
  clearPick();
  rows.forEach((r) => r.classList.add("prw-pick"));
}

// Re-paint a stored selection by matching its code text against the live rows —
// side-agnostic, so it works for added, deleted, or mixed selections. Returns the
// rows it painted so callers (the pick:rehighlight handler) can scroll to them.
export function rehighlightSession(s: RehighlightableSession): Element[] {
  const container = s.container && s.container.isConnected ? s.container : containerForFile(s.file);
  if (!container || !s.text) return [];
  s.container = container;
  const want = s.text.split("\n");
  const rows = rowsOf(container);
  for (let i = 0; i + want.length <= rows.length; i++) {
    let ok = true;
    for (let k = 0; k < want.length; k++) {
      if (cleanLine(rows[i + k]) !== want[k]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const span = rows.slice(i, i + want.length);
      highlightRows(span);
      return span;
    }
  }
  return [];
}

// Bring a step onto screen: scroll its file in, then highlight as soon as the
// rows exist. Most files are already rendered, so this lands on the first try;
// only a still-lazy-loading file makes us poll, and only until it appears.
export function showStep(step: HighlightableStep): void {
  const cont = document.getElementById(step.anchor);
  if (cont) cont.scrollIntoView({ block: "start" });
  let tries = 0;
  const tryHighlight = () => {
    const rows = highlightStep(step);
    if (rows.length) {
      rows[0].scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (++tries < 20) {
      setTimeout(tryHighlight, 40); // up to ~0.8s, only if the file isn't there yet
    }
  };
  tryHighlight();
}

// Find a diff container by a cited path, tolerating short/long path variants.
export function containerForFileLoose(file: string): Element | null {
  const exact = containerForFile(file);
  if (exact) return exact;
  for (const el of document.querySelectorAll('[id^="diff-"]')) {
    const p = filePathFromContainer(el);
    if (p && (p === file || p.endsWith("/" + file) || file.endsWith("/" + p))) return el;
  }
  return null;
}

// Scroll the diff to a cited path:line(-end) and highlight it. Returns false when
// the cited file isn't in this PR's diff, so callers can fall back.
/** The nearest scrollable ancestor — GitHub's /changes UI scrolls diffs in an
 * inner container, where window scrolling is a no-op. Null = the window scrolls. */
function scrollParentOf(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight)
      return p;
  }
  return null;
}

/** Height of whatever sticky bar overlays a header parked at `top`. Measured
 * live: GitHub's sticky toolbars vary by UI variant and only engage at scroll
 * depth — near the top nothing overlays, and the right seat is 0. Ancestors of
 * the container (the scroller itself) are layout, not overlay — ignored. */
function stickyOverlayHeight(cont: Element, top: number): number {
  const r = cont.getBoundingClientRect();
  const probe = document.elementFromPoint?.(r.left + 24, top + 2);
  if (!probe || cont.contains(probe) || probe.contains(cont)) return 0;
  return Math.min(Math.max(probe.getBoundingClientRect().bottom - top, 0), 150);
}

export function jumpToRef(file: string, start: number | null, end: number | null): boolean {
  const cont = containerForFileLoose(file);
  if (!cont) return false;
  if (start === null) {
    // A bare file mention — land the file header at the top of the viewport.
    // GitHub lazy-renders diffs, so content above keeps growing for a while
    // after the first jump and a one-shot correction lands short. Re-seat the
    // header every 120ms (~1s total) until the layout stops moving under us.
    cont.scrollIntoView({ block: "start" });
    let tries = 0;
    const seat = (): void => {
      const sp = scrollParentOf(cont);
      const target = sp ? Math.max(sp.getBoundingClientRect().top, 0) : 0;
      const off = cont.getBoundingClientRect().top - target - stickyOverlayHeight(cont, target);
      if (Math.abs(off) > 4) {
        if (sp) sp.scrollTop += off;
        else window.scrollBy(0, off);
      }
      // an inner scroller sitting below the PR header: scroll the window too so
      // the header leaves the screen and the file truly tops the viewport
      if (sp) {
        const flush = sp.getBoundingClientRect().top;
        if (flush > 4) window.scrollBy(0, flush);
      }
      if (++tries < 8) setTimeout(seat, 120);
    };
    seat();
    return true;
  }
  cont.scrollIntoView({ block: "start" }); // GitHub lazy-renders; bring the file in first
  const single = rowForLine(cont, start);
  const rows = end ? rowsInRange(cont, start, end) : single ? [single] : [];
  if (rows.length) {
    highlightRows(rows);
    rows[0].scrollIntoView({ behavior: "smooth", block: "center" });
  } else {
    cont.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  return true;
}

// Query: the rendered code + anchor rect for a step's rows, if the file is on
// the page. Pure read — Asgard composes its own fallbacks when this is null.
export function stepCode(step: HighlightableStep): { text: string; rect: ReturnType<typeof rowRect> } | null {
  const container = document.getElementById(step.anchor);
  const rows = container && step.lines ? rowsInRange(container, step.lines.start, step.lines.end) : [];
  if (!rows.length) return null;
  return { text: codeForRows(rows), rect: rowRect(rows[0]) };
}
