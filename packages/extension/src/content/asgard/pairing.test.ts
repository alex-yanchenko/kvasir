// @vitest-environment jsdom
import { PROTOCOL_VERSION } from "@kvasir/runes/protocol";
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

  it("concurrent rechecks join one probe (panel open onto Settings mounts two callers)", async () => {
    const outcomes = await Promise.all([pairingStore.recheck(), pairingStore.recheck()]);
    expect(outcomes).toEqual([undefined, undefined]);
    expect(pairingStore.state()).toEqual({ phase: "unpaired" });
    expect(vi.mocked(api)).toHaveBeenCalledTimes(1); // one /health probe, not two

    vi.mocked(api).mockClear();
    await pairingStore.recheck(); // the join releases once the probe settles
    expect(vi.mocked(api)).toHaveBeenCalledTimes(1);
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

  it("recheck bails when pair() completes during the /auth round-trip — the fresh token survives", async () => {
    vi.mocked(storeGet).mockResolvedValue("stale");
    let releaseAuth!: (v: BridgeResponse) => void;
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/auth") return new Promise<BridgeResponse>((r) => (releaseAuth = r));
      if (path === "/pair") return { ok: true, data: { requestId: "r", code: "ABC234" } };
      if (path.startsWith("/pair/claim")) return { ok: true, data: { token: "fresh" } };
      return { ok: true, data: { ok: true } };
    });
    const rechecking = pairingStore.recheck(); // health + token resolve; suspends on /auth
    await vi.advanceTimersByTimeAsync(0);
    const pairing = pairingStore.pair();
    await vi.advanceTimersByTimeAsync(CLAIM_POLL_MS); // claim lands → paired, fresh token stored
    await pairing;
    expect(pairingStore.state()).toEqual({ phase: "paired" });
    vi.mocked(storeRemove).mockClear();
    releaseAuth({ ok: false, status: 401 }); // the stale probe finally answers
    await rechecking;
    expect(pairingStore.state()).toEqual({ phase: "paired" }); // the completed pairing wins
    expect(vi.mocked(storeRemove)).not.toHaveBeenCalled(); // the fresh token survives
  });

  it("recheck bails if markUnpaired lands while /auth is in flight (no clobber to paired)", async () => {
    vi.mocked(storeGet).mockResolvedValue("tok");
    let releaseAuth!: (v: BridgeResponse) => void;
    vi.mocked(api).mockImplementation(async (path: string) =>
      path === "/auth"
        ? new Promise<BridgeResponse>((r) => (releaseAuth = r))
        : { ok: true, data: { ok: true } },
    );
    const rechecking = pairingStore.recheck();
    await vi.advanceTimersByTimeAsync(0); // suspend on /auth
    pairingStore.markUnpaired();
    releaseAuth({ ok: true, data: { paired: true } });
    await rechecking;
    expect(pairingStore.state()).toEqual({ phase: "unpaired" }); // not overwritten to paired
  });

  it("an orphaned content script (extension reloaded) reads as refresh-the-page, not down", async () => {
    vi.mocked(api).mockResolvedValue({ ok: false, error: "extension reloaded — refresh the page" });
    await pairingStore.recheck();
    expect(pairingStore.state()).toEqual({
      phase: "error",
      message: "Extension was reloaded — refresh the page, then retry.",
    });
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

describe("pairingStore protocol skew", () => {
  const health = (protocol: number, version = "9.9.9"): BridgeResponse => ({
    ok: true,
    data: { ok: true, specs: 0, version, protocol },
  });

  it("flags the channel as behind when /health reports a lower protocol", async () => {
    vi.mocked(api).mockResolvedValue(health(PROTOCOL_VERSION - 1, "0.5.0"));
    await pairingStore.recheck();
    expect(pairingStore.skew()).toEqual({
      channelProtocol: PROTOCOL_VERSION - 1,
      channelVersion: "0.5.0",
      behind: "channel",
    });
  });

  it("flags the extension as behind when /health reports a higher protocol", async () => {
    vi.mocked(api).mockResolvedValue(health(PROTOCOL_VERSION + 1));
    await pairingStore.recheck();
    expect(pairingStore.skew()).toEqual({
      channelProtocol: PROTOCOL_VERSION + 1,
      channelVersion: "9.9.9",
      behind: "extension",
    });
  });

  it("reports no skew when the protocol matches", async () => {
    vi.mocked(api).mockResolvedValue(health(PROTOCOL_VERSION));
    await pairingStore.recheck();
    expect(pairingStore.skew()).toBeNull();
  });

  it("reports no skew when /health omits the protocol (channel predates the handshake)", async () => {
    vi.mocked(api).mockResolvedValue({ ok: true, data: { ok: true } });
    await pairingStore.recheck();
    expect(pairingStore.skew()).toBeNull();
  });

  it("clears a skew when the channel goes down", async () => {
    vi.mocked(api).mockResolvedValue(health(PROTOCOL_VERSION - 1, "0.5.0"));
    await pairingStore.recheck();
    expect(pairingStore.skew()).not.toBeNull();
    vi.mocked(api).mockResolvedValue({ ok: false, error: "TypeError: Failed to fetch" });
    await pairingStore.recheck();
    expect(pairingStore.skew()).toBeNull();
    expect(pairingStore.state()).toEqual({ phase: "down" });
  });

  it("clears a skew once the protocol matches again", async () => {
    vi.mocked(api).mockResolvedValue(health(PROTOCOL_VERSION - 1, "0.5.0"));
    await pairingStore.recheck();
    expect(pairingStore.skew()?.behind).toBe("channel");
    vi.mocked(api).mockResolvedValue(health(PROTOCOL_VERSION));
    await pairingStore.recheck();
    expect(pairingStore.skew()).toBeNull();
  });
});
