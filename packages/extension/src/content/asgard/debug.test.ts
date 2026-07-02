// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../api";
import { HISTORY_KEY } from "../keys";
import { storeSet } from "../muninn";
import { wipeStoredData } from "./debug";

vi.mock(import("../api"), async (importOriginal) => ({ ...(await importOriginal()), api: vi.fn() }));
vi.mock("../muninn", () => ({ storeSet: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("wipeStoredData", () => {
  it("removes only kvasir: keys from chrome.storage.local + web storage, keeping the rest", async () => {
    const get = vi.fn().mockResolvedValue({ "kvasir:token": 1, "kvasir:history": [], other: 2 });
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", { storage: { local: { get, remove } } });
    localStorage.setItem("kvasirTheme", "dark");
    localStorage.setItem("keep", "x");
    sessionStorage.setItem("kvasir:session:a", "1");
    sessionStorage.setItem("nope", "2");

    await wipeStoredData();

    expect(remove).toHaveBeenCalledWith(["kvasir:token", "kvasir:history"]);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("kvasirTheme")).toBeNull();
    expect(localStorage.getItem("keep")).toBe("x");
    expect(sessionStorage.getItem("kvasir:session:a")).toBeNull();
    expect(sessionStorage.getItem("nope")).toBe("2");
  });

  it("hard-wipes the backend then signals every tab via HISTORY_KEY=[]", async () => {
    vi.stubGlobal("chrome", { storage: { local: { get: vi.fn().mockResolvedValue({}), remove: vi.fn() } } });

    await wipeStoredData();

    expect(api).toHaveBeenCalledWith("/entries", "DELETE");
    expect(api).toHaveBeenCalledTimes(1);
    // [] (not a removal) is what makes onChanged fire newValue=[] cross-tab.
    expect(storeSet).toHaveBeenCalledWith(HISTORY_KEY, []);
    expect(storeSet).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for chrome.storage when no extension runtime, still clearing web storage", async () => {
    vi.stubGlobal("chrome", {});
    localStorage.setItem("kvasirHl", "gutter");
    await wipeStoredData();
    expect(localStorage.getItem("kvasirHl")).toBeNull();
  });

  it("swallows web-storage failures (storage unavailable)", async () => {
    vi.stubGlobal("chrome", {});
    vi.stubGlobal("localStorage", {
      removeItem: () => {
        throw new Error("web storage blocked");
      },
    });
    await expect(wipeStoredData()).resolves.toBeUndefined();
  });

  it("swallows a failing chrome.storage call (orphaned context)", async () => {
    const get = vi.fn().mockRejectedValue(new Error("orphaned"));
    vi.stubGlobal("chrome", { storage: { local: { get, remove: vi.fn() } } });
    await expect(wipeStoredData()).resolves.toBeUndefined();
  });
});
