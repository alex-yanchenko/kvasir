// Walkthrough tab — replaces the launcher block + the floating tour card. Three
// states: no spec (run a walkthrough), generating (status), or the step walkthrough.
// tourStore drives the page highlights; the tab mount/unmount starts/stops the
// tour so switching tabs or closing the panel clears the highlight.
import type { WalkthroughSpec, WalkthroughStep } from "@kvasir/runes/spec";
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  GitCompare,
  Loader2,
  MessageSquare,
  MessageSquareMore,
  Play,
  RefreshCw,
  Workflow,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { JSX } from "react";
import { sanitizeSpecHtml } from "../../../sanitize";
import { chatStore } from "../../chat";
import { fmtElapsed, launcherStore } from "../../launcher";
import { pairingStore } from "../../pairing";
import { getSnapshot, PANEL_TABS, panelStore, subscribe } from "../../store";
import { tourStore } from "../../tour";
import { Button } from "../../ui/button";
import { Diagram } from "../Diagram";
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
      <div className="text-sm font-medium">Generating walkthrough…</div>
      <div className="text-xs text-muted-foreground">
        {fmtElapsed(Date.now() - launcherStore.genStartAt())} · runs in your Claude session, blocks chat
      </div>
      <Button variant="ghost" size="sm" onClick={() => launcherStore.dismissGen()}>
        Stop watching
      </Button>
    </div>
  );
}

/** Inline outcome of the last failed generate attempt (request refused, channel
 * unreachable, or the poll ran out) — shown above whatever the tab renders, so a
 * failed regenerate never silently reverts to the previous state. */
function GenErrorBar({ message }: Readonly<{ message: string }>): JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-secondary px-3 py-1.5 text-xs">
      <span className="text-destructive">⚠ {message}</span>
      <Button
        size="sm"
        variant="outline"
        className="ml-auto h-6"
        onClick={() => void launcherStore.retryGenerate()}
      >
        Retry
      </Button>
      <Button variant="ghost" size="sm" className="h-6" onClick={() => launcherStore.dismissGenError()}>
        Dismiss
      </Button>
    </div>
  );
}

/** Shown while the spec probe (cache + live) is still in flight — loading is not
 * "none", so a PR that HAS a walkthrough never flashes the empty state. */
function Checking(): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Checking this PR for a walkthrough…</p>
    </div>
  );
}

function Empty(): JSX.Element {
  // Pairing is surfaced globally by the panel's PairBanner (so any 401 anywhere
  // prompts it), so this just offers the generate action.
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <p className="text-sm text-muted-foreground">No walkthrough yet for this PR.</p>
      <Button
        disabled={pairingStore.needsPairing()}
        onClick={() => void launcherStore.requestGenerate("new")}
      >
        <Play /> Run walkthrough
      </Button>
    </div>
  );
}

// The current step's prose + its expandable detail. Split out of Steps so that
// component stays under the cognitive-complexity bar; detail open state is
// module-level (tourStore) so it persists across a tab switch.
function StepBody({ step }: Readonly<{ step: WalkthroughStep }>): JSX.Element {
  const detailOpen = tourStore.detailOpen();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <h3 className="mb-2 text-base font-semibold">{step.title}</h3>
      <div
        className="kvasir-prose text-sm"
        data-testid="step-body"
        dangerouslySetInnerHTML={{ __html: sanitizeSpecHtml(step.body) }}
      />
      {step.detail && (
        <>
          <Button
            variant="link"
            size="sm"
            className="mt-2 h-auto p-0"
            onClick={() => tourStore.setDetailOpen(!detailOpen)}
          >
            {detailOpen ? "Hide details" : "Show details"}
          </Button>
          {detailOpen && (
            <div
              className="kvasir-prose mt-2 border-t border-border pt-2 text-sm"
              data-testid="step-detail"
              dangerouslySetInnerHTML={{ __html: sanitizeSpecHtml(step.detail) }}
            />
          )}
        </>
      )}
    </div>
  );
}

// The overview "step 0": a prose-only intro shown in the full content pane (so long
// overviews read comfortably, unlike a floating card). Same prose rendering as a step.
// The step count sets the reader's expectation for the length of the walkthrough ahead.
function OverviewView({
  overview,
  stepCount,
}: Readonly<{ overview: string; stepCount: number }>): JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">Overview</h3>
        <span className="shrink-0 text-xs text-muted-foreground" data-testid="overview-step-count">
          {stepCount} {stepCount === 1 ? "step" : "steps"}
        </span>
      </div>
      <div
        className="kvasir-prose text-sm"
        data-testid="overview-body"
        dangerouslySetInnerHTML={{ __html: sanitizeSpecHtml(overview) }}
      />
    </div>
  );
}

