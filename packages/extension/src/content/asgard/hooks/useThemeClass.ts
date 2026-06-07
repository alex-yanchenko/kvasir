// Drives shadcn's class-based dark mode from the theme store. Toggles `.dark` on
// the target (the shadow host) so :host(.dark) tokens resolve. "auto" follows the
// OS via matchMedia (and its live changes); "light"/"dark" are fixed.
import { useEffect } from "react";
import { settingsStore } from "../store";

export function useThemeClass(target: HTMLElement | null): void {
  const theme = settingsStore.theme();
  useEffect(() => {
    if (!target) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (): void => {
      const dark = theme === "dark" || (theme === "auto" && mql.matches);
      target.classList.toggle("dark", dark);
    };
    apply();
    if (theme !== "auto") return;
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, [target, theme]);
}
