// The chat machine — Asgard-owned. Sessions live in the store's backing state
// as immutable updates; this picks which session the Chat tab shows, builds
// /ask requests (selection- or PR-level), regenerates answers in place, and
// prefetches the AI suggestions. The panel owns window geometry; this owns the
// content. Opening any session routes the panel to its Chat tab.

import { api } from "../api";
import { bifrost } from "../bifrost";
import type { Bifrost, SelectionPayload } from "../bifrost";
import { chatsKey, prUrl } from "../keys";
import { storeSet } from "../muninn";
import { friendlyError } from "./friendly";
import { activeGuide } from "./guide";
import { pairingStore } from "./pairing";
import { chatsStore, PANEL_TABS, panelStore, settingsStore, state, touch } from "./store";
import type { ChatMessage, ChatSession } from "./types";

export type AskOutcome = { ok: true; streamed: boolean } | { ok: false; error: string };

/** Live progress of the one in-flight question — ephemeral, never persisted. */
export interface LiveAsk {
  key: string;
  note: string | null;
  text: string;
}

export const POLL_MS = 600;
/** How long a citation-miss note stays up before clearing itself. */
export const REF_NOTICE_MS = 5000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let activeKey: string | null = null;
let live: LiveAsk | null = null;
/** Transient "that file isn't in this diff" note — raised by a ref:missing report
 * when a clicked citation has no target on the page; self-clears. */
let refNotice: string | null = null;
let refNoticeTimer: ReturnType<typeof setTimeout> | null = null;

/** Stable key for the overview "step 0" chat, so re-asking reopens it. */
const OVERVIEW_CHAT_KEY = "overview";

const persist = (): void => storeSet(chatsKey(prUrl()), state.chatHistory);

const update = (key: string, fn: (s: ChatSession) => ChatSession): void => {
  state.chatHistory = state.chatHistory.map((s) => (s.key === key ? fn(s) : s));
  persist();
  touch();
};

/** Quick actions for a code-selection chat. */
export const QUICK = [
  { label: "Explain", q: "Explain what this code does." },
  {
    label: "Why this approach?",
    q: "Why might it be written this way, and what are the trade-offs vs. alternatives?",
  },
  { label: "Bugs & edge cases", q: "Any bugs, edge cases, or risks in this code?" },
  { label: "How's it tested?", q: "How is this covered by tests, and what's missing?" },
  {
    label: "Draft review comment",
    q: "Draft a concise, constructive GitHub PR review comment about this code.",
  },
];

/** Quick prompts for the whole-PR chat — no code selection backing them. */
export const QUICK_PR = [
  { label: "Summarize", q: "Summarize this PR — what does it change, and why?" },
  { label: "Main risks", q: "What are the main risks or things to scrutinize when reviewing this PR?" },
  { label: "Where to focus", q: "As a reviewer, which files or changes should I look at first, and why?" },
  { label: "Test coverage", q: "How is this PR tested, and what's missing?" },
];

/** A 401 from any bridge call means our token is stale/absent: drop it so the
 * UI flips to "pair to continue". Returns true when it handled a 401. */
function handleAuth(r: { status?: number }): boolean {
  if (r.status !== 401) return false;
  pairingStore.markUnpaired();
  return true;
}

const idOf = (data: unknown): string | null =>
  typeof data === "object" && data !== null && "id" in data && typeof data.id === "string" ? data.id : null;

interface AskSnapshot {
  notes: string[];
  text: string;
  done: boolean;
  timedOut: boolean;
}

const snapOf = (data: unknown): AskSnapshot | null =>
  typeof data === "object" &&
  data !== null &&
  "done" in data &&
  typeof data.done === "boolean" &&
  "text" in data &&
  typeof data.text === "string" &&
  "timedOut" in data &&
  typeof data.timedOut === "boolean" &&
  "notes" in data &&
  Array.isArray(data.notes)
    ? { notes: data.notes.map(String), text: data.text, done: data.done, timedOut: data.timedOut }
    : null;

const suggestionsOf = (data: unknown): string[] | null =>
  typeof data === "object" && data !== null && "suggestions" in data && Array.isArray(data.suggestions)
    ? data.suggestions.map(String)
    : null;

type PollResult = { ok: true; text: string; streamed: boolean } | { ok: false; error: string };

/** Poll the answer stream to completion, mirroring it into the live bubble (notes +
 * partial text). Resolves to the finished text plus whether any partial was shown
 * (so the caller can skip the cosmetic typewriter replay). */