// The content pane (right of the rail): the overview "step 0" when one is active, the
// diagram overlay when open, else the step body. The outline rail is a sibling column,
// not part of this pane. `overview` is the overview HTML when on step 0, else undefined.
function MainView({
  spec,
  step,
  diagramOpen,
  overview,
}: Readonly<{
  spec: WalkthroughSpec;
  step: WalkthroughStep;
  diagramOpen: boolean;
  overview: string | undefined;
}>): JSX.Element {
  if (overview) return <OverviewView overview={overview} stepCount={spec.steps.length} />;
  if (diagramOpen && spec.diagram) return <Diagram source={spec.diagram} />;
  return <StepBody step={step} />;
}

// Arrow keys navigate steps; bound to the document AND the shadow root (the hotkey
// shield keeps shadow-origin keys off the document), skipping editable fields.
// Extracted from Steps so that component stays under the cognitive-complexity bar.
function useArrowKeyNav(): void {
  useEffect(() => {
    const keys = (event: Event): void => {
      if (!(event instanceof KeyboardEvent)) return;
      const t = event.target;
      if (t instanceof HTMLElement && (/^(?:TEXTAREA|INPUT|SELECT)$/.test(t.tagName) || t.isContentEditable))
        return;
      if (event.key === "ArrowRight" && tourStore.canNext()) {
        event.preventDefault();
        tourStore.next();
      } else if (event.key === "ArrowLeft" && tourStore.canBack()) {
        event.preventDefault();
        tourStore.back();
      }
    };
    const root = document.querySelector("#kvasir-root")?.shadowRoot ?? document;
    document.addEventListener("keydown", keys);
    if (root !== document) root.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      if (root !== document) root.removeEventListener("keydown", keys);
    };
  }, []);
}

// The "ask" button: on a code step it opens that step's chat; on the overview "step
// 0" it opens the whole-PR overview chat. Split out of StepTools so the label/click
// branching stays out of the JSX (and StepTools under the cognitive-complexity bar).
function ChatTool({
  step,
  atOverview,
}: Readonly<{ step: WalkthroughStep; atOverview: boolean }>): JSX.Element {
  const hasChat = atOverview ? !!chatStore.overviewChat() : !!chatStore.stepChat(step.id);
  const label = chatToolLabel(atOverview, hasChat);
  const onClick = (): void => {
    if (atOverview) {
      chatStore.openOverview();
      return;
    }
    tourStore.askAboutStep();
    panelStore.setTab(PANEL_TABS.CHAT);
  };
  return (
    <Button
      variant="ghost"
      size="icon"
      className={"h-7 w-7" + (hasChat ? " text-primary" : "")}
      aria-label={label.aria}
      data-kvasir-tip={label.tip}
      disabled={pairingStore.needsPairing()}
      onClick={onClick}
    >
      {hasChat ? <MessageSquareMore /> : <MessageSquare />}
    </Button>
  );
}

// aria-label / tooltip for the ChatTool, by where we are and whether a chat exists.
function chatToolLabel(atOverview: boolean, hasChat: boolean): { aria: string; tip: string } {
  if (atOverview)
    return hasChat
      ? { aria: "Reopen the overview chat", tip: "Reopen the overview chat" }
      : { aria: "Ask about the overview", tip: "Ask about the overview" };
  return hasChat
    ? { aria: "Reopen chat for this step", tip: "Reopen this step's chat" }
    : { aria: "Ask about this step", tip: "Ask about this step" };
}

