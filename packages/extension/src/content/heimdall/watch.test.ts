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
      if (key === `kvasir:chats:${PR}`) return chats;
      return { step: 2, pos: { left: 1, top: 2 }, size: { w: 3, h: 4 } };
    });
    await loadPersisted();
    expect(state.chatHistory).toEqual(chats);
    expect(state.tourState).toEqual({
      step: 2,
      overview: false,
      pos: { left: 1, top: 2 },
      size: { w: 3, h: 4 },
    });
  });

  it("restores the overview 'step 0' flag so a refresh resumes on the overview", async () => {
    vi.mocked(storeGet).mockImplementation(async (key: string) =>
      key.startsWith("kvasir:chats:") ? [] : { step: 3, overview: true, pos: null, size: null },
    );
    await loadPersisted();
    expect(state.tourState).toEqual({ step: 3, overview: true, pos: null, size: null });
  });

  it("keeps in-memory chats, tolerates empty storage, defaults sparse tour fields", async () => {
    const live = [{ key: "live", file: null, lines: null, text: "", suggestions: [], messages: [] }];
    state.chatHistory = live;
    vi.mocked(storeGet).mockImplementation(async (key: string) =>
      key.startsWith("kvasir:chats:") ? [{ key: "stored" }] : {},
    );
    await loadPersisted();
    expect(state.chatHistory).toEqual(live);
    expect(state.tourState).toEqual({ step: 0, overview: false, pos: null, size: null });
  });

  it("does not touch panel state off a PR page (panel is per-tab, hydrated at boot)", async () => {
    setUrl("https://github.com/acme/widget-api/blob/main/src/a.ts?kvasir=rev-1"); // no PR url
    state.panel = { open: true, tab: "history", pos: { left: 5, top: 6 }, size: { w: 7, h: 8 } };
    vi.mocked(storeGet).mockResolvedValue(null);
    await loadPersisted();
    expect(state.panel).toEqual({
      open: true,
      tab: "history",
      pos: { left: 5, top: 6 },
      size: { w: 7, h: 8 },
    });
    expect(state.chatHistory).toEqual([]); // per-PR content skipped without a PR
    expect(state.tourState).toEqual({ step: 0, pos: null, size: null });
  });

  it("tolerates empty storage with nothing stored", async () => {
    setUrl(`${PR}/files`);
    vi.mocked(storeGet).mockResolvedValue(null);
    await loadPersisted();
    expect(state.chatHistory).toEqual([]);
    expect(state.tourState).toEqual({ step: 0, overview: false, pos: null, size: null });
  });
});

describe("applyTheme", () => {
  it("pushes the stored theme across the Bifrost", () => {
    const seen: unknown[] = [];
    const off = bifrost.handle("theme:apply", (p) => seen.push(p));
    state.theme = "dark";
    state.hlStyle = "gutter";
    applyTheme();
    expect(seen).toEqual([{ theme: "dark", hlStyle: "gutter" }]);
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
    // synchronous part of the PR switch: state reset; refresh is chained AFTER loadPersisted
    expect(reset).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1); // not yet re-fired — waiting on loadPersisted
    expect(state.chatHistory).toEqual([]);
    expect(state.tourState).toEqual({ step: 0, overview: false, pos: null, size: null });
    expect(state.panel).toEqual({ open: true, tab: "chat", pos: { left: 1, top: 1 }, size: { w: 2, h: 2 } }); // untouched: panel is per-tab, a PR switch (same tab) keeps its window
    expect(state.spec).toBeNull();
    // flush microtasks so loadPersisted resolves and its .then re-fires refresh
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(2); // re-fired only after the new PR's state landed
    expect(vi.mocked(storeGet)).toHaveBeenCalledWith(`kvasir:chats:${OTHER}`);
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
