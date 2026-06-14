/**
 * Review push logic, pure and testable: coerce + validate an incoming review
 * (object or JSON string, same wire caveat as specInput.ts) and build the GitHub
 * landing URL the user follows to open it. The bridge handlers do only the side
 * effects (assign id, stamp, store in the mailbox).
 */
import { type Review, ReviewSchema } from "@prw/runes";

export type ReviewInputResult = { ok: true; review: Review } | { ok: false; error: string };

export function parseReviewInput(raw: unknown): ReviewInputResult {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, error: "review arrived as a string but was not valid JSON" };
    }
  }
  const parsed = ReviewSchema.safeParse(value);
  if (parsed.success) return { ok: true, review: parsed.data };
  const error = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { ok: false, error };
}

/** The GitHub page the user follows to open a pushed review — step 1's code,
 * carrying `?prw=<id>` so the extension knows which review to pull. Falls back to
 * the repo root when the step has no ref to pin a blob link. */
export function reviewLandingUrl(review: Review): string {
  const step = review.steps[0]!; // ReviewSchema .min(1) guarantees a first step
  const { owner, name } = step.repo;
  const query = `?prw=${encodeURIComponent(review.id ?? "")}`;
  if (!step.ref) return `https://github.com/${owner}/${name}${query}`;
  const blob = `https://github.com/${owner}/${name}/blob/${step.ref}/${step.file}${query}`;
  return step.lines ? `${blob}#L${step.lines.start}-L${step.lines.end}` : blob;
}
