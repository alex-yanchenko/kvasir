// Asgard's store. `state` is the store's mutable backing object: reads pull live
// values from it; writes go through actions (here and in the machines) that mutate
// it, persist, fire the
// page command, and bump a version that useSyncExternalStore subscribes to. A
// single object because ESM import bindings can't be reassigned — but object
// properties can, so every importer sees the same live values. Every mutation
// must be followed by touch() or React won't re-render.

import type { EntrySummary } from "@kvasir/runes/history";
import type { Review } from "@kvasir/runes/review";
import type { WalkthroughSpec, WalkthroughStep } from "@kvasir/runes/spec";
import { bifrost } from "../bifrost";
import { chatScope, chatsKey, PANEL_STATE_KEY } from "../keys";
import { storeSet } from "../muninn";
import {
  readLocal,
  readLocalJson,
  readSessionJson,
  writeLocal,
  writeLocalJson,
  writeSessionJson,
} from "./lib/persist";
import { parsePanelPrefs, parsePanelState } from "./persisted";
import type { ChatSession } from "./types";

export interface PersistedTour {
  step: number;
  /** Whether the overview "step 0" was the active view — so close/reopen restores it
   * rather than always resuming on a code step. */
  overview?: boolean;
  pos: { left: number; top: number } | null;
  size: { w: number; h: number } | null;
  /** Step ids the user has opened — the outline's "visited" dots. Rides the
   * persisted tour state so a reload keeps them; `visitedStamp` pins them to the
   * spec's generatedAt, so a regenerated walkthrough starts with fresh dots. */
  visited?: string[];
  visitedStamp?: string;
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

export interface LauncherState {
  generating: boolean;
  /** True until the first live/cache probe for this PR settles — lets the tab
   * render "checking" instead of the empty state (loading ≠ none). */
  specLoading: boolean;
  newCommits: boolean;
  currentHead: string | null;
  genStartAt: number;
  /** Why the last generate attempt ended without a spec — rendered inline with a
   * Retry. Null while nothing is wrong; a 401 stays null (the pair banner owns it). */
  genError: string | null;
  /** The last requested mode + range, so Retry re-issues exactly what failed. */
  lastGen: { mode: "new" | "incremental"; sinceSha: string | undefined };
}

export interface TourUiState {
  open: boolean;
  stepIndex: number;
  /** The overview "step 0" view — before the first code step, outside steps[]. */
  atOverview: boolean;
  detailOpen: boolean;
  diagramOpen: boolean;
}

/** Fresh machine-slice defaults — the state initializer below and each machine's
 * resetForPr both build from these, so boot and reset can't drift apart.
 * Factories, not consts: launcher nests an object (lastGen) that must never be
 * shared between resets. */
export const launcherDefaults = (): LauncherState => ({
  generating: false,
  specLoading: true,
  newCommits: false,
  currentHead: null,
  genStartAt: 0,
  genError: null,
  lastGen: { mode: "new", sinceSha: undefined },
});
export const tourDefaults = (): TourUiState => ({
  open: false,
  stepIndex: 0,
  atOverview: false,
  detailOpen: false,
  diagramOpen: false,
});

// Walkthrough-highlight styles: "rail" (left rail only — the default) and "gutter"
// (rail + a faint wash on the line-number columns). A retired/unknown stored value
// (e.g. an old "tint"/"github") falls back to the rail default.
const HL_STYLES = new Set(["rail", "gutter"]);
export const validHlStyle = (v: string | null): string => (v !== null && HL_STYLES.has(v) ? v : "rail");

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
  /** Why a ?kvasir link produced no review: "notfound" = the channel answered but
   * has no such walkthrough (links are machine-local). An unreachable channel is
   * NOT tracked here — the connection banner (pairing phase) owns that message.
   * Null when nothing is missing (including cached renders). */
  reviewMissing: "notfound" | null;
  /** Step ids the reader has navigated to (the outline's visited dots). Scoped to
   * the current review's generation — a re-push resets it (see applyReview);
   * persisted inside the per-review cache, so it pairs with the review it counts. */
  reviewVisited: string[];
  /** Step nav: true = advance the panel only once the page lands (loading in
   * between); false = advance immediately. Default true. */
  reviewSync: boolean;
  /** Walkthrough depth: "heavy" has the session check out the PR's local clone (a
   * worktree at the PR head) and read the surrounding code for context — what the
   * feature is and how the change flows; "light" authors from the PR diff alone
   * (gh only). Default heavy. */
  reviewMode: string; // "heavy" | "light"
  /** True until the user dismisses the one-time first-run card (channel → pair →
   * run) shown in the walkthrough tab's empty state. Persisted per machine. */
  firstRun: boolean;
  /** Preload 3 AI-suggested questions when a code/step chat opens. Default off. */
  preloadQuestions: boolean;
  /** Ask the session to author a mermaid flow diagram into the spec. Default off
   * (it adds time to generation and pulls in the lazy-loaded mermaid renderer). */
  generateDiagram: boolean;
  theme: string; // "auto" | "light" | "dark"
  hlStyle: string; // "rail" (left rail only) | "gutter" (rail + faint gutter wash)
  persistedTour: PersistedTour;
  chatHistory: ChatSession[]; // session objects, most recent first
  /** History (GET /history): null until first loaded; historyQuery filters it.
   * `seen` maps an entry id -> the version the FE last caught up to (drift flag). */
  history: EntrySummary[] | null;
  historyQuery: string;
  /** Sidebar facet narrowing the History list: "all" | "pr" | "code" | "stale". */
  historyFacet: string;
  seen: Record<string, number>;
  /** True when the walkthrough/review this tab was viewing got deleted (here or in
   * another tab) — drives the "This walkthrough was deleted" notice. */
  guideDeleted: boolean;
  panel: PanelState;
  /** The generation machine (launcher.ts): the request/poll lifecycle of
   * (re)generating a walkthrough. Reset on PR navigation (resetForPr). The poll
   * timer handle stays module-local in launcher.ts — a resource, not state. */
  launcher: LauncherState;
  /** The tour machine's interaction state (tour.ts): which step is showing and
   * which panes are expanded. Machine-lifetime so it survives a tab switch —
   * DISTINCT from persistedTour above, which is the per-PR PERSISTED step/geometry. */
  tour: TourUiState;
  /** Cross-tab panel preferences, persisted GLOBALLY (localStorage): the nav
   * column. sidebarOpen is the persisted INTENT — it shows the inline column
   * while the window fits it (the folded overlay is transient Panel state, not
   * this); sidebarWidth is the column's width. Lives beside — not inside —
   * `panel`, whose open/tab persist per-tab. */
  panelPrefs: { sidebarOpen: boolean; sidebarWidth: number };
} = {
  spec: null,
  activeStep: null,
  review: null,
  reviewStep: 0,
  reviewNavigating: false,
  reviewMissing: null,
  reviewVisited: [],
  reviewSync: readLocal("kvasirReviewSync") !== "false", // default on
  reviewMode: readLocal("kvasirReviewMode") || "heavy", // default heavy
  firstRun: readLocal("kvasirFirstRunDone") !== "true", // shows until dismissed once
  preloadQuestions: readLocal("kvasirPreloadQuestions") === "true", // default off
  generateDiagram: readLocal("kvasirGenerateDiagram") === "true", // default off
  theme: readLocal("kvasirTheme") || "auto",
  hlStyle: validHlStyle(readLocal("kvasirHl")),
  persistedTour: { step: 0, overview: false, pos: null, size: null },
  chatHistory: [],
  history: null,
  historyQuery: "",
  historyFacet: "all",
  seen: {},
  guideDeleted: false,
  panel: { open: false, tab: PANEL_TABS.WALKTHROUGH, pos: null, size: null },
  launcher: launcherDefaults(),
  tour: tourDefaults(),
  panelPrefs: {
    sidebarOpen: true, // the nav column is on by default; the rail's active icon toggles it
    sidebarWidth: Number(readLocal("kvasirSidebarWidth")) || 190,
  },
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
    writeLocal("kvasirReviewSync", String(on));
    touch();
  },
  reviewMode: (): string => state.reviewMode,
  setReviewMode(mode: string): void {
    state.reviewMode = mode;
    writeLocal("kvasirReviewMode", mode);
    touch();
  },
  firstRun: (): boolean => state.firstRun,
  /** Fired by "Got it" AND by every Run-walkthrough click (completing the steps
   * is a dismissal too), so a repeat must be a no-op, not a version bump. */
  dismissFirstRun(): void {
    if (!state.firstRun) return;
    state.firstRun = false;
    writeLocal("kvasirFirstRunDone", "true");
    touch();
  },
  preloadQuestions: (): boolean => state.preloadQuestions,
  setPreloadQuestions(on: boolean): void {
    state.preloadQuestions = on;
    writeLocal("kvasirPreloadQuestions", String(on));
    touch();
  },
  generateDiagram: (): boolean => state.generateDiagram,
  setGenerateDiagram(on: boolean): void {
    state.generateDiagram = on;
    writeLocal("kvasirGenerateDiagram", String(on));
    touch();
  },
  setTheme(theme: string): void {
    state.theme = theme;
    writeLocal("kvasirTheme", theme);
    applyToPage();
    touch();
  },
  setHlStyle(hlStyle: string): void {
    state.hlStyle = hlStyle;
    writeLocal("kvasirHl", hlStyle);
    applyToPage();
    touch();
  },
};

