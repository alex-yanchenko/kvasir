// History — the client side of the durable store. Fetches GET /history (summaries
// of both kinds: PR Walkthroughs and Code Walkthroughs) so you can browse, reopen,
// and prune past artifacts by their term (title). Caches the list in chrome.storage
// for instant paint; the backend store is the source of truth. Drift: each entry
// carries a `version` the store bumps when its content changes; `seen` records the
// version the FE last opened/synced, so an entry whose backend version moved past
// `seen` is flagged for re-sync (and counted into the tab badge).
import { type EntrySummary, isEntrySummaryList } from "@kvasir/runes/history";
import { prKey } from "@kvasir/runes/prUrl";
import { api } from "../api";
import { HISTORY_KEY, isGithubHttpsUrl, reviewKey, SEEN_KEY, specKey } from "../keys";
import { storeGet, storeRemove, storeSet } from "../muninn";
import { friendlyError } from "./friendly";
import { state, touch } from "./store";

/** Drift of one entry vs what the FE last caught up to. */
type Drift = "new" | "current" | "update";

/** Sidebar facet narrowing the list. "stale" = entries whose backend version moved
 * past what we last synced. */
export const HISTORY_FACETS = ["all", "pr", "code", "stale"] as const;
export type HistoryFacet = (typeof HISTORY_FACETS)[number];

/** Pull the summary list out of the bridge's { entries: [...] } envelope. */
const entriesFromResponse = (data: unknown): EntrySummary[] | null => {
  if (typeof data !== "object" || data === null || !("entries" in data)) return null;
  return isEntrySummaryList(data.entries) ? data.entries : null;
};

const entriesFromCache = (cached: unknown): EntrySummary[] | null =>
  isEntrySummaryList(cached) ? cached : null;

const isSeenMap = (value: unknown): value is Record<string, number> =>
  typeof value === "object" &&
  value !== null &&
  Object.values(value).every((version) => typeof version === "number");

/** Persist the seen-version map and re-derive drift flags. */
const writeSeen = (next: Record<string, number>): void => {
  state.seen = next;
  storeSet(SEEN_KEY, next);
};

/** Why the last backend write (delete) failed — rendered above the list until
 * dismissed or a later write succeeds. Module-level like the machine's other
 * ephemera; never persisted. */
let lastError: string | null = null;

const matchesTerm = (entry: EntrySummary, term: string): boolean =>
  `${entry.title} ${entry.source ?? ""} ${entry.repos.join(" ")}`.toLowerCase().includes(term);

/** Drop an entry's per-tab/global render cache so a deleted walkthrough can't be
 * resurrected from cache on refresh/reopen (code → its review cache; pr → its spec
 * cache, keyed by the PR url the entry opens to, minus the `/files` suffix). */
const clearEntryCache = (entry: EntrySummary): void => {
  if (entry.kind === "code") storeRemove(reviewKey(entry.id));
  else storeRemove(specKey(entry.url.replace(/\/files$/, "")));
};

/** If the walkthrough THIS tab is viewing is no longer in the live list, it was
 * deleted (here or in another tab) — clear it and raise the "deleted" notice. */
const invalidateActiveGuide = (live: readonly EntrySummary[]): void => {
  const liveIds = new Set(live.map((entry) => entry.id));
  if (state.review && !liveIds.has(state.review.id ?? "")) {
    state.review = null;
    state.guideDeleted = true;
  }
  if (state.spec && !liveIds.has(prKey(state.spec.pr.url))) {
    state.spec = null;
    state.guideDeleted = true;
  }
};