async function pollAnswer(key: string, id: string): Promise<PollResult> {
  live = { key, note: null, text: "" };
  touch();
  let previousNote: string | null = null; // mirror the live bubble to diff without re-reading the nullable singleton
  let previousText = "";
  let sawPartial = false; // any text shown before done → skip the cosmetic typewriter
  // Repaint the live bubble only when the note or text actually changed.
  const mirror = (note: string | null, text: string): void => {
    if (note === previousNote && text === previousText) return;
    previousNote = note;
    previousText = text;
    live = { key, note, text };
    touch();
  };
  try {
    for (;;) {
      await sleep(POLL_MS);
      const poll = await api(`/poll?id=${encodeURIComponent(id)}`);
      const snap = poll.ok ? snapOf(poll.data) : null;
      if (!snap) {
        handleAuth(poll);
        return { ok: false, error: friendlyError(poll) };
      }
      mirror(snap.notes.at(-1) ?? null, snap.text);
      if (!snap.done) {
        if (snap.text) sawPartial = true;
        continue;
      }
      if (!snap.text) {
        return { ok: false, error: friendlyError({ error: snap.timedOut ? "request timed out" : "" }) };
      }
      return { ok: true, text: snap.text, streamed: sawPartial };
    }
  } finally {
    live = null;
    touch();
  }
}

