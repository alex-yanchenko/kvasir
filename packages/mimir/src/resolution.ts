/**
 * Reviewer-authorized checkout resolution — the orchestration behind the bridge's
 * /resolve and /prepare routes and the heavy /generate path. Pure over injected
 * dependencies (fs/git probes, the resolved-path cache, the clone runner), so the
 * decision logic is unit-tested here and bridge.ts just maps it to HTTP.
 *
 * resolveCheckout answers "is a usable checkout ready?" without any Claude turn or
 * network. prepareCheckout executes the reviewer's explicit choice — clone into the
 * server folder, clone into a chosen dest, adopt an existing clone, set a default
 * clones root, or decline to the diff. `owner/repo` come only from parsePrUrl
 * (host/charset-guarded); the caller never supplies a clone URL.
 */
import path from "node:path";
import { parsePrUrl } from "@kvasir/runes";
import { checkoutPathSafe, cloneRepo, CloneError, type CloneRunner, isGhSegment } from "./cloneRepo";
import type { DefaultRootStore } from "./defaultRootStore";
import type { ResolvedRepoStore } from "./resolvedRepoStore";
import { isUsableClone, type Ready, type RepoProbes, resolveRepo, type ResolveResult } from "./resolveRepo";

export interface ResolutionDeps {
  /** fs/git probes (isDir + git origin) for validating a candidate checkout. */
  probes: RepoProbes;
  /** Per-repo resolved-path cache (re-validated on read, dropped when stale). */
  store: ResolvedRepoStore;
  /** The reviewer's default clones root — consulted for `<root>/<repo>` after the
   * clones dir and saved path, and set by the set-default-root action. */
  defaultRootStore: DefaultRootStore;
  /** Server-owned clones root (~/.kvasir/clones) — where clone-kvasir lands and the
   * first place resolution looks. */
  clonesDir: string;
  /** Home directory — every clone WRITE target (clone-kvasir, clone-dest, and the
   * local-clone adoption of use-existing / a default-root match) must resolve under it.
   * The reviewer-supplied SOURCE path only needs an absolute, control-char-free path
   * (checkoutPathSafe), since origin-match / isDir is the trust check there. */
  home: string;
  /** The hardened-clone runner (Bun.spawn), injected so this module stays testable. */
  cloneRun: CloneRunner;
}

/** The reviewer's choices from the resolution card. */
export const PREPARE_ACTIONS = [
  "clone-kvasir",
  "clone-dest",
  "use-existing",
  "set-default-root",
  "diff-only",
] as const;
export type PrepareAction = (typeof PREPARE_ACTIONS)[number];

export type PrepareResult = Ready | { status: "declined" };

/** Resolve a PR's local checkout deterministically (no Claude, no network): the
 * server clones dir wins, else a re-validated saved path, else the reviewer's default
 * clones root (<root>/<repo>), else absent. A saved path that no longer validates is
 * dropped so the reviewer is re-asked. */
export function resolveCheckout(pr: string, deps: ResolutionDeps): ResolveResult {
  const { owner, repo } = parsePrUrl(pr);
  // GitHub owner/repo are case-insensitive (originMatches treats them so); lowercase
  // the cache key so differently-cased URLs for the same repo share one entry.
  const ownerRepo = `${owner}/${repo}`.toLowerCase();
  const savedPath = deps.store.get(ownerRepo);
  const result = resolveRepo(owner, repo, {
    clonesDir: deps.clonesDir,
    savedPath,
    defaultRoot: deps.defaultRootStore.get(),
    probes: deps.probes,
  });
  if (result.status === "absent" && savedPath) deps.store.drop(ownerRepo);
  return result;
}

/** True when `candidate` resolves under the server-owned clones root. Heavy git ops run
 * only on such paths (channel enforces it before prepare_context_worktree); a checkout
 * anywhere else is FOREIGN and must be adopted before git touches it. */
export function isUnderClonesDirectory(candidate: string, clonesRoot: string): boolean {
  const resolved = path.resolve(candidate);
  const root = path.resolve(clonesRoot);
  return resolved === root || resolved.startsWith(root + path.sep);
}

/** Run a heavy-pass git `op` ONLY when `repoPath` is under the clones dir; otherwise
 * refuse without invoking it. This is the enforcement point the worktree MCP tools wire
 * to — extracting it (with the op injected) makes the guard's WIRING testable (that the
 * op is skipped on refusal), which channel.ts (an untestable entrypoint) can't prove. */
export async function guardHeavyGitOp<T>(
  repoPath: string,
  clonesRoot: string,
  op: () => Promise<T>,
): Promise<{ refused: true } | { refused: false; value: T }> {
  if (!isUnderClonesDirectory(repoPath, clonesRoot)) return { refused: true };
  return { refused: false, value: await op() };
}

/** Bring a checkout under kvasir ownership so heavy git ops never run against a foreign
 * .git. A path already under the clones dir is returned unchanged. A FOREIGN path is
 * copied into <clonesDir>/<owner>/<repo> via `git clone --local` (cloneRepo with a
 * source), origin reset to github — so every later op runs against a fresh,
 * kvasir-authored config, leaving the source's exec keys / named filters behind.
 * Idempotent: an already-adopted clone is reused, never re-cloned.
 *
 * `owner`/`repo` are the caller's canonical (PR-URL-derived) identity — the SAME values
 * resolveRepo uses to build its clones-dir path, so the adopted directory is exactly
 * where a later resolve looks. They are re-guarded here (isGhSegment) so the target path
 * can never be built from a `..`/traversal segment even if a future caller threads an
 * unvalidated value. The foreign checkout's own origin was already confirmed to match
 * this owner/repo upstream (isUsableClone), so it is not re-parsed here. */
