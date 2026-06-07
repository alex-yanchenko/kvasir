// Asgard — the panel-UI realm. It never touches GitHub's page; everything
// crosses the Bifrost. Boot passes the shadow host so the theme's dark-mode class
// resolves against :host. The whole UI is one launcher chip + one tabbed panel.
import type { JSX } from "react";
import { LauncherChip } from "./components/LauncherChip";
import { Panel } from "./components/Panel";
import { Tooltips } from "./components/Tooltip";
import { useThemeClass } from "./hooks/useThemeClass";

export function App({ themeTarget = null }: { themeTarget?: HTMLElement | null } = {}): JSX.Element {
  useThemeClass(themeTarget);
  return (
    <>
      <LauncherChip />
      <Panel />
      <Tooltips />
    </>
  );
}