export const chatStore = {
  active: (): ChatSession | null => state.chatHistory.find((s) => s.key === activeKey) ?? null,
  live: (): LiveAsk | null => live,
  refNotice: (): string | null => refNotice,

  /** The chat opened from a given walkthrough step, if one exists. */
  stepChat: (stepId: string): ChatSession | null =>
    state.chatHistory.find((s) => s.stepId === stepId) ?? null,

  /** The overview "step 0" chat (whole-PR, seeded from the overview), if opened. */
  overviewChat: (): ChatSession | null => state.chatHistory.find((s) => s.key === OVERVIEW_CHAT_KEY) ?? null,

  /** Show a session in the Chat tab; routes the panel there and repaints its
   * selection on the page (general PR chat has none). */
  open(sess: ChatSession): void {
    activeKey = sess.key;
    if (!sess.general)
      bifrost.send("pick:rehighlight", { file: sess.file ?? "", text: sess.text, lines: sess.lines });
    panelStore.open(PANEL_TABS.CHAT);
    touch();
  },

  /** A code selection asks for a chat (grip ask buttons, tour step-ask). */
  openSelection(p: SelectionPayload, withStep: boolean): void {
    void pairingStore.recheck(); // verify pairing when a chat starts (selection asks don't 401 until send)
    let sess = state.chatHistory.find((c) => c.key === p.selectionId);
    if (!sess) {
      sess = {
        key: p.selectionId,
        file: p.file,
        lines: p.lines,
        text: p.text,
        suggestions: null,
        messages: [],
        ...(p.stepId ? { stepId: p.stepId } : {}),
      };
      state.chatHistory = [sess, ...state.chatHistory];
      persist();
    }
    if (withStep) {
      update(sess.key, (s) => ({ ...s, step: activeGuide().stepContext() }));
    }
    const latest = state.chatHistory.find((c) => c.key === p.selectionId);
    if (latest) chatStore.open(latest);
  },

  /** Open (or reopen) the whole-PR chat anchored to the overview "step 0". General
   * (no code selection) since the overview has no code target; stable-keyed so
   * re-asking returns to the same session. The /ask background context already
   * carries the overview, so the chat is grounded without a selection. */
  openOverview(): void {
    void pairingStore.recheck(); // verify pairing when a chat starts (asks don't 401 until send)
    let sess = state.chatHistory.find((s) => s.key === OVERVIEW_CHAT_KEY);
    if (!sess) {
      sess = {
        key: OVERVIEW_CHAT_KEY,
        general: true,
        file: null,
        lines: null,
        text: "",
        suggestions: [],
        messages: [],
      };
      state.chatHistory = [sess, ...state.chatHistory];
      persist();
    }
    chatStore.open(sess);
  },

  /** Start a fresh whole-PR chat (the Chat rail's "New chat") — always a new
   * session, so several can run side by side. */
  newChat(): void {
    void pairingStore.recheck(); // a local New chat never 401s — verify so a stale token surfaces re-pair
    const sess: ChatSession = {
      key: `chat:${Date.now()}`,
      general: true,
      file: null,
      lines: null,
      text: "",
      suggestions: [],
      messages: [],
    };
    state.chatHistory = [sess, ...state.chatHistory];
    persist();
    chatStore.open(sess);
  },

  /** Delete any session by key (the rail's per-row trash). Clears the page
   * highlight and the active slot when it's the one being removed. */
  deleteSession(key: string): void {
    if (key === activeKey) {
      activeKey = null;
      bifrost.send("pick:clear", undefined);
    }
    chatsStore.dropSession(key); // filters state.chatHistory, persists, touches
  },

  /** Leave the current chat (clear the page highlight); the session stays in
   * History. The Chat tab falls back to its empty state. */
  closeActive(): void {
    activeKey = null;
    bifrost.send("pick:clear", undefined);
    touch();
  },

  /** Close for good: clears the active chat, history entry, storage, highlight. */
  deleteActive(): void {
    const key = activeKey;
    activeKey = null;
    bifrost.send("pick:clear", undefined);
    if (key) {
      state.chatHistory = state.chatHistory.filter((s) => s.key !== key);
      persist();
    }
    touch();
  },

  /** Send a question. pushUser=false resumes an already-recorded trailing user
   * turn (e.g. after a refresh dropped the in-flight request); replaceIdx
   * overwrites that assistant turn in place (regenerate). */
  async send(
    key: string,
    question: string,
    options: { pushUser?: boolean; replaceIdx?: number | undefined } = {},
  ): Promise<AskOutcome> {
    const sess = state.chatHistory.find((s) => s.key === key);
    if (!sess) return { ok: false, error: "this chat no longer exists" };
    const pushUser = options.pushUser !== false && options.replaceIdx === undefined;
    const messages: ChatMessage[] = pushUser
      ? [...sess.messages, { role: "user", content: question }]
      : sess.messages;
    if (pushUser) update(key, (s) => ({ ...s, messages }));
    const history =
      options.replaceIdx === undefined ? messages.slice(0, -1) : messages.slice(0, options.replaceIdx - 1);
    const r = await api("/ask", "POST", {
      pr: prUrl(),
      file: sess.file,
      lines: sess.lines,
      selection: sess.text.slice(0, 6000),
      question,
      review: activeGuide().backgroundContext(), // distilled understanding, so a fresh session is grounded
      step: sess.step, // present when the chat is scoped to a walkthrough step
      messages: history,
    });
    handleAuth(r);
    const id = r.ok ? idOf(r.data) : null;
    if (!id) return { ok: false, error: friendlyError(r) };

    // The live state (notes + partial text) is ephemeral UI — only the finished
    // answer lands in the session's messages, so the error and refresh-resume
    // paths behave exactly as before streaming existed.
    const result = await pollAnswer(key, id);
    if (!result.ok) return result;
    const message: ChatMessage = { role: "assistant", content: result.text };
    update(key, (s) => ({
      ...s,
      messages:
        options.replaceIdx === undefined
          ? [...s.messages, message]
          : s.messages.map((m, index) => (index === options.replaceIdx ? message : m)),
    }));
    return { ok: true, streamed: result.streamed };
  },

  /** Prefetch the AI suggestions once per session; cached on the session. Gated by
   * the Suggested-questions setting (default off) — when off, cache an empty list so
   * the chat opens clean (no skeleton, no /suggest call). */
  async ensureSuggestions(key: string): Promise<void> {
    const sess = state.chatHistory.find((s) => s.key === key);
    if (!sess || sess.suggestions) return;
    if (!settingsStore.preloadQuestions()) {
      update(key, (s) => ({ ...s, suggestions: [] }));
      return;
    }
    const r = await api("/suggest", "POST", {
      pr: prUrl(),
      file: sess.file,
      selection: sess.text.slice(0, 6000),
    });
    if (handleAuth(r)) return; // unpaired — don't cache an empty list, re-fetch after pairing
    const list = (r.ok ? suggestionsOf(r.data) : null) ?? [];
    update(key, (s) => ({ ...s, suggestions: list }));
  },
};

/** Asgard's ear on the Bifrost: a completed "ask" from the grip opens a chat, and
 * a citation miss (a cited file with no target on this page) raises a transient
 * note instead of the click silently doing nothing. Returns the unsubscriber. */
export function connectChat(bus: Bifrost): () => void {
  const offs = [
    bus.on("selection:ask", (p) => chatStore.openSelection(p, p.withStep)),
    bus.on("ref:missing", ({ file }) => {
      refNotice = `${file} isn't in this PR's diff`;
      if (refNoticeTimer) clearTimeout(refNoticeTimer);
      refNoticeTimer = setTimeout(() => {
        refNotice = null;
        refNoticeTimer = null;
        touch();
      }, REF_NOTICE_MS);
      touch();
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
