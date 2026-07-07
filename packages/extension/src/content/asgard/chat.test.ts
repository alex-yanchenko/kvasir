// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock(import("../api"), async (importOriginal) => ({ ...(await importOriginal()), api: vi.fn() }));
vi.mock("../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { api } from "../api";
import { bifrost } from "../bifrost";
import { storeSet } from "../muninn";
import { chatStore, connectChat, POLL_MS, REF_NOTICE_MS } from "./chat";
import { pairingStore } from "./pairing";
import { state, subscribe } from "./store";
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
      {
        kind: "pick:rehighlight",
        payload: { file: "src/app.ts", text: "const a = 1;", lines: { start: 4, end: 6 } },
      },
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
    expect(sends).toEqual([
      { kind: "pick:rehighlight", payload: { file: "", text: "const a = 1;", lines: { start: 4, end: 6 } } },
    ]);
  });
});

describe("openSelection", () => {
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

  it("links the session to a step via stepId, found by stepChat", () => {
    chatStore.openSelection({ ...payload, selectionId: "step:s1", stepId: "s1" }, false);
    const sess = chatStore.stepChat("s1");
    expect(sess?.key).toBe("step:s1");
    expect(sess?.stepId).toBe("s1");
    expect(chatStore.stepChat("missing")).toBeNull();
  });

  it("does not open a session that vanished during the step update", () => {
    vi.spyOn(tourStore, "stepContext").mockReturnValue("Step: X\nbody");
    // The withStep update's touch() lets a subscriber drop the session before the
    // re-lookup runs — the open is then skipped instead of dereferencing null.
    const off = subscribe(() => {
      state.chatHistory = [];
    });
    chatStore.openSelection(payload, true);
    off();
    expect(chatStore.active()).toBeNull();
    expect(sends).toEqual([]);
  });
});

describe("openOverview", () => {
  it("creates a stable, general overview chat once and reopens it after", () => {
    chatStore.openOverview();
    expect(state.chatHistory).toEqual([
      { key: "overview", general: true, file: null, lines: null, text: "", suggestions: [], messages: [] },
    ]);
    expect(chatStore.active()?.key).toBe("overview");
    expect(sends).toEqual([]); // general chat → no page rehighlight

    chatStore.openOverview();
    expect(state.chatHistory.length).toBe(1); // reopens the same session, not a duplicate
    expect(chatStore.overviewChat()?.key).toBe("overview");
  });

  it("overviewChat is null until one is opened", () => {
    expect(chatStore.overviewChat()).toBeNull();
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
    expect(vi.mocked(storeSet)).toHaveBeenCalledWith(`kvasir:chats:${PR}`, state.chatHistory);
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
  beforeEach(() => {
    state.preloadQuestions = true; // the fetch path; the off path is its own test
  });

  it("caches [] without calling /suggest when preload is off (default)", async () => {
    state.preloadQuestions = false;
    state.chatHistory = [mkSession("d")];
    await chatStore.ensureSuggestions("d");
    expect(state.chatHistory[0].suggestions).toEqual([]);
    expect(vi.mocked(api)).not.toHaveBeenCalled();
  });

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

  it("a non-401 suggest failure caches an empty list", async () => {
    state.chatHistory = [mkSession("c")];
    vi.mocked(api).mockResolvedValue({ ok: false, status: 500, data: { error: "boom" } });
    await chatStore.ensureSuggestions("c");
    expect(state.chatHistory[0].suggestions).toEqual([]);
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
    const off = connectChat(bifrost);
    bifrost.report("selection:ask", { ...payload, withStep: false });
    expect(chatStore.active()?.key).toBe(payload.selectionId);
    off();
  });

  it("a citation miss raises a note scoped to the active session, then clears itself", async () => {
    vi.useFakeTimers();
    const sess = mkSession("a");
    state.chatHistory = [sess];
    chatStore.open(sess);
    const off = connectChat(bifrost);
    bifrost.report("ref:missing", { file: "src/gone.ts" });
    expect(chatStore.refNotice()).toEqual({ key: "a", text: "src/gone.ts isn't in this PR's diff" });
    await vi.advanceTimersByTimeAsync(REF_NOTICE_MS);
    expect(chatStore.refNotice()).toBeNull();
    off();
    vi.useRealTimers();
  });

  it("a newer miss re-arms the clear timer instead of leaving the first one to fire", async () => {
    vi.useFakeTimers();
    const sess = mkSession("a");
    state.chatHistory = [sess];
    chatStore.open(sess);
    const off = connectChat(bifrost);
    bifrost.report("ref:missing", { file: "src/gone.ts" });
    await vi.advanceTimersByTimeAsync(REF_NOTICE_MS - 1000); // 4s of the first note's 5s window
    bifrost.report("ref:missing", { file: "src/other.ts" }); // resets the clock
    // 4s since the reset — the FIRST timer's original deadline has passed by now
    await vi.advanceTimersByTimeAsync(REF_NOTICE_MS - 1000);
    expect(chatStore.refNotice()).toEqual({ key: "a", text: "src/other.ts isn't in this PR's diff" });
    await vi.advanceTimersByTimeAsync(1000); // the full window since the reset
    expect(chatStore.refNotice()).toBeNull();
    off();
    vi.useRealTimers();
  });

  it("a citation miss with no active session is ignored", () => {
    const off = connectChat(bifrost);
    bifrost.report("ref:missing", { file: "src/gone.ts" });
    expect(chatStore.refNotice()).toBeNull();
    off();
  });
});
