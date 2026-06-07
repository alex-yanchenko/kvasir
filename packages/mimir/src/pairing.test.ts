import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPairing, type Pairing } from "./pairing";

let pushed: Array<{ content: string; meta: Record<string, string> }>;

const mkPairing = (over: { windowMs?: number; requestTtlMs?: number } = {}): Pairing =>
  createPairing({
    pushEvent: async (content, meta) => {
      pushed.push({ content, meta });
    },
    windowMs: 1000,
    requestTtlMs: 2000,
    ...over,
  });

beforeEach(() => {
  vi.useFakeTimers();
  pushed = [];
});
afterEach(() => {
  vi.useRealTimers();
});

const pairFully = (pairing: Pairing): { token: string; code: string } => {
  pairing.arm();
  const req = pairing.request("Chrome");
  if (!req.ok) throw new Error("expected pairing request to be accepted");
  expect(pairing.approve(req.code)).toBe(true);
  const claim = pairing.claim(req.requestId);
  if (!claim || !("token" in claim)) throw new Error("expected a token");
  return { token: claim.token, code: req.code };
};

describe("the happy pairing flow", () => {
  it("arm → request → approve(code) → claim(requestId) yields an in-memory token", () => {
    const pairing = mkPairing();
    expect(pairing.enforced()).toBe(false);
    const { token } = pairFully(pairing);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(pairing.enforced()).toBe(true);
    expect(pairing.verify(token)).toBe(true);
    expect(pairing.verify("x".repeat(64))).toBe(false);
    expect(pairing.verify("short")).toBe(false);
  });

  it("announces the request in the session with the code and the requester's name", () => {
    const pairing = mkPairing();
    pairing.arm();
    const req = pairing.request("Chrome on MacBook");
    if (!req.ok) throw new Error("expected ok");
    expect(pushed).toEqual([
      {
        content: expect.stringContaining(`code ${req.code}`),
        meta: { event_type: "pairing_request", code: req.code },
      },
    ]);
    expect(pushed[0].content).toContain("Chrome on MacBook");
    expect(req.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it("approve tolerates whitespace and lowercase; re-pairing the same instance keeps the token", () => {
    const pairing = mkPairing();
    pairing.arm();
    const req = pairing.request("a");
    if (!req.ok) throw new Error("expected ok");
    expect(pairing.approve(`  ${req.code.toLowerCase()} `)).toBe(true);
    const first = pairing.claim(req.requestId);
    if (!first || !("token" in first)) throw new Error("expected a token");

    const again = pairFully(pairing);
    expect(again.token).toBe(first.token);
  });

  it("a fresh instance (a restarted session) forgets the token — re-pair required", () => {
    const first = mkPairing();
    const a = pairFully(first);
    const restarted = mkPairing();
    expect(restarted.enforced()).toBe(false); // memory-only: nothing carried over
    expect(restarted.verify(a.token)).toBe(false);
    const b = pairFully(restarted);
    expect(b.token).not.toBe(a.token); // a brand-new token each session
  });
});

describe("the gates", () => {
  it("requests outside an armed window are refused", () => {
    const pairing = mkPairing();
    expect(pairing.request("x")).toEqual({ ok: false, reason: "not-armed" });
    pairing.arm();
    vi.advanceTimersByTime(1001);
    expect(pairing.request("x")).toEqual({ ok: false, reason: "not-armed" });
  });

  it("a second request while one is pending is denied and reported loudly", () => {
    const pairing = mkPairing();
    pairing.arm();
    expect(pairing.request("legit").ok).toBe(true);
    expect(pairing.request("racer")).toEqual({ ok: false, reason: "busy" });
    expect(pushed[1].meta).toEqual({ event_type: "pairing_denied" });
    expect(pushed[1].content).toContain('"racer"');
  });

  it("approve rejects a wrong code, a missing request, and a double approve+claim", () => {
    const pairing = mkPairing();
    expect(pairing.approve("AAAAAA")).toBe(false); // nothing pending
    pairing.arm();
    const req = pairing.request("a");
    if (!req.ok) throw new Error("expected ok");
    expect(pairing.approve("WRONG1")).toBe(false);
    expect(pairing.approve(req.code)).toBe(true);
    expect(pairing.approve(req.code)).toBe(false); // already approved
    const claim = pairing.claim(req.requestId);
    expect(claim && "token" in claim).toBe(true);
    expect(pairing.claim(req.requestId)).toBeNull(); // one-time claim
  });

  it("claim is pending before approval, null for foreign ids and expired requests", () => {
    const pairing = mkPairing();
    pairing.arm();
    const req = pairing.request("a");
    if (!req.ok) throw new Error("expected ok");
    expect(pairing.claim("someone-elses-id")).toBeNull();
    expect(pairing.claim(req.requestId)).toEqual({ status: "pending" });
    vi.advanceTimersByTime(2001); // the request expires un-approved
    expect(pairing.claim(req.requestId)).toBeNull();
    expect(pairing.approve(req.code)).toBe(false);
  });

  it("a successful claim closes the armed window (one pairing per arming)", () => {
    const pairing = mkPairing();
    pairFully(pairing);
    expect(pairing.request("again")).toEqual({ ok: false, reason: "not-armed" });
  });

  it("verify is false before any token exists", () => {
    const pairing = mkPairing();
    expect(pairing.enforced()).toBe(false);
    expect(pairing.verify("anything")).toBe(false);
  });
});
