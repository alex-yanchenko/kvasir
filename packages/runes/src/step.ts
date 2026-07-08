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

/** Fields every guide step carries, regardless of how its code is located. */
export const StepCoreSchema = z.object({
  /** Stable id, e.g. "controller-roles". Used by the extension for state. */
  id: z.string(),
  title: z.string(),
  /** Markdown/HTML body — the summary/explanation shown by default. */
  body: z.string(),
  /** Optional deeper, in-depth details revealed when the step is expanded. */
  detail: z.string().optional(),
  /** Repo-relative file path, e.g. "src/middleware/rate-limit.ts". Artifacts
   * whose file interpolates into a URL (blob steps) override this with a
   * traversal-guarded refinement. */
  file: z.string(),
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