// The header utility cluster (outline/diagram toggles, ask, re-scroll,
// regenerate). Split out of Steps so that component stays under the
// cognitive-complexity bar; reads its own toggle/chat/commit state from the stores.
function StepTools({
  spec,
  step,
  index,
  onRegen,
}: Readonly<{
  spec: WalkthroughSpec;
  step: WalkthroughStep;
  index: number;
  onRegen: () => void;
}>): JSX.Element {
  const diagramOpen = tourStore.diagramOpen();
  const atOverview = tourStore.atOverview();
  const newCommits = launcherStore.newCommits();
  return (
    <div className="ml-auto flex items-center gap-1">
      {spec.diagram && (
        <Button
          variant="ghost"
          size="icon"
          className={"h-7 w-7" + (diagramOpen ? " text-primary" : "")}
          aria-label={diagramOpen ? "Hide diagram" : "Show diagram"}
          data-kvasir-tip="Flow diagram of the change"
          onClick={() => tourStore.setDiagramOpen(!diagramOpen)}
        >
          <Workflow />
        </Button>
      )}
      <ChatTool step={step} atOverview={atOverview} />
      {/* Scroll-to-code is step-scoped: disabled on the overview "step 0", which has no code target. */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label="Scroll to this step's code"
        data-kvasir-tip={atOverview ? "The overview has no code target" : "Scroll to this step's code"}
        disabled={atOverview}
        onClick={() => tourStore.jumpToStep(index)}
      >
        <Crosshair />
      </Button>
      {newCommits && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="View changes since this walkthrough"
          data-kvasir-tip="View changes since this walkthrough — the combined diff of all new commits"
          onClick={() => launcherStore.openChangesSinceReview()}
        >
          <GitCompare />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className={"h-7 w-7" + (newCommits ? " text-primary" : "")}
        aria-label={newCommits ? "Update" : "Regenerate"}
        data-kvasir-tip={
          newCommits ? "Update — new commits since this walkthrough" : "Regenerate walkthrough"
        }
        disabled={pairingStore.needsPairing()}
        onClick={onRegen}
      >
        <RefreshCw />
      </Button>
    </div>
  );
}

// Footer: Back · step counter · Next on one row. The counter sits between the buttons
// (it stays short at any step count); the outline sidebar handles jumping to a step.
// On the overview "step 0" the counter reads "Overview" and Back is disabled.
function Footer({ index, count }: Readonly<{ index: number; count: number }>): JSX.Element {
  const atOverview = tourStore.atOverview();
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
      <Button
        variant="ghost"
        size="sm"
        aria-label="Previous step"
        disabled={!tourStore.canBack()}
        onClick={() => tourStore.back()}
      >
        <ChevronLeft /> Back
      </Button>
      <span className="shrink-0 text-xs text-muted-foreground">
        {atOverview ? (
          "Overview"
        ) : (
          <>
            Step <span className="font-medium text-primary">{index + 1}</span> / {count}
          </>
        )}
      </span>
      <Button
        variant="default"
        size="sm"
        aria-label="Next step"
        disabled={!tourStore.canNext()}
        onClick={() => tourStore.next()}
      >
        Next <ChevronRight />
      </Button>
    </div>
  );
}

function Steps({ spec }: Readonly<{ spec: WalkthroughSpec }>): JSX.Element {
  const [dialog, setDialog] = useState(false);
  const step = tourStore.step();
  const index = tourStore.stepIndex();
  const count = tourStore.stepCount();

  // Start (resume) the tour when this tab opens. We deliberately do NOT close on
  // unmount: leaving for Settings/Chat keeps the page highlight up — so the
  // highlight-style toggle is testable against a real selection. The panel close
  // clears it (Panel's unmount), and start() is idempotent on re-entry.
  useEffect(() => {
    tourStore.start();
  }, []);
  useArrowKeyNav();

  if (!step) return <Empty />;
  const diagramOpen = tourStore.diagramOpen();
  const overview = tourStore.atOverview() ? spec.overview : undefined;
  return (
    <div className="flex h-full flex-col">
      {/* header: low-frequency utilities (the outline toggle lives in the panel title bar) */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <StepTools spec={spec} step={step} index={index} onRegen={() => setDialog(true)} />
      </div>

      <MainView spec={spec} step={step} diagramOpen={diagramOpen} overview={overview} />

      <Footer index={index} count={count} />
      {dialog && <RegenDialog onClose={() => setDialog(false)} />}
    </div>
  );
}

function Body(): JSX.Element {
  const spec = launcherStore.spec();
  if (spec?.steps.length) return <Steps spec={spec} />;
  if (launcherStore.specLoading()) return <Checking />;
  return <Empty />;
}

export function WalkthroughTab(): JSX.Element {
  useSyncExternalStore(subscribe, getSnapshot);
  if (launcherStore.generating()) return <Generating />;
  const genError = launcherStore.genError();
  return (
    <div className="flex h-full min-h-0 flex-col">
      {genError && <GenErrorBar message={genError} />}
      <div className="min-h-0 flex-1">
        <Body />
      </div>
    </div>
  );
}
