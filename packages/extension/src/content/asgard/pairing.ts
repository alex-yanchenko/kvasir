// The pairing machine — Asgard's side of earning the bridge token. The user
// arms pairing in their Claude session (open_pairing), clicks Pair here, reads
// the code off this panel, and approves that code in chat; we poll the claim
// until the token lands and persist it for Huginn to attach on every request.
// It also owns the connection tri-state: "down" (nothing listening on the
// bridge port) is distinct from "unpaired" (channel up, token absent/stale),
// so the UI can say "start the channel" vs "pair" instead of guessing.
import { api } from "../api";
import type { BridgeResponse } from "../api";
import { TOKEN_KEY } from "../keys";
import { storeGet, storeRemove, storeSet } from "../muninn";
import { friendlyError } from "./friendly";
import { touch } from "./store";

export const CLAIM_POLL_MS = 1000;
export const CLAIM_POLL_TRIES = 120;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export type PairingPhase =
  | { phase: "unknown" }
  /** The channel itself is unreachable — nothing answered the token-less /health. */
  | { phase: "down" }
  | { phase: "unpaired" }
  | { phase: "waiting"; code: string }
  | { phase: "paired" }
  | { phase: "error"; message: string };

let state: PairingPhase = { phase: "unknown" };

const set = (next: PairingPhase): void => {
  state = next;
  touch();
};

/** Transport-level failure: the call never produced an HTTP status — fetch threw,
 * the worker didn't answer, etc. An HTTP error (any status) means something IS
 * listening on the bridge port, so only a status-less failure reads as "down". */
const isUnreachable = (r: BridgeResponse): boolean => !r.ok && r.status === undefined;

const requestIdOf = (data: unknown): { requestId: string; code: string } | null =>
  typeof data === "object" &&
  data !== null &&
  "requestId" in data &&
  typeof data.requestId === "string" &&
  "code" in data &&
  typeof data.code === "string"
    ? { requestId: data.requestId, code: data.code }
    : null;

/** Map an /auth result for a request that DID carry a stored token to a phase.
 * ok -> paired; 401 -> the token is genuinely stale, drop it and force a re-pair;
 * any other HTTP error is a transient failure -> keep the token and stay paired
 * (the channel answered /health a moment ago, so it isn't down). */
function authToPhase(r: BridgeResponse): PairingPhase {
  if (r.ok) return { phase: "paired" };
  if (r.status === 401) {
    storeRemove(TOKEN_KEY);
    return { phase: "unpaired" };
  }
  return { phase: "paired" };
}

const tokenOf = (data: unknown): string | null =>
  typeof data === "object" && data !== null && "token" in data && typeof data.token === "string"
    ? data.token
    : null;

/** True while pair() owns the phase — recheck must never stomp an active pairing. */
const pairingActive = (): boolean => state.phase === "waiting" || state.phase === "error";

export const pairingStore = {
  state: (): PairingPhase => state,

  /** True while a bridge call would fail — channel down or token absent/stale —
   * used to disable backend-dependent controls so they don't look clickable.
   * "unknown" (pre-boot-check) stays enabled; it resolves within a moment of load. */
  needsPairing: (): boolean => state.phase !== "paired" && state.phase !== "unknown",

  /** Back to square one (tests; the machine is a module singleton). */
  reset(): void {
    set({ phase: "unknown" });
  },

  /** A 401 from the bridge means our token is stale/absent — drop it and force
   * a re-pair. Safe to call repeatedly; only fires the state change once. */
  markUnpaired(): void {
    if (state.phase === "unpaired") return;
    storeRemove(TOKEN_KEY);
    set({ phase: "unpaired" });
  },

  /** Verify the connection — fired on panel open, when a chat starts, and from
   * every Retry. Two probes: the token-less /health (a transport failure means
   * nothing is listening -> "down"), then the stored token against /auth (the
   * bridge holds tokens in memory, so a session restart leaves a stale token on
   * disk -> 401 -> "unpaired"). Local actions like "New chat" never 401 on their
   * own, so without this the pair prompt wouldn't appear until the first failed
   * send. Never interrupts an in-flight pairing. */
  async recheck(): Promise<void> {
    if (pairingActive()) return;
    const health = await api("/health");
    if (pairingActive()) return; // pair() started during the await
    if (isUnreachable(health)) {
      set({ phase: "down" }); // keep any stored token — a stale one is /auth's 401 to report
      return;
    }
    const token = await storeGet(TOKEN_KEY);
    if (pairingActive()) return; // pair() started during the await
    if (typeof token !== "string" || !token) {
      set({ phase: "unpaired" });
      return;
    }
    set(authToPhase(await api("/auth")));
  },

  /** Ask the bridge to pair, show the code, poll the claim until the token lands. */
  async pair(): Promise<void> {
    const r = await api("/pair", "POST", { name: "Kvasir Chrome extension" });
    if (state.phase === "paired") return; // a concurrent recheck() resolved while the POST was in flight
    const request = r.ok ? requestIdOf(r.data) : null;
    if (!request) {
      set({ phase: "error", message: friendlyError(r, "pairing request failed") });
      return;
    }
    set({ phase: "waiting", code: request.code });
    for (let index = 0; index < CLAIM_POLL_TRIES; index++) {
      await sleep(CLAIM_POLL_MS);
      const c = await api(`/pair/claim?id=${encodeURIComponent(request.requestId)}`);
      if (!c.ok) {
        set({
          phase: "error",
          message: isUnreachable(c) ? friendlyError(c) : "pairing expired or was denied — try again",
        });
        return;
      }
      const token = tokenOf(c.data);
      if (token) {
        storeSet(TOKEN_KEY, token);
        set({ phase: "paired" });
        return;
      }
    }
    set({ phase: "error", message: "pairing timed out — try again" });
  },
};
