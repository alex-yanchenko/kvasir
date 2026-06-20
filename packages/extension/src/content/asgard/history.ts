// History — the client side of the durable store. Fetches GET /history (summaries
// of both kinds: PR Walkthroughs and Code Walkthroughs) so you can browse, reopen,
// and prune past artifacts by their term (title). Caches the list in chrome.storage
// for instant paint; the backend store is the source of truth. Drift: each entry
// carries a `version` the store bumps when its content changes; `seen` records the
// version the FE last opened/synced, so an entry whose backend version moved past
// `seen` is flagged for re-sync (and counted into the tab badge).
import { type EntrySummary, isEntrySummaryList } from "@prw/runes/history";
import { api } from "../api";
import { HISTORY_KEY, SEEN_KEY } from "../keys";
import { storeGet, storeSet } from "../muninn";
import { state, touch } from "./store";

/** Drift of one entry vs what the FE last caught up to. */
type Drift = "new" | "current" | "update";

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

const matchesTerm = (entry: EntrySummary, term: string): boolean =>
  `${entry.title} ${entry.source ?? ""} ${entry.repos.join(" ")}`.toLowerCase().includes(term);

export const historyStore = {
  /** The loaded list, or null before the first load completes. */
  all: (): EntrySummary[] | null => state.history,
  query: (): string => state.historyQuery,
  setQuery(value: string): void {
    state.historyQuery = value;
    touch();
  },

  /** The list filtered by the search term (title · source · repos). */
  filtered(): EntrySummary[] {
    const list = state.history ?? [];
    const term = state.historyQuery.trim().toLowerCase();
    return term ? list.filter((entry) => matchesTerm(entry, term)) : list;
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
    writeSeen({ ...state.seen, [entry.id]: entry.version });
    globalThis.location.assign(entry.url);
  },

  /** Soft-delete on the backend, then drop it from the list + caches. */
  async remove(id: string): Promise<void> {
    const response = await api(`/entry?id=${encodeURIComponent(id)}`, "DELETE");
    if (!response.ok) return;
    state.history = (state.history ?? []).filter((entry) => entry.id !== id);
    storeSet(HISTORY_KEY, state.history);
    const next = Object.fromEntries(Object.entries(state.seen).filter(([key]) => key !== id));
    writeSeen(next);
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
