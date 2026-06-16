// Pairing: how the extension earns the bridge token. Bluetooth-style code
// confirmation through the user's own Claude session:
//
//   request()  — the extension asks to pair (one at a time); gets {requestId,
//                code}, shows the code in its panel, and pushes it to the session
//   approve()  — the user compares codes and approves THE CODE in chat; an
//                attacker's racing request holds a different code shown nowhere
//   claim()    — the extension polls with its private requestId and collects the
//                token exactly once; the id never appears in chat or on screen
//   verify()   — every bridge call thereafter must carry the token
//
// Tokens are persisted as a HASH (sha256) via the optional SessionStore, so a
// channel restart reloads paired sessions instead of forcing a re-pair; the
// plaintext token is never written to disk. Without a SessionStore the pairing is
// memory-only (a restart forgets it). The bridge still requires the token on every
// call, and a token the store no longer holds 401s.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { hashToken, type SessionStore } from "./sessionStore";

/** No 0/O/1/I/L — the user reads this code off a screen and types it. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const PAIR_REQUEST_TTL_MS = 120_000;

export interface PairingDeps {
  pushEvent(content: string, meta: Record<string, string>): Promise<void>;
  requestTtlMs?: number;
  /** Persistence for paired sessions (sha256 token hashes). Omit for memory-only. */
  sessions?: SessionStore;
  /** Injectable clock for a session's createdAt (tests). */
  now?: () => number;
}

type PairRequestResult = { ok: true; requestId: string; code: string } | { ok: false; reason: "busy" };

type PairClaimResult = { status: "pending" } | { token: string } | null;

export interface Pairing {
  /** The extension asks to pair. One pending request at a time. The user
   * confirms the returned code in their session before it becomes a token. */
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
  /** Minted at approve, delivered once at claim, then persisted as a hash. */
  token: string | null;
}

const CODE_LEN = 6;
// Largest multiple of the alphabet length that fits in a byte (248 for 31 chars):
// reject bytes at or above it so `% length` stays uniform (no modulo bias toward
// the first 256 % length characters).
const CODE_MAX_BYTE = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;
const newCode = (): string => {
  const chars: string[] = [];
  while (chars.length < CODE_LEN) {
    for (const b of randomBytes(CODE_LEN - chars.length)) {
      if (b < CODE_MAX_BYTE) chars.push(CODE_ALPHABET[b % CODE_ALPHABET.length]!);
    }
  }
  return chars.join("");
};

export function createPairing(deps: PairingDeps): Pairing {
  const requestTtlMs = deps.requestTtlMs ?? PAIR_REQUEST_TTL_MS;
  const now = deps.now ?? ((): number => Date.now());
  let pending: PendingPair | null = null;
  // Live token hashes (sha256), seeded from the persisted store on boot so a restart
  // stays paired. Membership ⇒ a valid token; the plaintext token never lives here.
  const tokenHashes = new Set<string>(deps.sessions?.all().map((session) => session.tokenHash));

  const livePending = (): PendingPair | null => {
    if (pending && pending.expiresAt <= Date.now()) pending = null;
    return pending;
  };

  return {
    request(name) {
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
        token: null,
      };
      void deps.pushEvent(
        `Pairing request from "${name}" — code ${pending.code}. Confirm with the user via the AskUserQuestion tool (options "Approve" / "Decline", with this code in the question) and call approve_pairing only if they Approve. If you did not initiate this, ignore it and let it expire.`,
        { event_type: "pairing_request", code: pending.code },
      );
      return { ok: true, requestId: pending.requestId, code: pending.code };
    },

    approve(code) {
      const p = livePending();
      if (!p || p.approved || p.code !== code.trim().toUpperCase()) return false;
      p.approved = true;
      p.token = randomBytes(32).toString("hex"); // minted now; delivered once at claim
      return true;
    },

    claim(requestId) {
      const p = livePending();
      if (!p || p.requestId !== requestId) return null;
      if (!p.approved || !p.token) return { status: "pending" };
      pending = null;
      const tokenHash = hashToken(p.token);
      tokenHashes.add(tokenHash);
      deps.sessions?.add({ id: p.requestId, tokenHash, name: p.name, createdAt: now() });
      return { token: p.token };
    },

    verify(presented) {
      if (tokenHashes.size === 0) return false;
      const presentedHash = Buffer.from(hashToken(presented), "hex"); // always 32 bytes
      for (const stored of tokenHashes) {
        const storedHash = Buffer.from(stored, "hex");
        if (storedHash.length === presentedHash.length && timingSafeEqual(storedHash, presentedHash)) {
          return true;
        }
      }
      return false;
    },

    enforced() {
      return tokenHashes.size > 0;
    },
  };
}
