// Runs under `bun test` (NOT vitest) — Bun.spawn is Bun-only. Real-git integration
// for the heavy-pass worktree tools: prepare must materialize a commit WITHOUT ever
// grafting the clone (.git/shallow never appears), reuse a present commit with no
// fetch, refuse junk, and remove/gc must actually reclaim worktrees + registry.
import { existsSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  ContextWorktreeError,
  errorMessage,
  gcContextWorktrees,
  prepareContextWorktree,
  removeContextWorktree,
} from "./contextWorktree";

function git(cwd: string, args: string[]): string {
  const proc = Bun.spawnSync(["git", "-C", cwd, "-c", "user.email=t@test", "-c", "user.name=t", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new ContextWorktreeError(`fixture git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString().trim();
}

/** The error a promise rejected with, or null if it resolved — a typed stand-in
 * for `await expect().rejects` (whose bun-types signature isn't thenable). */
const rejection = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

let sandbox: string;
let origin: string;
let clone: string;
let worktrees: string;
let shaA: string;
let shaB: string;

beforeEach(async () => {
  sandbox = mkdtempSync(path.join(tmpdir(), "kvasir-cw-"));
  origin = path.join(sandbox, "origin");
  clone = path.join(sandbox, "clone");
  worktrees = path.join(sandbox, "wts");
  git(sandbox, ["init", "-b", "main", origin]);
  await Bun.write(path.join(origin, "a.txt"), "a\n");
  git(origin, ["add", "."]);
  git(origin, ["commit", "-m", "a"]);
  shaA = git(origin, ["rev-parse", "HEAD"]);
  git(sandbox, ["clone", origin, clone]);
  // a commit that lands in origin AFTER the clone — missing locally, fetchable
  await Bun.write(path.join(origin, "b.txt"), "b\n");
  git(origin, ["add", "."]);
  git(origin, ["commit", "-m", "b"]);
  shaB = git(origin, ["rev-parse", "HEAD"]);
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("prepareContextWorktree", () => {
  it("fetches a missing commit with a FULL fetch — the clone is never grafted", async () => {
    const wt = await prepareContextWorktree(clone, shaB, worktrees);
    expect(wt).toBe(path.join(worktrees, `clone-${shaB}`));
    expect(existsSync(path.join(clone, ".git", "shallow"))).toBe(false);
    expect(git(wt, ["rev-parse", "HEAD"])).toBe(shaB);
    expect(git(wt, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("HEAD"); // detached
  });

  it("reuses a commit that is already present without touching the network", async () => {
    rmSync(origin, { recursive: true, force: true }); // origin gone — a fetch would fail loudly
    const wt = await prepareContextWorktree(clone, shaA, worktrees);
    expect(git(wt, ["rev-parse", "HEAD"])).toBe(shaA);
  });

  it("a repeat prepare for the same sha REUSES the live worktree instead of destroying it", async () => {
    const first = await prepareContextWorktree(clone, shaB, worktrees);
    await Bun.write(path.join(first, "marker.txt"), "reading\n"); // a concurrent pass's state
    const second = await prepareContextWorktree(clone, shaB, worktrees);
    expect(second).toBe(first);
    expect(existsSync(path.join(first, "marker.txt"))).toBe(true); // not yanked from under a reader
    expect(git(second, ["rev-parse", "HEAD"])).toBe(shaB);
  });

  it("two truly concurrent prepares for the same sha both succeed on one worktree", async () => {
    const [first, second] = await Promise.all([
      prepareContextWorktree(clone, shaB, worktrees),
      prepareContextWorktree(clone, shaB, worktrees),
    ]);
    expect(second).toBe(first);
    expect(git(first, ["rev-parse", "HEAD"])).toBe(shaB);
  });

  it("recovers when a fallback rm left a stale registration behind (missing-but-registered)", async () => {
    const wt = await prepareContextWorktree(clone, shaB, worktrees);
    rmSync(wt, { recursive: true, force: true }); // what the rm fallback does: disk gone, registration stays
    const rebuilt = await prepareContextWorktree(clone, shaB, worktrees);
    expect(rebuilt).toBe(wt);
    expect(git(rebuilt, ["rev-parse", "HEAD"])).toBe(shaB);
  });

  it("rejects cleanly when the sha is missing AND origin is unreachable — no partial worktree", async () => {
    rmSync(origin, { recursive: true, force: true });
    expect(await rejection(prepareContextWorktree(clone, shaB, worktrees))).toBeInstanceOf(
      ContextWorktreeError,
    );
    expect(existsSync(path.join(worktrees, `clone-${shaB}`))).toBe(false);
  });

  it("refuses a non-sha and a non-repo path", async () => {
    expect(await rejection(prepareContextWorktree(clone, "main; rm -rf /", worktrees))).toBeInstanceOf(
      ContextWorktreeError,
    );
    expect(await rejection(prepareContextWorktree(sandbox, shaA, worktrees))).toBeInstanceOf(
      ContextWorktreeError,
    );
  });
});

describe("removeContextWorktree", () => {
  it("removes the worktree and its registration", async () => {
    const wt = await prepareContextWorktree(clone, shaB, worktrees);
    await removeContextWorktree(clone, wt, worktrees);
    expect(existsSync(wt)).toBe(false);
    expect(git(clone, ["worktree", "list"])).not.toContain(wt);
  });

  it("refuses any path outside the kvasir worktrees dir", async () => {
    expect(await rejection(removeContextWorktree(clone, clone, worktrees))).toBeInstanceOf(
      ContextWorktreeError,
    );
    expect(await rejection(removeContextWorktree(clone, worktrees, worktrees))).toBeInstanceOf(
      ContextWorktreeError,
    );
    expect(existsSync(path.join(clone, ".git"))).toBe(true); // the clone survived
  });
});

describe("gcContextWorktrees", () => {
  it("sweeps only stale worktrees, unregistering them from the parent repo", async () => {
    const fresh = await prepareContextWorktree(clone, shaB, worktrees);
    const stale = await prepareContextWorktree(clone, shaA, worktrees);
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(stale, old, old);
    const removed = await gcContextWorktrees(24 * 60 * 60 * 1000, worktrees);
    expect(removed).toEqual([`clone-${shaA}`]);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(git(clone, ["worktree", "list"])).not.toContain(stale);
  });

  it("reclaims a stale worktree whose parent repo is gone", async () => {
    const stale = await prepareContextWorktree(clone, shaA, worktrees);
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(stale, old, old);
    rmSync(clone, { recursive: true, force: true });
    expect(await gcContextWorktrees(24 * 60 * 60 * 1000, worktrees)).toEqual([`clone-${shaA}`]);
    expect(existsSync(stale)).toBe(false);
  });

  it("reclaims a stale worktree with an unreadable .git pointer", async () => {
    const stale = await prepareContextWorktree(clone, shaA, worktrees);
    rmSync(path.join(stale, ".git"), { force: true }); // corrupt FIRST — deleting bumps the dir mtime
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(stale, old, old);
    expect(await gcContextWorktrees(24 * 60 * 60 * 1000, worktrees)).toEqual([`clone-${shaA}`]);
    expect(existsSync(stale)).toBe(false);
  });

  it("skips a stray non-directory entry instead of crashing the sweep", async () => {
    await prepareContextWorktree(clone, shaA, worktrees); // ensures the dir exists
    await Bun.write(path.join(worktrees, "stray.txt"), "x");
    expect(await gcContextWorktrees(0, worktrees)).toEqual([`clone-${shaA}`]); // stray skipped, real one swept
    expect(existsSync(path.join(worktrees, "stray.txt"))).toBe(true);
  });

  it("is a no-op when the dir does not exist", async () => {
    expect(await gcContextWorktrees(0, path.join(sandbox, "absent"))).toEqual([]);
  });
});

describe("errorMessage", () => {
  it("extracts an Error's message and stringifies anything else", () => {
    expect(errorMessage(new ContextWorktreeError("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
  });
});
