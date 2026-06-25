// The walkthrough's contribution to the global left sidebar: the flow as a tree.
// Steps group either by their logical `group` label (phases — "Foundation",
// "Consumers", …) when the spec declares any, or — for legacy specs with no groups
// — by file adjacency. Each step shows a status dot (upcoming / visited / current)
// under connector lines; clicking it navigates. The sidebar shell (PanelSidebar)
// owns the width, scroll and resize; this just renders the content.
import type { WalkthroughStep } from "@kvasir/runes/spec";
import { FileText } from "lucide-react";
import type { JSX } from "react";
import { launcherStore } from "../launcher";
import { tourStore } from "../tour";
import { Coverage } from "./Coverage";

// One step plus its GLOBAL index in spec.steps — navigation, current, and visited
// all key off this index/id, never a per-group position.
type OutlineItem = { step: WalkthroughStep; index: number };
type OutlineGroup = { label: string; items: OutlineItem[] };

const STEP_BTN_CLASS =
  "flex min-w-full items-center gap-1.5 whitespace-nowrap py-1.5 pl-3 pr-3 text-left text-sm hover:bg-muted ";

// A step's status dot: current (accent), actually-visited (muted fill), or
// upcoming (hollow ring).
function dotClass(isCurrent: boolean, isVisited: boolean): string {
  if (isCurrent) return "bg-primary";
  if (isVisited) return "bg-muted-foreground";
  return "border border-muted-foreground/50";
}

// Group steps by their logical `group` label: first-appearance order of labels,
// authoring order within each, merging non-adjacent steps that share a label so a
// group is never split. Steps with no label collect into a trailing "Other" bucket.
function logicalGroups(steps: readonly WalkthroughStep[]): OutlineGroup[] {
  const groups: OutlineGroup[] = [];
  const byLabel = new Map<string, OutlineItem[]>();
  const ungrouped: OutlineItem[] = [];
  for (const [index, step] of steps.entries()) {
    const label = step.group?.trim();
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

// A single step row: connector, status dot, title, and — in logical grouping — the
// file path as a dim caption so the location stays visible (the group header is the
// phase, not the file). In file grouping showFile is false (the header is the file).
function StepRow({
  item,
  isLast,
  current,
  onOverview,
  showFile,
}: Readonly<{
  item: OutlineItem;
  isLast: boolean;
  current: number;
  onOverview: boolean;
  showFile: boolean;
}>): JSX.Element {
  const isCurrent = !onOverview && item.index === current;
  return (
    <li>
      <button
        className={STEP_BTN_CLASS + (isCurrent ? "font-medium text-primary" : "text-foreground/90")}
        aria-current={isCurrent ? "step" : undefined}
        onClick={() => tourStore.jumpToStep(item.index)}
      >
        <span className="select-none font-mono text-[11px] text-muted-foreground/40">
          {isLast ? "└" : "├"}
        </span>
        <span
          className={
            "size-1.5 shrink-0 rounded-full " + dotClass(isCurrent, tourStore.isVisited(item.step.id))
          }
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

// The list of groups: a header per group (the phase label, or the file path in
// legacy mode) with its steps nested and connectors running within the group.
function GroupList({
  groups,
  current,
  onOverview,
  showFile,
}: Readonly<{
  groups: OutlineGroup[];
  current: number;
  onOverview: boolean;
  showFile: boolean;
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
  if (!spec) return null;
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
        <GroupList groups={groups} current={current} onOverview={onOverview} showFile={grouped} />
      </div>
    </div>
  );
}
