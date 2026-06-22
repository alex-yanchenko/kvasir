/**
 * The publish_walkthrough decision logic, pure and testable. channel.ts is a Bun
 * entrypoint (MCP wiring + Bun.serve) that can't run under vitest, so anything
 * with a branch belongs here, not trapped inside the tool handler. Given a raw
 * spec + the per-PR state, this decides ONE of: reject (invalid), nudge (a
 * significant file has no step, once), or publish (stamped + ready). The handler
 * just applies the side effects the outcome names (Map writes, logging, throw).
 */
import { prKey, type WalkthroughSpec } from "@kvasir/runes";
import {
  COVERAGE_MIN_ADDS,
  significantFiles,
  stepsOffTarget,
  uncoveredFiles,
  type PrManifest,
} from "./manifest";
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

  // Line-target gate (hard): a step with no `lines` opens to nothing in the panel —
  // it can't highlight or scroll to code. Always fixable from the patch (no legit
  // step lacks a line range), so reject rather than nudge — there's no loop risk.
  const missingLines = spec.steps.filter((step) => !step.lines).map((step) => step.id);
  if (missingLines.length > 0) {
    return {
      kind: "invalid",
      message: `spec failed validation — every step must set lines:{side,start,end} (read from the @@ patch headers) so it highlights code; without them the step opens to nothing. Steps with no lines: ${missingLines.join(", ")}.`,
    };
  }

  // Overview gate (hard): every PR walkthrough opens with an Overview "step 0" so the
  // reader gets the "what is this" without reading the PR description. The schema keeps
  // it optional (the manual `kvasir build` path produces specs without one); this gate
  // only applies on the publish_walkthrough path.
  if (!spec.overview?.trim()) {
    return {
      kind: "invalid",
      message: `spec failed validation — set overview to a 2-4 sentence HTML summary of the PR (same markup as a step body; it's shown as the walkthrough's Overview step and fed to chat as context).`,
    };
  }

  // Coverage + on-target gate (bounded): nudge ONCE if a significant file has no step
  // OR a step's lines miss their file's changed hunks, then accept regardless — so a
  // genuinely step-less file (or imperfect line precision) can't loop generation.
  const manifest = state.manifests.get(key);
  const uncovered = manifest
    ? uncoveredFiles(
        manifest,
        spec.steps.map((step) => step.file),
      )
    : [];
  const offTarget = manifest ? stepsOffTarget(manifest, spec.steps) : [];
  const nudges = state.nudges.get(key) ?? 0;
  if ((uncovered.length > 0 || offTarget.length > 0) && nudges < state.maxNudges) {
    const sections: string[] = [];
    if (uncovered.length > 0) {
      sections.push(
        `These changed files have ≥${COVERAGE_MIN_ADDS} added lines but no step:\n` +
          uncovered.map((path) => `  - ${path}`).join("\n") +
          `\n(If a listed file genuinely needs no step — generated/config/trivial — call publish_walkthrough again unchanged to proceed.)`,
      );
    }
    if (offTarget.length > 0) {
      sections.push(
        `These steps' lines fall outside their file's changed hunks (re-read the @@ -a,b +c,d @@ headers and set lines inside a changed hunk):\n` +
          offTarget.map((step) => `  - ${step.id} (${step.file})`).join("\n") +
          `\n(If a step's lines are already as precise as the patch allows, call publish_walkthrough again unchanged to proceed.)`,
      );
    }
    return {
      kind: "nudge",
      key,
      message: `NOT published — fix these, then call publish_walkthrough again:\n\n` + sections.join("\n\n"),
    };
  }

  // Stamp generatedAt (so clients detect the update) and the PR author from the
  // manifest server-side — the author is not trusted from the model-authored spec.
  const stamped: WalkthroughSpec = {
    ...spec,
    generatedAt: state.now,
    pr: manifest ? { ...spec.pr, author: manifest.author } : spec.pr,
    // Coverage is meaningful only against a diff manifest — omit it (rather than
    // stamp empty arrays) when start_walkthrough wasn't recorded, so the panel
    // can tell "fully covered" from "unknown".
    ...(manifest ? { coverage: { significant: significantFiles(manifest), uncovered } } : {}),
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
