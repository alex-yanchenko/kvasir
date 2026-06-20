// @vitest-environment jsdom
import type { EntrySummary } from "@kvasir/runes/history";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { api } from "../api";
import { HISTORY_KEY, SEEN_KEY } from "../keys";
import { storeGet, storeRemove, storeSet } from "../muninn";
import { historyStore } from "./history";
import { state } from "./store";

const sum = (over: Partial<EntrySummary> = {}): EntrySummary => ({
  kind: "code",
  id: "a",
  title: "Auth flow",
  source: "chat",
  steps: 2,
  repos: ["acme/web"],
  url: "https://github.com/acme/web/blob/main/a.ts?kvasir=a",
  version: 1,
  updatedAt: 1000,
  ...over,
});

beforeEach(() => {
  sessionStorage.clear();
  state.history = null;
  state.historyQuery = "";
  state.seen = {};
  state.review = null;
  state.spec = null;
  state.guideDeleted = false;
  vi.mocked(storeGet).mockResolvedValue(undefined);
  vi.mocked(api).mockResolvedValue({ ok: false });
});

describe("historyStore filter, query, and kind split", () => {
  it("returns all with no term, then filters by title, repo, and source", () => {
    state.history = [
      sum({ id: "a", title: "Auth flow", source: undefined }),
      sum({ id: "b", title: "Billing", source: "notes", repos: ["acme/api"] }),
    ];
    expect(historyStore.filtered().map((entry) => entry.id)).toEqual(["a", "b"]);
    historyStore.setQuery("auth");
    expect(historyStore.filtered().map((entry) => entry.id)).toEqual(["a"]);
    historyStore.setQuery("api"); // repo match
    expect(historyStore.filtered().map((entry) => entry.id)).toEqual(["b"]);
    historyStore.setQuery("notes"); // source match
    expect(historyStore.filtered().map((entry) => entry.id)).toEqual(["b"]);
    expect(historyStore.query()).toBe("notes");
  });

  it("splits the filtered list into pr and code sections", () => {
    state.history = [
      sum({ id: "p1", kind: "pr", title: "Add limit" }),
      sum({ id: "c1", kind: "code", title: "Auth flow" }),
      sum({ id: "p2", kind: "pr", title: "Auth on PR" }),
    ];
    expect(historyStore.prItems().map((entry) => entry.id)).toEqual(["p1", "p2"]);
    expect(historyStore.codeItems().map((entry) => entry.id)).toEqual(["c1"]);
    historyStore.setQuery("auth");
    expect(historyStore.prItems().map((entry) => entry.id)).toEqual(["p2"]);
    expect(historyStore.codeItems().map((entry) => entry.id)).toEqual(["c1"]);
  });

  it("filtered() is empty and all() is null before the first load", () => {
    expect(historyStore.filtered()).toEqual([]);
    expect(historyStore.all()).toBeNull();
  });
});

describe("historyStore.load", () => {
  it("loads the seen map, paints from cache, then refreshes and re-caches", async () => {
    vi.mocked(storeGet).mockImplementation(async (key) =>
      key === SEEN_KEY ? { a: 2 } : [sum({ id: "cached" })],
    );
    vi.mocked(api).mockResolvedValue({ ok: true, data: { entries: [sum({ id: "fresh" })] } });
    await historyStore.load();
    expect(state.seen).toEqual({ a: 2 });
    expect(historyStore.all()?.map((entry) => entry.id)).toEqual(["fresh"]);
    expect(storeSet).toHaveBeenCalledWith(HISTORY_KEY, [sum({ id: "fresh" })]);
  });

  it("keeps the cached list when the fetch fails", async () => {
    vi.mocked(storeGet).mockImplementation(async (key) =>
      key === SEEN_KEY ? undefined : [sum({ id: "cached" })],
    );
    vi.mocked(api).mockResolvedValue({ ok: false });
    await historyStore.load();
    expect(historyStore.all()?.map((entry) => entry.id)).toEqual(["cached"]);
  });

  it("ignores a malformed response (no entries key, or not a summary list)", async () => {
    vi.mocked(api).mockResolvedValue({ ok: true, data: { nope: 1 } });
    await historyStore.load();
    expect(historyStore.all()).toBeNull();
    vi.mocked(api).mockResolvedValue({ ok: true, data: { entries: "bad" } });
    await historyStore.load();
    expect(historyStore.all()).toBeNull();
  });
});

