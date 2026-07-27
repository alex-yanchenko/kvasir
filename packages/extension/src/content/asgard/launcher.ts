// The launcher's generate state machine — Asgard-owned. Run/poll/resume:
// generation runs in the maintainer's Claude session; we persist a marker so a
// page refresh keeps waiting, and poll until a spec with a NEW signature lands.

import { isWalkthroughSpec, type WalkthroughSpec } from "@kvasir/runes/spec";
import { api, type BridgeResponse } from "../api";
import { genKey, onFilesTab, prUrl, specKey, tourKey } from "../keys";
import { storeGet, storeRemove, storeSet } from "../muninn";
import { friendlyError } from "./friendly";
import { pairingStore } from "./pairing";
import { launcherDefaults, type ResolveState, resolveDefaults, settingsStore, state, touch } from "./store";
import { tourStore } from "./tour";

/** The reviewer's resolution-card choices — mirrors the server's PREPARE_ACTIONS
 * (packages/mimir resolution.ts). `dest` is required for the three path actions. */
export type PrepareAction = "clone-kvasir" | "use-existing" | "clone-dest" | "set-default-root" | "diff-only";

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

// A git SHA (abbreviated or full) — validated before going into a navigation URL so
// a non-sha value can't smuggle extra path segments past the github-origin guard.
const isSha = (s: string | null | undefined): s is string => !!s && /^[0-9a-f]{7,40}$/i.test(s);

// Read a string `field` off an unknown bridge-response `data` object, else undefined.
// Reflect.get (not an `as` cast) reads the value without asserting the object's shape.
const dataField = (data: unknown, field: string): string | undefined => {
  if (typeof data !== "object" || data === null || !(field in data)) return undefined;
  const value: unknown = Reflect.get(data, field);
  return typeof value === "string" ? value : undefined;
};

/** Narrow a `POST /resolve` reply. `ready` = a local clone exists (the extension
 * ignores the returned path — the server re-resolves at /generate); `absent` = none,
 * offer the card; `error` = a transport failure or any other status — the caller treats
 * it like ready and generates anyway (the server then degrades to the diff). */
export type ResolveOutcome = "ready" | "absent" | "error";
export function resolveOutcome(r: BridgeResponse): ResolveOutcome {
  if (!r.ok) return "error";
  const status = dataField(r.data, "status");
  return status === "ready" || status === "absent" ? status : "error";
}

/** Narrow a `POST /prepare` reply (+ a reason for the error case). `ready` = the
 * clone/adopt succeeded → generate; `declined` = reviewer chose the diff; `error` =
 * surface the server's message (a bad dest, a failed clone). */
export interface PrepareOutcome {
  status: "ready" | "declined" | "error";
  message?: string;
}
export function prepareOutcome(r: BridgeResponse): PrepareOutcome {
  const status = dataField(r.data, "status");
  if (status === "ready") return { status: "ready" };
  if (status === "declined") return { status: "declined" };
  // Normalize a blank message to absent (trim, then falsy → drop) so the caller's
  // fallback copy shows rather than an empty error banner.
  const message = dataField(r.data, "message")?.trim() || r.error?.trim();
  return message ? { status: "error", message } : { status: "error" };
}

// This machine's state lives on state.launcher (one home for app state — see
// store.ts); only the poll TIMER stays here, a resource rather than state.
let genPoll: ReturnType<typeof setInterval> | null = null;

