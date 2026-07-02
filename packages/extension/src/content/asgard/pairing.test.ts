// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock(import("../api"), async (importOriginal) => ({ ...(await importOriginal()), api: vi.fn() }));
vi.mock("../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { api } from "../api";
import type { BridgeResponse } from "../api";
import { storeGet, storeRemove, storeSet } from "../muninn";
import { CLAIM_POLL_MS, CLAIM_POLL_TRIES, pairingStore } from "./pairing";

beforeEach(() => {
  vi.useFakeTimers();
  pairingStore.reset(); // module singleton — start each test from "unknown"
  vi.mocked(storeGet).mockResolvedValue(undefined);
  // default: the channel answers /health (up); individual tests override per-path
  vi.mocked(api).mockResolvedValue({ ok: true, data: { ok: true } });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("pairingStore", () => {
  it("markUnpaired drops the stored token and flips to unpaired, idempotently", () => {
    pairingStore.markUnpaired();
    expect(pairingStore.state()).toEqual({ phase: "unpaired" });
    expect(vi.mocked(storeRemove)).toHaveBeenCalledWith("kvasir:token");
    vi.mocked(storeRemove).mockClear();
    pairingStore.markUnpaired(); // already unpaired — no second clear
    expect(vi.mocked(storeRemove)).not.toHaveBeenCalled();
  });

  it("recheck resolves unknown -> unpaired without a stored token (no /auth round-trip)", async () => {
    expect(pairingStore.state()).toEqual({ phase: "unknown" });
    await pairingStore.recheck();
    expect(pairingStore.state()).toEqual({ phase: "unpaired" });
    expect(vi.mocked(api)).toHaveBeenCalledWith("/health");
    expect(vi.mocked(api)).toHaveBeenCalledTimes(1); // no token -> /auth never consulted
  });

  it("recheck verifies a stored token against the bridge and lands paired", async () => {
    vi.mocked(storeGet).mockResolvedValue("tok");
    vi.mocked(api).mockResolvedValue({ ok: true, data: { paired: true } });
    await pairingStore.recheck();
    expect(vi.mocked(api)).toHaveBeenNthCalledWith(1, "/health");
    expect(vi.mocked(api)).toHaveBeenNthCalledWith(2, "/auth");
    expect(pairingStore.state()).toEqual({ phase: "paired" });
  });

  it("recheck drops a stale stored token the bridge rejects (session restarted) -> unpaired", async () => {
    vi.mocked(storeGet).mockResolvedValue("stale");
    // /health answers with an HTTP error (the channel is up); /auth rejects the token
    vi.mocked(api).mockResolvedValue({ ok: false, status: 401 });
    await pairingStore.recheck();
    expect(vi.mocked(api)).toHaveBeenCalledWith("/auth");
    expect(vi.mocked(storeRemove)).toHaveBeenCalledWith("kvasir:token");
    expect(pairingStore.state()).toEqual({ phase: "unpaired" });
  });

  it("recheck flips to down when nothing answers /health, keeping the stored token", async () => {
    vi.mocked(storeGet).mockResolvedValue("tok");
    vi.mocked(api).mockResolvedValue({ ok: false, error: "TypeError: Failed to fetch" });
    await pairingStore.recheck();
    expect(pairingStore.state()).toEqual({ phase: "down" });
    expect(vi.mocked(storeRemove)).not.toHaveBeenCalled(); // the token may still be good
    expect(vi.mocked(api)).toHaveBeenCalledTimes(1); // bailed before token/auth
    expect(vi.mocked(storeGet)).not.toHaveBeenCalled();
  });

  it("recheck recovers from down once the channel answers again", async () => {
    vi.mocked(api).mockResolvedValue({ ok: false, error: "no response" });
    await pairingStore.recheck();
    expect(pairingStore.state()).toEqual({ phase: "down" });
    vi.mocked(storeGet).mockResolvedValue("tok");
    vi.mocked(api).mockResolvedValue({ ok: true, data: { paired: true } });
    await pairingStore.recheck();
    expect(pairingStore.state()).toEqual({ phase: "paired" });
  });

  it("recheck keeps a valid token paired on a bridge HTTP error that isn't a 401", async () => {
    vi.mocked(storeGet).mockResolvedValue("tok");
    vi.mocked(api).mockImplementation(async (path: string) =>
      path === "/health" ? { ok: true, data: { ok: true } } : { ok: false, status: 500 },
    );
    await pairingStore.recheck();
    expect(vi.mocked(storeRemove)).not.toHaveBeenCalled();
    expect(pairingStore.state()).toEqual({ phase: "paired" });
  });

  it("recheck won't interrupt an in-flight pairing (waiting)", async () => {
    vi.mocked(api).mockImplementation(async (path: string) =>
      path === "/pair"
        ? { ok: true, data: { requestId: "r", code: "ABC234" } }
        : { ok: true, data: { status: "pending" } },
    );
    const pending = pairingStore.pair();
    await vi.advanceTimersByTimeAsync(0); // → waiting
    expect(pairingStore.state().phase).toBe("waiting");
    vi.mocked(storeGet).mockClear();
    await pairingStore.recheck();
    expect(vi.mocked(storeGet)).not.toHaveBeenCalled(); // skipped while waiting
    await vi.advanceTimersByTimeAsync(CLAIM_POLL_MS * (CLAIM_POLL_TRIES + 1)); // let pair() settle
    await pending;
  });

  it("recheck won't interrupt a pairing that errored", async () => {
    vi.mocked(api).mockResolvedValue({ ok: false, status: 400, data: { error: "boom" } });
    await pairingStore.pair(); // → error
    expect(pairingStore.state().phase).toBe("error");
    vi.mocked(storeGet).mockClear();
    await pairingStore.recheck();
    expect(vi.mocked(storeGet)).not.toHaveBeenCalled(); // skipped while error
  });

  it("recheck bails if a pairing starts while /health is in flight (no clobber of waiting)", async () => {
    let releaseHealth!: (v: BridgeResponse) => void;
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/health") return new Promise<BridgeResponse>((r) => (releaseHealth = r));
      if (path === "/pair") return { ok: true, data: { requestId: "r", code: "ABC234" } };
      return { ok: true, data: { status: "pending" } };
    });
    const rechecking = pairingStore.recheck(); // suspends on /health
    const pairing = pairingStore.pair();
    await vi.advanceTimersByTimeAsync(0); // → waiting
    expect(pairingStore.state().phase).toBe("waiting");
    releaseHealth({ ok: true, data: { ok: true } });
    await rechecking;
    expect(pairingStore.state().phase).toBe("waiting"); // recheck backed off
    await vi.advanceTimersByTimeAsync(CLAIM_POLL_MS * (CLAIM_POLL_TRIES + 1)); // let pair() settle
    await pairing;
  });

  it("recheck bails if a pairing starts while the token read is in flight", async () => {
    let releaseToken!: (v: unknown) => void;
    vi.mocked(storeGet).mockReturnValueOnce(new Promise((r) => (releaseToken = r)));
    vi.mocked(api).mockImplementation(async (path: string) =>
      path === "/pair"
        ? { ok: true, data: { requestId: "r", code: "ABC234" } }
        : { ok: true, data: { status: "pending" } },
    );
    const rechecking = pairingStore.recheck(); // /health resolves, suspends on storeGet
    await vi.advanceTimersByTimeAsync(0);
    const pairing = pairingStore.pair();
    await vi.advanceTimersByTimeAsync(0); // → waiting
    vi.mocked(api).mockClear();
    releaseToken("tok");
    await rechecking;
    expect(pairingStore.state().phase).toBe("waiting"); // recheck backed off before /auth
    expect(vi.mocked(api)).not.toHaveBeenCalledWith("/auth");
    await vi.advanceTimersByTimeAsync(CLAIM_POLL_MS * (CLAIM_POLL_TRIES + 1)); // let pair() settle
    await pairing;
  });

  it("a failed /pair surfaces the bridge's detail through friendlyError", async () => {
    vi.mocked(api).mockResolvedValue({
      ok: false,
      data: { error: "another pairing request is already pending" },
    });
    await pairingStore.pair();
    expect(pairingStore.state()).toEqual({
      phase: "error",
      message: "Something went wrong: another pairing request is already pending",
    });

    // a transport-level failure reads as the channel being unreachable, not a raw TypeError
    vi.mocked(api).mockResolvedValue({ ok: false, error: "TypeError: Failed to fetch" });
    await pairingStore.pair();
    expect(pairingStore.state()).toEqual({
      phase: "error",
      message: "Can't reach the channel — is your Claude session running?",
    });

    vi.mocked(api).mockResolvedValue({ ok: true, data: { nope: 1 } });
    await pairingStore.pair();
    expect(pairingStore.state()).toEqual({ phase: "error", message: "pairing request failed" });
  });

  it("pair shows the code, polls the claim, stores the token, and lands paired", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/pair") return { ok: true, data: { requestId: "rid-1", code: "ABC234" } };
      return vi.mocked(api).mock.calls.filter(([p]) => String(p).startsWith("/pair/claim")).length < 2
        ? { ok: true, data: { status: "pending" } }
        : { ok: true, data: { token: "t0k" } };
    });
    const pending = pairingStore.pair();
    await vi.advanceTimersByTimeAsync(0);
    expect(pairingStore.state()).toEqual({ phase: "waiting", code: "ABC234" });
    await vi.advanceTimersByTimeAsync(CLAIM_POLL_MS * 2);
    await pending;
    expect(pairingStore.state()).toEqual({ phase: "paired" });
    expect(vi.mocked(storeSet)).toHaveBeenCalledWith("kvasir:token", "t0k");
    expect(vi.mocked(api)).toHaveBeenCalledWith("/pair/claim?id=rid-1");
  });

  it("a 404 claim (expired/denied) and a poll budget run-out both error out", async () => {
    vi.mocked(api).mockImplementation(async (path: string) =>
      path === "/pair"
        ? { ok: true, data: { requestId: "rid-2", code: "XYZ789" } }
        : { ok: false, status: 404 },
    );
    let pending = pairingStore.pair();
    await vi.advanceTimersByTimeAsync(CLAIM_POLL_MS);
    await pending;
    expect(pairingStore.state()).toEqual({
      phase: "error",
      message: "pairing expired or was denied — try again",
    });

    vi.mocked(api).mockImplementation(async (path: string) =>
      path === "/pair"
        ? { ok: true, data: { requestId: "rid-3", code: "XYZ789" } }
        : { ok: true, data: { status: "pending" } },
    );
    pending = pairingStore.pair();
    await vi.advanceTimersByTimeAsync(CLAIM_POLL_MS * (CLAIM_POLL_TRIES + 1));
    await pending;
    expect(pairingStore.state()).toEqual({ phase: "error", message: "pairing timed out — try again" });
  });

  it("a claim poll that can't reach the channel names that, not expired/denied", async () => {
    vi.mocked(api).mockImplementation(async (path: string) =>
      path === "/pair"
        ? { ok: true, data: { requestId: "rid-4", code: "XYZ789" } }
        : { ok: false, error: "TypeError: Failed to fetch" },
    );
    const pending = pairingStore.pair();
    await vi.advanceTimersByTimeAsync(CLAIM_POLL_MS);
    await pending;
    expect(pairingStore.state()).toEqual({
      phase: "error",
      message: "Can't reach the channel — is your Claude session running?",
    });
  });

  it("pair bails if a concurrent recheck already resolved to paired during the POST", async () => {
    vi.mocked(storeGet).mockResolvedValue("tok");
    vi.mocked(api).mockResolvedValue({ ok: true, data: { paired: true } });
    await pairingStore.recheck(); // phase -> paired
    expect(pairingStore.state().phase).toBe("paired");
    vi.mocked(api).mockResolvedValue({ ok: true, data: { requestId: "r", code: "ABC234" } });
    await pairingStore.pair(); // POST returns; phase already paired -> early return
    expect(pairingStore.state()).toEqual({ phase: "paired" }); // not flipped to waiting
  });
});
