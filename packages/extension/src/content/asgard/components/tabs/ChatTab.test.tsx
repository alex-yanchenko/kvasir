// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../api", () => ({ api: vi.fn() }));
vi.mock("../../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { api } from "../../../api";
import { bifrost } from "../../../bifrost";
import { chatStore } from "../../chat";
import { PANEL_TABS, state } from "../../store";
import type { ChatSession } from "../../types";
import { ChatTab, closeFences, linkifyRefs, REF_RE } from "./ChatTab";

const PR = "https://github.com/acme/widget-api/pull/7";

const mkSession = (key: string, over: Partial<ChatSession> = {}): ChatSession => ({
  key,
  file: "src/app.ts",
  lines: { start: 4, end: 6 },
  text: "const a = 1;",
  suggestions: [],
  messages: [],
  ...over,
});

class ROStub {
  observe(): void {}
  disconnect(): void {}
}

let jumps: unknown[];
let offs: Array<() => void>;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ROStub);
  Object.defineProperty(window, "location", { value: new URL(`${PR}/files`), writable: true });
  state.spec = null;
  state.chatHistory = [];
  state.panel = { open: true, tab: PANEL_TABS.CHAT, pos: null, size: null };
  chatStore.deleteActive();
  jumps = [];
  offs = [
    bifrost.handle("jump:ref", (p) => jumps.push(p)),
    bifrost.handle("pick:rehighlight", (p) => jumps.push({ pick: p })),
    bifrost.handle("pick:clear", () => undefined),
  ];
  jumps = [];
  vi.mocked(api).mockResolvedValue({ ok: true, data: { suggestions: [] } });
});
afterEach(() => {
  cleanup();
  document.getElementById("prw-root")?.remove();
  offs.forEach((off) => off());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const openSession = (sess: ChatSession) => {
  state.chatHistory = [sess, ...state.chatHistory.filter((s) => s.key !== sess.key)];
  act(() => chatStore.open(sess));
};

const snap = (over: Partial<{ notes: string[]; text: string; done: boolean; timedOut: boolean }> = {}) => ({
  notes: [],
  text: "",
  done: false,
  timedOut: false,
  ...over,
});
const mockStream = (...snaps: unknown[]) => {
  let i = 0;
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path.startsWith("/poll")) return { ok: true, data: snaps[Math.min(i++, snaps.length - 1)] };
    if (path === "/suggest") return { ok: true, data: { suggestions: [] } };
    return { ok: true, data: { id: "q-test" } };
  });
};

describe("REF_RE + linkifyRefs + closeFences", () => {
  it("linkifies path:line and ranged refs outside code; bare files only when in the PR diff", () => {
    const cont = document.createElement("div");
    cont.id = "diff-f1";
    cont.innerHTML = '<span data-tagsearch-path="src/app.ts"></span>';
    document.body.appendChild(cont);
    const el = document.createElement("div");
    el.innerHTML =
      "see src/app.ts:4 and src/app.ts:4-6 then src/app.ts but <pre>x.ts:9</pre> and vendor/lib.ts";
    el.appendChild(document.createTextNode("")); // empty node is skipped
    linkifyRefs(el);
    const refs = [...el.querySelectorAll<HTMLAnchorElement>(".prw-ref")];
    expect(refs.map((a) => a.textContent)).toEqual(["src/app.ts:4", "src/app.ts:4-6", "src/app.ts"]);
    refs[0].click();
    refs[1].click();
    refs[2].click();
    expect(jumps).toEqual([
      { file: "src/app.ts", start: 4, end: null },
      { file: "src/app.ts", start: 4, end: 6 },
      { file: "src/app.ts", start: null, end: null },
    ]);
    expect(el.textContent).toContain("vendor/lib.ts");
    expect(REF_RE.test("just words")).toBe(false);
    cont.remove();
  });

  it("closeFences closes an odd fence, leaves balanced alone", () => {
    expect(closeFences("a\n```ts\ncode")).toBe("a\n```ts\ncode\n```");
    expect(closeFences("a\n```ts\nx\n```")).toBe("a\n```ts\nx\n```");
    expect(closeFences("plain")).toBe("plain");
  });
});