describe("historyStore.open", () => {
  it("marks the entry caught-up and navigates to its url", () => {
    const assign = vi.fn();
    Object.defineProperty(globalThis, "location", { value: { assign }, writable: true });
    historyStore.open(sum({ id: "a", version: 3 }));
    expect(state.seen).toEqual({ a: 3 });
    expect(storeSet).toHaveBeenCalledWith(SEEN_KEY, { a: 3 });
    expect(assign).toHaveBeenCalledWith("https://github.com/acme/web/blob/main/a.ts?kvasir=a");
  });

  it("refuses an off-github url, navigating nowhere and leaving it un-seen", () => {
    const assign = vi.fn();
    Object.defineProperty(globalThis, "location", { value: { assign }, writable: true });
    historyStore.open(sum({ id: "x", version: 2, url: "https://evil.example/acme/web/blob/main/a.ts" }));
    expect(assign).not.toHaveBeenCalled();
    expect(state.seen).toEqual({});
  });
});

describe("historyStore.remove", () => {
  it("soft-deletes on the bridge, drops the row + caches, and prunes seen", async () => {
    state.history = [sum({ id: "a" }), sum({ id: "b" })];
    state.seen = { a: 1, b: 1 };
    vi.mocked(api).mockResolvedValue({ ok: true, data: { ok: true } });
    await historyStore.remove("a");
    expect(api).toHaveBeenCalledWith("/entry?id=a", "DELETE");
    expect(historyStore.all()?.map((entry) => entry.id)).toEqual(["b"]);
    expect(storeSet).toHaveBeenCalledWith(HISTORY_KEY, [sum({ id: "b" })]);
    expect(storeRemove).toHaveBeenCalledWith("kvasir:review:a"); // code entry's render cache cleared
    expect(state.seen).toEqual({ b: 1 });
    expect(storeSet).toHaveBeenCalledWith(SEEN_KEY, { b: 1 }); // pruned seen is persisted, not just in-state
  });

  it("clears a pr entry's spec cache (keyed by the PR url, minus /files)", async () => {
    state.history = [sum({ id: "acme/web#7", kind: "pr", url: "https://github.com/acme/web/pull/7/files" })];
    vi.mocked(api).mockResolvedValue({ ok: true, data: { ok: true } });
    await historyStore.remove("acme/web#7");
    expect(storeRemove).toHaveBeenCalledWith("kvasir:spec:https://github.com/acme/web/pull/7");
  });

  it("clears the open walkthrough (guideDeleted) when you delete the one you're viewing", async () => {
    state.history = [sum({ id: "a" })];
    state.review = {
      version: 1,
      id: "a",
      title: "t",
      steps: [{ id: "s", title: "s", body: "b", repo: { owner: "acme", name: "web" }, file: "f.ts" }],
    };
    vi.mocked(api).mockResolvedValue({ ok: true, data: { ok: true } });
    await historyStore.remove("a");
    expect(state.review).toBeNull();
    expect(state.guideDeleted).toBe(true);
  });

  it("clears the open PR walkthrough (spec path) when you delete the one you're viewing", async () => {
    state.history = [sum({ id: "acme/web#7", kind: "pr", url: "https://github.com/acme/web/pull/7/files" })];
    state.spec = {
      version: 1,
      pr: { url: "https://github.com/acme/web/pull/7", owner: "acme", repo: "web", number: 7 },
      generatedAt: "t",
      steps: [],
    };
    vi.mocked(api).mockResolvedValue({ ok: true, data: { ok: true } });
    await historyStore.remove("acme/web#7");
    expect(state.spec).toBeNull();
    expect(state.guideDeleted).toBe(true);
  });

  it("leaves the list untouched when the delete fails", async () => {
    state.history = [sum({ id: "a" })];
    vi.mocked(api).mockResolvedValue({ ok: false });
    await historyStore.remove("a");
    expect(historyStore.all()?.map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("historyStore.observeExternal (cross-tab delete)", () => {
  it("adopts the new list and clears the viewed walkthrough if it was deleted elsewhere", () => {
    state.spec = {
      version: 1,
      pr: { url: "https://github.com/acme/web/pull/7", owner: "acme", repo: "web", number: 7 },
      generatedAt: "t",
      steps: [],
    };
    state.history = [sum({ id: "acme/web#7", kind: "pr" })];
    historyStore.observeExternal([sum({ id: "other", kind: "code" })]); // the pr entry is gone
    expect(historyStore.all()?.map((entry) => entry.id)).toEqual(["other"]);
    expect(state.spec).toBeNull();
    expect(state.guideDeleted).toBe(true);
  });

  it("keeps the viewed walkthrough when it's still in the new list", () => {
    state.review = {
      version: 1,
      id: "a",
      title: "t",
      steps: [{ id: "s", title: "s", body: "b", repo: { owner: "acme", name: "web" }, file: "f.ts" }],
    };
    state.history = [sum({ id: "a" })];
    historyStore.observeExternal([sum({ id: "a" }), sum({ id: "b" })]);
    expect(state.review).not.toBeNull();
    expect(state.guideDeleted).toBe(false);
  });

  it("ignores a malformed payload", () => {
    state.history = [sum({ id: "a" })];
    historyStore.observeExternal("garbage");
    expect(historyStore.all()?.map((entry) => entry.id)).toEqual(["a"]); // unchanged
  });

  it("clears a viewed review with no id (defensive) when it's absent from the new list", () => {
    state.review = {
      version: 1,
      title: "t",
      steps: [{ id: "s", title: "s", body: "b", repo: { owner: "acme", name: "web" }, file: "f.ts" }],
    };
    state.history = [sum({ id: "a" })];
    historyStore.observeExternal([sum({ id: "b" })]);
    expect(state.review).toBeNull();
    expect(state.guideDeleted).toBe(true);
  });
});

describe("historyStore drift + staleCount", () => {
  it("classifies new / current / update against the seen map", () => {
    state.seen = { current: 1, stale: 1 };
    expect(historyStore.driftFor(sum({ id: "never" }))).toBe("new");
    expect(historyStore.driftFor(sum({ id: "current", version: 1 }))).toBe("current");
    expect(historyStore.driftFor(sum({ id: "stale", version: 2 }))).toBe("update");
  });

  it("staleCount counts only the entries whose backend version advanced", () => {
    state.history = [
      sum({ id: "x", version: 2 }),
      sum({ id: "y", version: 1 }),
      sum({ id: "z", version: 1 }),
    ];
    state.seen = { x: 1, y: 1 }; // x advanced, y current, z never seen
    expect(historyStore.staleCount()).toBe(1);
  });
});

describe("historyStore.sync + syncAll", () => {
  it("sync acknowledges one entry's drift; a missing id is a no-op", () => {
    state.history = [sum({ id: "x", version: 2 })];
    state.seen = { x: 1 };
    historyStore.sync("missing");
    expect(state.seen).toEqual({ x: 1 });
    historyStore.sync("x");
    expect(state.seen).toEqual({ x: 2 });
    expect(storeSet).toHaveBeenCalledWith(SEEN_KEY, { x: 2 });
  });

  it("sync, syncAll, and remove are safe before the list has loaded (history null)", async () => {
    state.history = null;
    vi.mocked(api).mockResolvedValue({ ok: true, data: { ok: true } });
    historyStore.sync("x"); // no entry -> no-op
    expect(state.seen).toEqual({});
    historyStore.syncAll();
    expect(storeSet).toHaveBeenCalledWith(SEEN_KEY, {});
    await historyStore.remove("x");
    expect(historyStore.all()).toEqual([]);
  });

  it("syncAll acknowledges every flagged entry at once", () => {
    state.history = [
      sum({ id: "x", version: 3 }),
      sum({ id: "y", version: 1 }),
      sum({ id: "z", version: 5 }),
    ];
    state.seen = { x: 1, z: 4 }; // x + z stale, y never seen (not flagged)
    historyStore.syncAll();
    expect(state.seen).toEqual({ x: 3, z: 5 });
    expect(storeSet).toHaveBeenCalledWith(SEEN_KEY, { x: 3, z: 5 });
  });
});
