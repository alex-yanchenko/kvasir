// Asgard — the panel-UI realm. It never touches GitHub's page; everything
// crosses the Bifrost. Boot passes the shadow host so the theme's dark-mode class
// resolves against :host. The whole UI is one launcher chip + one tabbed panel.
import { useSyncExternalStore } from "react";
import type { JSX } from "react";
import { LauncherChip } from "./components/LauncherChip";
import { Panel } from "./components/Panel";
import { Tooltips } from "./components/Tooltip";
import { useThemeClass } from "./hooks/useThemeClass";
import { getSnapshot, subscribe } from "./store";

export function App({ themeTarget = null }: { themeTarget?: HTMLElement | null } = {}): JSX.Element {
  // Subscribe so a theme change (settingsStore.setTheme → touch) re-renders and
  // useThemeClass re-applies live — otherwise the theme only updates on refresh.
  useSyncExternalStore(subscribe, getSnapshot);
  useThemeClass(themeTarget);
  return (
    <>
      <LauncherChip />
      <Panel />
      <Tooltips />
    </>
  );
}