describe("ChatTab shell", () => {
  it("shows the empty state without an active session", () => {
    render(<ChatTab />);
    expect(screen.getByText(/No chat open/)).toBeTruthy();
  });

  it("labels a selection chat by file:line and the general one as This PR; single line collapses", () => {
    render(<ChatTab />);
    openSession(mkSession("a"));
    expect(screen.getByText("app.ts:4-6")).toBeTruthy();
    openSession(mkSession("a1", { lines: { start: 4, end: 4 } }));
    expect(screen.getByText("app.ts:4")).toBeTruthy();
    openSession(mkSession("g", { general: true, file: null, lines: null, text: "", suggestions: [] }));
    expect(screen.getByText("This PR")).toBeTruthy();
  });

  it("delete removes the active session and falls back to the empty state", () => {
    render(<ChatTab />);
    openSession(mkSession("a"));
    fireEvent.click(screen.getByLabelText("Close and delete"));
    expect(screen.getByText(/No chat open/)).toBeTruthy();
    expect(state.chatHistory.find((s) => s.key === "a")).toBeUndefined();
  });

  it("shows the step banner and closes it on an outside click", () => {
    render(<ChatTab />);
    openSession(mkSession("a", { step: "Step: X\nbody" }));
    const banner = document.querySelector<HTMLDetailsElement>(".prw-ctxbanner")!;
    banner.open = true;
    fireEvent.mouseDown(document.body);
    expect(banner.open).toBe(false);
    banner.open = true;
    fireEvent.mouseDown(banner);
    expect(banner.open).toBe(true);
  });
});

