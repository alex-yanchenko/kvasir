// Walkthrough tab — replaces the launcher block + the floating tour card. Three
// states: no spec (run a review), generating (status), or the step walkthrough.
// tourStore drives the page highlights; the tab mount/unmount starts/stops the
// tour so switching tabs or closing the panel clears the highlight.
import type { WalkthroughSpec, WalkthroughStep } from "@kvasir/runes/spec";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  FileText,
  ListTree,
  Loader2,
  MessageSquare,
  MessageSquareMore,
  Play,
  RefreshCw,
  Workflow,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { JSX, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { bifrost } from "../../../bifrost";
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
  // Pairing is surfaced globally by the panel's PairBanner (so any 401 anywhere
  // prompts it), so this just offers the review action.
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <p className="text-sm text-muted-foreground">No walkthrough yet for this PR.</p>
      <Button
        disabled={pairingStore.needsPairing()}
        onClick={() => void launcherStore.requestGenerate("new")}
      >
        <Play /> Run review
      </Button>
    </div>
  );
}

// Coverage confidence: does the walkthrough explain the whole change? Stamped
// server-side onto the spec at publish (PR walkthroughs only). Absent → render
// nothing (a cross-repo review or a pre-coverage cached spec).
function Coverage({
  coverage,
}: Readonly<{ coverage: { significant: string[]; uncovered: string[] } | undefined }>): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (!coverage || coverage.significant.length === 0) return null;
  const { significant, uncovered } = coverage;
  const covered = significant.length - uncovered.length;
  const full = uncovered.length === 0;
  return (
    <div className="border-b border-border px-3 py-1.5 text-xs">
      <button
        className="flex w-full items-center gap-1.5 text-left"
        aria-label="Walkthrough coverage of changed files"
        data-kvasir-tip={
          full ? "Every significant changed file has a step" : "Some changed files have no step"
        }
        disabled={full}
        onClick={() => setOpen((value) => !value)}
      >
        {full ? (
          <Check className="size-3.5 shrink-0 text-primary" />
        ) : (
          <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
        )}
        <span className="text-muted-foreground">
          Explains {covered}/{significant.length} changed files
        </span>
        {!full && (
          <ChevronDown className={"ml-auto size-3.5 transition-transform" + (open ? " rotate-180" : "")} />
        )}
      </button>
      {open && !full && (
        <ul className="mt-1.5 space-y-0.5">
          {uncovered.map((path) => (
            <li key={path}>
              <button
                className="block w-full truncate text-left font-mono text-muted-foreground hover:text-primary"
                data-kvasir-tip="Jump to this uncovered file in the diff"
                onClick={() => bifrost.send("jump:ref", { file: path, start: null, end: null })}
              >
                {path}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A step's status dot in the rail: current (accent), actually-visited (muted
// fill), or upcoming (hollow ring). Visited replaces the old jump-trail's
// "where have I been" — shown in place on the always-present rail.
function dotClass(isCurrent: boolean, isVisited: boolean): string {
  if (isCurrent) return "bg-primary";
  if (isVisited) return "bg-muted-foreground";
  return "border border-muted-foreground/50";
}

// Persistent outline rail: the whole flow as a tree — file headers with their
// steps indented under connector lines, each carrying a status dot. Clicking a
// step navigates WITHOUT closing the rail (it's a side menu, not an overlay), so
// you keep the map in view. Width is persisted (tourStore.railWidth).
function Rail({
  spec,
  current,
  width,
}: Readonly<{ spec: WalkthroughSpec; current: number; width: number }>): JSX.Element {
  const groups: { file: string; items: { step: WalkthroughStep; index: number }[] }[] = [];
  let position = 0;
  for (const walkStep of spec.steps) {
    const last = groups.at(-1);
    if (last && last.file === walkStep.file) last.items.push({ step: walkStep, index: position });
    else groups.push({ file: walkStep.file, items: [{ step: walkStep, index: position }] });
    position += 1;
  }
  return (
    <div
      className="flex shrink-0 flex-col overflow-y-auto py-1"
      style={{ width: `${width}px` }}
      data-testid="outline"
    >
      <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
        Outline
      </div>
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="mb-1">
          <div className="truncate px-3 font-mono text-xs text-muted-foreground" data-kvasir-tip={group.file}>
            {group.file}
          </div>
          <ul>
            {group.items.map((item, itemIndex) => {
              const isCurrent = item.index === current;
              return (
                <li key={item.index}>
                  <button
                    className={
                      "flex w-full items-center gap-1.5 px-2 py-1 text-left text-sm hover:bg-muted " +
                      (isCurrent ? "font-medium text-primary" : "text-foreground")
                    }
                    aria-current={isCurrent ? "step" : undefined}
                    data-kvasir-tip={item.step.title}
                    onClick={() => tourStore.goto(item.index)}
                  >
                    <span className="font-mono text-xs text-muted-foreground/50">
                      {itemIndex === group.items.length - 1 ? "└─" : "├─"}
                    </span>
                    <span
                      className={
                        "size-1.5 shrink-0 rounded-full " +
                        dotClass(isCurrent, tourStore.isVisited(item.step.id))
                      }
                    />
                    <span className="truncate">{item.step.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
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

// The content pane (right of the rail): the diagram overlay when open, else the
// step body. The outline rail is a sibling column, not part of this pane.
function MainView({
  spec,
  step,
  diagramOpen,
}: Readonly<{ spec: WalkthroughSpec; step: WalkthroughStep; diagramOpen: boolean }>): JSX.Element {
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
      if (event.key === "ArrowRight" && tourStore.stepIndex() < tourStore.stepCount() - 1) {
        event.preventDefault();
        tourStore.goto(tourStore.stepIndex() + 1);
      } else if (event.key === "ArrowLeft" && tourStore.stepIndex() > 0) {
        event.preventDefault();
        tourStore.goto(tourStore.stepIndex() - 1);
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

// The header utility cluster (outline/diagram toggles, ask, re-scroll, copy log,
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
  const [copiedLog, setCopiedLog] = useState(false);
  const diagramOpen = tourStore.diagramOpen();
  const stepChat = chatStore.stepChat(step.id);
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
      <Button
        variant="ghost"
        size="icon"
        className={"h-7 w-7" + (stepChat ? " text-primary" : "")}
        aria-label={stepChat ? "Reopen chat for this step" : "Ask about this step"}
        data-kvasir-tip={stepChat ? "Reopen this step's chat" : "Ask about this step"}
        disabled={pairingStore.needsPairing()}
        onClick={() => {
          tourStore.askAboutStep();
          panelStore.setTab(PANEL_TABS.CHAT);
        }}
      >
        {stepChat ? <MessageSquareMore /> : <MessageSquare />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label="Scroll to this step's code"
        data-kvasir-tip="Scroll to this step's code"
        onClick={() => tourStore.goto(index)}
      >
        <Crosshair />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={"h-7 w-7" + (copiedLog ? " text-primary" : "")}
        aria-label="Copy build log"
        data-kvasir-tip="Copy how this was built — paste to Claude to review"
        onClick={() => void launcherStore.copyBuildLog().then((result) => setCopiedLog(result === "ok"))}
      >
        {copiedLog ? <Check /> : <FileText />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={"h-7 w-7" + (newCommits ? " text-primary" : "")}
        aria-label={newCommits ? "Update" : "Regenerate"}
        data-kvasir-tip={newCommits ? "Update — new commits since this review" : "Regenerate review"}
        disabled={pairingStore.needsPairing()}
        onClick={onRegen}
      >
        <RefreshCw />
      </Button>
    </div>
  );
}

// Outline-rail width bounds + its drag/keyboard resize, mirroring the chat rail.
// Live width is local state (zero re-render during drag); persisted via tourStore
// on release. rowRef anchors the splitter's left edge for the width math.
const RAIL_MIN = 130;
const RAIL_MAX = 320;
const RAIL_NUDGE: Record<string, number> = { ArrowLeft: -16, ArrowRight: 16 };
const clampRail = (n: number): number => Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(n)));

function useRailResize(): {
  railW: number;
  onResize: (event: ReactMouseEvent) => void;
  onResizeKey: (event: ReactKeyboardEvent) => void;
} {
  const [railW, setRailW] = useState(() => clampRail(tourStore.railWidth()));
  // Delta-based (start width + cursor delta) so no row geometry / nullable ref is needed.
  const onResize = (event: ReactMouseEvent): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = railW;
    const move = (moved: MouseEvent): void => setRailW(clampRail(startW + (moved.clientX - startX)));
    const up = (): void => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      setRailW((w) => {
        tourStore.setRailWidth(w);
        return w;
      });
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  const onResizeKey = (event: ReactKeyboardEvent): void => {
    const delta = RAIL_NUDGE[event.key] ?? 0;
    if (!delta) return;
    event.preventDefault();
    setRailW((w) => {
      const next = clampRail(w + delta);
      tourStore.setRailWidth(next);
      return next;
    });
  };
  return { railW, onResize, onResizeKey };
}

// Footer: the step counter (moved here from the header) above Back · dots · Next.
// Split out so Steps stays under the cognitive-complexity bar.
function Footer({ index, count }: Readonly<{ index: number; count: number }>): JSX.Element {
  const atFirst = index === 0;
  const atLast = index >= count - 1;
  return (
    <div className="border-t border-border">
      <div className="py-1 text-center text-xs text-muted-foreground">
        Step <span className="font-medium text-primary">{index + 1}</span> / {count}
      </div>
      <div className="flex items-center gap-2 px-3 pb-2">
        <span data-kvasir-tip={atFirst ? "First step" : undefined}>
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
          {Array.from({ length: count }, (_unused, dotIndex) => (
            <button
              key={dotIndex}
              aria-label={`Go to step ${dotIndex + 1}`}
              data-kvasir-tip={`Step ${dotIndex + 1}`}
              onClick={() => tourStore.goto(dotIndex)}
              className={
                "h-1.5 cursor-pointer rounded-full transition-all " +
                (dotIndex === index ? "w-4 bg-primary" : "w-1.5 bg-border hover:bg-muted-foreground")
              }
            />
          ))}
        </div>
        <span data-kvasir-tip={atLast ? "Last step" : undefined}>
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

  const { railW, onResize, onResizeKey } = useRailResize();
  if (!step) return <Empty />;
  const outlineOpen = tourStore.outlineOpen();
  const diagramOpen = tourStore.diagramOpen();
  return (
    <div className="flex h-full flex-col">
      {/* header: outline toggle (left, where the counter used to be) + utilities (right) */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className={"h-7 w-7" + (outlineOpen ? " text-primary" : "")}
          aria-label={outlineOpen ? "Hide outline" : "Show outline"}
          data-kvasir-tip="Outline — the whole flow; jump to any step"
          onClick={() => tourStore.setOutlineOpen(!outlineOpen)}
        >
          <ListTree />
        </Button>
        <StepTools spec={spec} step={step} index={index} onRegen={() => setDialog(true)} />
      </div>

      {/* body: persistent outline rail (when open) + a drag/keyboard splitter, beside the content */}
      <div className="flex min-h-0 flex-1">
        {outlineOpen && (
          <>
            <Rail spec={spec} current={index} width={railW} />
            {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- accessible window-splitter, same pattern as the chat rail */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize outline"
              aria-valuenow={railW}
              aria-valuemin={RAIL_MIN}
              aria-valuemax={RAIL_MAX}
              tabIndex={0}
              className="w-[5px] shrink-0 cursor-col-resize border-x border-border bg-transparent transition-colors hover:border-primary/40 hover:bg-primary/60 focus-visible:border-primary focus-visible:bg-primary/60 focus-visible:outline-none"
              onMouseDown={onResize}
              onKeyDown={onResizeKey}
            />
            {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
          </>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Coverage coverage={spec.coverage} />
          <MainView spec={spec} step={step} diagramOpen={diagramOpen} />
        </div>
      </div>

      <Footer index={index} count={count} />
      {dialog && <RegenDialog onClose={() => setDialog(false)} />}
    </div>
  );
}

export function WalkthroughTab(): JSX.Element {
  useSyncExternalStore(subscribe, getSnapshot);
  if (launcherStore.generating()) return <Generating />;
  const spec = launcherStore.spec();
  if (!spec?.steps.length) return <Empty />;
  return <Steps spec={spec} />;
}
