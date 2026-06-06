// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChatsButton } from "./ChatsButton";
import { state } from "../store";
import { chatStore } from "../chat";
import type { ChatSession } from "../types";

const mkSession = (key: string, over: Partial<ChatSession> = {}): ChatSession => ({
  key,
  file: "src/app.ts",
  lines: { start: 4, end: 6 },
  text: "const a = 1;",
  suggestions: null,
  messages: [{ role: "user", content: `q-${key}` }],
  pos: null,
  ...over,
});

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: new URL("https://github.com/acme/widget-api/pull/7/files"),
    writable: true,
  });
  vi.stubGlobal("chrome", { storage: { local: { set: vi.fn() } } });
  state.chatHistory = [mkSession("a"), mkSession("b")];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("ChatsButton", () => {
  it("renders nothing when there are no sessions", () => {
    state.chatHistory = [];
    const { container } = render(<ChatsButton />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the count and toggles the list", () => {
    render(<ChatsButton />);
    const pill = screen.getByText("Chats (2)");
    fireEvent.click(pill);
    expect(screen.getByText("app.ts:4 — q-a")).toBeTruthy();
    fireEvent.click(pill);
    expect(screen.queryByText("app.ts:4 — q-a")).toBeNull();
  });

  it("opens a session through the chat machine and closes the list", () => {
    const open = vi.spyOn(chatStore, "open").mockImplementation(() => {});
    render(<ChatsButton />);
    fireEvent.click(screen.getByText("Chats (2)"));
    fireEvent.click(screen.getByText("app.ts:4 — q-b"));
    expect(open).toHaveBeenCalledWith(state.chatHistory[1]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("app.ts:4 — q-a")).toBeNull();
  });

  it("deletes one session and re-renders the count", () => {
    render(<ChatsButton />);
    fireEvent.click(screen.getByText("Chats (2)"));
    fireEvent.click(screen.getAllByLabelText("Delete this chat")[0]);
    expect(screen.getByText("Chats (1)")).toBeTruthy();
    expect(screen.queryByText("app.ts:4 — q-a")).toBeNull();
  });

  it("clear-all empties the history and unmounts the pill", () => {
    const { container } = render(<ChatsButton />);
    fireEvent.click(screen.getByText("Chats (2)"));
    fireEvent.click(screen.getByText("Clear all chats"));
    expect(state.chatHistory).toEqual([]);
    expect(container.innerHTML).toBe("");
  });
});
