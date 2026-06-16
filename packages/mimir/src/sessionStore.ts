// Persisted pairing sessions — so a channel restart no longer forces a re-pair.
// We store sha256(token), NEVER the token itself: a leaked kvasir.db then holds no
// usable secret (the extension keeps the plaintext token in chrome.storage, same
// exposure as before). Multi-session by design: several paired clients coexist,
// each its own row. pairing.ts depends on this interface (memory impl in tests);
// channel.ts wires the bun:sqlite-backed one (sessionStore.sqlite.ts), which can't
// be imported under vitest — so the hashing + bookkeeping logic lives here.
import { createHash } from "node:crypto";

export interface SessionRecord {
  /** The pairing's requestId — a stable per-session id. */
  id: string;
  /** sha256(token), hex. The plaintext token is never stored. */
  tokenHash: string;
  name: string;
  createdAt: number;
}

export interface SessionStore {
  add(record: SessionRecord): void;
  all(): SessionRecord[];
  remove(id: string): boolean;
  clear(): void;
}

/** sha256 of a token, hex — the only form that touches disk. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** In-memory store — what pairing unit tests run against, and the fallback when no
 * persistence is wired. */
export function createMemorySessionStore(seed: readonly SessionRecord[] = []): SessionStore {
  const rows = new Map<string, SessionRecord>();
  for (const record of seed) rows.set(record.id, record);
  return {
    add: (record) => {
      rows.set(record.id, record);
    },
    all: () => [...rows.values()],
    remove: (id) => rows.delete(id),
    clear: () => rows.clear(),
  };
}
