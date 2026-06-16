// The Midgard controller: every WRITE to GitHub's page lives here — painting the
// walkthrough (kvasir-line) and selection (kvasir-pick) highlights onto GitHub's rows,
// and scrolling/jumping the diff. The ./diff readers stay pure; Asgard (the panel
// UI) must never touch the page directly. When the Bifrost lands, these become
// the handlers behind its commands.

import {
  cleanLine,
  containerForFile,
  filePathFromContainer,
  rowForLine,
  rowForText,
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

export const clearHL = (): void => {
  for (const r of document.querySelectorAll("tr.kvasir-line")) r.classList.remove("kvasir-line");
};

// Unrendered (lazy) lines resolve to null and are skipped; dedupe as we go.
function rowsByLines(cont: Element, lines: { start: number; end: number }): Element[] {
  const rows: Element[] = [];
  for (let n = lines.start; n <= lines.end; n++) {
    const r = rowForLine(cont, n);
    if (r && !rows.includes(r)) rows.push(r);
  }
  return rows;
}
function rowsByText(cont: Element, texts: string[]): Element[] {
  const rows: Element[] = [];
  for (const t of texts) {
    const r = rowForText(cont, t);
    if (r && !rows.includes(r)) rows.push(r);
  }
  return rows;
}

// Prefer the spec's exact line range; fall back to substring matches. Robust to
// GitHub's lazy rendering — unrendered lines resolve to null and are skipped.
export function highlightStep(step: HighlightableStep): Element[] {
  clearHL();
  const cont = document.getElementById(step.anchor);
  if (!cont) return [];
  let rows = step.lines ? rowsByLines(cont, step.lines) : [];
  if (rows.length === 0 && Array.isArray(step.highlight)) rows = rowsByText(cont, step.highlight);
  for (const r of rows) r.classList.add("kvasir-line");
  return rows;
}

export const clearPick = (): void => {
  for (const r of document.querySelectorAll("tr.kvasir-pick")) r.classList.remove("kvasir-pick");
};

export function highlightRows(rows: Element[]): void {
  clearPick();
  for (const r of rows) r.classList.add("kvasir-pick");
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
  for (let index = 0; index + want.length <= rows.length; index++) {
    let ok = true;
    for (const [k, element] of want.entries()) {
      const row = rows[index + k];
      if (!row || cleanLine(row) !== element) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const span = rows.slice(index, index + want.length);
      highlightRows(span);
      return span;
    }
  }
  return [];
}

/** Viewport bounds of the whole step range: the top of the first row, the bottom
 * of the last, and the viewport height — so we judge the entire span, not one row. */
function rangeBounds(rows: Element[]): { top: number; bottom: number; vh: number } {
  const first = rows[0];
  const last = rows.at(-1);
  /* v8 ignore next 2 */ // callers always pass a non-empty range; the 0 fallbacks are index-narrows only
  const top = first ? first.getBoundingClientRect().top : 0;
  const bottom = last ? last.getBoundingClientRect().bottom : 0;
  return { top, bottom, vh: window.innerHeight || document.documentElement.clientHeight || 0 };
}

/** True when the whole step range is already on screen, so re-issuing the jump
 * (pressing the button again) shouldn't re-scroll. `overlay` is the height of any
 * sticky bar covering the top of the viewport: a row tucked under it is NOT
 * visible. A range taller than the usable height can never fully fit, so for it
 * "anchored just below the bar" counts as in view. */
function rowsInView(rows: Element[], overlay: number): boolean {
  const { top, bottom, vh } = rangeBounds(rows);
  const view = vh - overlay; // usable height below the sticky bar
  if (bottom - top > view) return top >= overlay && top <= overlay + view * 0.15;
  return top >= overlay && bottom <= vh;
}

/** Bring a row range into view, but ONLY if it isn't already — centered when it
 * fits the usable viewport, top-aligned (offset past the sticky bar) when taller.
 * Shared by the walkthrough step jump and the chat citation jump so both no-op
 * when the target is on screen instead of doing a jarring re-scroll. */
function scrollRowsIntoView(rows: Element[], cont: Element): void {
  const doScroll = (): void => {
    const overlay = stickyOverlayHeight(cont, 0);
    if (rowsInView(rows, overlay)) return;
    const { top, bottom, vh } = rangeBounds(rows);
    const fits = bottom - top <= vh - overlay;
    const target = rows[fits ? Math.floor(rows.length / 2) : 0];
    /* v8 ignore next */ // rows is always non-empty here (callers guard) — index-narrow only
    if (!target) return;
    if (!fits && overlay && target instanceof HTMLElement) {
      target.style.scrollMarginTop = `${overlay}px`;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      // scrollIntoView consumes scroll-margin synchronously; clear it so the value
      // doesn't outlive this jump on GitHub's row (misplacing later native scrolls).
      target.style.scrollMarginTop = "";
    } else {
      target.scrollIntoView({ behavior: "smooth", block: fits ? "center" : "start" });
    }
  };
  doScroll();
  // GitHub lazy-renders diffs, so content can grow above/below right after the
  // jump and shove the target off-screen (you land at the bottom, file is way up).
  // Re-seat for ~1s, but STOP as soon as it's on screen so we don't fight the
  // user's own scrolling once it has settled.
  let tries = 0;
  const settle = (): void => {
    if (!cont.isConnected || rowsInView(rows, stickyOverlayHeight(cont, 0))) return;
    doScroll();
    if (++tries < 6) setTimeout(settle, 150);
  };
  setTimeout(settle, 150);
}

/** GitHub doesn't render large diffs until you click "Load Diff" ("Large diffs
 * are not rendered by default"), so a step's rows never exist. Click that control
 * inside the file's container if present, returning whether we did — the caller
 * keeps polling until the rows render. */
function loadDiffIfPresent(cont: Element): boolean {
  const button = [...cont.querySelectorAll('button, a, [role="button"]')].find((element) =>
    /load diff/i.test(element.textContent ?? ""),
  );
  if (!(button instanceof HTMLElement)) return false;
  button.click();
  return true;
}

// Bring a step onto screen, then highlight. Most files are already rendered, so
// this lands on the first try; a lazy/collapsed or "Load Diff" file makes us poll
// (clicking Load Diff to force the render) until the rows appear (~1.6s). Already-
// on-screen rows just (re)paint — no scroll — so a repeat press is a no-op.
let showGeneration = 0;
export function showStep(step: HighlightableStep): void {
  const generation = ++showGeneration; // a newer showStep/clear cancels this loop's retries
  let tries = 0;
  const run = () => {
    if (generation !== showGeneration) return;
    const cont = document.getElementById(step.anchor);
    const rows = highlightStep(step);
    if (cont && rows.length > 0) {
      scrollRowsIntoView(rows, cont);
      return;
    }
    // rows absent — force the file to render: click its "Load Diff" if shown, and
    // bring the container into view (a still-virtualized file mounts on approach).
    if (cont) {
      loadDiffIfPresent(cont);
      cont.scrollIntoView({ block: "start" });
    }
    if (++tries < 40) setTimeout(run, 40);
  };
  run();
}

// Find a diff container by a cited path, tolerating short/long path variants.
export function containerForFileLoose(file: string): Element | null {
  const exact = containerForFile(file);
  if (exact) return exact;
  const matches: Array<{ element: Element; path: string }> = [];
  for (const element of document.querySelectorAll('[id^="diff-"]')) {
    const path = filePathFromContainer(element);
    if (path && (path === file || path.endsWith("/" + file) || file.endsWith("/" + path))) {
      matches.push({ element, path });
    }
  }
  if (matches.length <= 1) return matches[0]?.element ?? null;
  // More than one file loosely matches (e.g. two paths sharing a basename). Prefer
  // the most specific (longest) path; if two are equally specific it's genuinely
  // ambiguous — return null so the caller treats it as missing rather than silently
  // scrolling to the wrong file.
  const maxLength = Math.max(...matches.map((m) => m.path.length));
  const longest = matches.filter((m) => m.path.length === maxLength);
  const only = longest.length === 1 ? longest[0] : undefined; // undefined when it's a tie
  return only?.element ?? null;
}

// Scroll the diff to a cited path:line(-end) and highlight it. Returns false when
// the cited file isn't in this PR's diff, so callers can fall back.
/** The nearest scrollable ancestor — GitHub's /changes UI scrolls diffs in an
 * inner container, where window scrolling is a no-op. Null = the window scrolls. */
function scrollParentOf(element: Element): Element | null {
  for (let p = element.parentElement; p; p = p.parentElement) {
    if (/auto|scroll|overlay/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight)
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
      if (!cont.isConnected) return; // SPA nav detached the container — stop seating
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
  // Poll until the cited line's rows exist: a large diff needs its "Load Diff"
  // clicked and a virtualized file mounts on approach. Returns true regardless
  // (the file IS in the diff); the highlight lands once the rows render.
  let tries = 0;
  const land = (): void => {
    if (!cont.isConnected) return; // the file (or page) went away — stop retrying
    const single = rowForLine(cont, start);
    const singleRows = single ? [single] : [];
    const rows = end ? rowsInRange(cont, start, end) : singleRows;
    if (rows.length > 0) {
      highlightRows(rows);
      scrollRowsIntoView(rows, cont); // no-op when the cited line is already on screen
      return;
    }
    loadDiffIfPresent(cont);
    cont.scrollIntoView({ block: "start" });
    if (++tries < 40) setTimeout(land, 40);
  };
  land();
  return true;
}
