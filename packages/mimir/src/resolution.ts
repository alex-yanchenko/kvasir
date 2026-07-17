/**
 * Reviewer-authorized checkout resolution — the orchestration behind the bridge's
 * /resolve and /prepare routes and the heavy /generate path. Pure over injected
 * dependencies (fs/git probes, the resolved-path cache, the clone runner), so the
 * decision logic is unit-tested here and bridge.ts just maps it to HTTP.
 *
 * resolveCheckout answers "is a usable checkout ready?" without any Claude turn or
 * network. prepareCheckout executes the reviewer's explicit choice — clone into the
 * server folder, clone into a chosen dest, adopt an existing clone, or decline to
 * the diff. `owner/repo` come only from parsePrUrl (host/charset-guarded); the
 * caller never supplies a clone URL.
 */
import path from "node:path";
import { parsePrUrl } from "@kvasir/runes";
import { cloneRepo, CloneError, type CloneRunner, destinationPathShapeOk } from "./cloneRepo";
import type { ResolvedRepoStore } from "./resolvedRepoStore";
import { isUsableClone, type Ready, type RepoProbes, resolveRepo, type ResolveResult } from "./resolveRepo";

export interface ResolutionDeps {
  /** fs/git probes (isDir + git origin) for validating a candidate checkout. */
  probes: RepoProbes;
  /** Per-repo resolved-path cache (re-validated on read, dropped when stale). */
  store: ResolvedRepoStore;
  /** Server-owned clones root (~/.kvasir/clones) — where clone-kvasir lands and the
   * first place resolution looks. */
  clonesDir: string;
  /** Home directory — clone/adopt destinations must resolve under it. */
  home: string;
  /** The hardened-clone runner (Bun.spawn), injected so this module stays testable. */
  cloneRun: CloneRunner;
}

/** The reviewer's choices from the resolution card (A5.3 UI); wired but dormant in
 * A5.2, where an unresolved PR simply degrades to the diff. The spec's fifth action,
 * `set-default-root`, is deferred to A5.3 with the default-root UI. */
export const PREPARE_ACTIONS = ["clone-kvasir", "clone-dest", "use-existing", "diff-only"] as const;
export type PrepareAction = (typeof PREPARE_ACTIONS)[number];

export type PrepareResult = Ready | { status: "declined" };

/** Resolve a PR's local checkout deterministically (no Claude, no network): the
 * server clones dir wins, else a re-validated saved path, else absent. A saved path
 * that no longer validates is dropped so the reviewer is re-asked. */
export function resolveCheckout(pr: string, deps: ResolutionDeps): ResolveResult {
  const { owner, repo } = parsePrUrl(pr);
  // GitHub owner/repo are case-insensitive (originMatches treats them so); lowercase
  // the cache key so differently-cased URLs for the same repo share one entry.
  const ownerRepo = `${owner}/${repo}`.toLowerCase();
  const savedPath = deps.store.get(ownerRepo);
  const result = resolveRepo(owner, repo, { clonesDir: deps.clonesDir, savedPath, probes: deps.probes });
  if (result.status === "absent" && savedPath) deps.store.drop(ownerRepo);
  return result;
}

/** Execute the reviewer's explicit resolution choice. Clones are the hardened
 * cloneRepo; use-existing adopts a path only after verifying it is a matching clone
 * under home; diff-only declines. A successful resolution is remembered per repo. */
export async function prepareCheckout(
  pr: string,
  action: PrepareAction,
  destination: string | undefined,
  deps: ResolutionDeps,
): Promise<PrepareResult> {
  const { owner, repo } = parsePrUrl(pr);
  const ownerRepo = `${owner}/${repo}`.toLowerCase(); // case-insensitive key, matching resolveCheckout

  switch (action) {
    case "diff-only": {
      return { status: "declined" };
    }
    case "clone-kvasir": {
      const target = path.join(deps.clonesDir, owner, repo);
      await cloneRepo(owner, repo, target, { run: deps.cloneRun, home: deps.home });
      deps.store.set(ownerRepo, target);
      return { status: "ready", path: target };
    }
    case "clone-dest": {
      if (!destination) throw new CloneError("clone-dest requires a destination path");
      await cloneRepo(owner, repo, destination, { run: deps.cloneRun, home: deps.home });
      deps.store.set(ownerRepo, destination);
      return { status: "ready", path: destination };
    }
    case "use-existing": {
      if (!destination) throw new CloneError("use-existing requires a path");
      if (!destinationPathShapeOk(destination, deps.home)) {
        throw new CloneError(
          `refusing to use ${destination}: must be an absolute path under your home directory`,
        );
      }
      if (!isUsableClone(destination, owner, repo, deps.probes)) {
        throw new CloneError(`${destination} is not a git clone of ${ownerRepo}`);
      }
      deps.store.set(ownerRepo, destination);
      return { status: "ready", path: destination };
    }
  }
}
