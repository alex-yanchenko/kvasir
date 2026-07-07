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

export class ContextWorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextWorktreeError";
  }
}

const SHA_RE = /^[0-9a-f]{7,40}$/i;

async function git(repo: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
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
function insideWorktreesDirectory(worktreePath: string, directory: string): boolean {
  const resolved = path.resolve(worktreePath);
  return resolved.startsWith(path.resolve(directory) + path.sep);
}

/** Materialize `sha` as a throwaway detached worktree of the clone at `repoPath`.
 * Fetches the commit only when missing, and only ever as a plain full fetch —
 * there is no code path that passes a shallow flag. Returns the worktree path. */
export async function prepareContextWorktree(
  repoPath: string,
  sha: string,
  directory = WORKTREES_DIR,
): Promise<string> {
  if (!SHA_RE.test(sha)) throw new ContextWorktreeError(`not a commit sha: ${sha}`);
  await git(repoPath, ["rev-parse", "--is-inside-work-tree"]).catch(() => {
    throw new ContextWorktreeError(`${repoPath} is not a git repository`);
  });
  const present = await git(repoPath, ["cat-file", "-e", `${sha}^{commit}`]).then(
    () => true,
    () => false,
  );
  if (!present) await git(repoPath, ["fetch", "origin", sha]);
  const target = path.join(directory, `${path.basename(repoPath)}-${sha}`);
  // A leftover from an interrupted prior run occupies the target — rebuild it so
  // prepare is idempotent instead of failing on "already exists".
  if (existsSync(target)) {
    await git(repoPath, ["worktree", "remove", "--force", target]).catch(() => {
      rmSync(target, { recursive: true, force: true });
    });
  }
  await git(repoPath, ["worktree", "add", "--detach", target, sha]);
  return target;
}

/** Remove a worktree created by prepareContextWorktree. Refuses any path that
 * isn't strictly inside the kvasir worktrees dir. */
export async function removeContextWorktree(
  repoPath: string,
  worktreePath: string,
  directory = WORKTREES_DIR,
): Promise<void> {
  if (!insideWorktreesDirectory(worktreePath, directory)) {
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
    try {
      if (repo === null) throw new ContextWorktreeError("no parent repo");
      await git(repo, ["worktree", "remove", "--force", worktree]);
    } catch {
      rmSync(worktree, { recursive: true, force: true }); // parent gone/refuses — reclaim the disk
    }
    removed.push(name);
  }
  return removed;
}
