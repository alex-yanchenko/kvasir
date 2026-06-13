// Walkthrough tab — replaces the launcher block + the floating tour card. Three
// states: no spec (run a review), generating (status), or the step walkthrough.
// tourStore drives the page highlights; the tab mount/unmount starts/stops the
// tour so switching tabs or closing the panel clears the highlight.
import type { JSX } from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Link2,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
} from "lucide-react";
import { sanitizeSpecHtml } from "../../../sanitize";
import { fmtElapsed, launcherStore } from "../../launcher";
import { pairingStore } from "../../pairing";
import { getSnapshot, PANEL_TABS, panelStore, subscribe } from "../../store";
import { tourStore } from "../../tour";
import { Button } from "../../ui/button";
import { RegenDialog } from "../RegenDialog";

function Generating(): JSX.Element {
  const [, setTick] = useState(0);
  useEffect(() => {
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(clock);
  }, []);
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <Loader2 className="size-6 animate-spin text-primary" />
      <div className="text-sm font-medium">Generating review…</div>
      <div className="text-xs text-muted-foreground">
        {fmtElapsed(Date.now() - launcherStore.genStartAt())} · runs in your Claude session, blocks chat
      </div>
      <Button variant="ghost" size="sm" onClick={() => launcherStore.dismissGen()}>
        Stop watching
      </Button>
    </div>
  );
}

function Empty(): JSX.Element {
  const pairing = pairingStore.state();
  // Until the extension is paired, "Run review" would just 401 — so make pairing
  // the call to action here instead of handing the user a button that does nothing.
  if (pairing.phase === "unpaired" || pairing.phase === "waiting" || pairing.phase === "error") {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Pair this extension with your Claude session to generate a review.
        </p>
        {pairing.phase === "waiting" ? (
          <p className="text-xs text-muted-foreground">
            Confirm code <b className="font-mono tracking-widest text-foreground">{pairing.code}</b> in your
            Claude session…
          </p>
        ) : (
          <Button onClick={() => void pairingStore.pair()}>
            <Link2 /> Pair with Claude
          </Button>
        )}
        {pairing.phase === "error" && <p className="text-xs text-destructive">{pairing.message}</p>}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <p className="text-sm text-muted-foreground">No walkthrough yet for this PR.</p>
      <Button onClick={() => void launcherStore.requestGenerate("new")}>
        <Play /> Run review
      </Button>
    </div>
  );
}

function Steps(): JSX.Element {
  const [showDetail, setShowDetail] = useState(false);
  const [dialog, setDialog] = useState(false);
  const step = tourStore.step();
  const idx = tourStore.stepIdx();
  const count = tourStore.stepCount();

  // Start the tour while this tab is shown; clear the highlight when it unmounts
  // (tab switch or panel close). Re-runs are cheap: start() resumes the step.
  useEffect(() => {
    tourStore.start();
    return () => tourStore.close();
  }, []);
  useEffect(() => setShowDetail(false), [idx]);

  // Arrow keys navigate; bound to the document AND the shadow root (the hotkey
  // shield keeps shadow-origin keys off the document), skipping editable fields.
  useEffect(() => {
    const keys = (e: KeyboardEvent): void => {
      const t = e.target;
      if (t instanceof HTMLElement && (/^(TEXTAREA|INPUT|SELECT)$/.test(t.tagName) || t.isContentEditable))
        return;
      if (e.key === "ArrowRight" && tourStore.stepIdx() < tourStore.stepCount() - 1) {
        e.preventDefault();
        tourStore.goto(tourStore.stepIdx() + 1);
      } else if (e.key === "ArrowLeft" && tourStore.stepIdx() > 0) {
        e.preventDefault();
        tourStore.goto(tourStore.stepIdx() - 1);
      }
    };
    const root = document.getElementById("prw-root")?.shadowRoot ?? document;
    document.addEventListener("keydown", keys);
    if (root !== document) root.addEventListener("keydown", keys as EventListener);
    return () => {
      document.removeEventListener("keydown", keys);
      if (root !== document) root.removeEventListener("keydown", keys as EventListener);
    };
  }, []);

  if (!step) return <Empty />;
  const newCommits = launcherStore.newCommits();
  const atFirst = idx === 0;
  const atLast = idx >= count - 1;
  return (
    <div className="flex h-full flex-col">
      {/* header: where you are + low-frequency utilities (re-scroll, regenerate) */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <span className="text-xs text-muted-foreground">
          Step <span className="font-medium text-primary">{idx + 1}</span> / {count}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Ask about this step"
            data-prw-tip="Ask about this step"
            onClick={() => {
              tourStore.askAboutStep();
              panelStore.setTab(PANEL_TABS.CHAT);
            }}
          >
            <MessageSquare />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Scroll to this step's code"
            data-prw-tip="Scroll to this step's code"
            onClick={() => tourStore.goto(idx)}
          >
            <Crosshair />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={"h-7 w-7" + (newCommits ? " text-primary" : "")}
            aria-label={newCommits ? "Update" : "Regenerate"}
            data-prw-tip={newCommits ? "Update — new commits since this review" : "Regenerate review"}
            onClick={() => setDialog(true)}
          >
            <RefreshCw />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <h3 className="mb-2 text-base font-semibold">{step.title}</h3>
        <div
          className="prw-prose text-sm"
          data-testid="step-body"
          dangerouslySetInnerHTML={{ __html: sanitizeSpecHtml(step.body) }}
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
                data-testid="step-detail"
                dangerouslySetInnerHTML={{ __html: sanitizeSpecHtml(step.detail) }}
              />
            )}
          </>
        )}
      </div>

      {/* wizard footer: Back (quiet) · progress dots · Next (accent) */}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <span data-prw-tip={atFirst ? "First step" : undefined}>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Previous step"
            disabled={atFirst}
            onClick={() => tourStore.back()}
          >
            <ChevronLeft /> Back
          </Button>
        </span>
        <div className="mx-auto flex items-center gap-1.5">
          {Array.from({ length: count }, (_unused, i) => (
            <button
              key={i}
              aria-label={`Go to step ${i + 1}`}
              data-prw-tip={`Step ${i + 1}`}
              onClick={() => tourStore.goto(i)}
              className={
                "h-1.5 cursor-pointer rounded-full transition-all " +
                (i === idx ? "w-4 bg-primary" : "w-1.5 bg-border hover:bg-muted-foreground")
              }
            />
          ))}
        </div>
        <span data-prw-tip={atLast ? "Last step" : undefined}>
          <Button
            variant="default"
            size="sm"
            aria-label="Next step"
            disabled={atLast}
            onClick={() => tourStore.next()}
          >
            Next <ChevronRight />
          </Button>
        </span>
      </div>
      {dialog && <RegenDialog onClose={() => setDialog(false)} />}
    </div>
  );
}

export function WalkthroughTab(): JSX.Element {
  useSyncExternalStore(subscribe, getSnapshot);
  if (launcherStore.generating()) return <Generating />;
  if (!launcherStore.spec()?.steps.length) return <Empty />;
  return <Steps />;
}
