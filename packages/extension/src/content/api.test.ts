import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "./api";

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
});
