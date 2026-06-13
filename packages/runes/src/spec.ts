/**
 * The walkthrough spec is the contract between the generator (Claude, in a
 * Claude Code session) and the renderer (the Chrome extension). Claude produces
 * one of these per PR; the extension knows nothing about how it was made.
 *
 * Keep this file dependency-free — it's imported by both the server and the
 * extension, so it should stay plain types + a tiny validator.
 */

export interface PrRef {
  url: string;
  owner: string;
  repo: string;
  number: number;
  title?: string;
  headSha?: string;
}

export interface StepLines {
  /** "R" = the new/right side of the diff (added lines), "L" = old/left side. */
  side: "R" | "L";
  start: number;
  end: number;
}

export interface WalkthroughStep {
  /** Stable id, e.g. "controller-roles". Used by the extension for state. */
  id: string;
  title: string;
  /** Markdown/HTML body — the summary/explanation shown by default. */
  body: string;
  /** Optional deeper, in-depth details revealed when the step is expanded. */
  detail?: string;
  /** Repo-relative file path, e.g. "src/middleware/rate-limit.ts". */
  file: string;
  /** GitHub diff anchor: "diff-" + sha256(path). See ./anchor. */
  anchor: string;
  /** Preferred way to highlight — exact line range via GitHub's per-line ids. */
  lines?: StepLines;
  /** Fallback highlight: substrings to match if line ids aren't available. */
  highlight?: string[];
  /** Quick-hint questions shown as clickable chips for this step. */
  suggestions?: string[];
}

export interface WalkthroughSpec {
  version: 1;
  pr: PrRef;
  /** Generated-at, for cache display. */
  generatedAt: string;
  /** 2-4 sentence plain-text summary of the whole PR. Not rendered as a step —
   * stored and fed to chat as background so a fresh session understands the PR. */
  overview?: string;
  steps: WalkthroughStep[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function isWalkthroughSpec(x: unknown): x is WalkthroughSpec {
  if (!isRecord(x)) return false;
  if (x.version !== 1) return false;
  if (!isRecord(x.pr) || typeof x.pr.url !== "string") return false;
  if (!Array.isArray(x.steps)) return false;
  return x.steps.every(
    (st) =>
      isRecord(st) &&
      typeof st.id === "string" &&
      typeof st.file === "string" &&
      typeof st.anchor === "string",
  );
}
