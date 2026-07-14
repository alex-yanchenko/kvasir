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
import { useArrowKeyNav } from "../../hooks/useArrowKeyNav";
import { fmtElapsed, launcherStore } from "../../launcher";
import { pairingStore } from "../../pairing";
import { getSnapshot, PANEL_TABS, panelStore, settingsStore, subscribe } from "../../store";
import { tourStore } from "../../tour";
import { Button } from "../../ui/button";
import { KvasirMark } from "../../ui/KvasirMark";
import { Diagram } from "../Diagram";
import { RegenDialog } from "../RegenDialog";
import { StepRing } from "../StepRing";

function Generating(): JSX.Element {
  const [, setTick] = useState(0);
  useEffect(() => {
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(clock);
  }, []);
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <div className="kvasir-shimmer" aria-hidden="true" />
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

/** One checklist row of the first-run card: a live check when its step is already
 * satisfied, a hollow dot (and full-strength text) while it's still to do. */
function FirstRunItem({
  done,
  title,
  children,
}: Readonly<{ done: boolean; title: string; children: React.ReactNode }>): JSX.Element {
  return (
    <li className="flex items-start gap-2" data-done={done}>
      <span
        aria-hidden="true"
        className={
          "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] " +
          (done ? "border-success text-success" : "border-border text-transparent")
        }
      >
        ✓
      </span>
      <span className={done ? "line-through opacity-60" : ""}>
        <b className="text-foreground">{title}</b> — {children}
      </span>
    </li>
  );
}

/** One-time onboarding shown in the empty state until dismissed: the three steps
 * between a fresh install and a first walkthrough, ending at the real Run button.
 * A LIVE checklist, not static copy — steps the pairing phase already proves done
 * are checked off (channel answering → 1; paired → 2), so it never coaches you
 * through something you've already finished. */
function FirstRunSteps(): JSX.Element {
  const phase = pairingStore.state().phase;
  // Only phases that imply a successful health probe count as "channel up" —
  // "error" can also mean the probe itself never reached the bridge.
  const channelUp = ["unpaired", "waiting", "paired"].includes(phase);
  return (
    <>
      <p className="text-sm font-medium">Three steps to your first walkthrough</p>
      <ol className="flex max-w-[340px] flex-col gap-2 text-left text-sm text-muted-foreground">
        <FirstRunItem done={channelUp} title="1. Start the channel">
          run <b className="font-mono text-foreground">kvasir</b> in your terminal.
        </FirstRunItem>
        <FirstRunItem done={phase === "paired"} title="2. Pair">
          Settings → Pair, then approve the code in that session.
        </FirstRunItem>
        <FirstRunItem done={false} title="3. Run">
          hit the button below on any PR.
        </FirstRunItem>
      </ol>
    </>
  );
}

function Empty(): JSX.Element {
  // Pairing is surfaced globally by the panel's PairBanner (so any 401 anywhere
  // prompts it), so this offers the generate action — plus the one-time first-run
  // card coaching toward it.
  const firstRun = settingsStore.firstRun();
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      {firstRun ? (
        <FirstRunSteps />
      ) : (
        <>
          <KvasirMark className="size-8 text-primary opacity-80" />
          <p className="text-sm text-muted-foreground">No walkthrough yet for this PR.</p>
        </>
      )}
      <Button
        disabled={pairingStore.needsPairing()}
        onClick={() => {
          settingsStore.dismissFirstRun(); // completing the card's steps retires it — no "Got it" needed
          void launcherStore.requestGenerate("new");
        }}
      >
        <Play /> Run walkthrough
      </Button>
      {firstRun && (
        <Button variant="ghost" size="sm" onClick={() => settingsStore.dismissFirstRun()}>
          Got it
        </Button>
      )}
    </div>
  );
}

