// Both guides' contribution to the global left sidebar: the flow as a tree.
// Walkthrough steps group either by their logical `group` label (phases —
// "Foundation", "Consumers", …) when the spec declares any, or — for legacy specs
// with no groups — by file adjacency; review steps group by the repo they live in.
// Each step shows a status dot (upcoming / visited / current) under connector
// lines; clicking it navigates via the guide the rail was built for. The sidebar
// shell (PanelSidebar) owns the width, scroll and resize; this renders content.
import type { ReviewStep } from "@kvasir/runes/review";
import type { WalkthroughStep } from "@kvasir/runes/spec";
import { FileText } from "lucide-react";
import type { JSX } from "react";
import { launcherStore } from "../launcher";
import { reviewStore } from "../review";
import { tourStore } from "../tour";
import { Coverage } from "./Coverage";

/** The step-core fields the rail renders — both artifacts' steps carry them. */
type OutlineStep = { id: string; title: string; file: string };
// One step plus its GLOBAL index in the guide's steps — navigation, current, and
// visited all key off this index/id, never a per-group position.
type OutlineItem = { step: OutlineStep; index: number };
type OutlineGroup = { label: string; items: OutlineItem[] };

/** How rows act + read state — the walkthrough rail binds tourStore, the review
 * rail reviewStore; the tree rendering in between is shared. `navigating` disables
 * the rows while a cross-file navigation is in flight (review only — a walkthrough
 * jump never leaves the page), so a rail click can't stack a second navigation. */
type OutlineNav = {
  onStep: (index: number) => void;
  isVisited: (stepId: string) => boolean;
  navigating?: boolean;
};

const STEP_BTN_CLASS =
  "flex min-w-full items-center gap-1.5 whitespace-nowrap py-1.5 pl-3 pr-3 text-left text-sm hover:bg-muted ";

// A step's status dot: current (accent), actually-visited (muted fill), or
// upcoming (hollow ring).
function dotClass(isCurrent: boolean, isVisited: boolean): string {
  if (isCurrent) return "bg-primary";
  if (isVisited) return "bg-muted-foreground";
  return "border border-muted-foreground/50";
}

// Group steps by a label: first-appearance order of labels, authoring order within
// each, merging non-adjacent steps that share a label so a group is never split.
// Steps with no label collect into a trailing "Other" bucket.
function mergedGroups<Step extends OutlineStep>(
  steps: readonly Step[],
  labelOf: (step: Step) => string | undefined,
): OutlineGroup[] {
  const groups: OutlineGroup[] = [];
  const byLabel = new Map<string, OutlineItem[]>();
  const ungrouped: OutlineItem[] = [];
  for (const [index, step] of steps.entries()) {
    const label = labelOf(step);
    if (!label) {
      ungrouped.push({ step, index });
      continue;
    }
    let bucket = byLabel.get(label);
    if (!bucket) {
      // The group object shares this array by reference, so later pushes land in it —
      // first-appearance order with no second lookup.
      bucket = [];
      byLabel.set(label, bucket);
      groups.push({ label, items: bucket });
    }
    bucket.push({ step, index });
  }
  if (ungrouped.length > 0) groups.push({ label: "Other", items: ungrouped });
  return groups;
}

// The walkthrough's logical phases ("Foundation", "Consumers", …).
const logicalGroups = (steps: readonly WalkthroughStep[]): OutlineGroup[] =>
  mergedGroups(steps, (step) => step.group?.trim());

// A review's steps grouped by the repo they live in (every step has one).
const repoGroups = (steps: readonly ReviewStep[]): OutlineGroup[] =>
  mergedGroups(steps, (step) => `${step.repo.owner}/${step.repo.name}`);

// Legacy outline: group consecutive same-file steps under a file header.
function fileGroups(steps: readonly WalkthroughStep[]): OutlineGroup[] {
  const groups: OutlineGroup[] = [];
  for (const [index, step] of steps.entries()) {
    const last = groups.at(-1);
    if (last && last.label === step.file) last.items.push({ step, index });
    else groups.push({ label: step.file, items: [{ step, index }] });
  }
  return groups;
}

