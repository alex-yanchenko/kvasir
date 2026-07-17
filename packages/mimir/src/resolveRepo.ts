/**
 * Pure repo-resolution decision for the heavy pass: given the server-owned clones
 * directory, an optional saved path (from the resolved_repos cache), and injected
 * fs/git probes, decide whether a usable local checkout of `owner/repo` is `ready`
 * (and where) or `absent`. No IO here — the caller (bridge /resolve) supplies the
 * probes and persists/drops the saved entry, so this branchy logic is unit-tested.
 *
 * Invariant: a path is only "ready" if it is a git repo whose `origin` actually
 * points at `github.com/<owner>/<repo>` — a stale or mismatched directory is never
 * trusted, so a hostile/wrong checkout can't be silently fed to the authoring pass.
 */
import path from "node:path";

/** A resolved, usable checkout at `path`. Shared by ResolveResult and prepareCheckout's
 * PrepareResult, which each add a different second arm. */
export type Ready = { status: "ready"; path: string };
export type ResolveResult = Ready | { status: "absent" };

export interface RepoProbes {
  /** True if `path` exists and is a directory. */
  isDir(path: string): boolean;
  /** The repo's `origin` remote URL, or null if `path` isn't a git repo / has no
   * origin. Only a remote literally named `origin` is consulted — a clone whose
   * primary remote was renamed won't validate (acceptable: `gh`/`git clone` name it
   * `origin` by default). */
  originOf(path: string): string | null;
}

// owner/repo out of any github.com origin form: https[+.git], scp-style
// git@github.com:owner/repo[.git], and ssh://git@github.com/owner/repo[.git].
// Anchored to the github.com host so a lookalike path segment (evil.com/github.com/…)
// can't match. Owner/repo use GitHub's charset; the trailing .git is optional.
const GITHUB_ORIGIN = /^(?:https:\/\/|ssh:\/\/git@|git@)github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

/** Does `origin` identify github.com/<owner>/<repo> (any scheme, optional .git)?
 * Case-insensitive on owner/repo, since GitHub treats them so. */
export function originMatches(origin: string, owner: string, repo: string): boolean {
  const match = GITHUB_ORIGIN.exec(origin.trim());
  if (!match) return false;
  return match[1]?.toLowerCase() === owner.toLowerCase() && match[2]?.toLowerCase() === repo.toLowerCase();
}

/** A directory usable as this PR's checkout: it exists and its git origin matches
 * the exact `owner/repo`. Shared by the clones-path and saved-path checks, and by
 * prepareCheckout's "use-existing" validation. */
export function isUsableClone(candidate: string, owner: string, repo: string, probes: RepoProbes): boolean {
  if (!probes.isDir(candidate)) return false;
  const origin = probes.originOf(candidate);
  return origin !== null && originMatches(origin, owner, repo);
}

/**
 * Resolve `owner/repo` to a ready checkout or absent, assuming no config:
 * the server-owned `<clonesDir>/<owner>/<repo>` wins if usable; else a saved path
 * (re-validated) wins; else absent. The caller drops the saved entry when the
 * result is absent and a saved path was supplied (it failed re-validation).
 */
export function resolveRepo(
  owner: string,
  repo: string,
  options: { clonesDir: string; savedPath: string | null; probes: RepoProbes },
): ResolveResult {
  const clonesPath = path.join(options.clonesDir, owner, repo);
  if (isUsableClone(clonesPath, owner, repo, options.probes)) return { status: "ready", path: clonesPath };
  if (options.savedPath && isUsableClone(options.savedPath, owner, repo, options.probes)) {
    return { status: "ready", path: options.savedPath };
  }
  return { status: "absent" };
}
