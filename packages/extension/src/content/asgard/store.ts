// Asgard's store — stage two of the state.ts transition (MIGRATION.md): during
// coexistence it WRAPS the legacy mutable singleton as its backing object, so the
// vanilla world and React render from one source of truth. Reads pull live values
// from `state`; writes go through actions that mutate `state`, persist, fire the
// page command, and bump a version that useSyncExternalStore subscribes to. When
// the last vanilla reader dies (E2), the backing object folds into this store.

import { state } from "../state";
import { bifrost } from "../bifrost";

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Snapshot for useSyncExternalStore — a counter; renders then read live values. */
export function getSnapshot(): number {
  return version;
}

/** Bump after any backing-state mutation so subscribed components re-render. */
export function touch(): void {
  version++;
  for (const fn of [...listeners]) fn();
}

const applyToPage = (): void => bifrost.send("theme:apply", { theme: state.theme, hlStyle: state.hlStyle });

export const settingsStore = {
  theme: (): string => state.theme,
  hlStyle: (): string => state.hlStyle,
  setTheme(theme: string): void {
    state.theme = theme;
    localStorage.setItem("prwTheme", theme);
    applyToPage();
    touch();
  },
  setHlStyle(hlStyle: string): void {
    state.hlStyle = hlStyle;
    localStorage.setItem("prwHl", hlStyle);
    applyToPage();
    touch();
  },
};
