// History tab — browse, reopen, and prune stored walkthroughs by their term
// (title), in two sections: PR Walkthroughs and Code Walkthroughs. Lists the
// durable store (GET /history) with a search filter; a row opens that artifact,
// the trash soft-deletes it, and a ↻ appears when the backend content has moved
// past what was last shown (click to acknowledge; "Sync all" clears them at once).
import type { EntrySummary } from "@prw/runes/history";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import type { JSX } from "react";
import { historyStore } from "../../history";
import { getSnapshot, subscribe } from "../../store";

function HistoryRow({ entry }: Readonly<{ entry: EntrySummary }>): JSX.Element {
  const stale = historyStore.driftFor(entry) === "update";
  return (
    <li className="flex items-stretch gap-1">
      <button
        type="button"
        onClick={() => historyStore.open(entry)}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md border border-border px-2 py-1.5 text-left hover:bg-secondary"
      >
        <span className="w-full break-words text-sm font-medium text-foreground">{entry.title}</span>
        <span className="text-xs text-muted-foreground">
          {entry.repos.join(", ")}
          {entry.prNumber === undefined ? "" : ` #${entry.prNumber}`} · {entry.steps} step
          {entry.steps === 1 ? "" : "s"}
          {entry.author ? ` · by ${entry.author}` : ""}
          {entry.source ? ` · ${entry.source}` : ""}
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

function HistorySection({ label, items }: Readonly<{ label: string; items: EntrySummary[] }>): JSX.Element {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
      {items.length === 0 ? (
        <p className="px-1 py-1 text-sm text-muted-foreground">
          {historyStore.query().trim() ? "No matches." : "None yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function HistoryTab(): JSX.Element {
  useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    void historyStore.load();
  }, []);

  const loaded = historyStore.all();
  const stale = historyStore.staleCount();

  if (loaded === null) {
    return (
      <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading history…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
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
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <HistorySection label="PR Walkthroughs" items={historyStore.prItems()} />
        <HistorySection label="Code Walkthroughs" items={historyStore.codeItems()} />
      </div>
    </div>
  );
}
