// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSnapshot, settingsStore, subscribe, touch } from "./store";
import * as storeModule from "./store";
import { chatsStore } from "./store";
import { state } from "./store";
import { bifrost } from "./../bifrost";

let applied: ReturnType<typeof vi.fn>;
let offApply: () => void;
beforeEach(() => {
  state.theme = "auto";
  state.hlStyle = "tint";
  localStorage.clear();
  applied = vi.fn();
  offApply = bifrost.handle("theme:apply", applied);
});
afterEach(() => {
  offApply();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("settingsStore", () => {
  it("reads live values from the backing state", () => {
    expect(settingsStore.theme()).toBe("auto");
    expect(settingsStore.hlStyle()).toBe("tint");
  });

  it("setTheme writes through: state, localStorage, theme:apply, and a version bump", () => {
    const before = getSnapshot();
    settingsStore.setTheme("dark");
    expect(state.theme).toBe("dark");
    expect(localStorage.getItem("prwTheme")).toBe("dark");
    expect(applied).toHaveBeenCalledWith({ theme: "dark", hlStyle: "tint" });
    expect(applied).toHaveBeenCalledTimes(1);
    expect(getSnapshot()).toBe(before + 1);
  });

  it("setHlStyle writes through the same path", () => {
    settingsStore.setHlStyle("github");
    expect(state.hlStyle).toBe("github");
    expect(localStorage.getItem("prwHl")).toBe("github");
    expect(applied).toHaveBeenCalledWith({ theme: "auto", hlStyle: "github" });
    expect(applied).toHaveBeenCalledTimes(1);
  });
});

describe("subscriptions", () => {
  it("notifies subscribers on touch and stops after unsubscribe", () => {
    const listener = vi.fn();
    const off = subscribe(listener);
    touch();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    touch();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("chatsStore", () => {
  const mkSession = (key: string, over: Partial<import("./types").ChatSession> = {}) => ({
    key,
    file: "src/app.ts",
    lines: { start: 1, end: 2 },
    text: "const a = 1;",
    suggestions: null,
    messages: [],
    pos: null,
    ...over,
  });
  let setSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: new URL("https://github.com/acme/widget-api/pull/7/files"),
      writable: true,
    });
    setSpy = vi.fn();
    vi.stubGlobal("chrome", { storage: { local: { set: setSpy } } });
    state.chatHistory = [mkSession("a"), mkSession("b")];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sessions() reads the live history", () => {
    expect(chatsStore.sessions().map((s) => s.key)).toEqual(["a", "b"]);
  });

  it("dropSession removes the session and persists", () => {
    chatsStore.dropSession("a");
    expect(state.chatHistory.map((s) => s.key)).toEqual(["b"]);
    expect(setSpy).toHaveBeenCalledWith({
      "prw:chats:https://github.com/acme/widget-api/pull/7": state.chatHistory,
    });
  });

  it("clearSessions empties and persists", () => {
    chatsStore.clearSessions();
    expect(state.chatHistory).toEqual([]);
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it("chatSnippet: file:line — first question, with selection-text and general fallbacks", () => {
    const { chatSnippet } = storeModule;
    expect(chatSnippet(mkSession("k", { messages: [{ role: "user", content: "why this loop?" }] }))).toBe(
      "app.ts:1 — why this loop?",
    );
    expect(chatSnippet(mkSession("k", { lines: null, text: "const a = 1;  const b = 2;" }))).toBe(
      "app.ts — const a = 1; const b = 2;",
    );
    expect(chatSnippet(mkSession("k", { general: true, file: null, lines: null, text: "" }))).toBe("This PR");
    // a legacy/corrupt session with a null file but general unset still renders
    expect(chatSnippet(mkSession("k", { file: null, lines: null, text: "x", messages: [] }))).toBe(" — x");
    expect(
      chatSnippet(
        mkSession("k", {
          general: true,
          file: null,
          lines: null,
          text: "",
          messages: [{ role: "user", content: "summarize" }],
        }),
      ),
    ).toBe("This PR — summarize");
  });
});

describe("panelStore", () => {
  let setSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: new URL("https://github.com/acme/widget-api/pull/7/files"),
      writable: true,
    });
    setSpy = vi.fn();
    vi.stubGlobal("chrome", { storage: { local: { set: setSpy } } });
    storeModule.state.panel = { open: false, tab: storeModule.PANEL_TABS.WALKTHROUGH, pos: null, size: null };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("open shows the panel and can target a tab; close hides it", () => {
    expect(storeModule.panelStore.isOpen()).toBe(false);
    storeModule.panelStore.open();
    expect(storeModule.panelStore.isOpen()).toBe(true);
    expect(storeModule.panelStore.tab()).toBe("walkthrough"); // unchanged default
    storeModule.panelStore.open(storeModule.PANEL_TABS.CHAT);
    expect(storeModule.panelStore.tab()).toBe("chat");
    storeModule.panelStore.close();
    expect(storeModule.panelStore.isOpen()).toBe(false);
  });

  it("setTab switches the active tab", () => {
    storeModule.panelStore.setTab(storeModule.PANEL_TABS.SETTINGS);
    expect(storeModule.panelStore.tab()).toBe("settings");
  });

  it("setPos / setSize update geometry and persist per-PR", () => {
    storeModule.panelStore.setPos({ left: 12, top: 34 });
    storeModule.panelStore.setSize({ w: 500, h: 600 });
    expect(storeModule.panelStore.pos()).toEqual({ left: 12, top: 34 });
    expect(storeModule.panelStore.size()).toEqual({ w: 500, h: 600 });
    expect(setSpy).toHaveBeenLastCalledWith({
      "prw:panel:https://github.com/acme/widget-api/pull/7": {
        pos: { left: 12, top: 34 },
        size: { w: 500, h: 600 },
      },
    });
  });
});
