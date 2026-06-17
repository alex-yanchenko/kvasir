// Asgard's store. `state` is the store's mutable backing object (the end of the
// state.ts transition — MIGRATION.md): reads pull live values from it; writes go
// through actions (here and in the machines) that mutate it, persist, fire the
// page command, and bump a version that useSyncExternalStore subscribes to. A
// single object because ESM import bindings can't be reassigned — but object
// properties can, so every importer sees the same live values. Every mutation
// must be followed by touch() or React won't re-render.

import type { EntrySummary } from "@kvasir/runes/history";
import type { Review } from "@kvasir/runes/review";
import type { WalkthroughSpec, WalkthroughStep } from "@kvasir/runes/spec";
import { bifrost } from "../bifrost";
import { chatsKey, PANEL_STATE_KEY, prUrl } from "../keys";
import { storeSet } from "../muninn";
import { parsePanelState } from "./persisted";
import type { ChatSession } from "./types";

export interface TourState {
  step: number;
  pos: { left: number; top: number } | null;
  size: { w: number; h: number } | null;
}

/** The consolidated panel's tabs (the redesign IA). History lists the durable
 * store (PR + Code Walkthroughs); Chat owns its own session switcher (a left rail). */
export const PANEL_TABS = {
  WALKTHROUGH: "walkthrough",
  CHAT: "chat",
  HISTORY: "history",
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
  /** True between clicking a step that lives in a different file and the page
   * navigation that follows — drives a loading state so the nav doesn't feel like
   * an unexplained flash. Reset on every fresh page load. */
  reviewNavigating: boolean;
  /** Review nav: true = advance the panel only once the page lands (loading in
   * between); false = advance immediately. Default true. */
  reviewSync: boolean;
  /** Review depth: "heavy" has the session check out the PR's local clone (a
   * worktree at the PR head) and read the surrounding code for correctness;
   * "light" authors from the PR diff alone (gh only). Default heavy. */
  reviewMode: string; // "heavy" | "light"
  /** Filesystem root the session searches for the PR's local clone in heavy mode;
   * if the repo isn't found under it, heavy degrades to light. */
  reviewReposRoot: string;
  /** Preload 3 AI-suggested questions when a code/step chat opens. Default off. */
  preloadQuestions: boolean;
  theme: string; // "auto" | "light" | "dark"
  hlStyle: string; // "tint" | "github"
  tourState: TourState;
  chatHistory: ChatSession[]; // session objects, most recent first
  /** History (GET /history): null until first loaded; historyQuery filters it.
   * `seen` maps an entry id -> the version the FE last caught up to (drift flag). */
  history: EntrySummary[] | null;
  historyQuery: string;
  seen: Record<string, number>;
  /** True when the walkthrough/review this tab was viewing got deleted (here or in
   * another tab) — drives the "This walkthrough was deleted" notice. */
  guideDeleted: boolean;
  panel: PanelState;
} = {
  spec: null,
  activeStep: null,
  review: null,
  reviewStep: 0,
  reviewNavigating: false,
  reviewSync: localStorage.getItem("kvasirReviewSync") !== "false", // default on
  reviewMode: localStorage.getItem("kvasirReviewMode") || "heavy", // default heavy
  reviewReposRoot: localStorage.getItem("kvasirReviewReposRoot") || "~/code",
  preloadQuestions: localStorage.getItem("kvasirPreloadQuestions") === "true", // default off
  theme: localStorage.getItem("kvasirTheme") || "auto",
  hlStyle: localStorage.getItem("kvasirHl") || "tint",
  tourState: { step: 0, pos: null, size: null },
  chatHistory: [],
  history: null,
  historyQuery: "",
  seen: {},
  guideDeleted: false,
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
  reviewSync: (): boolean => state.reviewSync,
  setReviewSync(on: boolean): void {
    state.reviewSync = on;
    localStorage.setItem("kvasirReviewSync", String(on));
    touch();
  },
  reviewMode: (): string => state.reviewMode,
  reviewReposRoot: (): string => state.reviewReposRoot,
  setReviewMode(mode: string): void {
    state.reviewMode = mode;
    localStorage.setItem("kvasirReviewMode", mode);
    touch();
  },
  setReviewReposRoot(root: string): void {
    state.reviewReposRoot = root;
    localStorage.setItem("kvasirReviewReposRoot", root);
    touch();
  },
  preloadQuestions: (): boolean => state.preloadQuestions,
  setPreloadQuestions(on: boolean): void {
    state.preloadQuestions = on;
    localStorage.setItem("kvasirPreloadQuestions", String(on));
    touch();
  },
  setTheme(theme: string): void {
    state.theme = theme;
    localStorage.setItem("kvasirTheme", theme);
    applyToPage();
    touch();
  },
  setHlStyle(hlStyle: string): void {
    state.hlStyle = hlStyle;
    localStorage.setItem("kvasirHl", hlStyle);
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
// geometry. The whole state is persisted PER-TAB in sessionStorage (PANEL_STATE_KEY)
// so it survives refresh + same-tab navigation, stays independent across tabs, and a
// child tab inherits it via the browser's sessionStorage copy. Content lives in the
// tab bodies, which reuse the existing machines (tour/chat/launcher/pairing).

const persistPanel = (): void => {
  try {
    sessionStorage.setItem(
      PANEL_STATE_KEY,
      JSON.stringify({
        open: state.panel.open,
        tab: state.panel.tab,
        pos: state.panel.pos,
        size: state.panel.size,
      }),
    );
  } catch {
    /* sessionStorage unavailable — geometry/open just won't persist this session */
  }
};

const readPanelState = (): unknown => {
  try {
    const raw = sessionStorage.getItem(PANEL_STATE_KEY);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
};

/** Restore the panel's per-tab state at boot — SYNCHRONOUS so the first paint is
 * already correct (no async flash) and review-mode sees the hydrated tab. */
export function hydratePanel(): void {
  const parsed = parsePanelState(readPanelState());
  state.panel.open = parsed.open;
  if (parsed.tab && isPanelTab(parsed.tab)) state.panel.tab = parsed.tab;
  state.panel.pos = parsed.pos;
  state.panel.size = parsed.size;
}

export const panelStore = {
  isOpen: (): boolean => state.panel.open,
  tab: (): PanelTab => state.panel.tab,
  pos: () => state.panel.pos,
  size: () => state.panel.size,

  /** Show the panel (optionally on a specific tab). */
  open(tab?: PanelTab): void {
    state.panel.open = true;
    if (tab) state.panel.tab = tab;
    persistPanel(); // remember open + tab per-tab so navigation/refresh keeps the window
    touch();
  },
  close(): void {
    state.panel.open = false;
    state.guideDeleted = false; // dismiss any lingering "deleted" notice on close
    persistPanel();
    touch();
  },
  setTab(tab: PanelTab): void {
    state.panel.tab = tab;
    persistPanel();
    touch();
  },

  /** The "this walkthrough was deleted" notice shows only while nothing is loaded to
   * replace it — so generating/opening a fresh walkthrough auto-hides it. */
  guideDeleted: (): boolean => state.guideDeleted && state.review === null && state.spec === null,
  dismissGuideDeleted(): void {
    state.guideDeleted = false;
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
