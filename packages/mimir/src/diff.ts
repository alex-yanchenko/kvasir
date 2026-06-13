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

/** A PR comment surfaced as context for the walkthrough. Three kinds: a general
 * discussion comment, a review's summary body, or an inline code comment (which
 * carries file + line). `bot` lets the author weigh automated reviewers. */
export interface DiscussionItem {
  kind: "comment" | "review" | "inline";
  author: string;
  bot: boolean;
  body: string;
  file?: string;
  line?: number | null;
  /** Review state for kind:"review" — APPROVED | CHANGES_REQUESTED | COMMENTED. */
  state?: string;
}

export interface PrManifest {
  owner: string;
  repo: string;
  number: number;
  title: string;
  /** The PR description (author intent/scope) — secondary to the code, ahead of comments. */
  description: string;
  headSha: string;
  files: ChangedFile[];
  /** Curated, non-outdated discussion (general + review + inline). Supplementary context. */
  discussion: DiscussionItem[];
}

// Caps so a big thread can't blow the model's context. We trim length, not by
// "importance" — which comments matter is the author's call when writing the spec.
const CAP_DESCRIPTION = 8000;
const CAP_ITEM = 800;
const CAP_TOTAL = 16_000;

const trim = (s: unknown, n: number): string => {
  const trimmed = typeof s === "string" ? s.trim() : "";
  return trimmed.length > n ? trimmed.slice(0, n) + "…" : trimmed;
};

interface RawUser {
  login?: string;
  type?: string;
}
const authorOf = (u: RawUser | null | undefined): { author: string; bot: boolean } => ({
  author: u?.login ?? "unknown",
  bot: u?.type === "Bot",
});

/** Merge the three comment sources into one time-ordered, capped list. Inline
 * comments whose anchor line no longer exists (position === null) are dropped as
 * outdated; everything else is kept, oldest trimmed first if we exceed the budget. */
type Dated = { at: string; item: DiscussionItem };

const commentItems = (issueComments: GhIssueComment[]): Dated[] => {
  const out: Dated[] = [];
  for (const c of issueComments) {
    if (!c.body?.trim()) continue;
    out.push({
      at: c.created_at ?? "",
      item: { kind: "comment", ...authorOf(c.user), body: trim(c.body, CAP_ITEM) },
    });
  }
  return out;
};

const reviewItems = (reviews: GhReview[]): Dated[] => {
  const out: Dated[] = [];
  for (const r of reviews) {
    if (!r.body?.trim()) continue; // a bare approve/request-changes carries no prose
    out.push({
      at: r.submitted_at ?? "",
      item: {
        kind: "review",
        ...authorOf(r.user),
        ...(r.state === undefined ? {} : { state: r.state }),
        body: trim(r.body, CAP_ITEM),
      },
    });
  }
  return out;
};

const inlineItems = (inlineComments: GhInline[]): Dated[] => {
  const out: Dated[] = [];
  for (const c of inlineComments) {
    if (c.position === null || c.position === undefined) continue; // outdated: anchor line is gone
    if (!c.body?.trim()) continue;
    out.push({
      at: c.created_at ?? "",
      item: {
        kind: "inline",
        ...authorOf(c.user),
        ...(c.path === undefined ? {} : { file: c.path }),
        line: c.line ?? c.original_line ?? null,
        body: trim(c.body, CAP_ITEM),
      },
    });
  }
  return out;
};

function buildDiscussion(
  issueComments: GhIssueComment[],
  reviews: GhReview[],
  inlineComments: GhInline[],
): DiscussionItem[] {
  const dated = [...commentItems(issueComments), ...reviewItems(reviews), ...inlineItems(inlineComments)];
  dated.sort((a, b) => a.at.localeCompare(b.at)); // oldest → newest
  let total = dated.reduce((n, d) => n + d.item.body.length, 0);
  while (total > CAP_TOTAL) {
    const dropped = dated.shift(); // drop the oldest until under budget
    if (!dropped) break;
    total -= dropped.item.body.length;
  }
  return dated.map((d) => d.item);
}

// Coverage gate: a changed file with at least this many added lines is expected
// to earn at least one walkthrough step. Generated/lockfile/vendored paths are
// exempt — they bulk up additions but aren't review material.
export const COVERAGE_MIN_ADDS = 30;
const SKIP_COVERAGE =
  /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|go\.sum)$|\.min\.(?:js|css)$|\.snap$|(?:^|\/)(?:dist|build|vendor|node_modules|__generated__)\//i;

/** Changed files that look like real review material (≥ COVERAGE_MIN_ADDS added
 * lines, not removed, not generated) but have no step covering them. Path match
 * is lenient at the boundary so a step's `file` can be a short or long variant.
 * Used to nudge the author once before publishing a walkthrough that skims a PR. */
export function uncoveredFiles(manifest: PrManifest, stepFiles: string[]): string[] {
  const covered = stepFiles.filter(Boolean);
  const isCovered = (path: string): boolean =>
    covered.some((c) => c === path || c.endsWith("/" + path) || path.endsWith("/" + c));
  return manifest.files
    .filter((f) => f.status !== "removed" && f.additions >= COVERAGE_MIN_ADDS && !SKIP_COVERAGE.test(f.path))
    .map((f) => f.path)
    .filter((p) => !isCovered(p));
}

// The gh-JSON shapes we read. Only the fields we use — gh returns much more.
interface GhPull {
  title: string;
  body?: string;
  head?: { sha?: string };
}
interface GhFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}
interface GhIssueComment {
  user?: RawUser;
  body?: string;
  created_at?: string;
}
interface GhReview {
  user?: RawUser;
  body?: string;
  state?: string;
  submitted_at?: string;
}
interface GhInline {
  user?: RawUser;
  body?: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
  position?: number | null;
  created_at?: string;
}

/** A `gh` subprocess exited non-zero — named so callers can discriminate it. */
class GhError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhError";
  }
}

/** Current head commit SHA of a PR (for detecting new pushes since a review). */
export async function getHeadSha(url: string): Promise<string> {
  const { owner, repo, number } = parsePrUrl(url);
  const pull = await ghJson<GhPull>(["api", `repos/${owner}/${repo}/pulls/${number}`]);
  return pull.head?.sha ?? "";
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
  const [pull, filesRaw, issueComments, reviews, inlineComments] = await Promise.all([
    ghJson<GhPull>(["api", `${base}/pulls/${number}`]),
    ghJson<GhFile[]>(["api", "--paginate", `${base}/pulls/${number}/files`]),
    ghJson<GhIssueComment[]>(["api", "--paginate", `${base}/issues/${number}/comments`]),
    ghJson<GhReview[]>(["api", "--paginate", `${base}/pulls/${number}/reviews`]),
    ghJson<GhInline[]>(["api", "--paginate", `${base}/pulls/${number}/comments`]),
  ]);

  const files: ChangedFile[] = filesRaw.map((f) => ({
    path: f.filename,
    anchor: anchorFor(f.filename),
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    ...(f.patch === undefined ? {} : { patch: f.patch }), // omit for binary/huge files
  }));

  return {
    owner,
    repo,
    number,
    title: pull.title,
    description: trim(pull.body, CAP_DESCRIPTION),
    headSha: pull.head?.sha ?? "",
    files,
    discussion: buildDiscussion(issueComments, reviews, inlineComments),
  };
}
