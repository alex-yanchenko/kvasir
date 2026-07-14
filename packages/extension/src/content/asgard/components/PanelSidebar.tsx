// The per-section nav column. Permanent beside the content while the window fits
// it; folds to a rail-toggled overlay when the window is narrow. Its CONTENT swaps
// per active section; a header band sized to the title bar keeps the list aligned
// with the content column. Width/scroll only; the resize splitter lives in Panel
// (it needs the panel size to redistribute width).
import type { JSX } from "react";
import { activeGuide } from "../guide";
import { PANEL_TABS, panelStore, type PanelTab } from "../store";
import { ChatList } from "./ChatList";
import { HistoryFacets } from "./HistoryFacets";
import { OutlineRail, ReviewOutlineRail } from "./OutlineRail";
import { SettingsNav } from "./SettingsNav";

// The header label per tab — matches the section the sidebar is navigating.
const SIDEBAR_LABELS: Record<PanelTab, string> = {
  [PANEL_TABS.WALKTHROUGH]: "Outline",
  [PANEL_TABS.CHAT]: "Chats",
  [PANEL_TABS.HISTORY]: "History",
  [PANEL_TABS.SETTINGS]: "Settings",
};

// Per-tab content. Walkthrough → the active guide's outline (the review rail on a
// ?kvasir page); Chat → the chat list; History → facet filters; Settings → section
// anchor nav.
function SidebarContent(): JSX.Element {
  const tab = panelStore.tab();
  if (tab === PANEL_TABS.WALKTHROUGH)
    return activeGuide().kind === "review" ? <ReviewOutlineRail /> : <OutlineRail />;
  if (tab === PANEL_TABS.CHAT) return <ChatList />;
  if (tab === PANEL_TABS.HISTORY) return <HistoryFacets />;
  return <SettingsNav />;
}

export function PanelSidebar(): JSX.Element {
  return (
    <div
      className="flex shrink-0 flex-col overflow-hidden"
      style={{ width: `${panelStore.sidebarWidth()}px` }}
      data-testid="sidebar"
    >
      {/* h-11 = the title bar's height (py-2 + h-7), so the list below lines up with
          the tabs/content to the right. */}
      <div className="flex h-11 shrink-0 items-center border-b border-border px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        {SIDEBAR_LABELS[panelStore.tab()]}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <SidebarContent />
      </div>
    </div>
  );
}
