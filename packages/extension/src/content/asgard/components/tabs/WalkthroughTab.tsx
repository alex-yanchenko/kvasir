// Walkthrough tab — replaces the launcher block + the floating tour card. Three
// states: no spec (run a review), generating (status), or the step walkthrough.
// tourStore drives the page highlights; the tab mount/unmount starts/stops the
// tour so switching tabs or closing the panel clears the highlight.
import type { WalkthroughStep } from "@kvasir/runes/spec";
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
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { JSX } from "react";
import { bifrost } from "../../../bifrost";
import { sanitizeSpecHtml } from "../../../sanitize";
import { chatStore } from "../../chat";
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
function Coverage(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const coverage = launcherStore.spec()?.coverage;
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

// Flow outline (altitude): the whole walkthrough as a skeleton — step titles
// grouped by consecutive same-file runs so the flow's file structure is visible.
// Click a step to jump in and drop back to the walk. Open state is module-level
// (tourStore) so it survives a tab switch.
function Outline(): JSX.Element {
  const steps = launcherStore.spec()?.steps ?? [];
  const current = tourStore.stepIndex();
  const groups: { file: string; items: { title: string; index: number }[] }[] = [];
  let position = 0;
  for (const walkStep of steps) {
    const last = groups.at(-1);
    if (last && last.file === walkStep.file) last.items.push({ title: walkStep.title, index: position });
    else groups.push({ file: walkStep.file, items: [{ title: walkStep.title, index: position }] });
    position += 1;
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2" data-testid="outline">
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="mb-2">
          <div className="truncate font-mono text-xs text-muted-foreground" data-kvasir-tip={group.file}>
            {group.file}
          </div>
          <ul className="mt-0.5">
            {group.items.map((item) => (
              <li key={item.index}>
                <button
                  className={
                    "block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-muted " +
                    (item.index === current ? "bg-muted font-medium text-primary" : "")
                  }
                  onClick={() => {
                    tourStore.goto(item.index);
                    tourStore.setOutlineOpen(false);
                  }}
                >
                  <span className="text-muted-foreground">{item.index + 1}.</span> {item.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Jump trail: the file path the flow has taken to the current step — distinct
// consecutive files across steps[0..current], each crumb jumping to where that
// file's run begins. Pure-derived from the step index; hidden for a single-file
// flow (nothing to orient against).
function Trail(): JSX.Element | null {
  const steps = launcherStore.spec()?.steps ?? [];
  const current = tourStore.stepIndex();
  const crumbs: { file: string; index: number }[] = [];
  for (let index = 0; index <= current && index < steps.length; index += 1) {
    const file = steps[index]?.file ?? "";
    const last = crumbs.at(-1);
    if (!last || last.file !== file) crumbs.push({ file, index });
  }
  if (crumbs.length < 2) return null;
  return (
    <div
      className="flex items-center gap-1 overflow-x-auto border-b border-border px-3 py-1 text-xs text-muted-foreground"
      data-testid="trail"
    >
      {crumbs.map((crumb, crumbIndex) => (
        <span key={crumb.index} className="flex shrink-0 items-center gap-1">
          {crumbIndex > 0 && <ChevronRight className="size-3 opacity-50" />}
          <button
            className={
              "truncate font-mono hover:text-primary " +
              (crumbIndex === crumbs.length - 1 ? "text-primary" : "")
            }
            data-kvasir-tip={`Jump to ${crumb.file}`}
            onClick={() => tourStore.goto(crumb.index)}
          >
            {crumb.file.split("/").pop()}
          </button>
        </span>
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

function Steps(): JSX.Element {
  const [dialog, setDialog] = useState(false);
  const [copiedLog, setCopiedLog] = useState(false);
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

  // Arrow keys navigate; bound to the document AND the shadow root (the hotkey
  // shield keeps shadow-origin keys off the document), skipping editable fields.
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

  if (!step) return <Empty />;
  const newCommits = launcherStore.newCommits();
  const stepChat = chatStore.stepChat(step.id);
  const outlineOpen = tourStore.outlineOpen();
  const atFirst = index === 0;
  const atLast = index >= count - 1;
  return (
    <div className="flex h-full flex-col">
      {/* header: where you are + low-frequency utilities (re-scroll, regenerate) */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <span className="text-xs text-muted-foreground">
          Step <span className="font-medium text-primary">{index + 1}</span> / {count}
        </span>
        <div className="ml-auto flex items-center gap-1">
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
            onClick={() => setDialog(true)}
          >
            <RefreshCw />
          </Button>
        </div>
      </div>

      <Coverage />
      <Trail />

      {outlineOpen ? <Outline /> : <StepBody step={step} />}

      {/* wizard footer: Back (quiet) · progress dots · Next (accent) */}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
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
