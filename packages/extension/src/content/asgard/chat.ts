// The chat machine — Asgard-owned. Sessions live in the store's backing state
// as immutable updates; this opens/closes the one visible chat,
// builds /ask requests (selection- or PR-level), regenerates answers in place,
// and prefetches the AI suggestions. The window itself is a React component.

import type { Bifrost, SelectionPayload } from "../bifrost";
import { bifrost } from "../bifrost";
import { api } from "../api";
import { chatsKey, prUrl } from "../keys";
import { storeSet } from "../muninn";
import { pairingStore } from "./pairing";
import { state, touch } from "./store";
import { tourStore } from "./tour";
import type { ChatMessage, ChatSession } from "./types";

export type AskOutcome = { ok: true; streamed: boolean } | { ok: false; error: string };

/** Live progress of the one in-flight question — ephemeral, never persisted. */
export interface LiveAsk {
  key: string;
  note: string | null;
  text: string;
}

export const POLL_MS = 600;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let activeKey: string | null = null;
let live: LiveAsk | null = null;
/** Where the window first appears when the session has no remembered position. */
let anchor: SelectionPayload["rect"] | null = null;

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

// A compact, plain-text version of the cached walkthrough — sent with chat
// questions so even a freshly-restarted (clean-context) session understands the PR.
export function reviewContext(): string {
  if (!state.spec) return "";
  const head = state.spec.overview ? `Overview: ${state.spec.overview.replace(/\s+/g, " ").trim()}\n\n` : "";
  const steps = state.spec.steps
    .map((st) => {
      const where = st.file ? ` (${st.file}${st.lines ? `:${st.lines.start}-${st.lines.end}` : ""})` : "";
      const body = st.body
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      return `• ${st.title}${where}\n  ${body}`;
    })
    .join("\n");
  return (head + steps).slice(0, 12000);
}

/** A 401 from any bridge call means our token is stale/absent: drop it so the
 * UI flips to "pair to continue". Returns true when it handled a 401. */
function handleAuth(r: { status?: number }): boolean {
  if (r.status !== 401) return false;
  pairingStore.markUnpaired();
  return true;
}

