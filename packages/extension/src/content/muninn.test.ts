import { describe, it, expect, vi, afterEach } from "vitest";
import { storeGet, storeSet, storeRemove } from "./muninn";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storeGet", () => {
  it("resolves the value stored under the key", async () => {
    vi.stubGlobal("chrome", {
      storage: { local: { get: (k: string, cb: (o: Record<string, unknown>) => void) => cb({ [k]: 42 }) } },
    });
    expect(await storeGet("prw:spec")).toBe(42);
  });

  it("resolves undefined when storage access throws (API unavailable)", async () => {
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: () => {
            throw new Error("no storage");
          },
        },
      },
    });
    expect(await storeGet("prw:spec")).toBeUndefined();
  });
});

describe("storeSet", () => {
  it("writes the value under the key", () => {
    const set = vi.fn();
    vi.stubGlobal("chrome", { storage: { local: { set } } });
    storeSet("prw:tour", { step: 2 });
    expect(set).toHaveBeenCalledWith({ "prw:tour": { step: 2 } });
    expect(set).toHaveBeenCalledTimes(1);
  });
});

describe("storeRemove", () => {
  it("removes the key", () => {
    const remove = vi.fn();
    vi.stubGlobal("chrome", { storage: { local: { remove } } });
    storeRemove("prw:gen");
    expect(remove).toHaveBeenCalledWith("prw:gen");
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe("write failures are swallowed (storage unavailable)", () => {
  it("storeSet does not throw when the storage API throws", () => {
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          set: () => {
            throw new Error("no storage");
          },
        },
      },
    });
    expect(() => storeSet("prw:tour", { step: 1 })).not.toThrow();
  });

  it("storeRemove does not throw when the storage API throws", () => {
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          remove: () => {
            throw new Error("no storage");
          },
        },
      },
    });
    expect(() => storeRemove("prw:gen")).not.toThrow();
  });
});
