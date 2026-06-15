/**
 * A "review" is a walkthrough NOT tied to a PR diff — it explains code that lives
 * in repo source files, possibly across SEVERAL repos (a full-stack explanation
 * an AI session researched). Each step locates real code by repo + ref + file +
 * line range; the extension navigates GitHub blob pages and lets GitHub's native
 * `#Lx-Ly` highlight do the rest. Distinct from spec.ts (PR-diff walkthrough);
 * shared by the mimir bridge (push/serve) and the extension (render).
 *
 * Schema-first: types are inferred from the zod schemas (z.infer) and isReview
 * validates against them, so the wire contract can't drift from its runtime check.
 */
import { z } from "zod";

export const RepoRefSchema = z.object({
  owner: z.string(),
  name: z.string(),
});

export const ReviewLinesSchema = z
  .object({
    start: z.number().int().positive(),
    end: z.number().int().positive(),
  })
  .refine(({ start, end }) => start <= end, { message: "start must be <= end" });

export const ReviewStepSchema = z.object({
  /** Stable id, e.g. "auth-guard". */
  id: z.string(),
  title: z.string(),
  /** Markdown explanation shown for the step. */
  body: z.string(),
  /** Optional deeper detail, revealed on expand. */
  detail: z.string().optional(),
  /** The repo this step's code lives in (steps may span repos). */
  repo: RepoRefSchema,
  /** Branch or commit sha to pin the blob link; absent → repo default branch. */
  ref: z.string().optional(),
  /** Repo-relative file path, e.g. "src/auth/guard.ts". */
  file: z.string(),
  /** New-side line range to highlight (GitHub `#L<start>-L<end>`). */
  lines: ReviewLinesSchema.optional(),
  /** Fallback highlight substrings if line ids aren't available. */
  highlight: z.array(z.string()).optional(),
  /** Quick follow-up questions for this step. */
  suggestions: z.array(z.string()).optional(),
});

export const ReviewSchema = z.object({
  version: z.literal(1),
  /** Mailbox key. Assigned by the server on push when absent. */
  id: z.string().optional(),
  title: z.string(),
  /** Where it came from (originating chat / note) — display only. */
  source: z.string().optional(),
  /** Stamped by the server on push. */
  generatedAt: z.string().optional(),
  steps: z.array(ReviewStepSchema).min(1),
});

export type RepoRef = z.infer<typeof RepoRefSchema>;
export type ReviewLines = z.infer<typeof ReviewLinesSchema>;
export type ReviewStep = z.infer<typeof ReviewStepSchema>;
export type Review = z.infer<typeof ReviewSchema>;

export function isReview(x: unknown): x is Review {
  return ReviewSchema.safeParse(x).success;
}

/** A history-list row: enough to tell reviews apart by their term (title) and to
 * reopen one (the landing url), without shipping every step. Produced by the
 * server's GET /reviews, consumed by the extension's Reviews tab. */
export const ReviewSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string().optional(),
  generatedAt: z.string().optional(),
  steps: z.number(),
  repos: z.array(z.string()),
  url: z.string(),
});
export type ReviewSummary = z.infer<typeof ReviewSummarySchema>;

export function isReviewSummaryList(x: unknown): x is ReviewSummary[] {
  return z.array(ReviewSummarySchema).safeParse(x).success;
}

/**
 * The GitHub page for a review step — its code on the blob view, carrying
 * `?prw=<reviewId>` so the extension knows which review it belongs to. Shared by
 * the server (landing link = step 0) and the extension (per-step navigation), so
 * the URL format has ONE definition. Falls back to the repo root when the step
 * has no ref to pin a blob link.
 */
export function stepBlobUrl(step: ReviewStep, reviewId?: string): string {
  const { owner, name } = step.repo;
  const query = `?prw=${encodeURIComponent(reviewId ?? "")}`;
  if (!step.ref) return `https://github.com/${owner}/${name}${query}`;
  // Encode each path segment (keep the slashes) so special chars survive — e.g. a
  // Next.js catch-all route `[...slug].ts` 404s on GitHub unless the brackets are
  // percent-encoded.
  const path = step.file
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const blob = `https://github.com/${owner}/${name}/blob/${step.ref}/${path}${query}`;
  return step.lines ? `${blob}#L${step.lines.start}-L${step.lines.end}` : blob;
}
