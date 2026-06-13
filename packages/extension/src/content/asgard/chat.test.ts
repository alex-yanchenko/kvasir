// @vitest-environment jsdom
import type { WalkthroughSpec } from "@prw/runes/spec";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { api } from "../api";
import { bifrost } from "../bifrost";
import { storeSet } from "../muninn";
import { chatStore, connectChat, friendlyError, POLL_MS, reviewContext } from "./chat";
import { pairingStore } from "./pairing";
import { state } from "./store";
import { tourStore } from "./tour";
import type { ChatSession } from "./types";

const PR = "https://github.com/acme/widget-api/pull/7";

const mkSession = (key: string, over: Partial<ChatSession> = {}): ChatSession => ({
  key,
  file: "src/app.ts",
  lines: { start: 4, end: 6 },
  text: "const a = 1;",
  suggestions: null,
  messages: [],
  ...over,
});

const payload = {
  selectionId: "src/app.ts::const a = 1;",
  file: "src/app.ts",
  text: "const a = 1;",
  lines: { start: 4, end: 6 },
  rect: { left: 1, top: 2, bottom: 3, height: 4 },
};

let sends: Array<{ kind: string; payload: unknown }>;
let offs: Array<() => void>;
beforeEach(() => {
  Object.defineProperty(window, "location", { value: new URL(`${PR}/files`), writable: true });
  state.spec = null;
  state.chatHistory = [];
  state.panel = { open: false, tab: "walkthrough", pos: null, size: null };
  chatStore.deleteActive(); // clears activeKey between tests
  sends = [];
  offs = [
    bifrost.handle("pick:rehighlight", (p) => sends.push({ kind: "pick:rehighlight", payload: p })),
    bifrost.handle("pick:clear", () => sends.push({ kind: "pick:clear", payload: undefined })),
  ];
  sends = [];
  vi.mocked(api).mockResolvedValue({ ok: false });
});
afterEach(() => {
  offs.forEach((off) => off());
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("reviewContext", () => {
  it("distills overview + steps with locations, capped", () => {
    state.spec = {
      version: 1,
      pr: { url: PR, owner: "acme", repo: "widget-api", number: 7 },
      generatedAt: "t",
      overview: "Adds   rate limiting.",
      steps: [
        {
          id: "s1",
          title: "Limiter",
          body: "<b>token bucket</b>",
          file: "src/mw.ts",
          anchor: "diff-a",
          lines: { side: "R", start: 1, end: 9 },
        },
        { id: "s2", title: "Wire-up", body: "uses it", file: "", anchor: "diff-b" },
      ],
    } as WalkthroughSpec;
    expect(reviewContext()).toBe(
      "Overview: Adds rate limiting.\n\n• Limiter (src/mw.ts:1-9)\n  token bucket\n• Wire-up\n  uses it",
    );
  });

  it("is empty without a spec, and skips the overview line without one", () => {
    expect(reviewContext()).toBe("");
    state.spec = {
      version: 1,
      pr: { url: PR, owner: "acme", repo: "widget-api", number: 7 },
      generatedAt: "t",
      steps: [{ id: "s", title: "T", body: "b", file: "f.ts", anchor: "d" }],
    };
    expect(reviewContext()).toBe("• T (f.ts)\n  b");
  });
});

describe("friendlyError", () => {
  it("maps the known failure classes to human messages", () => {
    expect(friendlyError({ data: { error: "request timed out" } })).toMatch(/session may be busy/);
    expect(friendlyError({ data: { error: "not paired" } })).toMatch(/open Settings/);
    expect(friendlyError({ error: "extension reloaded — refresh the page" })).toMatch(/refresh the page/);
    expect(friendlyError({ error: "failed to fetch" })).toMatch(/Claude session running/);
    expect(friendlyError({ error: "boom" })).toBe("Something went wrong: boom");
    expect(friendlyError({})).toBe("No answer came back.");
  });
});

describe("open / close / delete", () => {
  it("open marks the session active, routes the panel to Chat, and repaints its pick", () => {
    const sess = mkSession("a");
    state.chatHistory = [sess];
    chatStore.open(sess);
    expect(chatStore.active()?.key).toBe("a");
    expect(state.panel.open).toBe(true);
    expect(state.panel.tab).toBe("chat");
    expect(sends).toEqual([
      { kind: "pick:rehighlight", payload: { file: "src/app.ts", text: "const a = 1;" } },
    ]);
  });

  it("the PR (general) chat skips the page repaint", () => {
    const b = mkSession("b", { general: true, file: null, text: "" });
    state.chatHistory = [b];
    chatStore.open(b);
    expect(chatStore.active()?.key).toBe("b");
    expect(sends).toEqual([]);
  });

  it("closeActive clears the active chat + pick but keeps it in history", () => {
    const sess = mkSession("a");
    state.chatHistory = [sess];
    chatStore.open(sess);
    sends = [];
    chatStore.closeActive();
    expect(chatStore.active()).toBeNull();
    expect(state.chatHistory.map((s) => s.key)).toEqual(["a"]);
    expect(sends).toEqual([{ kind: "pick:clear", payload: undefined }]);
  });

  it("delete removes the session and clears the pick", () => {
    state.chatHistory = [mkSession("a"), mkSession("b")];
    chatStore.open(state.chatHistory[1]);
    chatStore.deleteActive();
    expect(chatStore.active()).toBeNull();
    expect(state.chatHistory.map((s) => s.key)).toEqual(["a"]);
  });

  it("delete with nothing open is a safe no-op", () => {
    chatStore.deleteActive();
    expect(chatStore.active()).toBeNull();
  });

  it("a legacy session without a file repaints with an empty path", () => {
    const sess = mkSession("a", { file: null });
    state.chatHistory = [sess];
    chatStore.open(sess);
    expect(sends).toEqual([{ kind: "pick:rehighlight", payload: { file: "", text: "const a = 1;" } }]);
  });
});

describe("openSelection / openPrChat", () => {
  it("creates a session from a selection payload once, resuming it after", () => {
    chatStore.openSelection(payload, false);
    expect(state.chatHistory).toEqual([
      {
        key: payload.selectionId,
        file: "src/app.ts",
        lines: { start: 4, end: 6 },
        text: "const a = 1;",
        suggestions: null,
        messages: [],
      },
    ]);
    chatStore.openSelection(payload, false);
    expect(state.chatHistory.length).toBe(1);
  });

  it("withStep frames the session with the current step context", () => {
    vi.spyOn(tourStore, "stepContext").mockReturnValue("Step: X\nbody");
    chatStore.openSelection(payload, true);
    expect(state.chatHistory[0].step).toBe("Step: X\nbody");
  });

  it("openPrChat creates the single general session and reuses it", () => {
    chatStore.openPrChat();
    chatStore.openPrChat();
    expect(state.chatHistory).toEqual([
      {
        key: "__pr__",
        general: true,
        file: null,
        lines: null,
        text: "",
        suggestions: [],
        messages: [],
      },
    ]);
    expect(chatStore.active()?.general).toBe(true);
  });
});

const snap = (over: Partial<{ notes: string[]; text: string; done: boolean; timedOut: boolean }> = {}) => ({
  notes: [],
  text: "",
  done: false,
  timedOut: false,
  ...over,
});

/** /ask returns an id; successive /poll calls walk the given snapshots (the last repeats). */
const mockStream = (...snaps: unknown[]) => {
  let i = 0;
  vi.mocked(api).mockImplementation(async (path: string) =>
    path.startsWith("/poll")
      ? { ok: true, data: snaps[Math.min(i++, snaps.length - 1)] }
      : { ok: true, data: { id: "q-test" } },
  );
};

describe("send", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // a second session so update()'s map exercises the non-matching (skip) arm
    state.chatHistory = [mkSession("a", { step: "Step: X" }), mkSession("other")];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pushes the user turn, posts the full request, polls, and appends the answer", async () => {
    mockStream(snap({ done: true, text: "because." }));
    const pending = chatStore.send("a", "why?");
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(await pending).toEqual({ ok: true, streamed: false });
    expect(vi.mocked(api)).toHaveBeenCalledWith("/ask", "POST", {
      pr: PR,
      file: "src/app.ts",
      lines: { start: 4, end: 6 },
      selection: "const a = 1;",
      question: "why?",
      review: "",
      step: "Step: X",
      messages: [],
    });
    expect(vi.mocked(api)).toHaveBeenCalledWith("/poll?id=q-test");
    expect(state.chatHistory[0].messages).toEqual([
      { role: "user", content: "why?" },
      { role: "assistant", content: "because." },
    ]);
    expect(vi.mocked(storeSet)).toHaveBeenCalledWith(`prw:chats:${PR}`, state.chatHistory);
  });

  it("streams notes and partial text through live(), then skips the typewriter", async () => {
    mockStream(
      snap({ notes: ["reading diff.ts"] }),
      snap({ notes: ["reading diff.ts"], text: "First. " }),
      snap({ notes: ["reading diff.ts"], text: "First. Second.", done: true }),
    );
    const pending = chatStore.send("a", "q");
    await vi.advanceTimersByTimeAsync(0); // /ask resolved, stream registered
    expect(chatStore.live()).toEqual({ key: "a", note: null, text: "" });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(chatStore.live()).toEqual({ key: "a", note: "reading diff.ts", text: "" });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(chatStore.live()).toEqual({ key: "a", note: "reading diff.ts", text: "First. " });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(await pending).toEqual({ ok: true, streamed: true });
    expect(chatStore.live()).toBeNull();
    expect(state.chatHistory[0].messages.at(-1)).toEqual({
      role: "assistant",
      content: "First. Second.",
    });
  });

  it("resume (pushUser:false) answers the recorded trailing user turn", async () => {
    state.chatHistory = [mkSession("a", { messages: [{ role: "user", content: "pending?" }] })];
    mockStream(snap({ done: true, text: "landed" }));
    const pending = chatStore.send("a", "pending?", { pushUser: false });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await pending;
    expect(state.chatHistory[0].messages).toEqual([
      { role: "user", content: "pending?" },
      { role: "assistant", content: "landed" },
    ]);
  });

  it("replaceIdx regenerates an answer in place with the prior history", async () => {
    state.chatHistory = [
      mkSession("a", {
        messages: [
          { role: "user", content: "q1" },
          { role: "assistant", content: "old" },
        ],
      }),
    ];
    mockStream(snap({ done: true, text: "new" }));
    const pending = chatStore.send("a", "q1", { replaceIdx: 1 });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await pending;
    expect(vi.mocked(api)).toHaveBeenCalledWith("/ask", "POST", expect.objectContaining({ messages: [] }));
    expect(state.chatHistory[0].messages).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "new" },
    ]);
  });

  it("maps /ask failures through friendlyError and leaves no assistant turn", async () => {
    vi.mocked(api).mockResolvedValue({ ok: false, error: "failed to fetch" });
    const r = await chatStore.send("a", "why?");
    expect(r).toEqual({ ok: false, error: "Can't reach the channel — is your Claude session running?" });
    expect(state.chatHistory[0].messages).toEqual([{ role: "user", content: "why?" }]);
  });

  it("a 401 from /ask flips the extension to unpaired and returns the pair hint", async () => {
    vi.mocked(api).mockResolvedValue({ ok: false, status: 401, data: { error: "not paired" } });
    const r = await chatStore.send("a", "why?");
    expect(r).toEqual({ ok: false, error: "Not paired — open Settings (gear) and pair the extension." });
    expect(pairingStore.state()).toEqual({ phase: "unpaired" });
  });

  it("a 401 mid-stream (poll) also flips to unpaired", async () => {
    pairingStore.reset();
    vi.mocked(api).mockImplementation(async (path: string) =>
      path.startsWith("/poll")
        ? { ok: false, status: 401, data: { error: "not paired" } }
        : { ok: true, data: { id: "q-test" } },
    );
    const pending = chatStore.send("a", "q");
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(await pending).toEqual({
      ok: false,
      error: "Not paired — open Settings (gear) and pair the extension.",
    });
    expect(pairingStore.state()).toEqual({ phase: "unpaired" });
  });

  it("a vanished session fails fast", async () => {
    expect(await chatStore.send("gone", "q")).toEqual({ ok: false, error: "this chat no longer exists" });
  });

  it("an /ask response without an id still fails", async () => {
    vi.mocked(api).mockResolvedValue({ ok: true, data: {} });
    expect(await chatStore.send("a", "q")).toEqual({ ok: false, error: "No answer came back." });
  });

  it("a timed-out stream with no text maps to the busy-session message", async () => {
    mockStream(snap({ done: true, timedOut: true }));
    const pending = chatStore.send("a", "q");
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(await pending).toEqual({
      ok: false,
      error: "No response yet — the session may be busy or paused in your terminal.",
    });
    expect(chatStore.live()).toBeNull();
  });

  it("a stream that closes empty without timing out reads as no answer", async () => {
    mockStream(snap({ done: true }));
    const pending = chatStore.send("a", "q");
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(await pending).toEqual({ ok: false, error: "No answer came back." });
  });

  it("a failing or malformed poll aborts the stream with a friendly error", async () => {
    vi.mocked(api).mockImplementation(async (path: string) =>
      path.startsWith("/poll")
        ? { ok: false, error: "failed to fetch" }
        : { ok: true, data: { id: "q-test" } },
    );
    let pending = chatStore.send("a", "q");
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(await pending).toEqual({
      ok: false,
      error: "Can't reach the channel — is your Claude session running?",
    });

    vi.mocked(api).mockImplementation(async (path: string) =>
      path.startsWith("/poll") ? { ok: true, data: { nope: 1 } } : { ok: true, data: { id: "q-test" } },
    );
    pending = chatStore.send("a", "q");
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(await pending).toEqual({ ok: false, error: "No answer came back." });
    expect(chatStore.live()).toBeNull();
  });
});