// Poll until a spec different from previousSig lands. Shared by a fresh request and
// by resuming after a page refresh.
function pollForSpec(pr: string, previousSig: string): void {
  let tries = 0;
  if (genPoll) clearInterval(genPoll);
  genPoll = setInterval(() => {
    void (async () => {
      tries++;
      const r = noteAuth(await api(`/walkthrough?pr=${encodeURIComponent(pr)}`));
      // Stop writing if the user navigated to another PR mid-poll (the interval for
      // this pr was already cleared by resetForPr on the switch; just don't clobber).
      if (prUrl() !== pr) return;
      const got = r.ok && isWalkthroughSpec(r.data) ? r.data : null;
      if (got && specSig(got) !== previousSig) {
        if (genPoll) clearInterval(genPoll);
        genPoll = null;
        state.spec = got;
        storeSet(specKey(pr), got);
        storeRemove(genKey(pr));
        // A freshly generated walkthrough opens on its overview "step 0" when it has
        // one, else on the first code step. Keep pos + size.
        state.persistedTour = { ...state.persistedTour, step: 0, overview: !!got.overview };
        storeSet(tourKey(pr), state.persistedTour);
        const { currentHead } = state.launcher;
        state.launcher.newCommits = !!(currentHead && got.pr?.headSha && got.pr.headSha !== currentHead);
        state.launcher.generating = false;
        touch();
      } else if (tries > GEN_MAX_TRIES) {
        if (genPoll) clearInterval(genPoll);
        genPoll = null;
        storeRemove(genKey(pr));
        state.launcher.generating = false;
        state.launcher.genError = "This took too long — the session may be stuck; check your terminal.";
        touch();
      }
    })();
  }, GEN_POLL_INTERVAL_MS);
}

/** Cache-then-refresh: render the cached spec the moment it reads (no empty-state
 * flash on a PR that HAS a walkthrough), then swap in the live one and re-cache it.
 * The live result still wins; the cache only bridges the network round-trip. */
async function loadSpec(pr: string): Promise<void> {
  const stored = await storeGet(specKey(pr));
  const cached = isWalkthroughSpec(stored) ? stored : null;
  // The instant render only fills a blank tab (a PR switch nulls state.spec first);
  // a same-PR refresh keeps whatever is on screen until the live answer lands.
  if (cached && !state.spec && prUrl() === pr) {
    state.spec = cached;
    touch();
  }
  const r = noteAuth(await api(`/walkthrough?pr=${encodeURIComponent(pr)}`));
  const fresh = r.ok && isWalkthroughSpec(r.data) ? r.data : null;
  // GitHub PRs are an SPA: the user can switch PRs while a fetch is in flight. One
  // currency check after the awaits, before the write, so a stale PR's spec can't
  // clobber (and persist over) the current PR's state.
  if (prUrl() !== pr) return;
  state.spec = fresh ?? cached;
  if (fresh) storeSet(specKey(pr), fresh); // cache the fresh live spec
  state.launcher.specLoading = false;
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
    state.launcher.generating = true;
    state.launcher.genStartAt = at;
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
  state.launcher.currentHead = headSha;
  state.launcher.newCommits = !!state.spec?.pr?.headSha && state.spec.pr.headSha !== headSha;
  touch();
}

/** Fire the /generate request + start the completion poll. Any heavy-checkout
 * resolution already happened (requestGenerate / prepareCheckout); the server
 * re-resolves and stamps the effective depth, degrading to the diff when absent. */
async function startGenerate(
  pr: string,
  mode: "new" | "incremental",
  sinceSha: string | undefined,
  previousSig: string,
): Promise<void> {
  state.launcher.generating = true;
  state.launcher.genError = null;
  state.launcher.lastGen = { mode, sinceSha };
  state.launcher.genStartAt = Date.now();
  storeSet(genKey(pr), { previousSig, at: state.launcher.genStartAt });
  touch();
  const r = noteAuth(
    await api("/generate", "POST", {
      pr,
      mode,
      sinceSha,
      depth: settingsStore.reviewMode(),
      diagram: settingsStore.generateDiagram(),
    }),
  );
  if (!r.ok) {
    // don't spin a 20-minute poll on nothing; say why instead. A 401 stays silent
    // here — noteAuth already flipped the pair banner on.
    state.launcher.generating = false;
    storeRemove(genKey(pr));
    if (r.status !== 401) {
      state.launcher.genError = friendlyError(r, "the generate request failed — try again");
    }
    touch();
    return;
  }
  pollForSpec(pr, previousSig);
}

