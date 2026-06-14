// Review tab — the step walkthrough for a pushed cross-repo review. Mirrors the
// Walkthrough tab's step UI, but has no generate/regenerate states (a review is
// pushed, not generated) and its nav navigates the tab between blob pages
// (reviewStore.goto/next/back), letting GitHub's native #L highlight land each
// step. Chat is reached the same way as the walkthrough — through activeGuide().
import { renderMarkdown } from "@prw/runes/markdown";
import { ChevronLeft, ChevronRight, Loader2, MessageSquare } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { JSX } from "react";
import { pairingStore } from "../../pairing";
import { reviewStore } from "../../review";
import { getSnapshot, PANEL_TABS, panelStore, subscribe } from "../../store";
import { Button } from "../../ui/button";

export function ReviewTab(): JSX.Element {
  useSyncExternalStore(subscribe, getSnapshot);
  const [showDetail, setShowDetail] = useState(false);
  const step = reviewStore.step();
  const index = reviewStore.stepIndex();
  const count = reviewStore.stepCount();
  // Collapse details when the step changes (mirrors the walkthrough tab).
  useEffect(() => setShowDetail(false), [index]);

  if (!step) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">No review loaded.</p>
      </div>
    );
  }

  const atFirst = index === 0;
  const atLast = index >= count - 1;
  const navigating = reviewStore.navigating(); // a cross-file step is loading a new page
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">
          Step {index + 1} / {count}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7"
          aria-label="Ask about this step"
          data-prw-tip="Ask about this step"
          disabled={pairingStore.needsPairing()}
          onClick={() => {
            reviewStore.askAboutStep();
            panelStore.setTab(PANEL_TABS.CHAT);
          }}
        >
          <MessageSquare />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <h3 className="mb-1 text-base font-semibold">{step.title}</h3>
        <div className="mb-2 text-xs text-muted-foreground">
          {step.repo.owner}/{step.repo.name} · {step.file}
        </div>
        <div
          className="prw-prose text-sm"
          data-testid="review-step-body"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(step.body) }}
        />
        {step.detail && (
          <>
            <Button
              variant="link"
              size="sm"
              className="mt-2 h-auto p-0"
              onClick={() => setShowDetail((d) => !d)}
            >
              {showDetail ? "Hide details" : "Show details"}
            </Button>
            {showDetail && (
              <div
                className="prw-prose mt-2 border-t border-border pt-2 text-sm"
                data-testid="review-step-detail"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(step.detail) }}
              />
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Previous step"
          disabled={atFirst || navigating}
          onClick={() => reviewStore.back()}
        >
          <ChevronLeft /> Back
        </Button>
        <div className="mx-auto flex items-center gap-1.5">
          {Array.from({ length: count }, (_unused, dotIndex) => (
            <button
              key={dotIndex}
              aria-label={`Go to step ${dotIndex + 1}`}
              data-prw-tip={`Step ${dotIndex + 1}`}
              disabled={navigating}
              onClick={() => reviewStore.goto(dotIndex)}
              className={
                "h-1.5 cursor-pointer rounded-full transition-all " +
                (dotIndex === index ? "w-4 bg-primary" : "w-1.5 bg-border hover:bg-muted-foreground")
              }
            />
          ))}
        </div>
        <Button
          variant="default"
          size="sm"
          aria-label="Next step"
          disabled={atLast || navigating}
          onClick={() => reviewStore.next()}
        >
          {navigating ? <Loader2 className="animate-spin" /> : <>Next <ChevronRight /></>}
        </Button>
      </div>
    </div>
  );
}
