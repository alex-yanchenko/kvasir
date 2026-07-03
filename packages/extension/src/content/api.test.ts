import { describe, it, expect, vi, afterEach } from "vitest";
import { api, isUnreachable } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api", () => {
  it("posts the request to the worker and resolves its reply", async () => {
    const reply = { ok: true, status: 200, data: { steps: [] } };
    const sendMessage = vi.fn((_msg: unknown, cb: (r: unknown) => void) => cb(reply));
    vi.stubGlobal("chrome", { runtime: { id: "ext-id", sendMessage } });

    expect(await api("/walkthrough", "POST", { pr: "x" })).toEqual(reply);
    expect(sendMessage).toHaveBeenCalledWith(
      { path: "/walkthrough", method: "POST", body: { pr: "x" } },
      expect.any(Function),
    );
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("defaults to a GET with a null body", async () => {
    const sendMessage = vi.fn((_msg: unknown, cb: (r: unknown) => void) => cb({ ok: true }));
    vi.stubGlobal("chrome", { runtime: { id: "ext-id", sendMessage } });

    await api("/ping");
    expect(sendMessage).toHaveBeenCalledWith(
      { path: "/ping", method: "GET", body: null },
      expect.any(Function),
    );
  });

  it("fails quietly when the content script is orphaned (no runtime id)", async () => {
    vi.stubGlobal("chrome", { runtime: { id: undefined } });
    expect(await api("/ping")).toEqual({ ok: false, error: "extension reloaded — refresh the page" });
  });

  it("surfaces chrome.runtime.lastError", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        id: "ext-id",
        lastError: { message: "Could not establish connection" },
        sendMessage: (_msg: unknown, cb: (r: unknown) => void) => cb(undefined),
      },
    });
    expect(await api("/ping")).toEqual({ ok: false, error: "Could not establish connection" });
  });

  it("resolves a 'no response' error when the worker replies with nothing", async () => {
    vi.stubGlobal("chrome", {
      runtime: { id: "ext-id", sendMessage: (_msg: unknown, cb: (r: unknown) => void) => cb(undefined) },
    });
    expect(await api("/ping")).toEqual({ ok: false, error: "no response" });
  });

  it("catches a synchronous throw from sendMessage", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        id: "ext-id",
        sendMessage: () => {
          throw new Error("Extension context invalidated");
        },
      },
    });
    expect(await api("/ping")).toEqual({ ok: false, error: "Error: Extension context invalidated" });
  });

  it("falls back to a generic message when lastError has no message", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        id: "ext-id",
        lastError: {},
        sendMessage: (_msg: unknown, cb: (r: unknown) => void) => cb(undefined),
      },
    });
    expect(await api("/ping")).toEqual({ ok: false, error: "extension messaging error" });
  });
});

describe("isUnreachable", () => {
  it("is true only for a status-less failure — any HTTP status means something answered", () => {
    expect(isUnreachable({ ok: false, error: "TypeError: Failed to fetch" })).toBe(true);
    expect(isUnreachable({ ok: false, error: "no response" })).toBe(true);
    expect(isUnreachable({ ok: false, status: 401 })).toBe(false);
    expect(isUnreachable({ ok: false, status: 500 })).toBe(false);
    expect(isUnreachable({ ok: true, status: 200 })).toBe(false);
  });
});
