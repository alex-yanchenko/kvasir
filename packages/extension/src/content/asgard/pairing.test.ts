// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api", () => ({ api: vi.fn() }));
vi.mock("../muninn", () => ({ storeGet: vi.fn(), storeSet: vi.fn(), storeRemove: vi.fn() }));

import { api } from "../api";
import type { BridgeResponse } from "../api";
import { storeGet, storeRemove, storeSet } from "../muninn";
import { CLAIM_POLL_MS, CLAIM_POLL_TRIES, pairingStore } from "./pairing";

beforeEach(() => {
  vi.useFakeTimers();
  pairingStore.reset(); // module singleton — start each test from "unknown"
  vi.mocked(storeGet).mockResolvedValue(undefined);
  vi.mocked(api).mockResolvedValue({ ok: false });
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

  it("refresh resolves unknown -> unpaired without a stored token, then never re-runs", async () => {
    expect(pairingStore.state()).toEqual({ phase: "unknown" });
    await pairingStore.refresh();
    expect(pairingStore.state()).toEqual({ phase: "unpaired" });
    expect(vi.mocked(api)).not.toHaveBeenCalled(); // no token -> no bridge round-trip
    vi.mocked(storeGet).mockResolvedValue("tok");
    await pairingStore.refresh(); // already resolved — storage not consulted again
    expect(pairingStore.state()).toEqual({ phase: "unpaired" });
    expect(vi.mocked(storeGet)).toHaveBeenCalledTimes(1);
  });

  it("refresh verifies a stored token against the bridge and lands paired when it works", async () => {
    vi.mocked(storeGet).mockResolvedValue("tok");
    vi.mocked(api).mockResolvedValue({ ok: true, data: { paired: true } });
    await pairingStore.refresh();
    expect(vi.mocked(api)).toHaveBeenCalledWith("/auth");
    expect(pairingStore.state()).toEqual({ phase: "paired" });
  });

  it("refresh drops a stale stored token the bridge rejects (session restarted) -> unpaired", async () => {
    vi.mocked(storeGet).mockResolvedValue("stale");
    vi.mocked(api).mockResolvedValue({ ok: false, status: 401 });
    await pairingStore.refresh();
    expect(vi.mocked(api)).toHaveBeenCalledWith("/auth");
    expect(vi.mocked(storeRemove)).toHaveBeenCalledWith("kvasir:token");
    expect(pairingStore.state()).toEqual({ phase: "unpaired" });
  });

  it("recheck keeps a good token paired, flips a stale one to unpaired, and handles no token", async () => {
    vi.mocked(storeGet).mockResolvedValue("tok");
    vi.mocked(api).mockResolvedValue({ ok: true, data: { paired: true } });
    await pairingStore.recheck();
    expect(pairingStore.state()).toEqual({ phase: "paired" });

    // stale token the bridge rejects → unpaired (the New-chat-after-session-restart case)
    vi.mocked(storeGet).mockResolvedValue("stale");
    vi.mocked(api).mockResolvedValue({ ok: false, status: 401 });
    await pairingStore.recheck();
    expect(vi.mocked(storeRemove)).toHaveBeenCalledWith("kvasir:token");
    expect(pairingStore.state()).toEqual({ phase: "unpaired" });

    vi.mocked(storeGet).mockResolvedValue(undefined);
    vi.mocked(api).mockClear();
    await pairingStore.recheck();
    expect(pairingStore.state()).toEqual({ phase: "unpaired" });
    expect(vi.mocked(api)).not.toHaveBeenCalled(); // no token → no /auth round-trip
  });

  it("refresh keeps a valid token on a transient bridge failure (not a 401) — no forced re-pair", async () => {
    vi.mocked(storeGet).mockResolvedValue("tok");
    vi.mocked(api).mockResolvedValue({ ok: false, error: "no response" }); // SW cold-start / bridge unreachable
    await pairingStore.refresh();
    expect(vi.mocked(storeRemove)).not.toHaveBeenCalled();
    expect(pairingStore.state()).toEqual({ phase: "paired" });
  });

  it("recheck keeps a valid token on a transient failure (not a 401) — no forced re-pair", async () => {
    vi.mocked(storeGet).mockResolvedValue("tok");
    vi.mocked(api).mockResolvedValue({ ok: false, error: "no response" });
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
    vi.mocked(api).mockResolvedValue({ ok: false, error: "boom" });
    await pairingStore.pair(); // → error
    expect(pairingStore.state().phase).toBe("error");
    vi.mocked(storeGet).mockClear();
    await pairingStore.recheck();
    expect(vi.mocked(storeGet)).not.toHaveBeenCalled(); // skipped while error
  });

  it("a failed /pair surfaces the bridge's error detail", async () => {
    vi.mocked(api).mockResolvedValue({
      ok: false,
      data: { error: "another pairing request is already pending" },
    });
    await pairingStore.pair();
    expect(pairingStore.state()).toEqual({
      phase: "error",
      message: "another pairing request is already pending",
    });

    vi.mocked(api).mockResolvedValue({ ok: false, error: "failed to fetch" });
    await pairingStore.pair();
    expect(pairingStore.state()).toEqual({ phase: "error", message: "failed to fetch" });

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
  it("refresh bails after the token read if pair() already left the unknown phase", async () => {
    let releaseToken!: (v: unknown) => void;
    vi.mocked(storeGet).mockReturnValueOnce(new Promise((r) => (releaseToken = r)));
    const pending = pairingStore.refresh();
    pairingStore.markUnpaired(); // phase -> unpaired while storeGet is in flight
    releaseToken("tok");
    await pending;
    expect(pairingStore.state()).toEqual({ phase: "unpaired" });
    expect(vi.mocked(api)).not.toHaveBeenCalled(); // bailed before the /auth round-trip
  });

  it("refresh bails after /auth if the phase already left unknown (no clobber to paired)", async () => {
    vi.mocked(storeGet).mockResolvedValue("tok");
    let releaseAuth!: (v: BridgeResponse) => void;
    vi.mocked(api).mockReturnValueOnce(new Promise<BridgeResponse>((r) => (releaseAuth = r)));
    const pending = pairingStore.refresh();
    await vi.advanceTimersByTimeAsync(0); // resolve storeGet, suspend on /auth
    pairingStore.markUnpaired(); // phase -> unpaired while /auth is in flight
    releaseAuth({ ok: true });
    await pending;
    expect(pairingStore.state()).toEqual({ phase: "unpaired" }); // not overwritten to paired
  });

  it("pair bails if a concurrent refresh already resolved to paired during the POST", async () => {
    vi.mocked(storeGet).mockResolvedValue("tok");
    vi.mocked(api).mockResolvedValue({ ok: true, data: { paired: true } });
    await pairingStore.recheck(); // phase -> paired
    expect(pairingStore.state().phase).toBe("paired");
    vi.mocked(api).mockResolvedValue({ ok: true, data: { requestId: "r", code: "ABC234" } });
    await pairingStore.pair(); // POST returns; phase already paired -> early return
    expect(pairingStore.state()).toEqual({ phase: "paired" }); // not flipped to waiting
  });
});
