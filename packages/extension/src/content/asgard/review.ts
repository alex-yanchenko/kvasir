// The review guide — Asgard's side of a pushed cross-repo review. Implements the
// same Guide contract as the walkthrough (tour), so the panel and chat treat it
// identically. The one thing it does differently is reveal a step: there's no PR
// diff on the page, so it NAVIGATES the tab to the step's GitHub blob URL and lets
// GitHub's native #L highlight land it (each step may be in a different repo).
// State (which review, which step) is re-derived on every page load from ?prw +
// stored step, because that navigation is a full page load that re-runs boot.
import { isReview, type Review, type ReviewStep, stepBlobUrl } from "@prw/runes/review";
import { api } from "../api";
import { reviewKey } from "../keys";
import { storeGet, storeSet } from "../muninn";
import { chatStore } from "./chat";
import { parseReviewCache } from "./persisted";
import { panelStore, PANEL_TABS, state, touch } from "./store";

const clamp = (index: number, length: number): number => Math.min(Math.max(index, 0), length - 1);

/** Show a review: store it, clamp the step into range, open the panel on the step tab. */
const applyReview = (review: Review): void => {
  state.review = review;
  state.reviewStep = clamp(state.reviewStep, review.steps.length);
  state.reviewOpen = true;
  panelStore.open(PANEL_TABS.WALKTHROUGH);
};
const strip = (html: string): string =>
  html
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();

export const reviewStore = {
  kind: "review" as const,
  isOpen: (): boolean => state.reviewOpen,
  navigating: (): boolean => state.reviewNavigating,
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
    const samePage = decodeURIComponent(url.pathname) === decodeURIComponent(globalThis.location.pathname);
    if (!id || samePage) {
      state.reviewStep = target;
      if (id) globalThis.location.hash = url.hash;
      touch();
      return;
    }
    state.reviewNavigating = true;
    touch();
    setTimeout(() => globalThis.location.assign(url.href), 0);
  },
  next(): void {
    if (state.review && state.reviewStep < state.review.steps.length - 1)
      reviewStore.goto(state.reviewStep + 1);
  },
  back(): void {
    if (state.reviewStep > 0) reviewStore.goto(state.reviewStep - 1);
  },
  close(): void {
    state.reviewOpen = false;
    touch();
  },

  // ── Guide ──────────────────────────────────────────────────────────────────
  backgroundContext(): string {
    if (!state.review) return "";
    const head = `Review: ${state.review.title}\n\n`;
    const steps = state.review.steps
      .map((s) => {
        const lineSuffix = s.lines ? `:${s.lines.start}-${s.lines.end}` : "";
        return `• ${s.title} (${s.repo.owner}/${s.repo.name}/${s.file}${lineSuffix})\n  ${strip(s.body)}`;
      })
      .join("\n");
    return (head + steps).slice(0, 12_000);
  },
  stepContext(): string {
    const s = reviewStore.step();
    if (!s) return "";
    const lineSuffix = s.lines ? `:${s.lines.start}-${s.lines.end}` : "";
    return `Step: ${s.title} (${s.file}${lineSuffix})\n${strip(s.body)}`;
  },
  askAboutStep(): void {
    const s = reviewStore.step();
    if (!s) return;
    const text = strip(s.body).slice(0, 1000) || (s.highlight ?? []).join("\n");
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