export const launcherStore = {
  generating: (): boolean => state.launcher.generating,
  specLoading: (): boolean => state.launcher.specLoading,
  genStartAt: (): number => state.launcher.genStartAt,
  newCommits: (): boolean => state.launcher.newCommits,
  spec: (): WalkthroughSpec | null => state.spec,
  genError: (): string | null => state.launcher.genError,
  dismissGenError(): void {
    state.launcher.genError = null;
    touch();
  },
  /** Re-issue the request that just failed (same mode + range). */
  retryGenerate: (): Promise<void> =>
    launcherStore.requestGenerate(state.launcher.lastGen.mode, state.launcher.lastGen.sinceSha),

  /** Whether a "changes since this walkthrough" range diff can be opened — true once
   * commits landed past the head the walkthrough was generated for. */
  canShowChangesSinceReview: (): boolean =>
    isSha(state.spec?.pr?.headSha) &&
    isSha(state.launcher.currentHead) &&
    state.spec?.pr?.headSha !== state.launcher.currentHead,

  /** Navigate to GitHub's native range diff `reviewedSha..currentHead` — the combined
   * diff of every commit pushed since the head this walkthrough was generated for, so an
   * incremental review sees exactly what changed against what it was generated for. A full
   * page navigation; no-op unless both SHAs are valid and differ. */
  openChangesSinceReview(): void {
    const pr = prUrl();
    const reviewed = state.spec?.pr?.headSha;
    const head = state.launcher.currentHead;
    // pr is already a https://github.com PR URL (prUrl) and both refs are validated as
    // bare SHAs (isSha) — so the range URL can't escape the github origin or the path.
    if (!pr || !isSha(reviewed) || !isSha(head) || reviewed === head) return;
    globalThis.location.assign(`${pr}/files/${reviewed}..${head}`);
  },

  /** Ask the session (via the channel) to (re)generate; persist a marker so the
   * "generating" state survives a refresh, then poll for the new spec. A HEAVY request
   * resolves a local checkout first (so an absent one offers the reviewer a clone via
   * the resolution card, instead of the server silently degrading to diff-only); light
   * authors from the diff, so it skips resolution. */
  async requestGenerate(mode: "new" | "incremental", sinceSha?: string): Promise<void> {
    const pr = prUrl();
    if (!pr) return;
    const previousSig = specSig(state.spec);
    tourStore.close(); // don't leave a stale walkthrough open while it regenerates
    state.resolve = resolveDefaults(); // clear any prior card
    state.launcher.genError = null; // drop a stale error now — the heavy resolve path may
    // stop at the card before ever reaching startGenerate (which also clears it)
    state.launcher.lastGen = { mode, sinceSha }; // stash so a card pick resumes this same request
    touch();
    if (settingsStore.reviewMode() === "heavy") {
      state.resolve.status = "resolving";
      touch();
      const r = noteAuth(await api("/resolve", "POST", { pr }));
      if (prUrl() !== pr) return; // user switched PRs mid-resolve — don't clobber
      if (r.status === 401) {
        state.resolve = resolveDefaults(); // the pair banner owns a 401
        touch();
        return;
      }
      if (resolveOutcome(r) === "absent") {
        state.resolve.status = "absent"; // render the card; a pick resumes via prepareCheckout
        touch();
        return;
      }
      state.resolve = resolveDefaults(); // ready, or a resolve error → generate (server degrades)
    }
    await startGenerate(pr, mode, sinceSha, previousSig);
  },

  /** Stop watching — generation keeps running in the session; reopen later. */
  dismissGen(): void {
    const pr = prUrl();
    if (genPoll) clearInterval(genPoll);
    genPoll = null;
    if (pr) storeRemove(genKey(pr)); // genKey(null) would remove a phantom "kvasir:gen:null"
    state.launcher.generating = false;
    touch();
  },

  /** PR navigation: drop everything generation-related (the new PR refreshes). */
  resetForPr(): void {
    if (genPoll) clearInterval(genPoll);
    genPoll = null;
    state.launcher = launcherDefaults();
    state.resolve = resolveDefaults(); // a half-open resolution card must not survive a PR switch
    touch();
  },

  /** Boot/refresh: load the spec (live, else cached), resume an in-flight
   * generation within the poll window, and detect new commits since the review. */
  async refresh(): Promise<void> {
    const pr = prUrl();
    if (!pr) return;
    await loadSpec(pr);
    // The panel persists across SPA tab switches (Conversation ↔ Files) without
    // remounting, so re-issue the current step's highlight whenever a refresh lands
    // on the diff with the tour open — otherwise highlights wouldn't reappear when
    // you navigate back to Files. (start() never navigates the page; see tour.ts.)
    if (state.spec && onFilesTab() && tourStore.open()) tourStore.reapply();
    if (!genPoll && (await resumeGeneration(pr))) return;
    if (state.spec && !state.launcher.generating) await detectNewCommits(pr);
  },
};