export const historyStore = {
  /** The loaded list, or null before the first load completes. */
  all: (): EntrySummary[] | null => state.history,
  error: (): string | null => lastError,
  dismissError(): void {
    lastError = null;
    touch();
  },
  query: (): string => state.historyQuery,
  setQuery(value: string): void {
    state.historyQuery = value;
    touch();
  },
  facet: (): string => state.historyFacet,
  setFacet(value: HistoryFacet): void {
    state.historyFacet = value;
    touch();
  },

  /** The search-filtered list, before the sidebar facet — drives the facet counts so
   * they don't change as you switch facets. */
  searched(): EntrySummary[] {
    const list = state.history ?? [];
    const term = state.historyQuery.trim().toLowerCase();
    return term ? list.filter((entry) => matchesTerm(entry, term)) : list;
  },
  /** Per-facet counts over the search-filtered list, for the sidebar chips. */
  facetCounts(): { all: number; pr: number; code: number; stale: number } {
    const base = historyStore.searched();
    return {
      all: base.length,
      pr: base.filter((entry) => entry.kind === "pr").length,
      code: base.filter((entry) => entry.kind === "code").length,
      stale: base.filter((entry) => historyStore.driftFor(entry) === "update").length,
    };
  },

  /** The list filtered by the search term (title · source · repos) AND the facet. */
  filtered(): EntrySummary[] {
    const base = historyStore.searched();
    const facet = historyStore.facet();
    if (facet === "pr") return base.filter((entry) => entry.kind === "pr");
    if (facet === "code") return base.filter((entry) => entry.kind === "code");
    if (facet === "stale") return base.filter((entry) => historyStore.driftFor(entry) === "update");
    return base;
  },
  /** Filtered entries of each kind, for the two sections. */
  prItems: (): EntrySummary[] => historyStore.filtered().filter((entry) => entry.kind === "pr"),
  codeItems: (): EntrySummary[] => historyStore.filtered().filter((entry) => entry.kind === "code"),

  /** New (never opened) · update (backend moved past what we saw) · current. */
  driftFor(entry: EntrySummary): Drift {
    const seen = state.seen[entry.id];
    if (seen === undefined) return "new";
    return entry.version > seen ? "update" : "current";
  },
  /** How many loaded entries need a re-sync — drives the tab badge. */
  staleCount: (): number =>
    (state.history ?? []).filter((entry) => historyStore.driftFor(entry) === "update").length,

  /** Paint from cache (if any), then refresh from the bridge and re-cache. Also
   * loads the seen-version map so drift flags are correct on first paint. */
  async load(): Promise<void> {
    const seen = await storeGet(SEEN_KEY);
    if (isSeenMap(seen)) state.seen = seen;
    const cached = entriesFromCache(await storeGet(HISTORY_KEY));
    if (cached) {
      state.history = cached;
      touch();
    }
    const response = await api("/history");
    if (!response.ok) return;
    const fresh = entriesFromResponse(response.data);
    if (fresh) {
      state.history = fresh;
      storeSet(HISTORY_KEY, fresh);
      touch();
    }
  },

  /** Open an entry from its row — a full navigation. Marks it caught-up first
   * (opening always re-fetches fresh content from the bridge on the next page). */
  open(entry: EntrySummary): void {
    // Refuse to navigate anywhere but github.com — the only origin a stored entry
    // should point to. Guards against an off-origin url in the /history response.
    if (!isGithubHttpsUrl(entry.url)) return;
    writeSeen({ ...state.seen, [entry.id]: entry.version });
    // The panel's per-tab state (open + History tab) is already in sessionStorage, so
    // a same-tab navigation carries it — the next page opens on History automatically.
    globalThis.location.assign(entry.url);
  },

  /** Soft-delete on the backend, then drop it from the list + every cache, and
   * clear it if it's the walkthrough this tab is viewing. Other tabs react via the
   * HISTORY_KEY storage change (observeExternal). */
  async remove(id: string): Promise<void> {
    const entry = (state.history ?? []).find((row) => row.id === id);
    const response = await api(`/entry?id=${encodeURIComponent(id)}`, "DELETE");
    if (!response.ok) {
      lastError = friendlyError(response, "the delete didn't go through — try again");
      touch();
      return;
    }
    lastError = null;
    state.history = (state.history ?? []).filter((row) => row.id !== id);
    storeSet(HISTORY_KEY, state.history);
    if (entry) clearEntryCache(entry);
    const next = Object.fromEntries(Object.entries(state.seen).filter(([key]) => key !== id));
    writeSeen(next);
    invalidateActiveGuide(state.history);
    touch();
  },

  /** React to a cross-tab history change (chrome.storage.onChanged on HISTORY_KEY):
   * adopt the new list and drop the walkthrough this tab was viewing if it's gone. */
  observeExternal(rawList: unknown): void {
    const list = entriesFromCache(rawList);
    if (!list) return;
    state.history = list;
    invalidateActiveGuide(list);
    touch();
  },

  /** Acknowledge drift for one entry (clears its flag; content refreshes on open). */
  sync(id: string): void {
    const entry = (state.history ?? []).find((row) => row.id === id);
    if (!entry) return;
    writeSeen({ ...state.seen, [id]: entry.version });
    touch();
  },
  /** Acknowledge drift for every flagged entry at once. */
  syncAll(): void {
    const next = { ...state.seen };
    for (const entry of state.history ?? []) {
      if (historyStore.driftFor(entry) === "update") next[entry.id] = entry.version;
    }
    writeSeen(next);
    touch();
  },
};
