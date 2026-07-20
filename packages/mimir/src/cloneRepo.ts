/**
 * The hardened clone for reviewer-authorized heavy-pass resolution. The reviewer
 * approves a repo + destination; this executes that clone as safely as possible.
 * The security-relevant decisions — the github.com-scoped command, the git
 * hardening flags/env, and the destination validation — are PURE functions
 * (cloneCommand, destinationPathShapeOk) so they are unit-tested exactly, not buried
 * in a process call the test runner can't spawn. Only the runner (Bun.spawn) is IO,
 * and it is injected, so the orchestration (single-flight, timeout, partial-cleanup)
 * is tested too.
 */
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { GIT_TERMINAL_PROMPT_OFF, gitHardeningFlags } from "./gitHardening";

/** A clone precondition failed (bad destination, bad owner/repo) or the clone
 * subprocess exited non-zero / timed out. Named so callers can discriminate it. */
export class CloneError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CloneError";
  }
}

/** A safe github.com owner/repo segment: GitHub's charset, no bare `.`/`..`, and no
 * leading `-` (a value starting with `-` sits un-`--`-separated in the `gh repo clone`
 * argv and could be re-parsed as a flag — CWE-88). Stricter than prUrl's charset check
 * on purpose, so this module refuses a malformed segment even if called directly. */
export const isGhSegment = (segment: string): boolean =>
  /^[\w.-]+$/.test(segment) && !segment.startsWith("-") && segment !== "." && segment !== "..";

/** Any Unicode control character — barred from a destination path so a newline in a
 * segment can't inject lines into the heavy-pass prompt the resolved path is
 * interpolated into. (`\p{Cc}` = the C0/C1/DEL control category.) */
const CONTROL_CHARS = /\p{Cc}/u;

/** Runs the clone argv with the given env under an abort signal; resolves the exit
 * code + captured stderr. Injected so the Bun.spawn IO stays out of the tested
 * logic; channel.ts supplies the real one. */
export type CloneRunner = (
  cmd: readonly string[],
  env: Record<string, string>,
  signal: AbortSignal,
) => Promise<{ code: number; stderr: string }>;

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** One git invocation of a clone: the argv and the env it runs under. Shared by the gh
 * clone (one step) and the local adoption (clone + origin reset). */
export interface CloneStep {
  cmd: readonly string[];
  env: Record<string, string>;
}

/** The exact clone command + env. github.com-scoped via `gh repo clone <owner>/<repo>`
 * (reuses the user's `gh` auth for private repos, never a client-supplied URL); a
 * blobless (not shallow — blame-safe) full-graph clone with submodules off; git's
 * file/ext transports disabled and the terminal prompt suppressed via env so the
 * config applies to every git process gh spawns. Throws on a malformed owner/repo. */
export function cloneCommand(owner: string, repo: string, destination: string): CloneStep {
  if (!isGhSegment(owner) || !isGhSegment(repo)) {
    throw new CloneError(`refusing to clone: invalid owner/repo "${owner}/${repo}"`);
  }
  return {
    cmd: [
      "gh",
      "repo",
      "clone",
      `${owner}/${repo}`,
      destination,
      "--",
      "--filter=blob:none",
      "--no-recurse-submodules",
    ],
    env: {
      ...GIT_TERMINAL_PROMPT_OFF,
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "protocol.file.allow",
      GIT_CONFIG_VALUE_0: "never",
      GIT_CONFIG_KEY_1: "protocol.ext.allow",
      GIT_CONFIG_VALUE_1: "never",
    },
  };
}

/** The two-step LOCAL adoption clone: copy a reviewer's existing checkout into the
 * server clones dir via `git clone --local` (hardlinks local objects — near-instant, no
 * re-download; git objects are immutable + content-addressed, so sharing inodes with the
 * source is safe), then reset origin to the canonical github URL. The clone writes a
 * FRESH config, so the source repo's exec keys and named filters are left behind (see
 * gitHardening) — this is what makes adopting an otherwise-untrusted checkout safe.
 * `--local` rides git's `file` transport, so — unlike the gh clone — protocol.file is
 * left at its default (`user`, which permits a direct top-level local clone while still
 * blocking the submodule-recursion file transport of CVE-2022-39253). The origin is
 * server-constructed from the validated owner/repo, never the foreign origin string, so
 * later fetches of a missing sha go to github, not back to the untrusted local path.
 * Throws on a malformed owner/repo or an unsafe source path. */
export function localCloneCommand(
  owner: string,
  repo: string,
  source: string,
  destination: string,
): CloneStep[] {
  if (!isGhSegment(owner) || !isGhSegment(repo)) {
    throw new CloneError(`refusing to adopt: invalid owner/repo "${owner}/${repo}"`);
  }
  if (!checkoutPathSafe(source)) {
    throw new CloneError(`refusing to adopt ${source}: must be an absolute path with no control characters`);
  }
  const flags = gitHardeningFlags();
  const env = { ...GIT_TERMINAL_PROMPT_OFF };
  return [
    { cmd: ["git", ...flags, "clone", "--local", source, destination], env },
    {
      cmd: [
        "git",
        ...flags,
        "-C",
        destination,
        "remote",
        "set-url",
        "origin",
        `https://github.com/${owner}/${repo}.git`,
      ],
      env,
    },
  ];
}

/** The destination is shaped safely: an absolute path under `home`, with no control
 * characters and no '.'/'..'/empty segments. (Symlink/existence/emptiness — and the
 * ancestor-symlink escape — are runtime fs checks in cloneRepo; this is the pure
 * path-shape half.) */