// ── chats slice ────────────────────────────────────────────────────────────────

/** Persist the chat history under the active guide's scope (PR url or review id);
 * with no scope there is no guide to key it under, so nothing is written. Shared
 * with chat.ts — the one place the scope-guarded write lives. */
export const persistChats = (): void => {
  const scope = chatScope();
  if (scope) storeSet(chatsKey(scope), state.chatHistory);
};

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
// The one consolidated panel, split across two persistence scopes:
//   • PER-TAB (sessionStorage PANEL_STATE_KEY): open + tab + scope — session
//     state. open MUST be per-tab so a fresh tab doesn't auto-open the panel on
//     every github page, and it's honored only on the guide (scope) it was
//     opened on, so this tab navigating to a different PR starts at the chip.
//   • GLOBAL (localStorage PANEL_PREFS_KEY): the window's SHAPE — pos, size, plus
//     sidebarOpen (the persisted intent showing the inline nav column while it
//     fits; the folded overlay is transient Panel state, not this) — cross-tab
//     preferences like sidebarWidth, so reopening a review in a new tab restores
//     your last size/position instead of the default.
// Content lives in the tab bodies, which reuse the existing machines.

/** localStorage key for the global window shape (pos + size + sidebarOpen).
 * v2: size.w is the WINDOW width — v1 stored the content-column width under the
 * bare "kvasir:panelPrefs" key, so the bump drops v1 blobs instead of
 * reinterpreting them. */
