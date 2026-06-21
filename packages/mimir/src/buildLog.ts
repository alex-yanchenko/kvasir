// The shareable "how was this walkthrough built" log. Hybrid: deterministic facts
// the channel already holds (the manifest from start_walkthrough + the published
// spec) plus the session's own rationale passed to record_build_log. Pure assembly
// + the on-disk filename — the IO (write/read under ~/.kvasir/logs) lives in
// channel.ts so this stays unit-testable on Node.
import { prKey, type WalkthroughSpec } from "@kvasir/runes";
import { significantFiles, uncoveredFiles, type PrManifest } from "./manifest";

export interface BuildLogInput {
  pr: string;
  /** What the session actually did — "heavy" or "light" (note a heavy→light fallback). */
  depth: string;
  /** The session's narrative: for heavy, which files/callers/types it read + any
   * correctness concerns; for light, that it was diff-only. */
  rationale: string;
  manifest: PrManifest | null;
  spec: WalkthroughSpec | null;
  now: string;
}

/** Filesystem-safe filename for a PR's build log (prKey has `/` and `#`). */
export function buildLogFileName(pr: string): string {
  return `${prKey(pr).replaceAll(/[^\w.-]+/g, "-")}.md`;
}

/** The change + coverage facts the channel can derive without trusting the session. */
function manifestFacts(manifest: PrManifest, spec: WalkthroughSpec | null, stepCount: number): string[] {
  let additions = 0;
  let deletions = 0;
  for (const file of manifest.files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  const significant = significantFiles(manifest);
  const stepFiles = spec ? spec.steps.map((step) => step.file) : [];
  const uncovered = spec ? uncoveredFiles(manifest, stepFiles) : significant;
  const uncoveredSection =
    uncovered.length > 0
      ? ["**Uncovered significant files:**", ...uncovered.map((path) => `  - ${path}`)]
      : [];
  return [
    `**Change:** ${manifest.files.length} files, +${additions} / -${deletions}`,
    `**Walkthrough:** ${stepCount} steps; covers ${significant.length - uncovered.length}/${significant.length} significant files`,
    ...uncoveredSection,
  ];
}

/** Render the markdown build log a user copies/pastes for a quality review. */
export function composeBuildLog(input: BuildLogInput): string {
  const { pr, depth, rationale, manifest, spec, now } = input;
  const stepCount = spec ? spec.steps.length : 0;
  const heading = manifest ? `${manifest.owner}/${manifest.repo}#${manifest.number}` : pr;
  const facts = manifest
    ? manifestFacts(manifest, spec, stepCount)
    : [
        `**Change:** (no manifest — start_walkthrough was not recorded)`,
        `**Walkthrough:** ${stepCount} steps`,
      ];
  return [
    `## Kvasir build log — ${heading}`,
    `_generated ${now} · depth: ${depth}_`,
    `PR: ${pr}`,
    "",
    ...facts,
    "",
    "### How it was built (session rationale)",
    rationale.trim() || "_(no rationale recorded)_",
    "",
  ].join("\n");
}
