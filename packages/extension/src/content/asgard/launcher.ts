// The launcher's generate state machine — Asgard-owned.
// Run/poll/resume semantics are ported verbatim from the vanilla launcher:
// generation runs in the maintainer's Claude session; we persist a marker so a
// page refresh keeps waiting, and poll until a spec with a NEW signature lands.

import { isWalkthroughSpec, type WalkthroughSpec } from "@prw/runes/spec";
import { api, type BridgeResponse } from "../api";
import { genKey, onFilesTab, prUrl, specKey, tourKey } from "../keys";
import { storeGet, storeRemove, storeSet } from "../muninn";
import { pairingStore } from "./pairing";
import { state, touch } from "./store";
import { tourStore } from "./tour";

/** Any 401 from the bridge means the token is stale/absent — flip to unpaired so
 * the panel surfaces the Pair prompt instead of silently doing nothing. */
function noteAuth(r: BridgeResponse): BridgeResponse {
  if (r.status === 401) pairingStore.markUnpaired();
  return r;
}

// Content signature — changes on any republish (timestamp, step count, or size),
// so completion detection doesn't depend on the model bumping generatedAt.
export const specSig = (s: WalkthroughSpec | null): string =>
  s ? `${s.generatedAt}|${s.steps.length}|${JSON.stringify(s).length}` : "";

// How long to keep watching for a generated spec before giving up. Generation
// runs in your Claude session and a large PR can take many minutes, so the stop
// is generous; it only stops the client watching — the session keeps going and a
// page refresh resumes the poll. (GEN_MAX_TRIES * GEN_POLL_INTERVAL_MS = ~20 min.)
export const GEN_POLL_INTERVAL_MS = 3000;
export const GEN_MAX_TRIES = 400;

// m:ss elapsed, for the "Generating…" status timer.
export const fmtElapsed = (ms: number): string => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};

interface GenMarker {
  previousSig?: string;
  at?: number;
}
const isGenMarker = (x: unknown): x is GenMarker => typeof x === "object" && x !== null;

let generating = false;
let newCommits = false;
let currentHead: string | null = null;
let genPoll: ReturnType<typeof setInterval> | null = null;
let genStartAt = 0;

// Poll until a spec different from previousSig lands. Shared by a fresh request and
// by resuming after a page refresh.
function pollForSpec(pr: string, previousSig: string): void {
  let tries = 0;
  if (genPoll) clearInterval(genPoll);
  genPoll = setInterval(() => {
    void (async () => {
      tries++;
      const r = noteAuth(await api(`/walkthrough?pr=${encodeURIComponent(pr)}`));
      const got = r.ok && isWalkthroughSpec(r.data) ? r.data : null;
      if (got && specSig(got) !== previousSig) {
        if (genPoll) clearInterval(genPoll);
        genPoll = null;
        state.spec = got;
        storeSet(specKey(pr), got);
        storeRemove(genKey(pr));
        state.tourState = { ...state.tourState, step: 0 };
        storeSet(tourKey(pr), state.tourState); // new review → first step; keep pos + size
        newCommits = !!(currentHead && got.pr?.headSha && got.pr.headSha !== currentHead);
        generating = false;
        touch();
      } else if (tries > GEN_MAX_TRIES) {
        if (genPoll) clearInterval(genPoll);
        genPoll = null;
        storeRemove(genKey(pr));
        generating = false;
        touch();
      }
    })();
  }, GEN_POLL_INTERVAL_MS);
}

/** Load the live spec (and cache it), else fall back to the cached one. */
async function loadSpec(pr: string): Promise<void> {
  const r = noteAuth(await api(`/walkthrough?pr=${encodeURIComponent(pr)}`));
  if (r.ok && isWalkthroughSpec(r.data)) {
    state.spec = r.data;
    storeSet(specKey(pr), r.data); // cache fresh spec
  } else {
    const cached = await storeGet(specKey(pr));
    state.spec = isWalkthroughSpec(cached) ? cached : null;
  }
  touch();
}

