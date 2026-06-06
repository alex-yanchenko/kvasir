/**
 * PR data + diff helpers. All GitHub access goes through the `gh` CLI, so this
 * reuses whatever auth the user already has — no PAT, no token in config. That
 * mirrors how the example-watcher / example-watcher channels work.
 *
 * The one load-bearing trick: GitHub anchors each file's diff on the PR
 * "Files changed" page as `diff-<sha256(path)>`. Computing that locally lets us
 * both deep-link into the PR and (in the extension) scroll/highlight by element
 * id instead of brittle text matching.
 */

import { anchorFor, parsePrUrl } from "@prw/runes";

export interface ChangedFile {
  path: string;
  anchor: string;
  status: string;
  additions: number;
  deletions: number;
  /** Unified diff patch for just this file (may be undefined for huge/binary files). */
  patch?: string;
}

export interface PrManifest {
  owner: string;
  repo: string;
  number: number;
  title: string;
  headSha: string;
  files: ChangedFile[];
}

/** Current head commit SHA of a PR (for detecting new pushes since a review). */
export async function getHeadSha(url: string): Promise<string> {
  const { owner, repo, number } = parsePrUrl(url);
  const pull = JSON.parse(await gh(["api", `repos/${owner}/${repo}/pulls/${number}`]));
  return pull.head?.sha ?? "";
}

async function gh(args: string[]): Promise<string> {
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`gh ${args.join(" ")} failed (exit ${code}): ${err.trim() || out.trim()}`);
  }
  return out;
}

/**
 * Fetch the changed-files manifest for a PR via `gh api`. This is the starting
 * material Claude reads to author the walkthrough spec — paths, anchors, per-file
 * patches, and the head SHA (so the spec can be cached against the exact commit).
 */
export async function getManifest(url: string): Promise<PrManifest> {
  const { owner, repo, number } = parsePrUrl(url);

  const pull = JSON.parse(await gh(["api", `repos/${owner}/${repo}/pulls/${number}`]));
  const filesRaw = JSON.parse(
    await gh(["api", "--paginate", `repos/${owner}/${repo}/pulls/${number}/files`]),
  ) as Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>;

  const files: ChangedFile[] = filesRaw.map((f) => ({
    path: f.filename,
    anchor: anchorFor(f.filename),
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
  }));

  return {
    owner,
    repo,
    number,
    title: pull.title,
    headSha: pull.head?.sha ?? "",
    files,
  };
}
