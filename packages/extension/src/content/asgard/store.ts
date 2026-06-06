// Asgard's store — stage two of the state.ts transition (MIGRATION.md): during
// coexistence it WRAPS the legacy mutable singleton as its backing object, so the
// vanilla world and React render from one source of truth. Reads pull live values
// from `state`; writes go through actions that mutate `state`, persist, fire the
// page command, and bump a version that useSyncExternalStore subscribes to. When
// the last vanilla reader dies (E2), the backing object folds into this store.

import { state } from "../state";
import { storeSet } from "../muninn";
import { chatsKey, prUrl } from "../keys";
import type { ChatSession } from "./types";
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

// ── chats slice ────────────────────────────────────────────────────────────────

/** Coexistence shim: the chat window is still vanilla; it registers how to open
 * and close itself here. Dies at D5 when ChatWindow becomes an Asgard island. */
export const legacyChatBridge: {
  openChat?: (sess: ChatSession) => void;
  openPrChat?: () => void;
  closeIfActive?: (key: string) => void;
} = {};

const persistChats = (): void => storeSet(chatsKey(prUrl()), state.chatHistory);

export const chatsStore = {
  sessions: (): ChatSession[] => state.chatHistory,
  openSession(sess: ChatSession): void {
    legacyChatBridge.openChat?.(sess);
  },
  dropSession(key: string): void {
    legacyChatBridge.closeIfActive?.(key);
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

/** One line summarising a session for the chats list: where — first question. */
export function chatSnippet(sess: ChatSession): string {
  const base = sess.general
    ? "This PR"
    : (sess.file ?? "").split("/").pop() + (sess.lines ? `:${sess.lines.start}` : "");
  const firstQ = sess.messages.find((m) => m.role === "user");
  const tail = firstQ ? firstQ.content : sess.general ? "" : sess.text.replace(/\s+/g, " ").slice(0, 40);
  return tail ? `${base} — ${tail}` : base;
}
