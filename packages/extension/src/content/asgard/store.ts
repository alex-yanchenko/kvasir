// Asgard's store. `state` is the store's mutable backing object (the end of the
// state.ts transition — MIGRATION.md): reads pull live values from it; writes go
// through actions (here and in the machines) that mutate it, persist, fire the
// page command, and bump a version that useSyncExternalStore subscribes to. A
// single object because ESM import bindings can't be reassigned — but object
// properties can, so every importer sees the same live values. Every mutation
// must be followed by touch() or React won't re-render.

import type { Review } from "@prw/runes/review";
import type { WalkthroughSpec, WalkthroughStep } from "@prw/runes/spec";
import { bifrost } from "../bifrost";
import { chatsKey, panelKey, prUrl } from "../keys";
import { storeSet } from "../muninn";
import type { ChatSession } from "./types";

export interface TourState {
  step: number;
  pos: { left: number; top: number } | null;
  size: { w: number; h: number } | null;
}

/** The consolidated panel's tabs (the redesign IA). Chat owns its own session
 * switcher (a left rail), so there is no separate History tab. */
export const PANEL_TABS = {
  WALKTHROUGH: "walkthrough",
  CHAT: "chat",
  SETTINGS: "settings",
} as const;
export type PanelTab = (typeof PANEL_TABS)[keyof typeof PANEL_TABS];
const PANEL_TAB_VALUES: readonly string[] = Object.values(PANEL_TABS);
/** Narrow a raw tab string (e.g. from Radix Tabs onValueChange) to a PanelTab. */
export const isPanelTab = (v: string): v is PanelTab => PANEL_TAB_VALUES.includes(v);

interface PanelState {
  open: boolean;
  tab: PanelTab;
  pos: { left: number; top: number } | null;
  size: { w: number; h: number } | null;
}

export const state: {
  spec: WalkthroughSpec | null;
  activeStep: WalkthroughStep | null;
  /** Review-mode (a pushed cross-repo review): the fetched review, current step,
   * and whether the review guide is active. Null/0/false outside review-mode. */
  review: Review | null;
  reviewStep: number;
  reviewOpen: boolean;
  theme: string; // "auto" | "light" | "dark"
  hlStyle: string; // "tint" | "github"
  tourState: TourState;
  chatHistory: ChatSession[]; // session objects, most recent first
  panel: PanelState;
} = {
  spec: null,
  activeStep: null,
  review: null,
  reviewStep: 0,
  reviewOpen: false,
  theme: localStorage.getItem("prwTheme") || "auto",
  hlStyle: localStorage.getItem("prwHl") || "tint",
  tourState: { step: 0, pos: null, size: null },
  chatHistory: [],
  panel: { open: false, tab: PANEL_TABS.WALKTHROUGH, pos: null, size: null },
};

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
  // Snapshot before notifying: a subscriber may unsubscribe (component unmount)
  // mid-notify, and iterating the live set would skip the next one.
  const snapshot = [...listeners];
  for (const fn of snapshot) fn();
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

// ── chats slice ────────────────────────────────────────────────────────────────

const persistChats = (): void => storeSet(chatsKey(prUrl()), state.chatHistory);

export const chatsStore = {
  sessions: (): ChatSession[] => state.chatHistory,
  dropSession(key: string): void {
    state.chatHistory = state.chatHistory.filter((s) => s.key !== key);
    persistChats();
    touch();
  },
  clearSessions(): void {
    state.chatHistory = [];
    persistChats();
    touch();
  },
};

// ── panel slice ──────────────────────────────────────────────────────────────
// The one consolidated panel: open/closed, which tab, and its movable/resizable
// geometry (persisted per-PR). Content lives in the tab bodies, which reuse the
// existing machines (tour/chat/launcher/pairing).

const persistPanel = (): void =>
  storeSet(panelKey(prUrl()), { pos: state.panel.pos, size: state.panel.size });

export const panelStore = {
  isOpen: (): boolean => state.panel.open,
  tab: (): PanelTab => state.panel.tab,
  pos: () => state.panel.pos,
  size: () => state.panel.size,

  /** Show the panel (optionally on a specific tab). */
  open(tab?: PanelTab): void {
    state.panel.open = true;
    if (tab) state.panel.tab = tab;
    touch();
  },
  close(): void {
    state.panel.open = false;
    touch();
  },
  setTab(tab: PanelTab): void {
    state.panel.tab = tab;
    touch();
  },
  setPos(pos: { left: number; top: number }): void {
    state.panel.pos = pos;
    persistPanel();
  },
  setSize(size: { w: number; h: number }): void {
    state.panel.size = size;
    persistPanel();
  },
};

/** One line summarising a session for the chats list: where — first question. */
export function chatSnippet(sess: ChatSession): string {
  const lineSuffix = sess.lines ? `:${sess.lines.start}` : "";
  const base = sess.general ? "This PR" : (sess.file ?? "").split("/").pop() + lineSuffix;
  const firstQ = sess.messages.find((m) => m.role === "user");
  const fallback = sess.general ? "" : sess.text.replaceAll(/\s+/g, " ").slice(0, 40);
  const tail = firstQ ? firstQ.content : fallback;
  return tail ? `${base} — ${tail}` : base;
}