const PANEL_PREFS_KEY = "kvasir:panelPrefs.v2";

// The nav-column state lives on state.panelPrefs, not in tourStore, so the
// walkthrough's close()/regenerate can never collapse a sidebar opened on another
// tab (see the panelPrefs field doc for the per-tab vs cross-tab persistence split).

const persistPanel = (): void => {
  // scope = the guide this open state belongs to (PR url / review id): navigating
  // this tab to a DIFFERENT PR starts closed at the chip.
  writeSessionJson(PANEL_STATE_KEY, { open: state.panel.open, tab: state.panel.tab, scope: chatScope() });
};

/** Persist the window shape globally (survives across tabs), separate from the per-tab
 * open/tab blob. */
const persistPrefs = (): void => {
  writeLocalJson(PANEL_PREFS_KEY, {
    pos: state.panel.pos,
    size: state.panel.size,
    sidebarOpen: state.panelPrefs.sidebarOpen,
  });
};

/** Restore the panel at boot — SYNCHRONOUS so the first paint is already correct (no
 * async flash) and review-mode sees the hydrated tab. open/tab come from the per-tab
 * sessionStorage blob; the window shape (pos/size/sidebar) from the global entry. */
export function hydratePanel(): void {
  const perTab = parsePanelState(readSessionJson(PANEL_STATE_KEY));
  // open is restored only on the guide it was opened on (refresh, Conversation↔Files);
  // the tab preference survives regardless.
  state.panel.open = perTab.open && perTab.scope === chatScope();
  if (perTab.tab && isPanelTab(perTab.tab)) state.panel.tab = perTab.tab;
  const prefs = parsePanelPrefs(readLocalJson(PANEL_PREFS_KEY));
  state.panel.pos = prefs.pos;
  state.panel.size = prefs.size;
  state.panelPrefs.sidebarOpen = prefs.sidebarOpen;
  // pre-v2 storage keys (renamed away) — deletion keeps the profile tidy
  for (const stale of ["kvasir:panelPrefs", "kvasirRailWidth"]) {
    try {
      localStorage.removeItem(stale);
    } catch {
      // storage unavailable (private mode) — nothing to clean anyway
    }
  }
}

export const panelStore = {
  isOpen: (): boolean => state.panel.open,
  tab: (): PanelTab => state.panel.tab,
  pos: () => state.panel.pos,
  size: () => state.panel.size,
  sidebarOpen: (): boolean => state.panelPrefs.sidebarOpen,
  setSidebarOpen(value: boolean): void {
    state.panelPrefs.sidebarOpen = value;
    persistPrefs(); // global (cross-tab), alongside pos/size
    touch();
  },
  sidebarWidth: (): number => state.panelPrefs.sidebarWidth,
  setSidebarWidth(width: number): void {
    // Bounds mirror the sidebar splitter (Panel) so every caller stays in range.
    state.panelPrefs.sidebarWidth = Math.min(360, Math.max(130, Math.round(width)));
    writeLocal("kvasirSidebarWidth", String(state.panelPrefs.sidebarWidth));
    touch();
  },

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
  // These DO touch() (the store invariant): the corner grip's live drag renders
  // geometry straight from the store, so a silent write would freeze it on screen.
  // The title-bar drag and the resize observer move the DOM first and persist
  // after, so the extra render is a no-op for them.
  setPos(pos: { left: number; top: number }): void {
    state.panel.pos = pos;
    persistPrefs();
    touch();
  },
  setSize(size: { w: number; h: number }): void {
    state.panel.size = size;
    persistPrefs();
    touch();
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
