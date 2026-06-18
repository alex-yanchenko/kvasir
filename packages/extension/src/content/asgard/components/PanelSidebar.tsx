// The global left sidebar's content column. One open state + reserved width shared
// across all tabs (so switching tabs never resizes the panel — only toggling does),
// with its CONTENT swapped per active tab. Width/scroll only; the resize splitter
// lives in Panel (it needs the panel size to redistribute width).
import type { JSX } from "react";
import { PANEL_TABS, panelStore } from "../store";
import { tourStore } from "../tour";
import { ChatList } from "./ChatList";
import { OutlineRail } from "./OutlineRail";

// Per-tab content. Walkthrough → the outline; Chat → the chat list; History and
// Settings get their own nav in later phases — until then, a quiet placeholder.
function SidebarContent(): JSX.Element {
  const tab = panelStore.tab();
  if (tab === PANEL_TABS.WALKTHROUGH) return <OutlineRail />;
  if (tab === PANEL_TABS.CHAT) return <ChatList />;
  return <div className="p-3 text-xs text-muted-foreground/60">Nothing here yet.</div>;
}

export function PanelSidebar(): JSX.Element {
  return (
    <div
      className="flex shrink-0 flex-col overflow-auto"
      style={{ width: `${tourStore.railWidth()}px` }}
      data-testid="sidebar"
    >
      <SidebarContent />
    </div>
  );
}
