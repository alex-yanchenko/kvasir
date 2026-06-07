// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { chatStore } from "../../chat";
import { PANEL_TABS, panelStore, state } from "../../store";
import type { ChatSession } from "../../types";
import { HistoryTab } from "./HistoryTab";

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
    value: new URL("https://github.com/acme/widget-api/pull/7/files"),
    writable: true,
  });
  state.chatHistory = [];
  state.panel = { open: true, tab: PANEL_TABS.HISTORY, pos: null, size: null };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("HistoryTab", () => {
  it("shows the empty state without sessions", () => {
    render(<HistoryTab />);
    expect(screen.getByText(/No chats yet/)).toBeTruthy();
  });

  it("lists sessions; opening one routes into the Chat tab", () => {
    state.chatHistory = [mkSession("a"), mkSession("b", { file: "src/b.ts" })];
    const open = vi.spyOn(chatStore, "open").mockImplementation(() => {});
    render(<HistoryTab />);
    fireEvent.click(screen.getByText(/app\.ts:4/));
    expect(open).toHaveBeenCalledWith(state.chatHistory[0]);
    expect(panelStore.tab()).toBe("chat");
  });

  it("deletes one session and clears all", () => {
    state.chatHistory = [mkSession("a"), mkSession("b")];
    render(<HistoryTab />);
    fireEvent.click(screen.getAllByLabelText("Delete this chat")[0]);
    expect(state.chatHistory.map((s) => s.key)).toEqual(["b"]);
    fireEvent.click(screen.getByText("Clear all chats"));
    expect(state.chatHistory).toEqual([]);
  });
});
