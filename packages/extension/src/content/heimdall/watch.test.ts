// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));
vi.mock("../api", () => ({ api: vi.fn() }));

import { launcherStore } from "../asgard/launcher";
import { state } from "../asgard/store";
import { bifrost } from "../bifrost";
import { storeGet } from "../muninn";
import { applyTheme, loadPersisted, watchUrl } from "./watch";

const PR = "https://github.com/acme/widget-api/pull/7";
const OTHER = "https://github.com/acme/widget-api/pull/8";

const setUrl = (href: string) =>
  Object.defineProperty(window, "location", { value: new URL(href), writable: true });

let stop: (() => void) | null;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("chrome", { runtime: { id: "ext" } });
  sessionStorage.clear();
  setUrl(`${PR}/files`);
  state.spec = null;
  state.chatHistory = [];
  state.tourState = { step: 0, pos: null, size: null };
  state.panel = { open: false, tab: "walkthrough", pos: null, size: null };
  stop = null;
  vi.mocked(storeGet).mockResolvedValue(undefined);
});
afterEach(() => {
  stop?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("loadPersisted", () => {
  it("restores stored chats and tour geometry for the current PR", async () => {
    const chats = [{ key: "a", file: "f.ts", lines: null, text: "t", suggestions: [], messages: [] }];
    vi.mocked(storeGet).mockImplementation(async (key: string) => {
      if (key === `prw:chats:${PR}`) return chats;
      if (key === "prw:panel") return { pos: { left: 9, top: 8 }, size: { w: 7, h: 6 } };
      return { step: 2, pos: { left: 1, top: 2 }, size: { w: 3, h: 4 } };
    });
    await loadPersisted();
    expect(state.chatHistory).toEqual(chats);
    expect(state.tourState).toEqual({ step: 2, pos: { left: 1, top: 2 }, size: { w: 3, h: 4 } });
    expect(state.panel.pos).toEqual({ left: 9, top: 8 });
    expect(state.panel.size).toEqual({ w: 7, h: 6 });
  });

  it("keeps in-memory chats, tolerates empty storage, defaults sparse tour fields", async () => {
    const live = [{ key: "live", file: null, lines: null, text: "", suggestions: [], messages: [] }];
    state.chatHistory = live;
    vi.mocked(storeGet).mockImplementation(async (key: string) =>
      key.startsWith("prw:chats:") ? [{ key: "stored" }] : {},
    );
    await loadPersisted();
    expect(state.chatHistory).toEqual(live);
    expect(state.tourState).toEqual({ step: 0, pos: null, size: null });
  });

  it("restores global panel geometry off a PR page, without touching chats/tour", async () => {
    setUrl("https://github.com/acme/widget-api/blob/main/src/a.ts?prw=rev-1"); // no PR url
    vi.mocked(storeGet).mockImplementation(async (key: string) =>
      key === "prw:panel" ? { pos: { left: 5, top: 6 }, size: { w: 7, h: 8 } } : null,
    );
    await loadPersisted();
    expect(state.panel.pos).toEqual({ left: 5, top: 6 });
    expect(state.panel.size).toEqual({ w: 7, h: 8 });
    expect(state.chatHistory).toEqual([]); // per-PR content skipped without a PR
    expect(state.tourState).toEqual({ step: 0, pos: null, size: null });
  });

  it("restores the persisted open-state + tab so the panel survives navigation", async () => {
    vi.mocked(storeGet).mockImplementation(async (key: string) =>
      key === "prw:panel" ? { pos: null, size: null, open: true, tab: "history" } : null,
    );
    await loadPersisted();
    expect(state.panel.open).toBe(true);
    expect(state.panel.tab).toBe("history");
  });

  it("ignores an unknown persisted tab, keeping the current one", async () => {
    state.panel.tab = "chat";
    vi.mocked(storeGet).mockImplementation(async (key: string) =>
      key === "prw:panel" ? { open: true, tab: "bogus" } : null,
    );
    await loadPersisted();
    expect(state.panel.tab).toBe("chat"); // bogus tab dropped
  });

  it("reopens the panel on the History tab after a History jump (marker set)", async () => {
    sessionStorage.setItem("prw:history-nav", "1");
    await loadPersisted();
    expect(state.panel.open).toBe(true);
    expect(state.panel.tab).toBe("history");
  });

  it("tolerates empty storage with nothing stored", async () => {
    setUrl(`${PR}/files`);
    vi.mocked(storeGet).mockResolvedValue(null);
    await loadPersisted();
    expect(state.chatHistory).toEqual([]);
    expect(state.tourState).toEqual({ step: 0, pos: null, size: null });
  });
});

describe("applyTheme", () => {
  it("pushes the stored theme across the Bifrost", () => {
    const seen: unknown[] = [];
    const off = bifrost.handle("theme:apply", (p) => seen.push(p));
    state.theme = "dark";
    state.hlStyle = "github";
    applyTheme();
    expect(seen).toEqual([{ theme: "dark", hlStyle: "github" }]);
    off();
  });
});

describe("watchUrl", () => {
  it("a same-PR URL change only refreshes the launcher; a PR switch resets and reloads", async () => {
    const refresh = vi.spyOn(launcherStore, "refresh").mockResolvedValue();
    const reset = vi.spyOn(launcherStore, "resetForPr").mockImplementation(() => {});
    state.chatHistory = [{ key: "x", file: null, lines: null, text: "", suggestions: [], messages: [] }];
    state.panel = { open: true, tab: "chat", pos: { left: 1, top: 1 }, size: { w: 2, h: 2 } };
    stop = watchUrl(1500);

    vi.advanceTimersByTime(1500); // no URL change — nothing happens
    expect(refresh).toHaveBeenCalledTimes(0);

    setUrl(`${PR}/commits`);
    vi.advanceTimersByTime(1500);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(0);
    expect(state.chatHistory.length).toBe(1);

    setUrl(`${OTHER}/files`);
    vi.advanceTimersByTime(1500);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(state.chatHistory).toEqual([]);
    expect(state.tourState).toEqual({ step: 0, pos: null, size: null });
    expect(state.panel).toEqual({ open: true, tab: "chat", pos: null, size: null }); // kept open (loadPersisted then restores the persisted open/tab); geometry cleared
    expect(state.spec).toBeNull();
    expect(vi.mocked(storeGet)).toHaveBeenCalledWith(`prw:chats:${OTHER}`);
  });

  it("stops itself when the extension is reloaded out from under the page", () => {
    const refresh = vi.spyOn(launcherStore, "refresh").mockResolvedValue();
    stop = watchUrl(1500);
    vi.stubGlobal("chrome", { runtime: undefined });
    setUrl(`${OTHER}/files`);
    vi.advanceTimersByTime(3000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("the stop function cancels the poll", () => {
    const refresh = vi.spyOn(launcherStore, "refresh").mockResolvedValue();
    const stopNow = watchUrl(1500);
    stopNow();
    setUrl(`${OTHER}/files`);
    vi.advanceTimersByTime(3000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
