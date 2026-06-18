// The global left sidebar shell. One open state + reserved width shared across all
// tabs (so switching tabs never resizes the panel — only opening/closing does), with
// its CONTENT swapped per active tab. Owns the width, horizontal scroll and the
// drag/keyboard resize; the per-tab pieces (OutlineRail, …) just render inside it.
// Width is driven live through tourStore so the panel's width tracks a drag in step.
import type { JSX, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { PANEL_TABS, panelStore } from "../store";
import { tourStore } from "../tour";
import { OutlineRail } from "./OutlineRail";

const SIDEBAR_MIN = 130;
const SIDEBAR_MAX = 360;
const NUDGE: Record<string, number> = { ArrowLeft: -16, ArrowRight: 16 };
const clampSidebar = (n: number): number => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(n)));

// Driven straight through tourStore (not local state) so the panel's width — derived
// from tourStore.railWidth — grows in lockstep during a drag. No closure state, so
// these live at module scope.
function onSidebarResize(event: ReactMouseEvent): void {
  event.preventDefault();
  const startX = event.clientX;
  const startW = tourStore.railWidth();
  const move = (moved: MouseEvent): void =>
    tourStore.setRailWidth(clampSidebar(startW + (moved.clientX - startX)));
  const up = (): void => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
}

function onSidebarResizeKey(event: ReactKeyboardEvent): void {
  const delta = NUDGE[event.key] ?? 0;
  if (!delta) return;
  event.preventDefault();
  tourStore.setRailWidth(clampSidebar(tourStore.railWidth() + delta));
}

// Per-tab content. Walkthrough → the outline; the other tabs get their own nav in
// later phases — until then, a quiet placeholder.
function SidebarContent(): JSX.Element {
  if (panelStore.tab() === PANEL_TABS.WALKTHROUGH) return <OutlineRail />;
  return <div className="p-3 text-xs text-muted-foreground/60">Nothing here yet.</div>;
}

export function PanelSidebar(): JSX.Element {
  const width = clampSidebar(tourStore.railWidth());
  return (
    <>
      <div
        className="flex shrink-0 flex-col overflow-auto"
        style={{ width: `${width}px` }}
        data-testid="sidebar"
      >
        <SidebarContent />
      </div>
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- accessible window-splitter, same pattern as the chat rail */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={width}
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        tabIndex={0}
        className="w-[5px] shrink-0 cursor-col-resize border-r border-border bg-transparent transition-colors hover:border-primary/40 hover:bg-primary/60 focus-visible:border-primary focus-visible:bg-primary/60 focus-visible:outline-none"
        onMouseDown={onSidebarResize}
        onKeyDown={onSidebarResizeKey}
      />
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
    </>
  );
}
