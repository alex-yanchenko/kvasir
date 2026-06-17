/**
 * The walkthrough spec is the contract between the generator (Claude, in a
 * Claude Code session) and the renderer (the Chrome extension). Claude produces
 * one of these per PR; the extension knows nothing about how it was made.
 *
 * Schema-first: the zod schemas are the single source of truth — the TypeScript
 * types are inferred from them (z.infer) and isWalkthroughSpec validates against
 * them, so the wire contract can't drift from its runtime check. Imported by both
 * the server and the extension.
 */
import { z } from "zod";

export const PrRefSchema = z.object({
  url: z.string(),
  owner: z.string(),
  repo: z.string(),
  number: z.number(),
  title: z.string().optional(),
  /** The PR author's login — stamped server-side at publish from the manifest. */
  author: z.string().optional(),
  headSha: z.string().optional(),
});

export const StepLinesSchema = z.object({
  /** "R" = the new/right side of the diff (added lines), "L" = old/left side. */
  side: z.enum(["R", "L"]),
  start: z.number().int().positive(),
  end: z.number().int().positive(),
});

export const WalkthroughStepSchema = z.object({
  /** Stable id, e.g. "controller-roles". Used by the extension for state. */
  id: z.string(),
  title: z.string(),
  /** Markdown/HTML body — the summary/explanation shown by default. */
  body: z.string(),
  /** Optional deeper, in-depth details revealed when the step is expanded. */
  detail: z.string().optional(),
  /** Repo-relative file path, e.g. "src/middleware/rate-limit.ts". */
  file: z.string(),
  /** GitHub diff anchor: "diff-" + sha256(path). See ./anchor. */
  anchor: z.string(),
  /** Preferred way to highlight — exact line range via GitHub's per-line ids. */
  lines: StepLinesSchema.optional(),
  /** Fallback highlight: substrings to match if line ids aren't available. */
  highlight: z.array(z.string()).optional(),
  /** Quick-hint questions shown as clickable chips for this step. */
  suggestions: z.array(z.string()).optional(),
});

export const WalkthroughSpecSchema = z.object({
  version: z.literal(1),
  pr: PrRefSchema,
  /** Generated-at, for cache display. */
  generatedAt: z.string(),
  /** 2-4 sentence plain-text summary of the whole PR. Not rendered as a step —
   * stored and fed to chat as background so a fresh session understands the PR. */
  overview: z.string().optional(),
  steps: z.array(WalkthroughStepSchema).min(1),
  /** Coverage of the PR's significant changed files by the steps, stamped
   * server-side at publish (never trusted from the model). `significant` =
   * changed files a walkthrough is expected to cover; `uncovered` = those with no
   * step. Absent on pre-coverage cached specs and on non-PR reviews (no diff). */
  coverage: z
    .object({
      significant: z.array(z.string()),
      uncovered: z.array(z.string()),
    })
    .optional(),
});

export type PrRef = z.infer<typeof PrRefSchema>;
export type StepLines = z.infer<typeof StepLinesSchema>;
export type WalkthroughStep = z.infer<typeof WalkthroughStepSchema>;
export type WalkthroughSpec = z.infer<typeof WalkthroughSpecSchema>;

export function isWalkthroughSpec(x: unknown): x is WalkthroughSpec {
  return WalkthroughSpecSchema.safeParse(x).success;
}
