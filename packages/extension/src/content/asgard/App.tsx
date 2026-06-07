// Asgard — the panel-UI realm. It never touches GitHub's page; everything
// crosses the Bifrost. Boot passes the shadow host (for the dark-mode class) and
// the in-shadow portal container (so Radix popovers stay styled). The redesign
// migrates the scattered widgets into one tabbed panel island by island.
import type { JSX } from "react";
import { Launcher } from "./components/Launcher";
import { LauncherChip } from "./components/LauncherChip";
import { Panel } from "./components/Panel";
import { TourCard } from "./components/TourCard";
import { ChatWindow } from "./components/Chat";
import { Tooltips } from "./components/Tooltip";
import { useThemeClass } from "./hooks/useThemeClass";
import { PortalContainerProvider } from "./ui/portal-container";

export function App({
  themeTarget = null,
  portalContainer = null,
}: {
  themeTarget?: HTMLElement | null;
  portalContainer?: HTMLElement | null;
} = {}): JSX.Element {
  useThemeClass(themeTarget);
  return (
    <PortalContainerProvider container={portalContainer}>
      {/* new consolidated panel (tabs filled in island by island) */}
      <LauncherChip />
      <Panel />
      {/* legacy widgets — removed one per island as each tab lands */}
      <Launcher />
      <TourCard />
      <ChatWindow />
      <Tooltips />
    </PortalContainerProvider>
  );
}
