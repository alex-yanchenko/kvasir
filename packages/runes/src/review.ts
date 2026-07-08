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
import { LINE_RANGE_FIELDS, noTraversal, ORDERED_RANGE_MESSAGE, orderedRange, StepCoreSchema } from "./step";

// owner/name interpolate raw into the github.com blob URL, so constrain them to
// GitHub's charset and reject "."/".." — otherwise a value like "a/../../evil" or
// ".." would path-traverse the URL to a DIFFERENT repo (a cross-repo phishing
// redirect). Mirrors the guard parsePrUrl already applies to PR URLs.
const ghName = z
  .string()
  .regex(/^[\w.-]+$/, "invalid GitHub owner/name")
  .refine((s) => s !== "." && s !== "..", "owner/name must not be '.' or '..'");

export const RepoRefSchema = z.object({
  owner: ghName,
  name: ghName,
});

export const ReviewLinesSchema = z.object(LINE_RANGE_FIELDS).refine(orderedRange, ORDERED_RANGE_MESSAGE);

/** The shared step core (see ./step) + the blob locator: this artifact's steps
 * live on plain GitHub blob pages, located by repo + ref, possibly across repos.
 * The core's `file` is already traversal-guarded for the blob URL it lands in. */
export const ReviewStepSchema = StepCoreSchema.extend({
  /** The repo this step's code lives in (steps may span repos). */
  repo: RepoRefSchema,
  /** Branch or commit sha to pin the blob link; absent → repo default branch. */
  ref: z
    .string()
    .regex(/^\w[\w./-]*$/, "invalid ref")
    .refine(noTraversal, "ref must not traverse")
    .optional(),
  /** New-side line range to highlight (GitHub `#L<start>-L<end>`). */
  lines: ReviewLinesSchema.optional(),
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

/**
 * The GitHub page for a review step — its code on the blob view, carrying
 * `?kvasir=<reviewId>` so the extension knows which review it belongs to. Shared by
 * the server (landing link = step 0) and the extension (per-step navigation), so
 * the URL format has ONE definition. Falls back to the repo root when the step
 * has no ref to pin a blob link.
 */
export function stepBlobUrl(step: ReviewStep, reviewId?: string): string {
  const { owner, name } = step.repo;
  const query = `?kvasir=${encodeURIComponent(reviewId ?? "")}`;
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