describe("asking", () => {
  it("a quick chip asks, shows typing, streams the answer into markdown with a citation", async () => {
    vi.useFakeTimers();
    const cont = document.createElement("div");
    cont.id = "diff-f1";
    cont.innerHTML = '<span data-tagsearch-path="src/app.ts"></span>';
    document.body.appendChild(cont);
    mockStream(snap({ done: true, text: "look at `src/app.ts:4` for **why**" }));
    render(<ChatTab />);
    openSession(mkSession("a"));
    await act(async () => {
      fireEvent.click(screen.getByText("Explain"));
    });
    expect(document.querySelector(".prw-typing")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(document.querySelector(".prw-md")).toBeTruthy();
    expect(document.querySelector(".prw-ref")!.textContent).toBe("src/app.ts:4");
    cont.remove();
    vi.useRealTimers();
  });

  it("live notes + partial markdown show while streaming, then skip the typewriter", async () => {
    vi.useFakeTimers();
    mockStream(
      snap({ notes: ["reading src/app.ts"] }),
      snap({ notes: ["reading src/app.ts"], text: "First." }),
      snap({ notes: ["reading src/app.ts"], text: "First. **Done.**", done: true }),
    );
    render(<ChatTab />);
    openSession(mkSession("a"));
    await act(async () => {
      fireEvent.click(screen.getByText("Explain"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(screen.getByText(/reading src\/app\.ts/)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(document.querySelector(".prw-live-text .prw-md")).toBeTruthy();
    expect(document.querySelector(".prw-typing")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(document.querySelector(".prw-live-text")).toBeNull();
    expect(state.chatHistory[0].messages.at(-1)).toEqual({
      role: "assistant",
      content: "First. **Done.**",
    });
    vi.useRealTimers();
  });

  it("failures render the friendly note with a working Retry", async () => {
    vi.useFakeTimers();
    vi.mocked(api).mockImplementation(async (path: string) =>
      path === "/ask" ? { ok: false, error: "request timed out" } : { ok: true, data: { suggestions: [] } },
    );
    render(<ChatTab />);
    openSession(mkSession("a"));
    await act(async () => {
      fireEvent.click(screen.getByText("Explain"));
    });
    expect(screen.getByText(/No response yet/)).toBeTruthy();
    mockStream(snap({ done: true, text: "ok now" }));
    await act(async () => {
      fireEvent.click(screen.getByText("Retry"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(screen.queryByText(/No response yet/)).toBeNull();
    expect(state.chatHistory[0].messages.at(-1)).toEqual({ role: "assistant", content: "ok now" });
    vi.useRealTimers();
  });

  it("resumes a trailing unanswered question on open", async () => {
    vi.useFakeTimers();
    mockStream(snap({ done: true, text: "resumed" }));
    render(<ChatTab />);
    await act(async () => {
      openSession(mkSession("a", { messages: [{ role: "user", content: "pending?" }] }));
    });
    expect(vi.mocked(api)).toHaveBeenCalledWith(
      "/ask",
      "POST",
      expect.objectContaining({ question: "pending?", messages: [] }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(state.chatHistory[0].messages.at(-1)).toEqual({ role: "assistant", content: "resumed" });
    vi.useRealTimers();
  });

  it("regenerate replaces an answer in place", async () => {
    vi.useFakeTimers();
    mockStream(snap({ done: true, text: "fresh take" }));
    render(<ChatTab />);
    openSession(
      mkSession("a", {
        messages: [
          { role: "user", content: "q1" },
          { role: "assistant", content: "old take" },
        ],
      }),
    );
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Regenerate answer"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(state.chatHistory[0].messages[1]).toEqual({ role: "assistant", content: "fresh take" });
    vi.useRealTimers();
  });
});

describe("message actions", () => {
  it("locate cycles citations, repaints the origin without any, and is a no-op for the PR chat", () => {
    render(<ChatTab />);
    openSession(
      mkSession("a", {
        messages: [
          { role: "user", content: "q" },
          { role: "assistant", content: "see src/app.ts:4 then src/app.ts:5" },
        ],
      }),
    );
    jumps = [];
    const locate = screen.getByLabelText("Jump to the cited code");
    fireEvent.click(locate);
    fireEvent.click(locate);
    fireEvent.click(locate);
    expect(jumps).toEqual([
      { file: "src/app.ts", start: 4, end: null },
      { file: "src/app.ts", start: 5, end: null },
      { file: "src/app.ts", start: 4, end: null },
    ]);

    openSession(
      mkSession("b", {
        messages: [
          { role: "user", content: "q" },
          { role: "assistant", content: "no refs" },
        ],
      }),
    );
    jumps = [];
    fireEvent.click(screen.getByLabelText("Jump to the cited code"));
    expect(jumps).toEqual([{ pick: { file: "src/app.ts", text: "const a = 1;", scroll: true } }]);

    openSession(
      mkSession("g", {
        general: true,
        file: null,
        lines: null,
        text: "",
        suggestions: [],
        messages: [
          { role: "user", content: "q" },
          { role: "assistant", content: "no refs" },
        ],
      }),
    );
    jumps = [];
    fireEvent.click(screen.getByLabelText("Jump to the cited code"));
    expect(jumps).toEqual([]);
  });

  it("a file-less selection chat labels by line only and repaints with an empty path", () => {
    render(<ChatTab />);
    openSession(
      mkSession("a", {
        file: null,
        messages: [
          { role: "user", content: "q" },
          { role: "assistant", content: "no refs" },
        ],
      }),
    );
    expect(screen.getByText(":4-6")).toBeTruthy(); // file null → line label only
    jumps = [];
    fireEvent.click(screen.getByLabelText("Jump to the cited code"));
    expect(jumps).toEqual([{ pick: { file: "", text: "const a = 1;", scroll: true } }]);
  });

  it("an answer landing after the chat was deleted streams nowhere", async () => {
    vi.useFakeTimers();
    mockStream(snap({ done: true, text: "late" }));
    render(<ChatTab />);
    openSession(mkSession("a"));
    await act(async () => {
      fireEvent.click(screen.getByText("Explain"));
    });
    act(() => chatStore.deleteActive());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(screen.getByText(/No chat open/)).toBeTruthy();
    vi.useRealTimers();
  });

  it("copy writes the message and flashes the check", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<ChatTab />);
    openSession(
      mkSession("a", {
        messages: [
          { role: "user", content: "q" },
          { role: "assistant", content: "the answer" },
        ],
      }),
    );
    const copy = screen.getByLabelText("Copy message");
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith("the answer");
    expect(copy.className).toContain("prw-ok");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(copy.className).not.toContain("prw-ok");
    vi.useRealTimers();
  });

  it("per-code-block copy buttons land inside rendered answers", () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<ChatTab />);
    openSession(
      mkSession("a", {
        messages: [
          { role: "user", content: "q" },
          { role: "assistant", content: "```ts\nconst x = 1;\n```" },
        ],
      }),
    );
    document.querySelector<HTMLButtonElement>(".prw-code-copy")!.click();
    expect(writeText).toHaveBeenCalledWith("const x = 1;");
  });
});

describe("suggestions + input", () => {
  it("skeletons → rows; a clipped row shows a chevron that expands; the → button asks", async () => {
    // make every row report as clipped so the expand chevron renders
    const sw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    const cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, value: 500 });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 100 });

    let resolve!: (v: { ok: boolean; data?: unknown }) => void;
    vi.mocked(api).mockImplementation((path: string) =>
      path === "/suggest"
        ? new Promise((res) => {
            resolve = res;
          })
        : Promise.resolve({ ok: true, data: { id: "q" } }),
    );
    render(<ChatTab />);
    openSession(mkSession("a", { suggestions: null }));
    expect(document.querySelector(".prw-skel")).toBeTruthy();
    await act(async () => {
      resolve({ ok: true, data: { suggestions: ["why is this safe?"] } });
    });
    expect(screen.getByText("why is this safe?")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Show full text")); // expand the clipped row
    expect(document.querySelector(".prw-srow-open")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Ask this question"));
    expect(vi.mocked(api)).toHaveBeenCalledWith(
      "/ask",
      "POST",
      expect.objectContaining({ question: "why is this safe?" }),
    );

    if (sw) Object.defineProperty(HTMLElement.prototype, "scrollWidth", sw);
    if (cw) Object.defineProperty(HTMLElement.prototype, "clientWidth", cw);
  });

  it("a general chat shows no suggestion rows; an empty suggestions list renders the bare area", () => {
    render(<ChatTab />);
    openSession(mkSession("g", { general: true, file: null, lines: null, text: "", suggestions: [] }));
    expect(document.querySelector(".prw-srow")).toBeNull();
    openSession(mkSession("a", { suggestions: [] })); // selection chat, no suggestions
    expect(document.querySelector(".prw-ai")?.className).not.toContain("prw-has");
  });

  it("Enter sends, ⌘+Enter inserts a newline, Shift+Enter is native, empty is a no-op, input autosizes", async () => {
    vi.useFakeTimers();
    mockStream(snap({ done: true, text: "a" }));
    render(<ChatTab />);
    openSession(mkSession("a"));
    const input = document.querySelector<HTMLTextAreaElement>(".prw-chat-input")!;

    fireEvent.click(screen.getByText("Ask")); // empty
    expect(state.chatHistory[0].messages).toEqual([]);

    input.value = "x";
    fireEvent.input(input);
    expect(input.style.height).not.toBe("");

    input.value = "line one";
    input.selectionStart = input.selectionEnd = input.value.length;
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(input.value).toBe("line one\n");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: "a" });

    input.value = "real question";
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(state.chatHistory[0].messages[0]).toEqual({ role: "user", content: "real question" });
    expect(input.value).toBe("");
    vi.useRealTimers();
  });
});