describe("ensureSuggestions", () => {
  it("fetches once and caches on the session; malformed data caches []", async () => {
    state.chatHistory = [mkSession("a")];
    vi.mocked(api).mockResolvedValue({ ok: true, data: { suggestions: ["q1", "q2"] } });
    await chatStore.ensureSuggestions("a");
    expect(state.chatHistory[0].suggestions).toEqual(["q1", "q2"]);
    await chatStore.ensureSuggestions("a"); // cached — no second call
    expect(vi.mocked(api)).toHaveBeenCalledTimes(1);

    state.chatHistory = [mkSession("b")];
    vi.mocked(api).mockResolvedValue({ ok: true, data: { nope: 1 } });
    await chatStore.ensureSuggestions("b");
    expect(state.chatHistory[0].suggestions).toEqual([]);
    await chatStore.ensureSuggestions("gone"); // vanished session is a no-op
  });

  it("a 401 while fetching suggestions flips to unpaired and caches nothing", async () => {
    pairingStore.reset();
    state.chatHistory = [mkSession("a")];
    vi.mocked(api).mockResolvedValue({ ok: false, status: 401, data: { error: "not paired" } });
    await chatStore.ensureSuggestions("a");
    expect(state.chatHistory[0].suggestions).toBeNull(); // not cached — retried after pairing
    expect(pairingStore.state()).toEqual({ phase: "unpaired" });
  });
});

describe("connectChat", () => {
  it("opens a selection chat when the grip reports an ask", () => {
    connectChat(bifrost);
    bifrost.report("selection:ask", { ...payload, withStep: false });
    expect(chatStore.active()?.key).toBe(payload.selectionId);
  });
});
