// Drives shadcn's class-based dark mode from the theme store. Toggles `.dark` on
// the target (the shadow host) so :host(.dark) tokens resolve. "auto" follows the
// OS via matchMedia (and its live changes); "light"/"dark" are fixed.
import { useEffect, useSyncExternalStore } from "react";
import { getSnapshot, settingsStore, subscribe } from "../store";

export function useThemeClass(target: HTMLElement | null): void {
  useSyncExternalStore(subscribe, getSnapshot); // re-render on a theme change so the effect re-applies
  const theme = settingsStore.theme();
  useEffect(() => {
    if (!target) return;
    // matchMedia is only consulted for "auto" — fixed light/dark never touch it.
    const mql = theme === "auto" ? globalThis.matchMedia("(prefers-color-scheme: dark)") : null;
    const apply = (): void => {
      target.classList.toggle("dark", theme === "dark" || (theme === "auto" && !!mql?.matches));
    };
    apply();
    if (!mql) return;
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, [target, theme]);
}
