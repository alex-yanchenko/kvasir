// The review guide — Asgard's side of a pushed cross-repo review. Implements the
// same Guide contract as the walkthrough (tour), so the panel and chat treat it
// identically. The one thing it does differently is reveal a step: there's no PR
// diff on the page, so it NAVIGATES the tab to the step's GitHub blob URL and lets
// GitHub's native #L highlight land it (each step may be in a different repo).
// State (which review, which step) is re-derived on every page load from ?kvasir +
// stored step, because that navigation is a full page load that re-runs boot.
import { isReview, type Review, type ReviewStep, stepBlobUrl } from "@kvasir/runes/review";
import { api } from "../api";
import { reviewIdFromUrl, reviewKey, reviewSessionKey } from "../keys";
import { storeGet, storeSet } from "../muninn";
import { chatStore } from "./chat";
import { awaitSoftNav, softNavigate } from "./lib/nav";
import { stripHtml } from "./lib/strip";
import { parseReviewCache } from "./persisted";
import { panelStore, PANEL_TABS, settingsStore, state, touch } from "./store";

const clamp = (index: number, length: number): number => Math.min(Math.max(index, 0), length - 1);

/** Snapshot the destination review (content + step) to sessionStorage (sync,
 * survives the same-origin nav) so the next page renders it on first paint. Panel
 * geometry is NOT here — it lives in the per-tab panel state (store.hydratePanel). */
const writeSession = (id: string, step: number, review: Review): void => {
  try {
    sessionStorage.setItem(reviewSessionKey(id), JSON.stringify({ step, review }));
  } catch {
    // sessionStorage unavailable — the async chrome.storage cache still covers it
  }
};

/** Show a review: store it, clamp the step into range, open the panel on the step tab. */
const applyReview = (review: Review): void => {
  state.review = review;
  state.reviewStep = clamp(state.reviewStep, review.steps.length);
  // A History jump leaves the hydrated tab on History (so the next pick is one click
  // away); a direct ?kvasir open shows the review on the Walkthrough tab.
  panelStore.open(state.panel.tab === PANEL_TABS.HISTORY ? PANEL_TABS.HISTORY : PANEL_TABS.WALKTHROUGH);
};

/** "/owner/repo" prefix of a blob pathname — same value ⇒ same repo (GitHub will
 * soft-navigate within it; across repos it's a full load). */
const repoPath = (pathname: string): string =>
  "/" + decodeURIComponent(pathname).split("/").filter(Boolean).slice(0, 2).join("/");

