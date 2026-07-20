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
import { checkoutPathSafe, cloneRepo, CloneError, type CloneRunner } from "./cloneRepo";
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
  /** Home directory — clone WRITE targets (clone-kvasir, clone-dest) must resolve
   * under it. use-existing / set-default-root only require an absolute, control-char
   * free path (checkoutPathSafe), since origin-match / isDir is the trust check there. */
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

/** Clone `owner/repo` into `destination` (or the kvasir folder when none is given)
 * and remember the resolved path. */
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

/** Adopt an EXISTING clone at `destination` — origin-match is the trust check, so the
 * path need not be under $HOME (still absolute + control-char free, since it's
 * interpolated into the heavy-pass prompt). */
function adoptExisting(
  ids: { owner: string; repo: string; ownerRepo: string },
  destination: string | undefined,
  deps: ResolutionDeps,
): Ready {
  if (!destination) throw new CloneError("use-existing requires a path");
  if (!checkoutPathSafe(destination)) {
    throw new CloneError(
      `refusing to use ${destination}: must be an absolute path with no control characters`,
    );
  }
  if (!isUsableClone(destination, ids.owner, ids.repo, deps.probes)) {
    throw new CloneError(`${destination} is not a git clone of ${ids.ownerRepo}`);
  }
  deps.store.set(ids.ownerRepo, destination);
  return { status: "ready", path: destination };
}

/** Persist a default clones root, then re-resolve the current PR under it — ready if
 * it lives there, else the root is remembered for future repos and this one degrades. */
function applyDefaultRoot(pr: string, destination: string | undefined, deps: ResolutionDeps): PrepareResult {
  if (!destination) throw new CloneError("set-default-root requires a path");
  if (!checkoutPathSafe(destination)) {
    throw new CloneError(
      `refusing to set ${destination}: must be an absolute path with no control characters`,
    );
  }
  if (!deps.probes.isDir(destination)) throw new CloneError(`${destination} is not a directory`);
  deps.defaultRootStore.set(destination);
  const resolved = resolveCheckout(pr, deps);
  return resolved.status === "ready" ? resolved : { status: "declined" };
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
