/**
 * The `gh` subprocess shell for PR data. All GitHub access goes through the `gh`
 * CLI, so this reuses whatever auth the user already has — no PAT, no token in
 * config.
 *
 * This file is the IO boundary only: spawn `gh`, parse its JSON, hand the raw
 * pieces to buildManifest (manifest.ts) for the pure assembly. The anchor trick
 * and all field mapping live there; keeping them apart lets the transforms be
 * fully unit-tested while this thin shell stays subprocess-bound.
 */
import { parsePrUrl } from "@kvasir/runes";
import {
  buildManifest,
  type GhFile,
  type GhInline,
  type GhIssueComment,
  type GhPull,
  type GhReview,
  type PrManifest,
} from "./manifest";

/** A `gh` subprocess exited non-zero — named so callers can discriminate it. */
class GhError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhError";
  }
}

async function gh(args: string[]): Promise<string> {
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) {
    throw new GhError(`gh ${args.join(" ")} failed (exit ${code}): ${error.trim() || out.trim()}`);
  }
  return out;
}

// Parse a gh response to a known shape. Typing the external IO boundary here (like
// a projected .lean<T>() read) keeps the unsafe-any out of the rest of the module.
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- trusted gh subprocess JSON; the generic documents the expected shape, and downstream guards validate what's actually used.
const ghJson = async <T>(args: string[]): Promise<T> => JSON.parse(await gh(args)) as T;

/** Current head commit SHA of a PR (for detecting new pushes since a review). */
export async function getHeadSha(url: string): Promise<string> {
  const { owner, repo, number } = parsePrUrl(url);
  const pull = await ghJson<GhPull>(["api", `repos/${owner}/${repo}/pulls/${number}`]);
  return pull.head?.sha ?? "";
}

/**
 * Fetch the changed-files manifest for a PR via `gh api`. This is the starting
 * material Claude reads to author the walkthrough spec — paths, anchors, per-file
 * patches, and the head SHA (so the spec can be cached against the exact commit).
 */
export async function getManifest(url: string): Promise<PrManifest> {
  const { owner, repo, number } = parsePrUrl(url);
  const base = `repos/${owner}/${repo}`;

  // Fetch in parallel: the pull (title/body/head), the files, and the three
  // comment sources. The diff is the substance; description + discussion are the
  // context the author weighs when writing the spec (see channel instructions).
  const [pull, files, issueComments, reviews, inlineComments] = await Promise.all([
    ghJson<GhPull>(["api", `${base}/pulls/${number}`]),
    ghJson<GhFile[]>(["api", "--paginate", `${base}/pulls/${number}/files`]),
    ghJson<GhIssueComment[]>(["api", "--paginate", `${base}/issues/${number}/comments`]),
    ghJson<GhReview[]>(["api", "--paginate", `${base}/pulls/${number}/reviews`]),
    ghJson<GhInline[]>(["api", "--paginate", `${base}/pulls/${number}/comments`]),
  ]);

  return buildManifest({ owner, repo, number }, { pull, files, issueComments, reviews, inlineComments });
}
