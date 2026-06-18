// The walkthrough's contribution to the global left sidebar: the flow as a tree —
// file headers with their steps indented under connector lines, each with a status
// dot (upcoming / actually-visited / current). Clicking a step navigates. The
// sidebar shell (PanelSidebar) owns the width, scroll and resize; this just renders
// the content.
import type { WalkthroughStep } from "@kvasir/runes/spec";
import type { JSX } from "react";
import { launcherStore } from "../launcher";
import { tourStore } from "../tour";

// A step's status dot: current (accent), actually-visited (muted fill), or
// upcoming (hollow ring).
function dotClass(isCurrent: boolean, isVisited: boolean): string {
  if (isCurrent) return "bg-primary";
  if (isVisited) return "bg-muted-foreground";
  return "border border-muted-foreground/50";
}

export function OutlineRail(): JSX.Element | null {
  const spec = launcherStore.spec();
  const current = tourStore.stepIndex();
  if (!spec) return null;
  const groups: { file: string; items: { step: WalkthroughStep; index: number }[] }[] = [];
  let position = 0;
  for (const walkStep of spec.steps) {
    const last = groups.at(-1);
    if (last && last.file === walkStep.file) last.items.push({ step: walkStep, index: position });
    else groups.push({ file: walkStep.file, items: [{ step: walkStep, index: position }] });
    position += 1;
  }
  return (
    <div className="py-2" data-testid="outline">
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="mb-2">
          <div
            className="whitespace-nowrap px-3 py-1 font-mono text-[11px] text-muted-foreground/80"
            data-kvasir-tip={group.file}
          >
            {group.file}
          </div>
          <ul>
            {group.items.map((item, itemIndex) => {
              const isCurrent = item.index === current;
              return (
                <li key={item.index}>
                  <button
                    className={
                      "flex min-w-full items-center gap-1.5 whitespace-nowrap py-1.5 pl-3 pr-3 text-left text-sm hover:bg-muted " +
                      (isCurrent ? "font-medium text-primary" : "text-foreground/90")
                    }
                    aria-current={isCurrent ? "step" : undefined}
                    data-kvasir-tip={item.step.title}
                    onClick={() => tourStore.goto(item.index)}
                  >
                    <span className="select-none font-mono text-[11px] text-muted-foreground/40">
                      {itemIndex === group.items.length - 1 ? "└" : "├"}
                    </span>
                    <span
                      className={
                        "size-1.5 shrink-0 rounded-full " +
                        dotClass(isCurrent, tourStore.isVisited(item.step.id))
                      }
                    />
                    <span>{item.step.title}</span>
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
