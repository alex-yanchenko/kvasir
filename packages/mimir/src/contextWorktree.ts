// Deterministic git operations for the heavy pass. The authoring agent calls the
// prepare/remove MCP tools instead of running git itself, so the two ways it has
// damaged user repos are impossible by construction: every fetch here is a plain
// FULL fetch (a shallow fetch grafts the clone — writes .git/shallow — and
// silently breaks git blame/log past the boundary), and worktree cleanup is code
// (tool + boot GC), not agent discretion. Bun-only (Bun.spawn); verified by
// contextWorktree.buntest.ts under `bun test`.
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const WORKTREES_DIR = path.join(homedir(), ".kvasir", "worktrees");

/** A worktree-tool precondition failed (bad sha, not a git repo, a path outside
 * the worktrees dir) or the underlying git subprocess exited non-zero — named so
 * channel.ts's tool handlers can discriminate it when building the caller-facing
 * failure text. */
export class ContextWorktreeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ContextWorktreeError";
  }
}

/** The message a tool handler should surface for any thrown value. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const SHA_RE = /^[0-9a-f]{7,40}$/i;

// Applied to EVERY git invocation against a heavy-pass checkout — a repo the reviewer
// ADOPTED (use-existing / a default root) can carry an attacker-authored .git/config +
// hooks, and git runs configured commands during ordinary operations (a post-checkout
// hook fires on `worktree add`, fsmonitor is a spawned command). Command-line -c is
// git's highest-precedence config, so it overrides the repo's own values and
// neutralizes these automatic-execution vectors. The malicious-transport vector
// (file://, ext::) is already closed upstream: an adopted clone is only accepted when
// its `origin` matches github.com/<owner>/<repo> (isUsableClone/originMatches), and the
// fetch remote is that same origin — so no protocol.* restriction is needed here (and
// forcing it would break a legitimate local-mirror origin). Residual: clean/smudge/
// process filters are keyed by driver name and can't be blanket-disabled via -c;
// origin-match + explicit reviewer authorization remain the primary trust signals.
const GIT_HARDENING = [
  "-c",
  "core.hooksPath=/dev/null", // no hook execution (post-checkout et al.)
  "-c",
  "core.fsmonitor=false", // no fsmonitor command execution
];

async function git(repo: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...GIT_HARDENING, "-C", repo, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const out = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) {
    throw new ContextWorktreeError(
      `git ${args.join(" ")} failed (exit ${code}): ${error.trim() || out.trim()}`,
    );
  }
  return out.trim();
}

/** True when `worktreePath` resolves strictly INSIDE the worktrees directory —
 * never the directory itself, never anything outside it. The one guard between
 * "remove a kvasir worktree" and "remove an arbitrary directory the agent named". */
function isInsideWorktreesDirectory(worktreePath: string, directory: string): boolean {
  const resolved = path.resolve(worktreePath);
  return resolved.startsWith(path.resolve(directory) + path.sep);
}

/** In-flight prepares keyed by target path: a concurrent call for the same
 * repo+sha joins the first instead of racing it on the shared directory. */
const inFlight = new Map<string, Promise<string>>();

/** Materialize `sha` as a throwaway detached worktree of the clone at `repoPath`.
 * Fetches the commit only when missing, and only ever as a plain full fetch —
 * there is no code path that passes a shallow flag. Returns the worktree path. */
export async function prepareContextWorktree(
  repoPath: string,
  sha: string,
  directory = WORKTREES_DIR,
): Promise<string> {
  if (!SHA_RE.test(sha)) throw new ContextWorktreeError(`not a commit sha: ${sha}`);
  const target = path.join(directory, `${path.basename(repoPath)}-${sha}`);
  const pending = inFlight.get(target);
  if (pending) return pending;
  const job = materialize(repoPath, sha, target).finally(() => inFlight.delete(target));
  inFlight.set(target, job);
  return job;
}

/** The remote to fetch a missing commit from: origin when the clone has one,
 * else its first remote — a rename (origin -> upstream) must not strand the
 * heavy pass. No remote at all is its own error; git's would blame "origin". */
