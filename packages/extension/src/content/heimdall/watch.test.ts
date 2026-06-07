// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));
vi.mock("../api", () => ({ api: vi.fn() }));

import { storeGet } from "../muninn";
import { bifrost } from "../bifrost";
import { state } from "../asgard/store";
import { launcherStore } from "../asgard/launcher";
import { applyTheme, loadPersisted, watchUrl } from "./watch";

const PR = "https://github.com/acme/widget-api/pull/7";
const OTHER = "https://github.com/acme/widget-api/pull/8";

const setUrl = (href: string) =>
  Object.defineProperty(window, "location", { value: new URL(href), writable: true });

let stop: (() => void) | null;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("chrome", { runtime: { id: "ext" } });
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
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("loadPersisted", () => {
  it("restores stored chats and tour geometry for the current PR", async () => {
    const chats = [{ key: "a", file: "f.ts", lines: null, text: "t", suggestions: [], messages: [] }];
    vi.mocked(storeGet).mockImplementation(async (key: string) => {
      if (key === `prw:chats:${PR}`) return chats;
      if (key === `prw:panel:${PR}`) return { pos: { left: 9, top: 8 }, size: { w: 7, h: 6 } };
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

  it("does nothing off a PR page or with nothing stored", async () => {
    setUrl("https://github.com/acme/widget-api");
    await loadPersisted();
    expect(vi.mocked(storeGet)).not.toHaveBeenCalled();

    setUrl(`${PR}/files`);
    await loadPersisted(); // storeGet -> undefined for both keys
    vi.mocked(storeGet).mockResolvedValue(null);
    await loadPersisted(); // stored nulls are ignored the same way
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
    expect(state.panel).toEqual({ open: false, tab: "chat", pos: null, size: null }); // closed, geometry cleared
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
