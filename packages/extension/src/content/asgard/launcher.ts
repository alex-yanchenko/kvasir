// The launcher's generate state machine — Asgard-owned (the legacy state shim
// holds only what the vanilla tour still reads: the spec itself and tourState).
// Run/poll/resume semantics are ported verbatim from the vanilla launcher:
// generation runs in the maintainer's Claude session; we persist a marker so a
// page refresh keeps waiting, and poll until a spec with a NEW signature lands.

import { isWalkthroughSpec, type WalkthroughSpec } from "@prw/runes/spec";
import { api } from "../api";
import { genKey, onFilesTab, prUrl, specKey, tourKey } from "../keys";
import { storeGet, storeRemove, storeSet } from "../muninn";
import { state } from "../state";
import { touch } from "./store";

/** Coexistence shim: the tour card is vanilla until D4 — opening/closing it
 * crosses this bridge (auto-start after a tab hop, regenerate closing the tour). */
export const legacyTourBridge: {
  startTour?: () => void;
  closeTour?: () => void;
} = {};

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
  prevSig?: string;
  at?: number;
}
const isGenMarker = (x: unknown): x is GenMarker => typeof x === "object" && x !== null;

let generating = false;
let newCommits = false;
let curHead: string | null = null;
let genPoll: ReturnType<typeof setInterval> | null = null;
let genStartAt = 0;

// Poll until a spec different from prevSig lands. Shared by a fresh request and
// by resuming after a page refresh.
function pollForSpec(pr: string, prevSig: string): void {
  let tries = 0;
  if (genPoll) clearInterval(genPoll);
  genPoll = setInterval(() => {
    void (async () => {
      tries++;
      const r = await api(`/walkthrough?pr=${encodeURIComponent(pr)}`);
      const got = r.ok && isWalkthroughSpec(r.data) ? r.data : null;
      if (got && specSig(got) !== prevSig) {
        if (genPoll) clearInterval(genPoll);
        genPoll = null;
        state.spec = got;
        storeSet(specKey(pr), got);
        storeRemove(genKey(pr));
        state.tourState = { ...state.tourState, step: 0 };
        storeSet(tourKey(pr), state.tourState); // new review → first step; keep pos + size
        newCommits = !!(curHead && got.pr?.headSha && got.pr.headSha !== curHead);
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

export const launcherStore = {
  generating: (): boolean => generating,
  genStartAt: (): number => genStartAt,
  newCommits: (): boolean => newCommits,
  spec: (): WalkthroughSpec | null => state.spec,

  openTour(): void {
    legacyTourBridge.startTour?.();
  },

  /** Ask the session (via the channel) to (re)generate; persist a marker so the
   * "generating" state survives a refresh, then poll for the new spec. */
  async requestGenerate(mode: "new" | "incremental", sinceSha?: string): Promise<void> {
    const pr = prUrl();
    if (!pr) return;
    const prevSig = specSig(state.spec);
    legacyTourBridge.closeTour?.(); // don't leave a stale walkthrough open while it regenerates
    generating = true;
    genStartAt = Date.now();
    storeSet(genKey(pr), { prevSig, at: genStartAt });
    touch();
    await api("/generate", "POST", { pr, mode, sinceSha });
    pollForSpec(pr, prevSig);
  },

  /** Stop watching — generation keeps running in the session; reopen later. */
  dismissGen(): void {
    const pr = prUrl();
    if (genPoll) clearInterval(genPoll);
    genPoll = null;
    storeRemove(genKey(pr));
    generating = false;
    touch();
  },

  /** PR navigation: drop everything generation-related (the new PR refreshes). */
  resetForPr(): void {
    if (genPoll) clearInterval(genPoll);
    genPoll = null;
    generating = false;
    newCommits = false;
    curHead = null;
    genStartAt = 0;
    touch();
  },

  /** Boot/refresh: load the spec (live, else cached), resume an in-flight
   * generation within the poll window, and detect new commits since the review. */
  async refresh(): Promise<void> {
    const pr = prUrl();
    if (!pr) return;
    let data: WalkthroughSpec | null = null;
    const r = await api(`/walkthrough?pr=${encodeURIComponent(pr)}`);
    if (r.ok && isWalkthroughSpec(r.data)) {
      data = r.data;
      storeSet(specKey(pr), data); // cache fresh spec
    } else {
      const cached = await storeGet(specKey(pr));
      if (isWalkthroughSpec(cached)) data = cached; // fall back to cache
    }
    state.spec = data;
    touch();
    if (state.spec && onFilesTab() && sessionStorage.getItem("prwAutoStart") === "1") {
      sessionStorage.removeItem("prwAutoStart");
      setTimeout(() => legacyTourBridge.startTour?.(), 900);
    }
    if (!genPoll) {
      // resume a generation that was in flight before a refresh — within the same
      // window the poll watches, so the timer keeps counting from the original start
      const gen = await storeGet(genKey(pr));
      const marker = isGenMarker(gen) ? gen : null;
      const at = marker?.at || 0;
      const fresh = Date.now() - at < GEN_MAX_TRIES * GEN_POLL_INTERVAL_MS;
      if (marker && fresh && (!state.spec || specSig(state.spec) === marker.prevSig)) {
        generating = true;
        genStartAt = at;
        touch();
        pollForSpec(pr, marker.prevSig ?? "");
        return;
      }
      if (marker) storeRemove(genKey(pr)); // finished (spec already changed), or stale — drop it
    }
    if (state.spec && !generating) {
      // detect new commits since the reviewed head
      const h = await api(`/head?pr=${encodeURIComponent(pr)}`);
      let headSha: string | null = null;
      if (h.ok && typeof h.data === "object" && h.data !== null && "headSha" in h.data) {
        headSha = typeof h.data.headSha === "string" ? h.data.headSha : null;
      }
      if (headSha) {
        curHead = headSha;
        newCommits = !!state.spec.pr?.headSha && state.spec.pr.headSha !== curHead;
        touch();
      }
    }
  },
};