export function friendlyError(r: { data?: unknown; error?: string }): string {
  const fromData =
    typeof r.data === "object" && r.data !== null && "error" in r.data && typeof r.data.error === "string"
      ? r.data.error
      : "";
  const e = fromData || r.error || "";
  if (/not paired/i.test(e)) return "Not paired — open Settings (gear) and pair the extension.";
  if (/timed out/i.test(e)) return "No response yet — the session may be busy or paused in your terminal.";
  if (/refresh the page/i.test(e)) return "Extension was reloaded — refresh the page, then retry.";
  if (/fetch|reach|no response|network/i.test(e))
    return "Can't reach the channel — is your Claude session running?";
  return e ? `Something went wrong: ${e}` : "No answer came back.";
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

export const chatStore = {
  active: (): ChatSession | null => state.chatHistory.find((s) => s.key === activeKey) ?? null,
  anchor: (): SelectionPayload["rect"] | null => anchor,
  live: (): LiveAsk | null => live,

  /** Open a session (one window at a time; an open one minimizes first). */
  open(sess: ChatSession, at: SelectionPayload["rect"] | null = null): void {
    if (activeKey && activeKey !== sess.key) this.minimize();
    anchor = at;
    activeKey = sess.key;
    if (!sess.general) bifrost.send("pick:rehighlight", { file: sess.file ?? "", text: sess.text });
    touch();
  },

  /** A code selection asks for a chat (grip ask buttons, tour step-ask). */
  openSelection(p: SelectionPayload, withStep: boolean): void {
    let sess = state.chatHistory.find((c) => c.key === p.selectionId);
    if (!sess) {
      sess = {
        key: p.selectionId,
        file: p.file,
        lines: p.lines,
        text: p.text,
        suggestions: null,
        messages: [],
        pos: null,
      };
      state.chatHistory = [sess, ...state.chatHistory];
      persist();
    }
    if (withStep) {
      update(sess.key, (s) => ({ ...s, step: tourStore.stepContext() }));
    }
    const latest = state.chatHistory.find((c) => c.key === p.selectionId);
    if (latest) this.open(latest, p.rect);
  },

  /** The single whole-PR chat — created on first use, resumed after. */
  openPrChat(): void {
    let sess = state.chatHistory.find((c) => c.general);
    if (!sess) {
      sess = {
        key: "__pr__",
        general: true,
        file: null,
        lines: null,
        text: "",
        suggestions: [],
        messages: [],
        pos: null,
      };
      state.chatHistory = [sess, ...state.chatHistory];
      persist();
    }
    this.open(sess);
  },

  /** Collapse to the Chats list; the window's geometry is remembered. */
  minimize(geometry?: { pos: { left: number; top: number }; size: { w: number; h: number } }): void {
    const key = activeKey;
    activeKey = null;
    anchor = null;
    bifrost.send("pick:clear", undefined);
    if (key && geometry) update(key, (s) => ({ ...s, pos: geometry.pos, size: geometry.size }));
    else touch();
  },

  /** Close for good: window + history + storage. */
  deleteActive(): void {
    const key = activeKey;
    activeKey = null;
    anchor = null;
    bifrost.send("pick:clear", undefined);
    if (key) {
      state.chatHistory = state.chatHistory.filter((s) => s.key !== key);
      persist();
    }
    touch();
  },

  setPos(key: string, pos: { left: number; top: number }): void {
    update(key, (s) => ({ ...s, pos }));
  },
  setSize(key: string, size: { w: number; h: number }): void {
    update(key, (s) => ({ ...s, size }));
  },

  /** Send a question. pushUser=false resumes an already-recorded trailing user
   * turn (e.g. after a refresh dropped the in-flight request); replaceIdx
   * overwrites that assistant turn in place (regenerate). */
  async send(
    key: string,
    question: string,
    opts: { pushUser?: boolean; replaceIdx?: number } = {},
  ): Promise<AskOutcome> {
    const sess = state.chatHistory.find((s) => s.key === key);
    if (!sess) return { ok: false, error: "this chat no longer exists" };
    const pushUser = opts.pushUser !== false && opts.replaceIdx === undefined;
    const messages: ChatMessage[] = pushUser
      ? [...sess.messages, { role: "user", content: question }]
      : sess.messages;
    if (pushUser) update(key, (s) => ({ ...s, messages }));
    const history =
      opts.replaceIdx !== undefined ? messages.slice(0, opts.replaceIdx - 1) : messages.slice(0, -1);
    const r = await api("/ask", "POST", {
      pr: prUrl(),
      file: sess.file,
      lines: sess.lines,
      selection: sess.text.slice(0, 6000),
      question,
      review: reviewContext(), // distilled PR understanding, so a fresh session is grounded
      step: sess.step, // present when the chat is scoped to a walkthrough step
      messages: history,
    });
    handleAuth(r);
    const id = r.ok ? idOf(r.data) : null;
    if (!id) return { ok: false, error: friendlyError(r) };

    // Poll the stream. The live state (notes + partial text) is ephemeral UI —
    // only the finished answer lands in the session's messages, so the error
    // and refresh-resume paths behave exactly as before streaming existed.
    live = { key, note: null, text: "" };
    touch();
    let sawPartial = false; // any text shown before done → skip the cosmetic typewriter
    try {
      for (;;) {
        await sleep(POLL_MS);
        const poll = await api(`/poll?id=${encodeURIComponent(id)}`);
        const snap = poll.ok ? snapOf(poll.data) : null;
        if (!snap) {
          handleAuth(poll);
          return { ok: false, error: friendlyError(poll) };
        }
        const note = snap.notes.length ? snap.notes[snap.notes.length - 1] : null;
        if (note !== live.note || snap.text !== live.text) {
          live = { key, note, text: snap.text };
          touch();
        }
        if (!snap.done) {
          if (snap.text) sawPartial = true;
          continue;
        }
        if (!snap.text) {
          return {
            ok: false,
            error: friendlyError({ error: snap.timedOut ? "request timed out" : "" }),
          };
        }
        const streamed = sawPartial;
        const msg: ChatMessage = { role: "assistant", content: snap.text };
        update(key, (s) => ({
          ...s,
          messages:
            opts.replaceIdx !== undefined
              ? s.messages.map((m, i) => (i === opts.replaceIdx ? msg : m))
              : [...s.messages, msg],
        }));
        return { ok: true, streamed };
      }
    } finally {
      live = null;
      touch();
    }
  },

  /** Prefetch the AI suggestions once per session; cached on the session. */
  async ensureSuggestions(key: string): Promise<void> {
    const sess = state.chatHistory.find((s) => s.key === key);
    if (!sess || sess.suggestions) return;
    const r = await api("/suggest", "POST", {
      pr: prUrl(),
      file: sess.file,
      selection: sess.text.slice(0, 6000),
    });
    if (handleAuth(r)) return; // unpaired — don't cache an empty list, re-fetch after pairing
    const list = (r.ok && suggestionsOf(r.data)) || [];
    update(key, (s) => ({ ...s, suggestions: list }));
  },
};

/** Asgard's ear on the Bifrost: a completed "ask" from the grip opens a chat. */
export function connectChat(bus: Bifrost): void {
  bus.on("selection:ask", (p) => chatStore.openSelection(p, p.withStep));
}
