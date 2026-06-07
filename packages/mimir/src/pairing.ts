// Pairing: how the extension earns the bridge token. Bluetooth-style code
// confirmation through the user's own Claude session:
//
//   arm()      — the user says "pair my extension" in chat; opens a short window
//   request()  — the extension asks to pair (only inside the window, one at a
//                time); gets {requestId, code} and shows the code in its panel
//   approve()  — the user compares codes and approves THE CODE in chat; an
//                attacker's racing request holds a different code shown nowhere
//   claim()    — the extension polls with its private requestId and collects the
//                token exactly once; the id never appears in chat or on screen
//   verify()   — every bridge call thereafter must carry the token
//
// The token lives ONLY in this process's memory — never on disk. Restarting the
// Claude session forgets it, so a new session always re-pairs: auth lifetime is
// tied to the session, which is the trust anchor. The extension keeps its copy
// in storage so a page refresh within a live session doesn't re-pair, but its
// token goes stale the moment the session restarts and the bridge 401s it.
import { randomBytes, timingSafeEqual } from "node:crypto";

/** No 0/O/1/I/L — the user reads this code off a screen and types it. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const PAIR_WINDOW_MS = 60_000;
export const PAIR_REQUEST_TTL_MS = 120_000;

export interface PairingDeps {
  pushEvent(content: string, meta: Record<string, string>): Promise<void>;
  windowMs?: number;
  requestTtlMs?: number;
}

export type PairRequestResult =
  | { ok: true; requestId: string; code: string }
  | { ok: false; reason: "not-armed" | "busy" };

export type PairClaimResult = { status: "pending" } | { token: string } | null;

export interface Pairing {
  /** Open the pairing window (the open_pairing tool). Returns its close time. */
  arm(): { until: number };
  /** The extension asks to pair. One pending request at a time, window-gated. */
  request(name: string): PairRequestResult;
  /** The user approves the code they read off the extension panel. */
  approve(code: string): boolean;
  /** The extension collects the token by its private requestId — exactly once. */
  claim(requestId: string): PairClaimResult;
  /** Constant-time check of a presented token against the in-memory one. */
  verify(presented: string): boolean;
  /** True once a token exists this session — the bridge requires it from then on. */
  enforced(): boolean;
}

interface PendingPair {
  requestId: string;
  code: string;
  name: string;
  expiresAt: number;
  approved: boolean;
}

const newCode = (): string =>
  Array.from(randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");

export function createPairing(deps: PairingDeps): Pairing {
  const windowMs = deps.windowMs ?? PAIR_WINDOW_MS;
  const requestTtlMs = deps.requestTtlMs ?? PAIR_REQUEST_TTL_MS;
  let armedUntil = 0;
  let pending: PendingPair | null = null;
  let cachedToken: string | null = null;

  const ensureToken = (): string => {
    if (!cachedToken) cachedToken = randomBytes(32).toString("hex");
    return cachedToken;
  };

  const livePending = (): PendingPair | null => {
    if (pending && pending.expiresAt <= Date.now()) pending = null;
    return pending;
  };

  return {
    arm() {
      armedUntil = Date.now() + windowMs;
      return { until: armedUntil };
    },

    request(name) {
      if (Date.now() > armedUntil) return { ok: false, reason: "not-armed" };
      if (livePending()) {
        // a second request while one is pending is exactly the confusion race —
        // refuse it and make it loud in the session
        void deps.pushEvent(
          `A SECOND pairing request ("${name}") arrived while one is already pending — denied. If you did not expect two requests, something else on this machine is probing the bridge.`,
          { event_type: "pairing_denied" },
        );
        return { ok: false, reason: "busy" };
      }
      pending = {
        requestId: randomBytes(16).toString("hex"),
        code: newCode(),
        name,
        expiresAt: Date.now() + requestTtlMs,
        approved: false,
      };
      void deps.pushEvent(
        `Pairing request from "${name}" — code ${pending.code}. If this matches the code shown in the extension's settings panel, call approve_pairing with it. If you did not initiate this, ignore it and let it expire.`,
        { event_type: "pairing_request", code: pending.code },
      );
      return { ok: true, requestId: pending.requestId, code: pending.code };
    },

    approve(code) {
      const p = livePending();
      if (!p || p.approved || p.code !== code.trim().toUpperCase()) return false;
      p.approved = true;
      ensureToken();
      return true;
    },

    claim(requestId) {
      const p = livePending();
      if (!p || p.requestId !== requestId) return null;
      if (!p.approved) return { status: "pending" };
      pending = null;
      armedUntil = 0; // one pairing per armed window
      return { token: ensureToken() };
    },

    verify(presented) {
      if (!cachedToken || presented.length !== cachedToken.length) return false;
      return timingSafeEqual(Buffer.from(presented), Buffer.from(cachedToken));
    },

    enforced() {
      return cachedToken !== null;
    },
  };
}