export const reviewStore = {
  kind: "review" as const,
  navigating: (): boolean => state.reviewNavigating,

  /** Synchronously populate review-mode state from the sessionStorage snapshot the
   * previous page wrote before navigating — runs in boot BEFORE React mounts, so
   * the panel's FIRST paint already has the right step + geometry (no async pop-in
   * / window blink). A miss (new tab, opened link directly) just falls through to
   * the async load() below. */
  hydrate(): void {
    const id = reviewIdFromUrl();
    if (!id) return;
    let parsed: unknown;
    try {
      const raw = sessionStorage.getItem(reviewSessionKey(id));
      if (!raw) return;
      parsed = JSON.parse(raw);
    } catch {
      return; // no/garbled/unavailable snapshot — fall back to the async load()
    }
    const { step, review } = parseReviewCache(parsed);
    if (!review) return;
    // Panel geometry comes from the per-tab panel state (store.hydratePanel, run
    // first in boot); here we only restore the review content + open it. Keep the
    // hydrated tab when it's History (a History jump), else show the review.
    state.review = review;
    state.reviewStep = clamp(step, review.steps.length);
    state.panel.open = true;
    if (state.panel.tab !== PANEL_TABS.HISTORY) state.panel.tab = PANEL_TABS.WALKTHROUGH;
  },
  steps: (): ReviewStep[] => state.review?.steps ?? [],
  stepIndex: (): number => state.reviewStep,
  stepCount: (): number => state.review?.steps.length ?? 0,
  step: (): ReviewStep | null => state.review?.steps[state.reviewStep] ?? null,
  title: (): string => state.review?.title ?? "",

  /** Boot/refresh in review-mode: restore the saved step, pull the review from the
   * mailbox, and open the panel on the step tab. */
  async load(id: string): Promise<void> {
    state.reviewNavigating = false; // fresh page — clear any pending-nav flag
    // Render instantly from the cached walk (each goto caches it before navigating),
    // so the panel shows without waiting on the network…
    const cache = parseReviewCache(await storeGet(reviewKey(id)));
    state.reviewStep = cache.step;
    if (cache.review) applyReview(cache.review);
    // …then refresh from the mailbox and re-cache. A failed fetch (e.g. daemon
    // restarted) leaves the cached walk in place.
    const r = await api(`/review?id=${encodeURIComponent(id)}`);
    if (r.ok && isReview(r.data)) {
      applyReview(r.data);
      storeSet(reviewKey(id), { step: state.reviewStep, review: r.data });
    }
    touch();
  },

  /** Go to a step. Same file as the current page (or no link) → switch in place +
   * move GitHub's #L highlight. Different file → DON'T switch the panel here (that
   * would flash the next step on the current page); keep the current step + show
   * loading, cache the destination, and navigate — the target renders only after
   * the new page opens (its boot reads the cache). */
  goto(index: number): void {
    const review = state.review;
    if (!review) return;
    const target = clamp(index, review.steps.length);
    const step = review.steps[target]!; // clamp keeps target in range; min(1) guarantees a step
    const id = review.id ?? "";
    storeSet(reviewKey(id), { step: target, review }); // cache the destination

    const url = new URL(stepBlobUrl(step, id));
    const here = globalThis.location;
    if (!id || decodeURIComponent(url.pathname) === decodeURIComponent(here.pathname)) {
      // No link, or same file → switch in place; move GitHub's #L highlight.
      state.reviewStep = target;
      if (id) here.hash = url.hash;
      touch();
      return;
    }
    if (repoPath(url.pathname) === repoPath(here.pathname)) {
      // Same repo, different file → GitHub's router soft-navigates (no reload, our
      // panel survives). Synced (default): keep the current step + loading, advance
      // once the page lands. Instant: advance the panel immediately.
      softNavigate(url.href);
      if (settingsStore.reviewSync()) {
        state.reviewNavigating = true;
        touch();
        awaitSoftNav(decodeURIComponent(url.pathname), () => {
          state.reviewStep = target;
          state.reviewNavigating = false;
          touch();
        });
      } else {
        state.reviewStep = target;
        touch();
      }
      return;
    }
    // Different repo → a full load is unavoidable. Keep the current step + show
    // loading here; the new page hydrates to the target from the session snapshot.
    state.reviewNavigating = true;
    writeSession(id, target, review);
    touch();
    setTimeout(() => here.assign(url.href), 0);
  },
  next(): void {
    if (state.review && state.reviewStep < state.review.steps.length - 1)
      reviewStore.goto(state.reviewStep + 1);
  },
  back(): void {
    if (state.reviewStep > 0) reviewStore.goto(state.reviewStep - 1);
  },

  // ── Guide ──────────────────────────────────────────────────────────────────
  backgroundContext(): string {
    if (!state.review) return "";
    const head = `Review: ${state.review.title}\n\n`;
    const steps = state.review.steps
      .map((s) => {
        const lineSuffix = s.lines ? `:${s.lines.start}-${s.lines.end}` : "";
        return `• ${s.title} (${s.repo.owner}/${s.repo.name}/${s.file}${lineSuffix})\n  ${stripHtml(s.body)}`;
      })
      .join("\n");
    return (head + steps).slice(0, 12_000);
  },
  stepContext(): string {
    const s = reviewStore.step();
    if (!s) return "";
    const lineSuffix = s.lines ? `:${s.lines.start}-${s.lines.end}` : "";
    return `Step: ${s.title} (${s.file}${lineSuffix})\n${stripHtml(s.body)}`;
  },
  askAboutStep(): void {
    const s = reviewStore.step();
    if (!s) return;
    const text = stripHtml(s.body).slice(0, 1000) || (s.highlight ?? []).join("\n");
    chatStore.openSelection(
      {
        selectionId: `${s.file}::${text.slice(0, 200)}`,
        file: s.file,
        text,
        lines: s.lines ?? null,
        rect: { left: 60, top: 90, bottom: 114, height: 24 },
      },
      true,
    );
  },
};
