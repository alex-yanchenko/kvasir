// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { bifrost } from "../bifrost";
import { getSnapshot, settingsStore, subscribe, touch, chatsStore, state } from "./store";
import * as storeModule from "./store";

let applied: Mock<(payload: { theme: string; hlStyle: string }) => void>;
let offApply: () => void;
beforeEach(() => {
  state.theme = "auto";
  state.hlStyle = "rail";
  state.reviewMode = "heavy";
  state.reviewReposRoot = "~/code";
  state.preloadQuestions = false;
  localStorage.clear();
  applied = vi.fn<(payload: { theme: string; hlStyle: string }) => void>();
  offApply = bifrost.handle("theme:apply", applied);
});
afterEach(() => {
  offApply();
});

describe("settingsStore", () => {
  it("reads live values from the backing state", () => {
    expect(settingsStore.theme()).toBe("auto");
    expect(settingsStore.hlStyle()).toBe("rail");
  });

  it("validHlStyle keeps a known style and retires anything else to the rail default", () => {
    expect(storeModule.validHlStyle("rail")).toBe("rail");
    expect(storeModule.validHlStyle("gutter")).toBe("gutter");
    expect(storeModule.validHlStyle("tint")).toBe("rail"); // a retired old value
    expect(storeModule.validHlStyle(null)).toBe("rail");
  });

  it("setTheme writes through: state, localStorage, theme:apply, and a version bump", () => {
    const before = getSnapshot();
    settingsStore.setTheme("dark");
    expect(state.theme).toBe("dark");
    expect(localStorage.getItem("kvasirTheme")).toBe("dark");
    expect(applied).toHaveBeenCalledWith({ theme: "dark", hlStyle: "rail" });
    expect(applied).toHaveBeenCalledTimes(1);
    expect(getSnapshot()).toBe(before + 1);
  });

  it("setHlStyle writes through the same path", () => {
    settingsStore.setHlStyle("gutter");
    expect(state.hlStyle).toBe("gutter");
    expect(localStorage.getItem("kvasirHl")).toBe("gutter");
    expect(applied).toHaveBeenCalledWith({ theme: "auto", hlStyle: "gutter" });
    expect(applied).toHaveBeenCalledTimes(1);
  });

  it("reviewSync defaults on, and setReviewSync persists + bumps the version", () => {
    expect(settingsStore.reviewSync()).toBe(true);
    const before = getSnapshot();
    settingsStore.setReviewSync(false);
    expect(state.reviewSync).toBe(false);
    expect(localStorage.getItem("kvasirReviewSync")).toBe("false");
    expect(getSnapshot()).toBe(before + 1);
  });

  it("reviewMode defaults heavy, and setReviewMode persists + bumps the version (no page command)", () => {
    expect(settingsStore.reviewMode()).toBe("heavy");
    const before = getSnapshot();
    settingsStore.setReviewMode("light");
    expect(state.reviewMode).toBe("light");
    expect(localStorage.getItem("kvasirReviewMode")).toBe("light");
    expect(applied).not.toHaveBeenCalled();
    expect(getSnapshot()).toBe(before + 1);
  });

  it("reviewReposRoot defaults to ~/code, and setReviewReposRoot persists + bumps the version", () => {
    expect(settingsStore.reviewReposRoot()).toBe("~/code");
    const before = getSnapshot();
    settingsStore.setReviewReposRoot("/srv/repos");
    expect(state.reviewReposRoot).toBe("/srv/repos");
    expect(localStorage.getItem("kvasirReviewReposRoot")).toBe("/srv/repos");
    expect(getSnapshot()).toBe(before + 1);
  });

  it("dismissFirstRun persists + bumps the version once — a repeat is a no-op", () => {
    state.firstRun = true;
    const before = getSnapshot();
    settingsStore.dismissFirstRun();
    expect(settingsStore.firstRun()).toBe(false);
    expect(localStorage.getItem("kvasirFirstRunDone")).toBe("true");
    expect(getSnapshot()).toBe(before + 1);
    settingsStore.dismissFirstRun(); // already dismissed (the Run button fires it every click)
    expect(getSnapshot()).toBe(before + 1);
  });

  it("firstRun reads the persisted dismissal on module load — the card never comes back", async () => {
    localStorage.setItem("kvasirFirstRunDone", "true");
    vi.resetModules();
    const fresh = await import("./store");
    expect(fresh.settingsStore.firstRun()).toBe(false);
    localStorage.removeItem("kvasirFirstRunDone");
    vi.resetModules();
    const untouched = await import("./store");
    expect(untouched.settingsStore.firstRun()).toBe(true); // default: show the card
  });

  it("preloadQuestions defaults off, and setPreloadQuestions persists + bumps the version", () => {
    expect(settingsStore.preloadQuestions()).toBe(false);
    const before = getSnapshot();
    settingsStore.setPreloadQuestions(true);
    expect(state.preloadQuestions).toBe(true);
    expect(localStorage.getItem("kvasirPreloadQuestions")).toBe("true");
    expect(getSnapshot()).toBe(before + 1);
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
      "kvasir:chats:https://github.com/acme/widget-api/pull/7": state.chatHistory,
    });
  });

  it("dropSession on a page with no PR and no review persists nothing (no null bucket)", () => {
    Object.defineProperty(window, "location", {
      value: new URL("https://github.com/acme/widget-api/blob/main/src/a.ts"),
      writable: true,
    });
    chatsStore.dropSession("a");
    expect(state.chatHistory.map((s) => s.key)).toEqual(["b"]); // state still updates
    expect(setSpy).not.toHaveBeenCalled();
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
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: new URL("https://github.com/acme/widget-api/pull/7/files"),
      writable: true,
    });
    storeModule.panelStore.setSidebarOpen(false); // reset the module-level open state (writes a blob)…
    sessionStorage.clear(); // …then empty it so "nothing stored" cases start clean
    storeModule.state.panel = { open: false, tab: storeModule.PANEL_TABS.WALKTHROUGH, pos: null, size: null };
  });

  const persisted = (): unknown => JSON.parse(sessionStorage.getItem("kvasir:panel") ?? "null");
  const prefs = (): unknown => JSON.parse(localStorage.getItem("kvasir:panelPrefs.v2") ?? "null");

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

  it("splits persistence: open/tab per-tab in sessionStorage, shape (pos/size/sidebar) global in localStorage", () => {
    storeModule.panelStore.open(storeModule.PANEL_TABS.HISTORY);
    expect(persisted()).toEqual({ open: true, tab: "history" }); // sessionStorage: no shape
    storeModule.panelStore.setPos({ left: 12, top: 34 });
    storeModule.panelStore.setSize({ w: 500, h: 600 });
    storeModule.panelStore.setSidebarOpen(true);
    // the window SHAPE lives in localStorage (survives across tabs), never in the blob
    expect(prefs()).toEqual({ pos: { left: 12, top: 34 }, size: { w: 500, h: 600 }, sidebarOpen: true });
    expect(persisted()).toEqual({ open: true, tab: "history" });
    storeModule.panelStore.close();
    expect(persisted()).toEqual({ open: false, tab: "history" }); // only open/tab change
  });

  it("restores the global shape in a FRESH tab (empty sessionStorage) — the cross-tab bug", () => {
    storeModule.panelStore.setPos({ left: 12, top: 34 });
    storeModule.panelStore.setSize({ w: 500, h: 600 });
    storeModule.panelStore.setSidebarOpen(true);
    // A brand-new tab starts with empty sessionStorage but shares localStorage.
    sessionStorage.clear();
    storeModule.state.panel = { open: false, tab: storeModule.PANEL_TABS.WALKTHROUGH, pos: null, size: null };
    storeModule.hydratePanel();
    expect(storeModule.panelStore.pos()).toEqual({ left: 12, top: 34 }); // not snapped to default
    expect(storeModule.panelStore.size()).toEqual({ w: 500, h: 600 });
    expect(storeModule.panelStore.sidebarOpen()).toBe(true);
  });

  it("setPos / setSize persist AND re-render (the corner grip renders straight from the store)", () => {
    const before = getSnapshot();
    storeModule.panelStore.setPos({ left: 1, top: 2 });
    expect(getSnapshot()).not.toBe(before); // touch() fired
    const mid = getSnapshot();
    storeModule.panelStore.setSize({ w: 3, h: 4 });
    expect(getSnapshot()).not.toBe(mid);
    expect(storeModule.panelStore.pos()).toEqual({ left: 1, top: 2 });
    expect(storeModule.panelStore.size()).toEqual({ w: 3, h: 4 });
  });

  it("hydratePanel restores open/tab (sessionStorage) + shape (localStorage); a bogus tab keeps the current one", () => {
    sessionStorage.setItem("kvasir:panel", JSON.stringify({ open: true, tab: "history" }));
    localStorage.setItem(
      "kvasir:panelPrefs.v2",
      JSON.stringify({ pos: { left: 5, top: 6 }, size: { w: 7, h: 8 }, sidebarOpen: true }),
    );
    storeModule.hydratePanel();
    expect(storeModule.panelStore.isOpen()).toBe(true);
    expect(storeModule.panelStore.tab()).toBe("history");
    expect(storeModule.panelStore.pos()).toEqual({ left: 5, top: 6 });
    expect(storeModule.panelStore.size()).toEqual({ w: 7, h: 8 });
    expect(storeModule.panelStore.sidebarOpen()).toBe(true);
    sessionStorage.setItem("kvasir:panel", JSON.stringify({ open: true, tab: "bogus" }));
    storeModule.hydratePanel();
    expect(storeModule.panelStore.tab()).toBe("history"); // bogus tab dropped
  });

  it("hydratePanel with nothing stored leaves the panel closed at default geometry", () => {
    storeModule.state.panel = {
      open: true,
      tab: storeModule.PANEL_TABS.CHAT,
      pos: { left: 1, top: 2 },
      size: { w: 3, h: 4 },
    };
    sessionStorage.clear();
    localStorage.removeItem("kvasir:panelPrefs.v2"); // nothing persisted anywhere
    storeModule.hydratePanel();
    expect(storeModule.panelStore.isOpen()).toBe(false);
    expect(storeModule.panelStore.pos()).toBeNull();
    expect(storeModule.panelStore.size()).toBeNull();
  });

  it("survives sessionStorage being unavailable (private mode / disabled)", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    });
    expect(() => storeModule.panelStore.open()).not.toThrow(); // persist catch
    expect(() => storeModule.hydratePanel()).not.toThrow(); // read catch
    vi.unstubAllGlobals();
  });

  it("setSidebarOpen toggles the sidebar and re-renders", () => {
    const before = getSnapshot();
    expect(storeModule.panelStore.sidebarOpen()).toBe(false);
    storeModule.panelStore.setSidebarOpen(true);
    expect(storeModule.panelStore.sidebarOpen()).toBe(true);
    expect(getSnapshot()).not.toBe(before); // touch() fired
    storeModule.panelStore.setSidebarOpen(false);
    expect(storeModule.panelStore.sidebarOpen()).toBe(false);
  });

  it("setSidebarWidth rounds, clamps to [130, 360], and persists to localStorage", () => {
    storeModule.panelStore.setSidebarWidth(212.7);
    expect(storeModule.panelStore.sidebarWidth()).toBe(213); // rounded
    expect(localStorage.getItem("kvasirSidebarWidth")).toBe("213");
    storeModule.panelStore.setSidebarWidth(50); // below min
    expect(storeModule.panelStore.sidebarWidth()).toBe(130);
    storeModule.panelStore.setSidebarWidth(9000); // above max
    expect(storeModule.panelStore.sidebarWidth()).toBe(360);
  });

  it("guideDeleted shows only while nothing is loaded; dismiss + close clear the flag", () => {
    storeModule.state.review = null;
    storeModule.state.spec = null;
    storeModule.state.guideDeleted = false;
    expect(storeModule.panelStore.guideDeleted()).toBe(false); // flag off
    storeModule.state.guideDeleted = true;
    expect(storeModule.panelStore.guideDeleted()).toBe(true);
    storeModule.state.spec = {
      version: 1,
      pr: { url: "u", owner: "a", repo: "b", number: 1 },
      generatedAt: "t",
      steps: [],
    };
    expect(storeModule.panelStore.guideDeleted()).toBe(false); // a loaded spec hides it
    storeModule.state.spec = null;
    storeModule.state.review = {
      version: 1,
      id: "r",
      title: "t",
      steps: [{ id: "s", title: "s", body: "b", repo: { owner: "a", name: "b" }, file: "f.ts" }],
    };
    expect(storeModule.panelStore.guideDeleted()).toBe(false); // a loaded review hides it too
    storeModule.state.review = null;
    storeModule.panelStore.dismissGuideDeleted();
    expect(storeModule.state.guideDeleted).toBe(false);
    storeModule.state.guideDeleted = true;
    storeModule.panelStore.close();
    expect(storeModule.state.guideDeleted).toBe(false); // close clears it
  });
});
