// Review history — the client side of the durable mailbox. Fetches GET /reviews
// (summaries) so you can browse and reopen past pushed reviews by their term
// (title), instead of tracking ?prw= links. Caches the list in chrome.storage for
// instant paint; the backend store is the source of truth.
import { isReviewSummaryList, type ReviewSummary } from "@prw/runes/review";
import { api } from "../api";
import { REVIEWS_KEY } from "../keys";
import { storeGet, storeSet } from "../muninn";
import { state, touch } from "./store";

/** Pull the summary list out of the bridge's { reviews: [...] } envelope. */
const reviewsFromResponse = (data: unknown): ReviewSummary[] | null => {
  if (typeof data !== "object" || data === null || !("reviews" in data)) return null;
  return isReviewSummaryList(data.reviews) ? data.reviews : null;
};

export const reviewsStore = {
  /** The loaded list, or null before the first load completes. */
  all: (): ReviewSummary[] | null => state.reviews,
  query: (): string => state.reviewsQuery,
  setQuery(value: string): void {
    state.reviewsQuery = value;
    touch();
  },
  /** The list filtered by the search term (title · source · repos). */
  filtered(): ReviewSummary[] {
    const list = state.reviews ?? [];
    const term = state.reviewsQuery.trim().toLowerCase();
    if (!term) return list;
    return list.filter((review) =>
      `${review.title} ${review.source ?? ""} ${review.repos.join(" ")}`.toLowerCase().includes(term),
    );
  },
  /** Paint from cache (if any), then refresh from the bridge and re-cache. */
  async load(): Promise<void> {
    const cached = reviewsFromCache(await storeGet(REVIEWS_KEY));
    if (cached) {
      state.reviews = cached;
      touch();
    }
    const response = await api("/reviews");
    if (!response.ok) return;
    const fresh = reviewsFromResponse(response.data);
    if (fresh) {
      state.reviews = fresh;
      storeSet(REVIEWS_KEY, fresh);
      touch();
    }
  },
  /** Open a review from its history row — a full load into review-mode. */
  open(url: string): void {
    globalThis.location.assign(url);
  },
};

const reviewsFromCache = (cached: unknown): ReviewSummary[] | null =>
  isReviewSummaryList(cached) ? cached : null;