/** The resolution card's store — launcher.ts owns it because a pick resumes the
 * generate. Getters the card reads, setters for the three reviewer-typed path inputs,
 * and the actions (dismiss + pick). The extension never derives a path; the three
 * inputs are the reviewer's explicit authorization, validated server-side. */
export const resolveStore = {
  status: (): ResolveState["status"] => state.resolve.status,
  error: (): string | null => state.resolve.error,
  /** True whenever the card should be showing (any status but idle). */
  active: (): boolean => state.resolve.status !== "idle",
  existingPath: (): string => state.resolve.existingPath,
  clonePath: (): string => state.resolve.clonePath,
  defaultRoot: (): string => state.resolve.defaultRoot,
  setExistingPath(value: string): void {
    state.resolve.existingPath = value;
    touch();
  },
  setClonePath(value: string): void {
    state.resolve.clonePath = value;
    touch();
  },
  setDefaultRoot(value: string): void {
    state.resolve.defaultRoot = value;
    touch();
  },
  /** Dismiss the card without acting — back to the empty state. */
  dismiss(): void {
    state.resolve = resolveDefaults();
    touch();
  },

  /** The reviewer picked a card action. "diff-only" declines the clone and generates
   * from the diff; the clone/adopt actions authorize a checkout via /prepare, then — on
   * ready — generate against it. `destination` carries the reviewer-typed path for the
   * path actions (the server validates it) and rides as the request's `dest` field. */
  async prepareCheckout(action: PrepareAction, destination?: string): Promise<void> {
    const pr = prUrl();
    if (!pr) return;
    const previousSig = specSig(state.spec);
    const { mode, sinceSha } = state.launcher.lastGen;
    if (action === "diff-only") {
      state.resolve = resolveDefaults();
      await startGenerate(pr, mode, sinceSha, previousSig); // no checkout → server degrades to the diff
      return;
    }
    state.resolve.status = "preparing";
    state.resolve.error = null;
    touch();
    const r = noteAuth(await api("/prepare", "POST", { pr, action, dest: destination }));
    if (prUrl() !== pr) return; // user switched PRs mid-prepare — don't clobber
    if (r.status === 401) {
      state.resolve.status = "absent"; // the pair banner owns a 401; keep the card up
      touch();
      return;
    }
    const outcome = prepareOutcome(r);
    if (outcome.status === "error") {
      state.resolve.status = "error";
      state.resolve.error = outcome.message ?? "couldn't prepare the checkout — try again";
      touch();
      return;
    }
    // ready (clone/adopt done → heavy) or declined (no checkout → server degrades to the
    // diff) — either way, generate now.
    state.resolve = resolveDefaults();
    await startGenerate(pr, mode, sinceSha, previousSig);
  },
};
