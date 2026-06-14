/**
 * Deterministic review assembly — the verifiable half of authoring a review,
 * split from the model's judgment. The model supplies WHICH file + a verbatim
 * snippet it read (the locator) + the prose; these pure functions turn that into
 * a validated ReviewStep with REAL repo/ref/lines. No guessing: a bad path or a
 * snippet that isn't in the file is a hard error, so blob links can't 404.
 *
 * IO (git, fetch) lives in scripts/build-review.ts; everything here is pure and
 * unit-tested.
 */
import { type ReviewStep } from "@prw/runes/review";
import { z } from "zod";

export class ReviewBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewBuildError";
  }
}

// A step locates code either by a verbatim snippet the model read (preferred —
// `from`, optional `to` for a range) or by explicit line numbers.
const LocatorSchema = z.union([
  z.object({ from: z.string(), to: z.string().optional() }),
  z.object({ lines: z.object({ start: z.number(), end: z.number() }) }),
]);
const DraftStepSchema = z.object({
  repoDir: z.string(),
  file: z.string(),
  locator: LocatorSchema,
  title: z.string(),
  body: z.string(),
  detail: z.string().optional(),
  highlight: z.array(z.string()).optional(),
  suggestions: z.array(z.string()).optional(),
  id: z.string().optional(),
});
export const DraftSchema = z.object({
  title: z.string(),
  source: z.string().optional(),
  steps: z.array(DraftStepSchema).min(1),
});
export type DraftStep = z.infer<typeof DraftStepSchema>;
type Locator = z.infer<typeof LocatorSchema>;

/** Parse `owner/name` from a git remote (ssh `git@github.com:o/n.git` or https). */
export function repoSlug(remote: string): { owner: string; name: string } {
  const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(remote.trim());
  if (!match) throw new ReviewBuildError(`cannot parse a GitHub owner/name from remote: ${remote.trim()}`);
  return { owner: match[1]!, name: match[2]! };
}

/** Resolve a locator to 1-based line numbers against the file content. A verbatim
 * `from`/`to` is grepped (first occurrence; `to` searched at or after `from`);
 * explicit `lines` pass through. A snippet that isn't present is a hard error. */
export function lineRange(content: string, locator: Locator): { start: number; end: number } {
  if ("lines" in locator) return locator.lines;
  const lines = content.split("\n");
  const startIndex = lines.findIndex((line) => line.includes(locator.from));
  if (startIndex === -1) {
    throw new ReviewBuildError(`locator.from not found in file: ${JSON.stringify(locator.from)}`);
  }
  if (locator.to === undefined) return { start: startIndex + 1, end: startIndex + 1 };
  const to = locator.to; // capture so the narrowing survives into the closure
  const relativeEnd = lines.slice(startIndex).findIndex((line) => line.includes(to));
  if (relativeEnd === -1) {
    throw new ReviewBuildError(`locator.to not found at or after locator.from: ${JSON.stringify(locator.to)}`);
  }
  return { start: startIndex + 1, end: startIndex + 1 + relativeEnd };
}

export const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "") || "step";

/** Everything the IO layer resolves for a step's repo (git remote, head sha, the
 * file content at that sha). */
export interface RepoContext {
  remote: string;
  sha: string;
  content: string;
}

/** Turn one draft step + its resolved repo context into a validated ReviewStep. */
export function resolveStep(step: DraftStep, context: RepoContext, index: number): ReviewStep {
  return {
    id: step.id ?? `${slugify(step.title)}-${index + 1}`,
    title: step.title,
    body: step.body,
    ...(step.detail === undefined ? {} : { detail: step.detail }),
    repo: repoSlug(context.remote),
    ref: context.sha,
    file: step.file,
    lines: lineRange(context.content, step.locator),
    ...(step.highlight === undefined ? {} : { highlight: step.highlight }),
    ...(step.suggestions === undefined ? {} : { suggestions: step.suggestions }),
  };
}