export function destinationPathShapeOk(destination: string, home: string): boolean {
  if (CONTROL_CHARS.test(destination)) return false;
  if (!path.isAbsolute(destination)) return false;
  const resolvedHome = path.resolve(home);
  const resolved = path.resolve(destination);
  if (resolved !== resolvedHome && !resolved.startsWith(resolvedHome + path.sep)) return false;
  // Reject any '.'/'..'/empty segment in the INPUT (a resolved path has none, but we
  // refuse a traversal attempt loudly rather than silently normalize it away).
  return destination
    .split(path.sep)
    .slice(1) // drop the leading "" from an absolute path's root
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** A reviewer-supplied path safe to accept without the full write-target guard:
 * absolute and control-char free (it is interpolated into the heavy-pass prompt).
 * Weaker than destinationPathShapeOk — NO under-$HOME requirement — used where the
 * trust comes from elsewhere: adopting an EXISTING clone (origin-match) or setting a
 * default clones root (isDir). A clone WRITE target still uses the full
 * destinationPathShapeOk + ancestor guard. */
export function checkoutPathSafe(candidate: string): boolean {
  return !CONTROL_CHARS.test(candidate) && path.isAbsolute(candidate);
}

/** The nearest ancestor of `target` that exists on disk (walking up until one does).
 * The loop terminates because the filesystem root always exists. */
function nearestExistingAncestor(target: string): string {
  let directory = target;
  while (!existsSync(directory)) directory = path.dirname(directory);
  return directory;
}

/** True when the destination's nearest existing ancestor, with symlinks resolved,
 * still sits under `home` — closes the ancestor-symlink escape that the lexical
 * destinationPathShapeOk can't see (an existing `~/escape -> /tmp` would otherwise
 * let a clone land outside home). */
function ancestorStaysUnderHome(destination: string, home: string): boolean {
  // realpath BOTH sides — home itself may sit under a symlinked prefix (e.g. macOS
  // /var -> /private/var), so comparing a resolved ancestor to a lexical home would
  // spuriously reject every path.
  const realHome = realpathSync(home);
  const realAncestor = realpathSync(nearestExistingAncestor(destination));
  return realAncestor === realHome || realAncestor.startsWith(realHome + path.sep);
}

/** In-flight clones keyed by destination: a concurrent call for the same destination
 * joins the first instead of racing on the directory. */
const inFlight = new Map<string, Promise<string>>();

/**
 * Clone `owner/repo` into `destination` safely, returning it. With no `source`, this is
 * a github clone via `gh` (cloneCommand); with a `source`, it ADOPTS that existing local
 * checkout via a local clone + origin reset (localCloneCommand). Validates the
 * destination (shape + ancestor stays under home + not a symlink + empty-or-absent) and,
 * for an adoption, the source (absolute/control-char-free + a real directory);
 * single-flights concurrent calls, enforces a timeout, and removes any partial checkout
 * on failure so a half-clone is never left behind. Throws CloneError on any precondition
 * or subprocess failure.
 */
export async function cloneRepo(
  owner: string,
  repo: string,
  destination: string,
  options: { run: CloneRunner; home: string; timeoutMs?: number; source?: string },
): Promise<string> {
  const { home } = options;
  if (!destinationPathShapeOk(destination, home)) {
    throw new CloneError(
      `refusing to clone into ${destination}: it must be an absolute path under your home directory with no '.'/'..' segments`,
    );
  }
  if (!ancestorStaysUnderHome(destination, home)) {
    throw new CloneError(
      `refusing to clone into ${destination}: an ancestor directory escapes your home directory`,
    );
  }
  if (options.source !== undefined) {
    if (!checkoutPathSafe(options.source)) {
      throw new CloneError(
        `refusing to adopt ${options.source}: must be an absolute path with no control characters`,
      );
    }
    if (!existsSync(options.source) || !statSync(options.source).isDirectory()) {
      throw new CloneError(`refusing to adopt ${options.source}: it is not a directory`);
    }
  }
  if (existsSync(destination)) {
    const stat = lstatSync(destination); // lstat: never follow a symlink at the destination itself
    if (stat.isSymbolicLink()) throw new CloneError(`refusing to clone into ${destination}: it is a symlink`);
    if (!stat.isDirectory())
      throw new CloneError(`refusing to clone into ${destination}: it is not a directory`);
    if (readdirSync(destination).length > 0) {
      throw new CloneError(`refusing to clone into ${destination}: it is not empty`);
    }
  }
  const pending = inFlight.get(destination);
  if (pending) return pending;
  const job = runClone(
    owner,
    repo,
    destination,
    options.source,
    options.run,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  ).finally(() => inFlight.delete(destination));
  inFlight.set(destination, job);
  return job;
}

async function runClone(
  owner: string,
  repo: string,
  destination: string,
  source: string | undefined,
  run: CloneRunner,
  timeoutMs: number,
): Promise<string> {
  // Both builders throw on a bad owner/repo before any IO; the local one runs two steps
  // (clone, then origin reset), the gh one a single step.
  const steps =
    source === undefined
      ? [cloneCommand(owner, repo, destination)]
      : localCloneCommand(owner, repo, source, destination);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (const { cmd, env } of steps) {
      const { code, stderr } = await run(cmd, env, controller.signal);
      if (code !== 0) {
        throw new CloneError(
          `clone of ${owner}/${repo} failed (exit ${code}): ${stderr.trim().slice(0, 500)}`,
        );
      }
    }
    return destination;
  } catch (error) {
    // Any failure — non-zero exit, timeout/abort, or a runner error — must not leave a
    // half-written checkout; reclaim the disk, then surface a typed error carrying the
    // real reason (so a missing `gh` / timeout / permission failure reads accurately).
    rmSync(destination, { recursive: true, force: true });
    if (error instanceof CloneError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new CloneError(`clone of ${owner}/${repo} did not complete: ${reason}`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}
