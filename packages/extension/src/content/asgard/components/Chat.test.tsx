// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../api", () => ({ api: vi.fn() }));
vi.mock("../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { api } from "../../api";
import { bifrost } from "../../bifrost";
import { state } from "../store";
import { chatStore } from "../chat";
import type { ChatSession } from "../types";
import { ChatWindow, closeFences, linkifyRefs, REF_RE } from "./Chat";

const PR = "https://github.com/acme/widget-api/pull/7";

const mkSession = (key: string, over: Partial<ChatSession> = {}): ChatSession => ({
  key,
  file: "src/app.ts",
  lines: { start: 4, end: 6 },
  text: "const a = 1;",
  suggestions: [],
  messages: [],
  pos: { left: 30, top: 40 },
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
  document.getElementById("prw-root")?.remove(); // fixture survives a failed assertion otherwise
  offs.forEach((off) => off());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const openSession = (sess: ChatSession) => {
  state.chatHistory = [sess, ...state.chatHistory.filter((s) => s.key !== sess.key)];
  act(() => chatStore.open(sess));
};

describe("closeFences", () => {
  it("closes an odd fence so a streaming code block renders, leaves balanced text alone", () => {
    expect(closeFences("a\n```ts\ncode")).toBe("a\n```ts\ncode\n```");
    expect(closeFences("a\n```ts\ncode\n```")).toBe("a\n```ts\ncode\n```");
    expect(closeFences("plain")).toBe("plain");
  });
});

describe("REF_RE + linkifyRefs", () => {
  it("linkifies path:line and path:start-end outside code blocks", () => {
    const el = document.createElement("div");
    el.innerHTML = "see src/app.ts:4 and src/app.ts:4-6 but <pre>not.in.code:9</pre> <a href='#'>x.ts:1</a>";
    linkifyRefs(el);
    const refs = [...el.querySelectorAll<HTMLAnchorElement>(".prw-ref")];
    expect(refs.map((a) => a.textContent)).toEqual(["src/app.ts:4", "src/app.ts:4-6"]);
    refs[0].click();
    refs[1].click(); // the ranged form carries its end line
    expect(jumps).toEqual([
      { file: "src/app.ts", start: 4, end: null },
      { file: "src/app.ts", start: 4, end: 6 },
    ]);
    expect(REF_RE.test("just words")).toBe(false);
  });
});

describe("ChatWindow shell", () => {
  it("renders nothing without an active session", () => {
    const { container } = render(<ChatWindow />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the file:line label for a selection chat and This PR for the general one", () => {
    render(<ChatWindow />);
    openSession(mkSession("a"));
    expect(screen.getByText("app.ts:4-6")).toBeTruthy();
    openSession(mkSession("g", { general: true, file: null, lines: null, text: "", suggestions: [] }));
    expect(screen.getByText("This PR")).toBeTruthy();
  });

  it("a single-line selection collapses the label range", () => {
    render(<ChatWindow />);
    openSession(mkSession("a", { lines: { start: 4, end: 4 } }));
    expect(screen.getByText("app.ts:4")).toBeTruthy();
  });

  it("minimize persists geometry; × deletes the session", () => {
    render(<ChatWindow />);
    openSession(mkSession("a"));
    fireEvent.click(screen.getByLabelText("Collapse to Chats list"));
    expect(chatStore.active()).toBeNull();
    expect(state.chatHistory[0].pos).toEqual({ left: 0, top: 0 }); // jsdom rects

    openSession(mkSession("b"));
    fireEvent.click(screen.getByLabelText("Close and delete"));
    expect(state.chatHistory.find((s) => s.key === "b")).toBeUndefined();
  });

  it("shows the step-context banner and closes it on an outside click", () => {
    render(<ChatWindow />);
    openSession(mkSession("a", { step: "Step: X\ncontext body" }));
    const banner = document.querySelector<HTMLDetailsElement>(".prw-ctxbanner")!;
    banner.open = true;
    fireEvent.mouseDown(document.body);
    expect(banner.open).toBe(false);
    banner.open = true;
    fireEvent.mouseDown(banner); // clicks inside keep it open
    expect(banner.open).toBe(true);
  });

  it("restores a persisted size", () => {
    render(<ChatWindow />);
    openSession(mkSession("a", { size: { w: 500, h: 400 } }));
    const win = document.querySelector<HTMLElement>(".prw-chat")!;
    expect(win.style.width).toBe("500px");
    expect(win.style.height).toBe("400px");
  });

  it("dragging the head persists the final position", () => {
    render(<ChatWindow />);
    openSession(mkSession("a"));
    fireEvent.mouseDown(document.querySelector(".prw-chat-head")!, { clientX: 50, clientY: 50 });
    fireEvent.mouseMove(document, { clientX: 80, clientY: 70 });
    fireEvent.mouseUp(document);
    expect(state.chatHistory[0].pos).toEqual({ left: 0, top: 0 }); // jsdom rects
  });
});

const snap = (over: Partial<{ notes: string[]; text: string; done: boolean; timedOut: boolean }> = {}) => ({
  notes: [],
  text: "",
  done: false,
  timedOut: false,
  ...over,
});

/** /ask -> id, successive /poll calls walk the snapshots (last repeats), /suggest -> []. */
const mockStream = (...snaps: unknown[]) => {
  let i = 0;
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path.startsWith("/poll")) return { ok: true, data: snaps[Math.min(i++, snaps.length - 1)] };
    if (path === "/suggest") return { ok: true, data: { suggestions: [] } };
    return { ok: true, data: { id: "q-test" } };
  });
};

describe("asking", () => {
  it("a quick chip asks, shows typing, then streams the answer into markdown with citations", async () => {
    vi.useFakeTimers();
    mockStream(snap({ done: true, text: "look at \`src/app.ts:4\` for **why**" }));
    render(<ChatWindow />);
    openSession(mkSession("a"));
    await act(async () => {
      fireEvent.click(screen.getByText("Explain"));
    });
    expect(document.querySelector(".prw-typing")).toBeTruthy();
    // the poll lands the one-shot answer and mounts the typewriter...
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    // ...which streams, then the markdown render takes over
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(document.querySelector(".prw-md")).toBeTruthy();
    expect(document.querySelector(".prw-ref")!.textContent).toBe("src/app.ts:4");
    expect(state.chatHistory[0].messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    vi.useRealTimers();
  });

  it("live progress notes and partial text show in the bubble; a streamed answer skips the typewriter", async () => {
    vi.useFakeTimers();
    mockStream(
      snap({ notes: ["reading src/app.ts"] }),
      snap({ notes: ["reading src/app.ts"], text: "First piece." }),
      snap({ notes: ["reading src/app.ts"], text: "First piece. **Done.**", done: true }),
    );
    render(<ChatWindow />);
    openSession(mkSession("a"));
    await act(async () => {
      fireEvent.click(screen.getByText("Explain"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(screen.getByText(/reading src\/app\.ts/)).toBeTruthy();
    expect(document.querySelector(".prw-typing")).toBeTruthy(); // note, but no text yet
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    // the partial renders as markdown already, with an unfinished fence auto-closed
    expect(document.querySelector(".prw-live-text .prw-md")).toBeTruthy();
    expect(document.querySelector(".prw-live-text")!.textContent).toContain("First piece.");
    expect(document.querySelector(".prw-typing")).toBeTruthy(); // still streaming — dots stay up
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    // done: the live bubble is gone, the real message rendered as markdown immediately
    expect(document.querySelector(".prw-live-text")).toBeNull();
    expect(document.querySelector(".prw-md")).toBeTruthy();
    expect(document.querySelector(".prw-md b, .prw-md strong")).toBeTruthy();
    expect(state.chatHistory[0].messages.at(-1)).toEqual({
      role: "assistant",
      content: "First piece. **Done.**",
    });
    vi.useRealTimers();
  });

  it("failures render the friendly note with a working Retry", async () => {
    vi.useFakeTimers();
    vi.mocked(api).mockImplementation(async (path: string) =>
      path === "/ask" ? { ok: false, error: "request timed out" } : { ok: true, data: { suggestions: [] } },
    );
    render(<ChatWindow />);
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

  it("resumes a trailing unanswered question on open (refresh recovery)", async () => {
    vi.useFakeTimers();
    mockStream(snap({ done: true, text: "resumed" }));
    render(<ChatWindow />);
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

  it("an answer landing after the chat was deleted streams nowhere", async () => {
    vi.useFakeTimers();
    mockStream(snap({ done: true, text: "late" }));
    render(<ChatWindow />);
    openSession(mkSession("a"));
    await act(async () => {
      fireEvent.click(screen.getByText("Explain"));
    });
    act(() => chatStore.deleteActive());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(document.querySelector(".prw-chat")).toBeNull();
    expect(state.chatHistory).toEqual([]);
    vi.useRealTimers();
  });

  it("regenerate replaces an answer in place", async () => {
    vi.useFakeTimers();
    mockStream(snap({ done: true, text: "fresh take" }));
    render(<ChatWindow />);
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
  it("locate cycles through citations, or repaints the origin without any", () => {
    render(<ChatWindow />);
    openSession(
      mkSession("a", {
        messages: [
          { role: "user", content: "q" },
          { role: "assistant", content: "see src/app.ts:4 then src/app.ts:5" },
        ],
      }),
    );
    jumps = []; // open itself repaints the pick
    const locate = screen.getByLabelText("Jump to the cited code");
    fireEvent.click(locate);
    fireEvent.click(locate);
    fireEvent.click(locate); // wraps
    expect(jumps).toEqual([
      { file: "src/app.ts", start: 4, end: null },
      { file: "src/app.ts", start: 5, end: null },
      { file: "src/app.ts", start: 4, end: null },
    ]);
  });

  it("locate without citations repaints the origin selection (skipped for the PR chat)", () => {
    render(<ChatWindow />);
    openSession(
      mkSession("a", {
        messages: [
          { role: "user", content: "q" },
          { role: "assistant", content: "no refs here" },
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

  it("a legacy session without a file labels and repaints with an empty path", () => {
    render(<ChatWindow />);
    openSession(
      mkSession("a", {
        file: null,
        messages: [
          { role: "user", content: "q" },
          { role: "assistant", content: "no refs" },
        ],
      }),
    );
    expect(screen.getByText(":4-6")).toBeTruthy();
    jumps = [];
    fireEvent.click(screen.getByLabelText("Jump to the cited code"));
    expect(jumps).toEqual([{ pick: { file: "", text: "const a = 1;", scroll: true } }]);
  });

  it("copy writes the message and flashes the check", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<ChatWindow />);
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

  it("per-code-block copy buttons land inside rendered answers", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<ChatWindow />);
    openSession(
      mkSession("a", {
        messages: [
          { role: "user", content: "q" },
          { role: "assistant", content: "```ts\nconst x = 1;\n```" },
        ],
      }),
    );
    const btn = document.querySelector<HTMLButtonElement>(".prw-code-copy")!;
    btn.click();
    expect(writeText).toHaveBeenCalledWith("const x = 1;");
  });

  it("copy buttons are no-ops when the clipboard API is missing", () => {
    render(<ChatWindow />);
    openSession(
      mkSession("a", {
        messages: [
          { role: "user", content: "q" },
          { role: "assistant", content: "plain\n```ts\nconst x = 1;\n```" },
        ],
      }),
    );
    fireEvent.click(screen.getByLabelText("Copy message"));
    document.querySelector<HTMLButtonElement>(".prw-code-copy")!.click();
    expect(screen.getByLabelText("Copy message").className).toContain("prw-ok"); // still flashes
  });
});

describe("suggestions", () => {
  it("shows skeletons while fetching, then the rows; a row asks its question", async () => {
    let resolve!: (v: { ok: boolean; data?: unknown }) => void;
    vi.mocked(api).mockImplementation((path: string) =>
      path === "/suggest"
        ? new Promise((res) => {
            resolve = res;
          })
        : Promise.resolve({ ok: true, data: { answer: "a" } }),
    );
    render(<ChatWindow />);
    openSession(mkSession("a", { suggestions: null }));
    expect(document.querySelectorAll(".prw-skel").length).toBe(3);
    await act(async () => {
      resolve({ ok: true, data: { suggestions: ["What about overflow?"] } });
    });
    expect(screen.getByText("What about overflow?")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Ask this question"));
    });
    expect(state.chatHistory[0].messages[0]).toEqual({ role: "user", content: "What about overflow?" });
  });

  it("the expand chevron appears only when a row is clipped", () => {
    const widths = { scrollWidth: 300, clientWidth: 100 };
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("prw-srow-text") ? widths.scrollWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("prw-srow-text") ? widths.clientWidth : 0;
    });
    render(<ChatWindow />);
    openSession(mkSession("a", { suggestions: ["a long clipped suggestion"] }));
    const exp = screen.getByLabelText("Show full text");
    fireEvent.click(exp);
    expect(document.querySelector(".prw-srow-open")).toBeTruthy();
    fireEvent.click(exp);
    expect(document.querySelector(".prw-srow-open")).toBeNull();
  });
});

describe("input", () => {
  it("Enter sends, ⌘+Enter inserts a newline, Shift+Enter is native, empty submit is a no-op", async () => {
    vi.mocked(api).mockImplementation(async (path: string) =>
      path === "/ask" ? { ok: true, data: { answer: "a" } } : { ok: true, data: { suggestions: [] } },
    );
    render(<ChatWindow />);
    openSession(mkSession("a"));
    const input = document.querySelector<HTMLTextAreaElement>(".prw-chat-input")!;

    fireEvent.click(screen.getByText("Ask")); // empty — nothing happens
    expect(state.chatHistory[0].messages).toEqual([]);

    input.value = "line one";
    input.selectionStart = input.selectionEnd = input.value.length;
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(input.value).toBe("line one\n");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true }); // native newline path
    fireEvent.keyDown(input, { key: "a" }); // non-Enter ignored

    input.value = "line one\nand two";
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(state.chatHistory[0].messages[0]).toEqual({ role: "user", content: "line one\nand two" });
    expect(input.value).toBe("");
  });

  it("typing autosizes the textarea", () => {
    render(<ChatWindow />);
    openSession(mkSession("a"));
    const input = document.querySelector<HTMLTextAreaElement>(".prw-chat-input")!;
    input.value = "x";
    fireEvent.input(input);
    expect(input.style.height).not.toBe("");
  });
});

describe("initial position", () => {
  it("uses the anchor when there is no remembered position, avoiding the tour card", () => {
    // a shadow-rooted #prw-root with a card, like Heimdall builds
    const host = document.createElement("div");
    host.id = "prw-root";
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const card = document.createElement("div");
    card.className = "prw-card";
    shadow.appendChild(card);
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
      left: 200,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => null,
    });
    render(<ChatWindow />);
    const sess = mkSession("a", { pos: null });
    state.chatHistory = [sess];
    act(() => chatStore.open(sess, { left: 50, top: 700, bottom: 720, height: 20 }));
    const win = document.querySelector<HTMLElement>(".prw-chat")!;
    // anchor bottom near the viewport floor flips the window above (700 - 360 - 8);
    // the card at left 200 pushes it left of the anchor
    expect(win.style.top).toBe("332px");
    expect(win.style.left).toBe("10px");
    host.remove();
  });

  it("falls back to the default spot without pos or anchor", () => {
    render(<ChatWindow />);
    const sess = mkSession("a", { pos: null });
    state.chatHistory = [sess];
    act(() => chatStore.open(sess));
    const win = document.querySelector<HTMLElement>(".prw-chat")!;
    expect(win.style.left).toBe("40px");
    expect(win.style.top).toBe("90px");
  });
});
