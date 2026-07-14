// History tab — browse, reopen, and prune stored walkthroughs. One recency-ordered
// list of both kinds, each row led by a fixed-width PR/Code chip (the sidebar
// facets narrow by kind). Lists the durable store (GET /history) with a search
// filter; a row opens that artifact, the trash soft-deletes it, and a ↻ appears
// when the backend content has moved past what was last shown (click to
// acknowledge; "Sync all" clears them at once).
import type { EntrySummary } from "@kvasir/runes/history";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import type { JSX } from "react";
import { historyStore } from "../../history";
import { pairingStore } from "../../pairing";
import { getSnapshot, subscribe } from "../../store";

function HistoryRow({ entry }: Readonly<{ entry: EntrySummary }>): JSX.Element {
  const stale = historyStore.driftFor(entry) === "update";
  return (
    <li className="flex items-stretch gap-1">
      <button
        type="button"
        onClick={() => historyStore.open(entry)}
        className="flex min-w-0 flex-1 items-start gap-2 rounded-md border border-border px-2 py-1.5 text-left hover:bg-secondary"
      >
        {/* Fixed-width kind chip so titles align down the list regardless of the
            chip's text (46px fits "CODE", the wider label, at this size/tracking).
            Violet is reserved for the Code chip — the one place violet may color
            text. */}
        <span
          className={
            "mt-0.5 inline-flex w-[46px] shrink-0 justify-center rounded-full border border-border py-px text-[9.5px] font-semibold uppercase tracking-[0.11em] " +
            (entry.kind === "code" ? "text-[var(--aurora-3)]" : "text-primary")
          }
        >
          {entry.kind === "code" ? "Code" : "PR"}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="w-full break-words text-sm font-medium text-foreground">{entry.title}</span>
          <span className="text-xs text-muted-foreground">
            {entry.repos.join(", ")}
            {entry.prNumber === undefined ? "" : ` #${entry.prNumber}`} · {entry.steps} step
            {entry.steps === 1 ? "" : "s"}
            {entry.author ? ` · by ${entry.author}` : ""}
            {entry.source ? ` · ${entry.source}` : ""}
          </span>
        </span>
      </button>
      {stale ? (
        <button
          type="button"
          aria-label={`Sync ${entry.title}`}
          onClick={() => historyStore.sync(entry.id)}
          className="rounded-md border border-border px-2 text-muted-foreground hover:bg-secondary"
        >
          <RefreshCw className="size-4" />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={`Delete ${entry.title}`}
        onClick={() => void historyStore.remove(entry.id)}
        className="rounded-md border border-border px-2 text-muted-foreground hover:bg-secondary"
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}

const CHANNEL_DOWN_COPY = "Channel not running — run kvasir in your terminal to start it.";

// Empty-state copy: distinguish a search miss, "never saved any", "the active
// filter excludes them all", and "the channel is down" — so a facet that empties
// a non-empty kind isn't "None yet.", and neither is an unreachable backend.
function emptyCopy(facet: string): string {
  if (historyStore.query().trim()) return "No matches.";
  if (facet !== "all") return "None in this filter.";
  return pairingStore.state().phase === "down" ? CHANNEL_DOWN_COPY : "None yet.";
}

// One flat list ordered by recency — the per-row kind chip carries PR vs Code
// (the sidebar facets narrow it), so there are no section headers to break the
// aligned chip column.
function HistoryList({ facet }: Readonly<{ facet: string }>): JSX.Element {
  const items = historyStore.filtered().toSorted((a, b) => b.updatedAt - a.updatedAt);
  if (items.length === 0) {
    return <p className="px-2 py-1 text-sm text-muted-foreground">{emptyCopy(facet)}</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {items.map((entry) => (
        <HistoryRow key={entry.id} entry={entry} />
      ))}
    </ul>
  );
}

export function HistoryTab(): JSX.Element {
  useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    void historyStore.load();
  }, []);

  const loaded = historyStore.all();
  const stale = historyStore.staleCount();
  const facet = historyStore.facet();

  // A down channel can never deliver the list — name that instead of spinning
  // forever (load() leaves `all` null when the fetch fails and nothing is cached).
  if (loaded === null) {
    return (
      <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
        {pairingStore.state().phase === "down" ? (
          CHANNEL_DOWN_COPY
        ) : (
          <>
            <Loader2 className="size-4 animate-spin" /> Loading history…
          </>
        )}
      </div>
    );
  }

  const lastError = historyStore.error();
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      {lastError && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-secondary px-2 py-1 text-xs">
          <span className="text-destructive">⚠ {lastError}</span>
          <button
            type="button"
            onClick={() => historyStore.dismissError()}
            className="ml-auto rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-background"
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={historyStore.query()}
          onChange={(event) => historyStore.setQuery(event.target.value)}
          placeholder="Search history…"
          aria-label="Search history"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        />
        {stale > 0 ? (
          <button
            type="button"
            onClick={() => historyStore.syncAll()}
            className="flex items-center gap-1 whitespace-nowrap rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-secondary"
          >
            <RefreshCw className="size-3.5" /> Sync all ({stale})
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <HistoryList facet={facet} />
      </div>
    </div>
  );
}
