// Review tab — the step walkthrough for a pushed cross-repo review. Mirrors the
// Walkthrough tab's G1 step head (ring + eyebrow, slim footer; jumping to a step
// lives in the review outline sidebar), has no generate/regenerate states (a
// review is pushed, not generated), and its nav navigates the tab between blob
// pages (reviewStore.goto/next/back), letting GitHub's native #L highlight land
// each step. Chat is reached the same way as the walkthrough — through
// activeGuide().
import { renderMarkdown } from "@kvasir/runes/markdown";
import { ChevronLeft, ChevronRight, Loader2, MessageSquare } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { JSX } from "react";
import { useArrowKeyNav } from "../../hooks/useArrowKeyNav";
import { pairingStore } from "../../pairing";
import { reviewStore } from "../../review";
import { getSnapshot, PANEL_TABS, panelStore, subscribe } from "../../store";
import { Button } from "../../ui/button";
import { StepHead } from "../StepRing";

export function ReviewTab(): JSX.Element {
  useSyncExternalStore(subscribe, getSnapshot);
  const [showDetail, setShowDetail] = useState(false);
  useArrowKeyNav(reviewStore); // canNext/canBack gate the edges + in-flight navigation
  const step = reviewStore.step();
  const index = reviewStore.stepIndex();
  const count = reviewStore.stepCount();
  // Collapse details when the step changes. (The walkthrough persists detail-open
  // across steps via tourStore; review keeps it step-local — each step's detail is
  // an independent aside, not a reading mode.)
  useEffect(() => setShowDetail(false), [index]);

  if (!step) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">No walkthrough loaded.</p>
      </div>
    );
  }

  const atFirst = index === 0;
  const atLast = index >= count - 1;
  const navigating = reviewStore.navigating(); // a cross-file step is loading a new page
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end border-b border-border px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Ask about this step"
          data-kvasir-tip="Ask about this step"
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
        {/* G1 step head — review steps span repos, so the eyebrow carries the repo
            where the walkthrough's carries just the file. */}
        <StepHead
          eyebrow={`${step.repo.owner}/${step.repo.name} · ${step.file} · ${index + 1} of ${count}`}
          eyebrowTestId="review-step-eyebrow"
          title={step.title}
          index={index}
          count={count}
        />
        {/* step.body/detail are MARKDOWN (a pushed review), so they go through
            renderMarkdown — a constructive renderer that escapes first and only
            emits a fixed safe tag/attr set (links are protocol-checked and the
            href is attribute-escaped in markdown.ts). This is the XSS boundary for
            markdown content; do NOT swap it for WalkthroughTab's sanitizeSpecHtml,
            which expects author-supplied HTML and strips every attribute (it would
            kill the links/code styling renderMarkdown produces). */}
        <div
          key={step.id}
          className="kvasir-prose text-sm motion-safe:[animation:kvasir-step-in_140ms_ease-out]"
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
                key={step.id}
                className="kvasir-prose mt-2 border-t border-border pt-2 text-sm motion-safe:[animation:kvasir-step-in_140ms_ease-out]"
                data-testid="review-step-detail"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(step.detail) }}
              />
            )}
          </>
        )}
      </div>

      {/* Slim footer (G1): Back ghost + gradient Next — the review outline sidebar
          owns jumping to an arbitrary step. */}
      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Previous step"
          disabled={atFirst || navigating}
          onClick={() => reviewStore.back()}
        >
          <ChevronLeft /> Back
        </Button>
        <Button
          variant="default"
          size="sm"
          className="kvasir-next"
          aria-label="Next step"
          disabled={atLast || navigating}
          onClick={() => reviewStore.next()}
        >
          {navigating ? (
            <Loader2 className="animate-spin" />
          ) : (
            <>
              Next <ChevronRight />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
