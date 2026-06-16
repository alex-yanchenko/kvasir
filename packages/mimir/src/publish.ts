/**
 * The publish_walkthrough decision logic, pure and testable. channel.ts is a Bun
 * entrypoint (MCP wiring + Bun.serve) that can't run under vitest, so anything
 * with a branch belongs here, not trapped inside the tool handler. Given a raw
 * spec + the per-PR state, this decides ONE of: reject (invalid), nudge (a
 * significant file has no step, once), or publish (stamped + ready). The handler
 * just applies the side effects the outcome names (Map writes, logging, throw).
 */
import { prKey, type WalkthroughSpec } from "@prw/runes";
import { COVERAGE_MIN_ADDS, uncoveredFiles, type PrManifest } from "./manifest";
import { parseSpecInput } from "./specInput";

export interface PublishState {
  manifests: Map<string, PrManifest>;
  /** Per-PR count of coverage rejections so far — to nudge at most maxNudges times. */
  nudges: Map<string, number>;
  maxNudges: number;
  /** ISO timestamp to stamp onto the published spec (injected for testability). */
  now: string;
}

export type PublishOutcome =
  | { kind: "invalid"; message: string }
  | { kind: "nudge"; key: string; message: string }
  | { kind: "published"; key: string; spec: WalkthroughSpec; message: string };

export function preparePublish(rawSpec: unknown, state: PublishState): PublishOutcome {
  const result = parseSpecInput(rawSpec);
  if (!result.ok) return { kind: "invalid", message: `spec failed validation — ${result.error}` };

  const spec = result.spec;
  const key = prKey(spec.pr.url);

  // Coverage gate (bounded): if significant changed files have no step, nudge ONCE
  // with the list so the author adds steps, then accept regardless — so a genuinely
  // step-less file (or a stubborn model) can't loop generation forever.
  const manifest = state.manifests.get(key);
  const uncovered = manifest
    ? uncoveredFiles(
        manifest,
        spec.steps.map((step) => step.file),
      )
    : [];
  const nudges = state.nudges.get(key) ?? 0;
  if (uncovered.length > 0 && nudges < state.maxNudges) {
    return {
      kind: "nudge",
      key,
      message:
        `NOT published — coverage check. These changed files have ≥${COVERAGE_MIN_ADDS} added lines but no step:\n` +
        uncovered.map((path) => `  - ${path}`).join("\n") +
        `\n\nAdd steps covering the significant changes in them (see the sizing checklist), then call publish_walkthrough again. ` +
        `If a listed file genuinely needs no step (generated/config/trivial), just call publish_walkthrough again unchanged — it will go through.`,
    };
  }

  // Stamp generatedAt (so clients detect the update) and the PR author from the
  // manifest server-side — the author is not trusted from the model-authored spec.
  const stamped: WalkthroughSpec = {
    ...spec,
    generatedAt: state.now,
    pr: manifest ? { ...spec.pr, author: manifest.author } : spec.pr,
  };
  const coverageNote =
    uncovered.length > 0 ? ` (${uncovered.length} changed file(s) still without a step)` : "";
  return {
    kind: "published",
    key,
    spec: stamped,
    message: `Published ${stamped.steps.length} steps.${coverageNote} Open the PR; the extension will render it.`,
  };
}
