/**
 * The history-list contract: a row that tells one stored artifact apart and
 * carries enough to reopen it, without shipping every step. Two KINDS share the
 * shape: a `pr` walkthrough (a PR-bound diff tour, from spec.ts) and a `code`
 * walkthrough (a cross-repo authored explanation, from review.ts). The mimir
 * bridge produces these (GET /history); the extension's History tab consumes
 * them. UI labels them "PR Walkthroughs" / "Code Walkthroughs".
 *
 * Schema-first: the type is inferred from the zod schema and isEntrySummaryList
 * validates against it, so the wire contract can't drift from its runtime check.
 */
import { z } from "zod";

export const EntryKindSchema = z.enum(["pr", "code"]);
export type EntryKind = z.infer<typeof EntryKindSchema>;

export const EntrySummarySchema = z.object({
  kind: EntryKindSchema,
  /** pr: `owner/repo#number` (prKey); code: the review's slug-id. */
  id: z.string(),
  title: z.string(),
  /** Originating chat / note — display only (code walkthroughs). */
  source: z.string().optional(),
  /** Distinct `owner/name` repos the steps touch. */
  repos: z.array(z.string()),
  steps: z.number(),
  /** PR number (pr entries only) — for the "#123" badge in History. */
  prNumber: z.number().optional(),
  /** PR author login (pr entries only). */
  author: z.string().optional(),
  /** Where a row opens: pr -> `<pr.url>/files`; code -> the `?kvasir=` blob landing. */
  url: z.string(),
  /** Bumped by the store ONLY when the stored content changes — drives FE drift. */
  version: z.number(),
  /** Display "when" (ISO string). */
  generatedAt: z.string().optional(),
  /** Last changed-push, epoch ms — the store's newest-first sort key. */
  updatedAt: z.number(),
});
export type EntrySummary = z.infer<typeof EntrySummarySchema>;

export function isEntrySummaryList(x: unknown): x is EntrySummary[] {
  return z.array(EntrySummarySchema).safeParse(x).success;
}
