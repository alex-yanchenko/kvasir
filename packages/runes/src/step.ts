/**
 * The step core shared by BOTH guide artifacts. A PR-diff walkthrough step
 * (spec.ts) and a pushed cross-repo review step (review.ts) differ ONLY in how
 * they locate code on GitHub — a diff anchor vs a repo+ref blob — so everything
 * the reader consumes (title, prose, hints) is one shape, defined once here and
 * extended with locator fields by each artifact. A future locator strategy
 * (e.g. an arbitrary base..compare DiffSource) is one more extension of this
 * core, not a third parallel step contract.
 */
import { z } from "zod";

/** No "." / ".." / empty path segment — blocks "../" traversal out of the repo
 * when the value is interpolated into a github.com URL (mirrors the guard
 * parsePrUrl applies to PR URLs). Shared by the core `file` and the blob
 * locator's `ref`. */
export const noTraversal = (value: string): boolean =>
  !value.split("/").some((segment) => [".", "..", ""].includes(segment));

/** Fields every guide step carries, regardless of how its code is located. */
export const StepCoreSchema = z.object({
  /** Stable id, e.g. "controller-roles" or "auth-guard". The walkthrough keys
   * extension state off it (visited dots, the step chat); the review artifact
   * carries it for identity but reads it only server-side. */
  id: z.string(),
  title: z.string(),
  /** Markdown/HTML body — the summary/explanation shown by default. */
  body: z.string(),
  /** Optional deep-dive details revealed when the step is expanded. */
  detail: z.string().optional(),
  /** Repo-relative file path, e.g. "src/middleware/rate-limit.ts". Traversal-guarded
   * in the CORE, fail closed: git itself forbids "."/".."/empty path segments, so no
   * legitimate step is rejected — and a locator whose file interpolates into a URL
   * (blob steps, any future base..compare locator) can't forget the guard. */
  file: z.string().refine(noTraversal, "file must not contain '.'/'..' path segments"),
  /** Fallback highlight: substrings to match if line ids aren't available. */
  highlight: z.array(z.string()).optional(),
  /** Quick-hint questions shown as clickable chips for this step. */
  suggestions: z.array(z.string()).optional(),
});

/** A 1-based inclusive line range — locators compose these fields (the diff
 * locator adds a side; the blob locator adds nothing) and apply the shared
 * ordering refinement, so every locator's range validates identically. */
export const LINE_RANGE_FIELDS = {
  start: z.number().int().positive(),
  end: z.number().int().positive(),
};

export const orderedRange = (range: { start: number; end: number }): boolean => range.start <= range.end;

export const ORDERED_RANGE_MESSAGE = { message: "start must be <= end" };
