// The pairing machine — Asgard's side of earning the bridge token. The user
// arms pairing in their Claude session (open_pairing), clicks Pair here, reads
// the code off this panel, and approves that code in chat; we poll the claim
// until the token lands and persist it for Huginn to attach on every request.
import { api } from "../api";
import { TOKEN_KEY } from "../keys";
import { storeGet, storeRemove, storeSet } from "../muninn";
import { touch } from "./store";

export const CLAIM_POLL_MS = 1000;
export const CLAIM_POLL_TRIES = 120;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export type PairingPhase =
  | { phase: "unknown" }
  | { phase: "unpaired" }
  | { phase: "waiting"; code: string }
  | { phase: "paired" }
  | { phase: "error"; message: string };

let state: PairingPhase = { phase: "unknown" };

const set = (next: PairingPhase): void => {
  state = next;
  touch();
};

const requestIdOf = (data: unknown): { requestId: string; code: string } | null =>
  typeof data === "object" &&
  data !== null &&
  "requestId" in data &&
  typeof data.requestId === "string" &&
  "code" in data &&
  typeof data.code === "string"
    ? { requestId: data.requestId, code: data.code }
    : null;

const tokenOf = (data: unknown): string | null =>
  typeof data === "object" && data !== null && "token" in data && typeof data.token === "string"
    ? data.token
    : null;

export const pairingStore = {
  state: (): PairingPhase => state,

  /** True while a bridge call would 401 — used to disable backend-dependent
   * controls so they don't look clickable. "unknown" (pre-boot-check) stays
   * enabled; it resolves to paired/unpaired within a moment of load. */
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

  /** Resolve unknown → paired/unpaired (once, on boot). A stored token is not
   * enough: the bridge holds the token in memory, so a session restart leaves a
   * stale token on disk — verify it against the bridge and drop it if rejected. */
  async refresh(): Promise<void> {
    if (state.phase !== "unknown") return;
    const token = await storeGet(TOKEN_KEY);
    if (state.phase !== "unknown") return; // pair() may have started during the await
    if (typeof token !== "string" || !token) {
      set({ phase: "unpaired" });
      return;
    }
    const r = await api("/auth");
    if (state.phase !== "unknown") return; // pair() may have started during the await
    if (r.ok) {
      set({ phase: "paired" });
    } else {
      storeRemove(TOKEN_KEY);
      set({ phase: "unpaired" });
    }
  },

  /** Re-verify the stored token against the bridge on demand — fired when the user
   * starts a chat. Restarting the Claude session silently staleifies the token, and
   * a local action like "New chat" never 401s on its own, so without this the pair
   * prompt wouldn't appear until the first failed send. Transitions to unpaired when
   * the bridge rejects the token; never interrupts an in-flight pairing. */
  async recheck(): Promise<void> {
    if (state.phase === "waiting" || state.phase === "error") return; // don't interrupt an active pair
    const token = await storeGet(TOKEN_KEY);
    if (typeof token !== "string" || !token) {
      set({ phase: "unpaired" });
      return;
    }
    const r = await api("/auth");
    if (r.ok) {
      set({ phase: "paired" });
    } else {
      storeRemove(TOKEN_KEY);
      set({ phase: "unpaired" });
    }
  },

  /** Ask the bridge to pair, show the code, poll the claim until the token lands. */
  async pair(): Promise<void> {
    const r = await api("/pair", "POST", { name: "Kvasir Chrome extension" });
    if (state.phase === "paired") return; // a concurrent refresh() resolved while the POST was in flight
    const request = r.ok ? requestIdOf(r.data) : null;
    if (!request) {
      const detail =
        typeof r.data === "object" && r.data !== null && "error" in r.data ? String(r.data.error) : r.error;
      set({ phase: "error", message: detail || "pairing request failed" });
      return;
    }
    set({ phase: "waiting", code: request.code });
    for (let index = 0; index < CLAIM_POLL_TRIES; index++) {
      await sleep(CLAIM_POLL_MS);
      const c = await api(`/pair/claim?id=${encodeURIComponent(request.requestId)}`);
      if (!c.ok) {
        set({ phase: "error", message: "pairing expired or was denied — try again" });
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
