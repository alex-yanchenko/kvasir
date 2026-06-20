/**
 * Pure PR-manifest assembly: the transforms that turn raw `gh` JSON into the
 * PrManifest Claude reads to author a walkthrough. No subprocess, no IO — kept
 * separate from diff.ts (the `gh` shell) so this branchy logic (comment merging,
 * capping, coverage detection) is fully unit-tested and mutation-covered.
 */
import { anchorFor } from "@kvasir/runes";

interface ChangedFile {
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
  /** The PR author's login (gh `user.login`). */
  author: string;
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

// The gh-JSON input shapes we read. Only the fields we use — gh returns much more.
export interface GhPull {
  title: string;
  body?: string;
  head?: { sha?: string };
  user?: RawUser;
}
export interface GhFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}
export interface GhIssueComment {
  user?: RawUser;
  body?: string;
  created_at?: string;
}
export interface GhReview {
  user?: RawUser;
  body?: string;
  state?: string;
  submitted_at?: string;
}
export interface GhInline {
  user?: RawUser;
  body?: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
  position?: number | null;
  created_at?: string;
}

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

export function buildDiscussion(
  issueComments: GhIssueComment[],
  reviews: GhReview[],
  inlineComments: GhInline[],
): DiscussionItem[] {
  const dated = [...commentItems(issueComments), ...reviewItems(reviews), ...inlineItems(inlineComments)];
  dated.sort((a, b) => a.at.localeCompare(b.at)); // oldest → newest
  let total = dated.reduce((n, d) => n + d.item.body.length, 0);
  // total > CAP_TOTAL implies at least one item remains (an empty list sums to 0),
  // so shift() always yields one — drop the oldest until under budget.
  while (total > CAP_TOTAL) total -= dated.shift()!.item.body.length;
  return dated.map((d) => d.item);
}

// Coverage gate: a changed file with at least this many added lines is expected
// to earn at least one walkthrough step. Generated/lockfile/vendored paths are
// exempt — they bulk up additions but aren't review material. Test files are exempt
// too: a walkthrough explains the CHANGE; tests validate it (the author may still
// add a test step, but isn't required to — and requiring it forced a re-publish).
export const COVERAGE_MIN_ADDS = 30;
const GENERATED_PATH =
  /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|go\.sum)$|\.min\.(?:js|css)$|\.snap$|(?:^|\/)(?:dist|build|vendor|node_modules|__generated__)\//i;
const TEST_PATH = /\.(?:spec|test|unit)\.[jt]sx?$|\.e2e-spec\.[jt]sx?$|(?:^|\/)(?:tests?|__tests__|e2e)\//i;
/** A changed file the coverage gate ignores — generated/vendored noise or a test
 * file (tests validate the change; the walkthrough explains the change itself). */
const isExemptFromCoverage = (path: string): boolean => GENERATED_PATH.test(path) || TEST_PATH.test(path);

/** Changed files a walkthrough is expected to cover: ≥ COVERAGE_MIN_ADDS added
 * lines, not removed, not generated/test. start_walkthrough surfaces this list
 * UP FRONT so the author covers them on the first publish (no nudge round-trip). */
export function significantFiles(manifest: PrManifest): string[] {
  return manifest.files
    .filter(
      (f) => f.status !== "removed" && f.additions >= COVERAGE_MIN_ADDS && !isExemptFromCoverage(f.path),
    )
    .map((f) => f.path);
}

/** Significant files (above) that have no step covering them. Path match is lenient
 * at the boundary so a step's `file` can be a short or long variant. The publish-time
 * backstop for when the author skimmed the up-front list. */
export function uncoveredFiles(manifest: PrManifest, stepFiles: string[]): string[] {
  const covered = stepFiles.filter(Boolean);
  const isCovered = (path: string): boolean =>
    covered.some((c) => c === path || c.endsWith("/" + path) || path.endsWith("/" + c));
  return significantFiles(manifest).filter((path) => !isCovered(path));
}

/** The raw `gh` JSON pieces getManifest fetches, assembled into a PrManifest.
 * Pure: every field-mapping and fallback decision lives here, testable without
 * touching the `gh` subprocess. */
export function buildManifest(
  ids: { owner: string; repo: string; number: number },
  raw: {
    pull: GhPull;
    files: GhFile[];
    issueComments: GhIssueComment[];
    reviews: GhReview[];
    inlineComments: GhInline[];
  },
): PrManifest {
  const files: ChangedFile[] = raw.files.map((f) => ({
    path: f.filename,
    anchor: anchorFor(f.filename),
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    ...(f.patch === undefined ? {} : { patch: f.patch }), // omit for binary/huge files
  }));
  return {
    owner: ids.owner,
    repo: ids.repo,
    number: ids.number,
    title: raw.pull.title,
    author: raw.pull.user?.login ?? "unknown",
    description: trim(raw.pull.body, CAP_DESCRIPTION),
    headSha: raw.pull.head?.sha ?? "",
    files,
    discussion: buildDiscussion(raw.issueComments, raw.reviews, raw.inlineComments),
  };
}