// The current step's prose + its expandable detail. Split out of Steps so that
// component stays under the cognitive-complexity bar; detail open state lives on
// state.tour (via tourStore) so it persists across a tab switch.
function StepBody({
  step,
  index,
  count,
}: Readonly<{ step: WalkthroughStep; index: number; count: number }>): JSX.Element {
  const detailOpen = tourStore.detailOpen();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {/* G1 step head: eyebrow (the outline's group = the step's file, plus position),
          ring beside the title. The footer carries no counter — the ring owns position. */}
      <div className="mb-3 flex items-center gap-3">
        <StepRing index={index} count={count} />
        <div className="min-w-0">
          <div
            className="truncate font-mono text-[9.5px] font-semibold uppercase tracking-[0.13em] text-muted-foreground"
            data-testid="step-eyebrow"
          >
            {step.file} · {index + 1} of {count}
          </div>
          <h3 className="text-[19px] font-[650] leading-tight tracking-tight">{step.title}</h3>
        </div>
      </div>
      {/* Keyed by step id: navigation remounts the PROSE so it fades in, while the
          head above stays mounted (the ring's fill sweeps) and the details toggle
          below keeps its node — a focused toggle must survive arrow-key nav. */}
      <div
        key={step.id}
        className="kvasir-prose text-sm motion-safe:[animation:kvasir-step-in_140ms_ease-out]"
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
              key={step.id}
              className="kvasir-prose mt-2 border-t border-border pt-2 text-sm motion-safe:[animation:kvasir-step-in_140ms_ease-out]"
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
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 motion-safe:[animation:kvasir-step-in_140ms_ease-out]">
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
  index,
  diagramOpen,
  overview,
}: Readonly<{
  spec: WalkthroughSpec;
  step: WalkthroughStep;
  index: number;
  diagramOpen: boolean;
  overview: string | undefined;
}>): JSX.Element {
  if (overview) return <OverviewView overview={overview} stepCount={spec.steps.length} />;
  if (diagramOpen && spec.diagram) return <Diagram source={spec.diagram} />;
  return <StepBody step={step} index={index} count={spec.steps.length} />;
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

// Footer: Back (ghost) · Next (aurora gradient) — no counter; the step head's ring
// owns position, and the outline sidebar handles jumping to a step.
function Footer(): JSX.Element {
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
      <Button
        variant="default"
        size="sm"
        className="kvasir-next"
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

  // Start (resume) the tour when this tab opens, and re-start when the displayed
  // spec's identity changes — the cache-first load can swap a regenerated live
  // spec under a mounted Steps, and start() re-clamps the step index and re-issues
  // the highlight against it. We deliberately do NOT close on unmount: leaving for
  // Settings/Chat keeps the page highlight up — so the highlight-style toggle is
  // testable against a real selection. The panel close clears it (Panel's
  // unmount), and start() is idempotent on re-entry.
  useEffect(() => {
    tourStore.start();
  }, [spec.generatedAt]);
  useArrowKeyNav(tourStore);

  if (!step) return <Empty />;
  const diagramOpen = tourStore.diagramOpen();
  const overview = tourStore.atOverview() ? spec.overview : undefined;
  return (
    <div className="flex h-full flex-col">
      {/* header: low-frequency utilities (the outline toggle lives in the panel title bar) */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        {spec.depth && (
          // Generation depth as chrome, never as prose (the prompt forbids the
          // model narrating it) — absent on older specs, so no chip, no guess.
          // min-w-0 + truncate (not shrink-0): at the panel's minimum width with
          // every StepTool visible the header has no room to spare, and the chip
          // is the right thing to give way.
          <span
            className="min-w-0 truncate rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
            data-kvasir-tip={
              spec.depth === "heavy"
                ? 'Generated with local-repo context (the "Deep context" walkthrough depth)'
                : 'Generated from the PR diff alone (the "Diff only" walkthrough depth)'
            }
          >
            {spec.depth === "heavy" ? "Deep context" : "Diff only"}
          </span>
        )}
        <StepTools spec={spec} step={step} index={index} onRegen={() => setDialog(true)} />
      </div>

      <MainView spec={spec} step={step} index={index} diagramOpen={diagramOpen} overview={overview} />

      <Footer />
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