// A single step row: connector, status dot, title, and — when showFile is set — the
// file path as a dim caption so the location stays visible (the group header is a
// phase or a repo, not the file). showFile is false only in the legacy per-file
// grouping, where the header IS the file.
function StepRow({
  item,
  isLast,
  current,
  onOverview,
  showFile,
  nav,
}: Readonly<{
  item: OutlineItem;
  isLast: boolean;
  current: number;
  onOverview: boolean;
  showFile: boolean;
  nav: OutlineNav;
}>): JSX.Element {
  const isCurrent = !onOverview && item.index === current;
  return (
    <li>
      <button
        className={STEP_BTN_CLASS + (isCurrent ? "font-medium text-primary" : "text-foreground/90")}
        aria-current={isCurrent ? "step" : undefined}
        disabled={nav.navigating}
        onClick={() => nav.onStep(item.index)}
      >
        <span className="select-none font-mono text-[11px] text-muted-foreground/40">
          {isLast ? "└" : "├"}
        </span>
        <span
          className={"size-1.5 shrink-0 rounded-full " + dotClass(isCurrent, nav.isVisited(item.step.id))}
        />
        {showFile ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate">{item.step.title}</span>
            <span className="block truncate font-mono text-[10px] text-muted-foreground/55">
              {item.step.file}
            </span>
          </span>
        ) : (
          <span>{item.step.title}</span>
        )}
      </button>
    </li>
  );
}

// The list of groups: a header per group (a phase label, a repo, or the file path
// in legacy mode) with its steps nested and connectors running within the group.
function GroupList({
  groups,
  current,
  onOverview,
  showFile,
  nav,
}: Readonly<{
  groups: OutlineGroup[];
  current: number;
  onOverview: boolean;
  showFile: boolean;
  nav: OutlineNav;
}>): JSX.Element {
  return (
    <>
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="mb-2">
          {showFile ? (
            <div className="whitespace-nowrap px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/90">
              {group.label}
            </div>
          ) : (
            <div className="whitespace-nowrap px-3 py-1 font-mono text-[11px] text-muted-foreground/80">
              {group.label}
            </div>
          )}
          <ul>
            {group.items.map((item, itemIndex) => (
              <StepRow
                key={item.index}
                item={item}
                isLast={itemIndex === group.items.length - 1}
                current={current}
                onOverview={onOverview}
                showFile={showFile}
                nav={nav}
              />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

export function OutlineRail(): JSX.Element | null {
  const spec = launcherStore.spec();
  const current = tourStore.stepIndex();
  const onOverview = tourStore.atOverview();
  // While a (re)generation is running, the main pane shows "Generating…" and the old
  // spec is intentionally kept (so "Stop watching" can restore it) — but the outline
  // must NOT keep offering the prior walkthrough's steps, or clicking one jumps into
  // stale code. Render nothing until the fresh spec lands.
  if (!spec || launcherStore.generating()) return null;
  // Guardrail (enforced here, not just asked of the model): switch to logical
  // grouping ONLY when the labels actually cluster the steps — at least two groups
  // AND fewer groups than steps (so some group holds more than one step). A label
  // on every step (one-per-step) or a single all-steps label adds no structure, so
  // we fall back to the legacy per-file outline regardless of what the spec carries.
  const logical = logicalGroups(spec.steps);
  const grouped = logical.length >= 2 && logical.length < spec.steps.length;
  const groups = grouped ? logical : fileGroups(spec.steps);
  const hasCoverage = (spec.coverage?.significant.length ?? 0) > 0;
  return (
    <div data-testid="outline">
      {/* Tabs-aligned spacer: holds the coverage chip when present and offsets the tree
          down so the list starts roughly inline with the step content. Border only when
          there's coverage, so a spec without it leaves a clean gap, not an empty bar. */}
      <div className={"px-3 py-2.5" + (hasCoverage ? " border-b border-border" : "")}>
        <Coverage coverage={spec.coverage} />
      </div>
      <div className="py-2">
        {spec.overview && (
          <button
            className={
              "mb-2 flex min-w-full items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-left text-sm hover:bg-muted " +
              (onOverview ? "font-medium text-primary" : "text-foreground/90")
            }
            aria-current={onOverview ? "step" : undefined}
            onClick={() => tourStore.gotoOverview()}
          >
            <FileText className="size-3.5 shrink-0 text-muted-foreground/60" />
            <span>Overview</span>
          </button>
        )}
        <GroupList
          groups={groups}
          current={current}
          onOverview={onOverview}
          showFile={grouped}
          nav={{ onStep: (index) => tourStore.jumpToStep(index), isVisited: tourStore.isVisited }}
        />
      </div>
    </div>
  );
}

/** The review guide's rail: steps grouped by the repo they live in, the file as a
 * per-row caption (the header is the repo), no overview/coverage (a pushed review
 * has neither). Clicking navigates via reviewStore — possibly to another page. */
export function ReviewOutlineRail(): JSX.Element | null {
  const steps = reviewStore.steps();
  if (steps.length === 0) return null;
  return (
    <div data-testid="outline">
      <div className="py-2">
        <GroupList
          groups={repoGroups(steps)}
          current={reviewStore.stepIndex()}
          onOverview={false}
          showFile
          nav={{
            onStep: (index) => reviewStore.goto(index),
            isVisited: reviewStore.isVisited,
            navigating: reviewStore.navigating(),
          }}
        />
      </div>
    </div>
  );
}
