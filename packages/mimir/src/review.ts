/**
 * Review push logic, pure and testable: coerce + validate an incoming review
 * (object or JSON string, same wire caveat as specInput.ts) and build the GitHub
 * landing URL the user follows to open it. The bridge handlers do only the side
 * effects (assign id, stamp, store in the mailbox).
 */
import { type Review, ReviewSchema, stepBlobUrl } from "@kvasir/runes";

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
 * carrying `?kvasir=<id>`. The URL format lives in @kvasir/runes (shared with the
 * extension's per-step navigation). */
export function reviewLandingUrl(review: Review): string {
  return stepBlobUrl(review.steps[0]!, review.id); // ReviewSchema .min(1) guarantees a first step
}
