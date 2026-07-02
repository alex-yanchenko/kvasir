// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// newChat rechecks the connection via /health
vi.mock(import("../../api"), async (importOriginal) => ({ ...(await importOriginal()), api: vi.fn() }));
vi.mock("../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { api } from "../../api";
import { chatStore } from "../chat";
import { state } from "../store";
import type { ChatSession } from "../types";
import { ChatList } from "./ChatList";

const mkSession = (key: string, over: Partial<ChatSession> = {}): ChatSession => ({
  key,
  file: "src/app.ts",
  lines: { start: 4, end: 6 },
  text: "const a = 1;",
  suggestions: [],
  messages: [],
  ...over,
});

beforeEach(() => {
  Object.defineProperty(window, "location", {
    value: new URL("https://github.com/a/b/pull/7/files"),
    writable: true,
  });
  state.chatHistory = [];
  chatStore.deleteActive();
  vi.mocked(api).mockResolvedValue({ ok: true, data: { ok: true } });
});
afterEach(() => cleanup());

describe("ChatList", () => {
  it("shows the empty state and starts a new (general) chat", () => {
    render(<ChatList />);
    expect(screen.getByText("No chats yet.")).toBeTruthy();
    act(() => fireEvent.click(screen.getByRole("button", { name: "New chat" })));
    expect(state.chatHistory.length).toBe(1);
    expect(state.chatHistory[0]!.general).toBe(true);
    expect(chatStore.active()?.key).toBe(state.chatHistory[0]!.key); // the new chat opens
  });

  it("lists open chats (active highlighted), switches, and deletes one", () => {
    state.chatHistory = [mkSession("sel"), mkSession("g", { general: true, file: null, lines: null })];
    act(() => chatStore.open(state.chatHistory[0]!)); // "sel" active
    render(<ChatList />);
    expect(screen.getByText(/app\.ts:4/)).toBeTruthy(); // snippet: "app.ts:4 — const a = 1;"
    expect(screen.getByText("This PR")).toBeTruthy();
    // active "sel" entry is highlighted
    expect(screen.getByText(/app\.ts:4/).closest(".group")?.className).toContain("bg-accent");
    // switch to the general chat
    act(() => fireEvent.click(screen.getByText("This PR")));
    expect(chatStore.active()?.general).toBe(true);
    // delete the selection chat
    act(() => fireEvent.click(screen.getAllByLabelText("Delete this chat")[0]!));
    expect(state.chatHistory.find((s) => s.key === "sel")).toBeUndefined();
  });

  it("deleting the active chat clears the active slot", () => {
    state.chatHistory = [mkSession("a")];
    act(() => chatStore.open(state.chatHistory[0]!)); // "a" is active
    render(<ChatList />);
    act(() => fireEvent.click(screen.getByLabelText("Delete this chat")));
    expect(chatStore.active()).toBeNull();
    expect(state.chatHistory.find((s) => s.key === "a")).toBeUndefined();
  });

  it("clears all chats", () => {
    state.chatHistory = [mkSession("a"), mkSession("b")];
    render(<ChatList />);
    act(() => fireEvent.click(screen.getByRole("button", { name: "Clear all" })));
    expect(state.chatHistory).toEqual([]);
  });
});
