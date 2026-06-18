// The History tab's contribution to the global left sidebar: facet chips that narrow
// the main list (All / PR / Code / Needs-sync). Counts come from the search-filtered
// list so they stay stable as you switch facets. The list + search live in HistoryTab;
// this only sets the active facet.
import type { JSX } from "react";
import { HISTORY_FACETS, type HistoryFacet, historyStore } from "../history";

const FACET_LABELS: Record<HistoryFacet, string> = {
  all: "All",
  pr: "PR Walkthroughs",
  code: "Code Walkthroughs",
  stale: "Needs sync",
};

export function HistoryFacets(): JSX.Element {
  const active = historyStore.facet();
  const counts = historyStore.facetCounts();
  return (
    <ul className="py-2" data-testid="history-facets">
      {HISTORY_FACETS.map((facet) => {
        const selected = active === facet;
        return (
          <li key={facet}>
            <button
              className={
                "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted " +
                (selected ? "font-medium text-primary" : "text-foreground/90")
              }
              aria-current={selected ? "true" : undefined}
              onClick={() => historyStore.setFacet(facet)}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={
                    "size-1.5 shrink-0 rounded-full " +
                    (selected ? "bg-primary" : "border border-muted-foreground/50")
                  }
                />
                {FACET_LABELS[facet]}
              </span>
              <span className="text-xs text-muted-foreground">{counts[facet]}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