/** Resume a generation that was in flight before a refresh — within the same window
 * the poll watches, so the timer keeps counting from the original start. Returns true
 * if it took over polling (caller should stop). A finished/stale marker is dropped. */
async function resumeGeneration(pr: string): Promise<boolean> {
  const gen = await storeGet(genKey(pr));
  const marker = isGenMarker(gen) ? gen : null;
  const at = marker?.at ?? 0;
  const fresh = Date.now() - at < GEN_MAX_TRIES * GEN_POLL_INTERVAL_MS;
  if (marker && fresh && (!state.spec || specSig(state.spec) === marker.previousSig)) {
    generating = true;
    genStartAt = at;
    touch();
    pollForSpec(pr, marker.previousSig ?? "");
    return true;
  }
  if (marker) storeRemove(genKey(pr)); // finished (spec already changed), or stale — drop it
  return false;
}

/** Detect commits pushed since the reviewed head. */
async function detectNewCommits(pr: string): Promise<void> {
  const h = noteAuth(await api(`/head?pr=${encodeURIComponent(pr)}`));
  let headSha: string | null = null;
  if (h.ok && typeof h.data === "object" && h.data !== null && "headSha" in h.data) {
    headSha = typeof h.data.headSha === "string" ? h.data.headSha : null;
  }
  if (!headSha) return;
  currentHead = headSha;
  newCommits = !!state.spec?.pr?.headSha && state.spec.pr.headSha !== currentHead;
  touch();
}

export const launcherStore = {
  generating: (): boolean => generating,
  genStartAt: (): number => genStartAt,
  newCommits: (): boolean => newCommits,
  spec: (): WalkthroughSpec | null => state.spec,

  /** Ask the session (via the channel) to (re)generate; persist a marker so the
   * "generating" state survives a refresh, then poll for the new spec. */
  async requestGenerate(mode: "new" | "incremental", sinceSha?: string): Promise<void> {
    const pr = prUrl();
    if (!pr) return;
    const previousSig = specSig(state.spec);
    tourStore.close(); // don't leave a stale walkthrough open while it regenerates
    generating = true;
    genStartAt = Date.now();
    storeSet(genKey(pr), { previousSig, at: genStartAt });
    touch();
    const r = noteAuth(await api("/generate", "POST", { pr, mode, sinceSha }));
    if (!r.ok) {
      // unpaired (or the channel is down) — don't spin a 20-minute poll on nothing
      generating = false;
      storeRemove(genKey(pr));
      touch();
      return;
    }
    pollForSpec(pr, previousSig);
  },

  /** Stop watching — generation keeps running in the session; reopen later. */
  dismissGen(): void {
    const pr = prUrl();
    if (genPoll) clearInterval(genPoll);
    genPoll = null;
    if (pr) storeRemove(genKey(pr)); // genKey(null) would remove a phantom "prw:gen:null"
    generating = false;
    touch();
  },

  /** PR navigation: drop everything generation-related (the new PR refreshes). */
  resetForPr(): void {
    if (genPoll) clearInterval(genPoll);
    genPoll = null;
    generating = false;
    newCommits = false;
    currentHead = null;
    genStartAt = 0;
    touch();
  },

  /** Boot/refresh: load the spec (live, else cached), resume an in-flight
   * generation within the poll window, and detect new commits since the review. */
  async refresh(): Promise<void> {
    const pr = prUrl();
    if (!pr) return;
    await loadSpec(pr);
    if (state.spec && onFilesTab() && sessionStorage.getItem("prwAutoStart") === "1") {
      sessionStorage.removeItem("prwAutoStart");
      setTimeout(() => tourStore.start(), 900);
    }
    if (!genPoll && (await resumeGeneration(pr))) return;
    if (state.spec && !generating) await detectNewCommits(pr);
  },
};