export async function adoptForeignCheckout(
  repoPath: string,
  owner: string,
  repo: string,
  deps: ResolutionDeps,
): Promise<string> {
  if (isUnderClonesDirectory(repoPath, deps.clonesDir)) return repoPath;
  if (!isGhSegment(owner) || !isGhSegment(repo)) {
    throw new CloneError(`refusing to adopt ${repoPath}: invalid owner/repo "${owner}/${repo}"`);
  }
  const target = path.join(deps.clonesDir, owner, repo);
  if (isUsableClone(target, owner, repo, deps.probes)) return target; // already adopted
  await cloneRepo(owner, repo, target, { run: deps.cloneRun, home: deps.home, source: repoPath });
  return target;
}

/** Discovery + adoption for the heavy /generate path: resolve the PR's checkout, then
 * ensure it is kvasir-owned (adopting a foreign one). The returned path is always safe
 * for heavy git ops; a successful adoption is cached per repo so later passes reuse it
 * regardless of how the PR URL's owner/repo is cased. */
export async function ensureCheckout(pr: string, deps: ResolutionDeps): Promise<ResolveResult> {
  const discovered = resolveCheckout(pr, deps);
  if (discovered.status !== "ready") return discovered;
  const { owner, repo } = parsePrUrl(pr);
  const owned = await adoptForeignCheckout(discovered.path, owner, repo, deps);
  deps.store.set(`${owner}/${repo}`.toLowerCase(), owned);
  return { status: "ready", path: owned };
}

/** Clone `owner/repo` into `destination` (or the kvasir folder when none is given)
 * and remember the resolved path. NOTE: a `clone-dest` target OUTSIDE the clones dir is
 * kvasir-authored (trustworthy) but not recognized as such by adoptForeignCheckout — the
 * first heavy pass will re-adopt it into a clones-dir mirror (one extra local hardlink
 * clone) and read from the mirror. Harmless today (clone-dest is not yet UI-wired); the
 * card work (A5.3b) reconciles whether clone-dest should just land in the clones dir. */
async function cloneAndRemember(
  ids: { owner: string; repo: string; ownerRepo: string },
  destination: string | undefined,
  deps: ResolutionDeps,
): Promise<Ready> {
  const target = destination ?? path.join(deps.clonesDir, ids.owner, ids.repo);
  await cloneRepo(ids.owner, ids.repo, target, { run: deps.cloneRun, home: deps.home });
  deps.store.set(ids.ownerRepo, target);
  return { status: "ready", path: target };
}

/** Adopt an EXISTING clone the reviewer pointed at: validate it is a github clone of
 * THIS repo (origin-match — so the path need not be under $HOME, only absolute +
 * control-char free), then bring it under kvasir ownership via a local clone so heavy
 * git ops never run against the foreign .git. Returns the kvasir-owned path. */
async function adoptExisting(
  ids: { owner: string; repo: string; ownerRepo: string },
  destination: string | undefined,
  deps: ResolutionDeps,
): Promise<Ready> {
  if (!destination) throw new CloneError("use-existing requires a path");
  if (!checkoutPathSafe(destination)) {
    throw new CloneError(
      `refusing to use ${destination}: must be an absolute path with no control characters`,
    );
  }
  if (!isUsableClone(destination, ids.owner, ids.repo, deps.probes)) {
    throw new CloneError(`${destination} is not a git clone of ${ids.ownerRepo}`);
  }
  const owned = await adoptForeignCheckout(destination, ids.owner, ids.repo, deps);
  deps.store.set(ids.ownerRepo, owned);
  return { status: "ready", path: owned };
}

/** Persist a default clones root, then resolve+adopt the current PR under it — ready
 * (kvasir-owned) if it lives there, else the root is remembered for future repos and
 * this one degrades. */
async function applyDefaultRoot(
  pr: string,
  destination: string | undefined,
  deps: ResolutionDeps,
): Promise<PrepareResult> {
  if (!destination) throw new CloneError("set-default-root requires a path");
  if (!checkoutPathSafe(destination)) {
    throw new CloneError(
      `refusing to set ${destination}: must be an absolute path with no control characters`,
    );
  }
  if (!deps.probes.isDir(destination)) throw new CloneError(`${destination} is not a directory`);
  deps.defaultRootStore.set(destination);
  // The root is now persisted for future repos regardless. Adopting the CURRENT pr under
  // it is a bonus — if that adoption clone fails (git error, disk), degrade this pr to
  // declined (it falls to the diff) rather than surface a hard error for the whole
  // action, matching /generate's fail-toward-the-diff invariant.
  try {
    const resolved = await ensureCheckout(pr, deps);
    return resolved.status === "ready" ? resolved : { status: "declined" };
  } catch {
    return { status: "declined" };
  }
}

/** Execute the reviewer's explicit resolution choice. A successful resolution is
 * remembered per repo; diff-only declines. */
export async function prepareCheckout(
  pr: string,
  action: PrepareAction,
  destination: string | undefined,
  deps: ResolutionDeps,
): Promise<PrepareResult> {
  const { owner, repo } = parsePrUrl(pr);
  const ownerRepo = `${owner}/${repo}`.toLowerCase(); // case-insensitive key, matching resolveCheckout
  const ids = { owner, repo, ownerRepo };

  switch (action) {
    case "diff-only": {
      return { status: "declined" };
    }
    case "clone-kvasir": {
      return cloneAndRemember(ids, undefined, deps);
    }
    case "clone-dest": {
      if (!destination) throw new CloneError("clone-dest requires a destination path");
      return cloneAndRemember(ids, destination, deps);
    }
    case "use-existing": {
      return adoptExisting(ids, destination, deps);
    }
    case "set-default-root": {
      return applyDefaultRoot(pr, destination, deps);
    }
  }
}
