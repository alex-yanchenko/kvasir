// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { wipeStoredData } from "./debug";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("wipeStoredData", () => {
  it("removes only prw: keys from chrome.storage.local + web storage, keeping the rest", async () => {
    const get = vi.fn().mockResolvedValue({ "prw:token": 1, "prw:history": [], other: 2 });
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", { storage: { local: { get, remove } } });
    localStorage.setItem("prwTheme", "dark");
    localStorage.setItem("keep", "x");
    sessionStorage.setItem("prw:session:a", "1");
    sessionStorage.setItem("nope", "2");

    await wipeStoredData();

    expect(remove).toHaveBeenCalledWith(["prw:token", "prw:history"]);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("prwTheme")).toBeNull();
    expect(localStorage.getItem("keep")).toBe("x");
    expect(sessionStorage.getItem("prw:session:a")).toBeNull();
    expect(sessionStorage.getItem("nope")).toBe("2");
  });

  it("is a no-op for chrome.storage when no extension runtime, still clearing web storage", async () => {
    vi.stubGlobal("chrome", {});
    localStorage.setItem("prwHl", "github");
    await wipeStoredData();
    expect(localStorage.getItem("prwHl")).toBeNull();
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
