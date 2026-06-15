// Reviews tab — browse + reopen pushed reviews by their term (title). Lists the
// durable history (GET /reviews) with a search filter; a row opens that review.
import { Loader2 } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import type { JSX } from "react";
import { reviewsStore } from "../../reviews";
import { getSnapshot, subscribe } from "../../store";

export function ReviewsTab(): JSX.Element {
  useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    void reviewsStore.load();
  }, []);

  const loaded = reviewsStore.all();
  const rows = reviewsStore.filtered();

  // IIFE (not a nested ternary) so the three states read as a flat if-chain.
  const body = ((): JSX.Element => {
    if (loaded === null)
      return (
        <div className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading reviews…
        </div>
      );
    if (rows.length === 0)
      return (
        <p className="px-1 py-2 text-sm text-muted-foreground">
          {reviewsStore.query().trim()
            ? "No reviews match that search."
            : "No reviews yet — push one with /kvasir."}
        </p>
      );
    return (
      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {rows.map((review) => (
          <li key={review.id}>
            <button
              type="button"
              onClick={() => reviewsStore.open(review.url)}
              className="flex w-full flex-col items-start gap-0.5 rounded-md border border-border px-2 py-1.5 text-left hover:bg-secondary"
            >
              <span className="text-sm font-medium text-foreground">{review.title}</span>
              <span className="text-xs text-muted-foreground">
                {review.repos.join(", ")} · {review.steps} step{review.steps === 1 ? "" : "s"}
                {review.source ? ` · ${review.source}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  })();

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <input
        type="search"
        value={reviewsStore.query()}
        onChange={(event) => reviewsStore.setQuery(event.target.value)}
        placeholder="Search reviews…"
        aria-label="Search reviews"
        className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
      />
      {body}
    </div>
  );
}