async function fetchRemote(repoPath: string, sha: string): Promise<string> {
  const listed = await git(repoPath, ["remote"]);
  const remotes = listed.split("\n").filter(Boolean);
  const remote = remotes.includes("origin") ? "origin" : remotes[0];
  if (remote === undefined) {
    throw new ContextWorktreeError(
      `commit ${sha} is not in ${repoPath}, and the clone has no remote to fetch it from`,
    );
  }
  return remote;
}

async function materialize(repoPath: string, sha: string, target: string): Promise<string> {
  await git(repoPath, ["rev-parse", "--is-inside-work-tree"]).catch((error: unknown) => {
    throw new ContextWorktreeError(`${repoPath} is not a usable git repository`, { cause: error });
  });
  const present = await git(repoPath, ["cat-file", "-e", `${sha}^{commit}`]).then(
    () => true,
    () => false,
  );
  if (!present) await git(repoPath, ["fetch", await fetchRemote(repoPath, sha), sha]);
  if (existsSync(target)) {
    // Already materialized at the right sha (a sibling pass, or a clean leftover) —
    // reuse it; a remove+re-add here would yank files out from under a live reader.
    const head = await git(target, ["rev-parse", "HEAD"]).catch(() => null);
    if (head !== null && head.toLowerCase().startsWith(sha.toLowerCase())) return target;
    await git(repoPath, ["worktree", "remove", "--force", target]).catch(async () => {
      rmSync(target, { recursive: true, force: true });
      await git(repoPath, ["worktree", "prune"]).catch(() => {});
    });
  }
  // --force: a fallback rm (here, in gc, or an interrupted run) can leave the path
  // registered in the parent repo while gone from disk, and a plain `worktree add`
  // then refuses forever ("missing but already registered") — --force re-registers.
  await git(repoPath, ["worktree", "add", "--force", "--detach", target, sha]);
  return target;
}

/** Remove a worktree created by prepareContextWorktree. Refuses any path that
 * isn't strictly inside the kvasir worktrees dir. */
export async function removeContextWorktree(
  repoPath: string,
  worktreePath: string,
  directory = WORKTREES_DIR,
): Promise<void> {
  if (!isInsideWorktreesDirectory(worktreePath, directory)) {
    throw new ContextWorktreeError(`refusing to remove ${worktreePath}: not under ${directory}`);
  }
  await git(repoPath, ["worktree", "remove", "--force", path.resolve(worktreePath)]);
}

/** Boot-time sweep: remove worktrees older than `maxAgeMs`, unregistering each
 * from its parent repo (found via the worktree's `.git` pointer file). A pass
 * that died before its remove_context_worktree call must not leak forever.
 * Returns the swept directory names. */
export async function gcContextWorktrees(
  maxAgeMs = 24 * 60 * 60 * 1000,
  directory = WORKTREES_DIR,
): Promise<string[]> {
  if (!existsSync(directory)) return [];
  const removed: string[] = [];
  for (const name of readdirSync(directory)) {
    const worktree = path.join(directory, name);
    let stats;
    try {
      stats = statSync(worktree);
    } catch {
      continue;
    }
    if (!stats.isDirectory() || Date.now() - stats.mtimeMs < maxAgeMs) continue;
    // The worktree's .git is a pointer file: "gitdir: <repo>/.git/worktrees/<name>"
    // — the one place the parent repo's path is recoverable from.
    let repo: string | null = null;
    try {
      const pointer = readFileSync(path.join(worktree, ".git"), "utf8");
      repo = /^gitdir: (.+)\/\.git\/worktrees\//m.exec(pointer)?.[1] ?? null;
    } catch {
      repo = null; // pointer unreadable — fall through to the plain rm below
    }
    if (repo === null) {
      rmSync(worktree, { recursive: true, force: true }); // parent unknown — reclaim the disk
    } else {
      await git(repo, ["worktree", "remove", "--force", worktree]).catch(async () => {
        // Parent gone or refusing: reclaim the disk, then best-effort prune the
        // parent's now-stale registration so a future add at this path isn't blocked.
        rmSync(worktree, { recursive: true, force: true });
        await git(repo, ["worktree", "prune"]).catch(() => {});
      });
    }
    removed.push(name);
  }
  return removed;
}
