// The review guide — Asgard's side of a pushed cross-repo review. Implements the
// same Guide contract as the walkthrough (tour), so the panel and chat treat it
// identically. The one thing it does differently is reveal a step: there's no PR
// diff on the page, so it NAVIGATES the tab to the step's GitHub blob URL and lets
// GitHub's native #L highlight land it (each step may be in a different repo).
// State (which review, which step) is re-derived on every page load from ?kvasir +
// stored step, because that navigation is a full page load that re-runs boot.
import { isReview, type Review, type ReviewStep, stepBlobUrl } from "@kvasir/runes/review";
import { api, isUnreachable } from "../api";
import { reviewIdFromUrl, reviewKey, reviewSessionKey } from "../keys";
import { storeGet, storeSet } from "../muninn";
import { chatStore } from "./chat";
import { registerGuide } from "./guide";
import { awaitSoftNav, softNavigate } from "./lib/nav";
import { clampIndex, guideBackgroundText, stepContextText, whereText } from "./lib/stepText";
import { stripHtml } from "./lib/strip";
import { pairingStore } from "./pairing";
import { parseReviewCache } from "./persisted";
import { panelStore, PANEL_TABS, settingsStore, state, touch } from "./store";

/** Snapshot the destination review (content + step + visited dots) to sessionStorage
 * (sync, survives the same-origin nav) so the next page renders it on first paint.
 * Panel geometry is NOT here — it lives in the per-tab panel state (store.hydratePanel). */
const writeSession = (id: string, step: number, review: Review): void => {
  try {
    sessionStorage.setItem(
      reviewSessionKey(id),
      JSON.stringify({ step, review, visited: state.reviewVisited }),
    );
  } catch {
    // sessionStorage unavailable — the async chrome.storage cache still covers it
  }
};

/** Marks a step's outline dot visited the moment it becomes the current step — at
 * goto() call time (not page arrival) and on the step a load settles on. */
const markVisited = (step: ReviewStep | undefined): void => {
  if (step && !state.reviewVisited.includes(step.id)) {
    state.reviewVisited = [...state.reviewVisited, step.id];
  }
};

/** Show a review: store it, clamp the step into range, open the panel on the step tab. */
const applyReview = (review: Review): void => {
  // A re-pushed review (new generatedAt) starts its visited dots fresh; refreshing
  // the same generation keeps them. Eager reset, not the tour's read-time stamp:
  // reviewVisited is only ever assigned TOGETHER with the review it was persisted
  // against (one cache/snapshot object), so pairing holds by construction — but
  // that means restores must assign visited AFTER this runs, never before.
  if (state.review && state.review.generatedAt !== review.generatedAt) state.reviewVisited = [];
  state.review = review;
  state.reviewStep = clampIndex(state.reviewStep, review.steps.length);
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
    const { step, review, visited } = parseReviewCache(parsed);
    if (!review) return;
    // Panel geometry comes from the per-tab panel state (store.hydratePanel, run
    // first in boot); here we only restore the review content + open it. Keep the
    // hydrated tab when it's History (a History jump), else show the review.
    state.review = review;
    state.reviewStep = clampIndex(step, review.steps.length);
    state.reviewVisited = visited;
    state.panel.open = true;
    if (state.panel.tab !== PANEL_TABS.HISTORY) state.panel.tab = PANEL_TABS.WALKTHROUGH;
  },
  steps: (): ReviewStep[] => state.review?.steps ?? [],
  /** Why a ?kvasir link produced nothing (see state.reviewMissing), or null. */
  missing: (): "notfound" | null => state.reviewMissing,
  dismissMissing(): void {
    state.reviewMissing = null;
    touch();
  },
  stepIndex: (): number => state.reviewStep,
  /** Whether a step's outline dot shows visited (see state.reviewVisited). */
  isVisited: (stepId: string): boolean => state.reviewVisited.includes(stepId),
  /** Step-nav gating shared by the buttons and the arrow keys: within bounds AND
   * no cross-file navigation in flight (keys must not stack a second one). */
  canNext: (): boolean =>
    !state.reviewNavigating && state.review !== null && state.reviewStep < state.review.steps.length - 1,
  canBack: (): boolean => !state.reviewNavigating && state.reviewStep > 0,
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
    if (cache.review) {
      applyReview(cache.review);
      // AFTER applyReview: the cached visited list was written with cache.review in
      // one object, so it is valid for that review no matter what generation a
      // sessionStorage hydrate (per-tab, possibly older) left in state.review.
      state.reviewVisited = cache.visited;
      markVisited(state.review?.steps[state.reviewStep]); // the landing step counts as seen
    }
    // …then refresh from the mailbox and re-cache. A failed fetch (e.g. daemon
    // restarted) leaves the cached walk in place.
    const r = await api(`/review?id=${encodeURIComponent(id)}`);
    if (r.ok && isReview(r.data)) {
      state.reviewMissing = null;
      applyReview(r.data);
      markVisited(state.review?.steps[state.reviewStep]); // the landing step counts as seen
      storeSet(reviewKey(id), { step: state.reviewStep, review: r.data, visited: state.reviewVisited });
    } else if (!state.review) {
      // Neither the cache nor the mailbox produced a walk — the link must not die
      // silently. An unreachable channel is the connection banner's story (recheck
      // tells "start the channel" apart from "refresh the page"), so just refresh
      // it; anything the channel answered (404, invalid payload) means this machine
      // doesn't have the walkthrough — the link is machine-local, say so.
      if (isUnreachable(r)) void pairingStore.recheck();
      else state.reviewMissing = "notfound";
      panelStore.open(PANEL_TABS.WALKTHROUGH);
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
    const target = clampIndex(index, review.steps.length);
    const step = review.steps[target]!; // clamp keeps target in range; min(1) guarantees a step
    const id = review.id ?? "";
    markVisited(step); // the dot marks on the jump, not on page arrival (mirrors the tour)
    storeSet(reviewKey(id), { step: target, review, visited: state.reviewVisited }); // cache the destination

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
    return guideBackgroundText(
      `Review: ${state.review.title}\n\n`,
      state.review.steps.map((s) => ({
        title: s.title,
        where: whereText(`${s.repo.owner}/${s.repo.name}/${s.file}`, s.lines),
        body: s.body,
      })),
    );
  },
  stepContext(): string {
    const s = reviewStore.step();
    if (!s) return "";
    return stepContextText({ title: s.title, where: whereText(s.file, s.lines), body: s.body });
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

// Self-registration keeps guide.ts import-free of the stores (see its registry
// comment): chat calls into activeGuide() while this store calls into chatStore,
// and a direct import in guide.ts would close that ESM cycle.
registerGuide(reviewStore);
