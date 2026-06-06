// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WalkthroughSpec } from "@prw/runes/spec";

vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { api } from "../api";
import { storeSet } from "../muninn";
import { bifrost } from "../bifrost";
import { state } from "./store";
import { chatStore, connectChat, friendlyError, reviewContext } from "./chat";
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
  pos: null,
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
  chatStore.deleteActive(); // clears activeKey/anchor between tests
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
    expect(friendlyError({ error: "extension reloaded — refresh the page" })).toMatch(/refresh the page/);
    expect(friendlyError({ error: "failed to fetch" })).toMatch(/Claude session running/);
    expect(friendlyError({ error: "boom" })).toBe("Something went wrong: boom");
    expect(friendlyError({})).toBe("No answer came back.");
  });
});

describe("open / minimize / delete", () => {
  it("open marks the session active, stores the anchor, and repaints its pick", () => {
    const sess = mkSession("a");
    state.chatHistory = [sess];
    chatStore.open(sess, payload.rect);
    expect(chatStore.active()?.key).toBe("a");
    expect(chatStore.anchor()).toEqual(payload.rect);
    expect(sends).toEqual([
      { kind: "pick:rehighlight", payload: { file: "src/app.ts", text: "const a = 1;" } },
    ]);
  });

  it("opening another session minimizes the current one first; the PR chat skips the repaint", () => {
    const a = mkSession("a");
    const b = mkSession("b", { general: true, file: null, text: "" });
    state.chatHistory = [a, b];
    chatStore.open(a);
    chatStore.open(b);
    expect(chatStore.active()?.key).toBe("b");
    expect(sends.map((s) => s.kind)).toEqual(["pick:rehighlight", "pick:clear"]);
  });

  it("minimize remembers geometry; delete removes the session and its pick", () => {
    const sess = mkSession("a");
    state.chatHistory = [sess, mkSession("b")];
    chatStore.open(sess);
    chatStore.minimize({ pos: { left: 5, top: 6 }, size: { w: 400, h: 300 } });
    expect(chatStore.active()).toBeNull();
    expect(state.chatHistory[0]).toEqual({ ...sess, pos: { left: 5, top: 6 }, size: { w: 400, h: 300 } });

    chatStore.open(state.chatHistory[1]);
    chatStore.deleteActive();
    expect(state.chatHistory.map((s) => s.key)).toEqual(["a"]);
  });

  it("minimize/delete with nothing open are safe no-ops", () => {
    chatStore.minimize();
    chatStore.deleteActive();
    expect(chatStore.active()).toBeNull();
  });

  it("a legacy session without a file repaints with an empty path", () => {
    const sess = mkSession("a", { file: null });
    state.chatHistory = [sess];
    chatStore.open(sess);
    expect(sends).toEqual([{ kind: "pick:rehighlight", payload: { file: "", text: "const a = 1;" } }]);
  });

  it("setPos / setSize update the session geometry", () => {
    state.chatHistory = [mkSession("a")];
    chatStore.setPos("a", { left: 7, top: 8 });
    chatStore.setSize("a", { w: 300, h: 200 });
    expect(state.chatHistory).toEqual([
      { ...mkSession("a"), pos: { left: 7, top: 8 }, size: { w: 300, h: 200 } },
    ]);
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
        pos: null,
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
        pos: null,
      },
    ]);
    expect(chatStore.active()?.general).toBe(true);
  });
});

describe("send", () => {
  beforeEach(() => {
    state.chatHistory = [mkSession("a", { step: "Step: X" })];
  });

  it("pushes the user turn, posts the full request, and appends the answer", async () => {
    vi.mocked(api).mockResolvedValue({ ok: true, data: { answer: "because." } });
    const r = await chatStore.send("a", "why?");
    expect(r).toEqual({ ok: true });
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
    expect(state.chatHistory[0].messages).toEqual([
      { role: "user", content: "why?" },
      { role: "assistant", content: "because." },
    ]);
    expect(vi.mocked(storeSet)).toHaveBeenCalledWith(`prw:chats:${PR}`, state.chatHistory);
  });

  it("resume (pushUser:false) answers the recorded trailing user turn", async () => {
    state.chatHistory = [mkSession("a", { messages: [{ role: "user", content: "pending?" }] })];
    vi.mocked(api).mockResolvedValue({ ok: true, data: { answer: "landed" } });
    await chatStore.send("a", "pending?", { pushUser: false });
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
    vi.mocked(api).mockResolvedValue({ ok: true, data: { answer: "new" } });
    await chatStore.send("a", "q1", { replaceIdx: 1 });
    expect(vi.mocked(api)).toHaveBeenCalledWith("/ask", "POST", expect.objectContaining({ messages: [] }));
    expect(state.chatHistory[0].messages).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "new" },
    ]);
  });

  it("maps failures through friendlyError and leaves no assistant turn", async () => {
    vi.mocked(api).mockResolvedValue({ ok: false, error: "failed to fetch" });
    const r = await chatStore.send("a", "why?");
    expect(r).toEqual({ ok: false, error: "Can't reach the channel — is your Claude session running?" });
    expect(state.chatHistory[0].messages).toEqual([{ role: "user", content: "why?" }]);
  });

  it("a vanished session fails fast", async () => {
    expect(await chatStore.send("gone", "q")).toEqual({ ok: false, error: "this chat no longer exists" });
  });

  it("an ok response without an answer string still fails", async () => {
    vi.mocked(api).mockResolvedValue({ ok: true, data: {} });
    expect(await chatStore.send("a", "q")).toEqual({ ok: false, error: "No answer came back." });
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
});

describe("connectChat", () => {
  it("opens a selection chat when the grip reports an ask", () => {
    connectChat(bifrost);
    bifrost.report("selection:ask", { ...payload, withStep: false });
    expect(chatStore.active()?.key).toBe(payload.selectionId);
  });
});
