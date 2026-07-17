/**
 * The publish_walkthrough decision logic, pure and testable. channel.ts is a Bun
 * entrypoint (MCP wiring + Bun.serve) that can't run under vitest, so anything
 * with a branch belongs here, not trapped inside the tool handler. Given a raw
 * spec + the per-PR state, this decides ONE of: reject (invalid), nudge (a
 * significant file has no step, once), or publish (stamped + ready). The handler
 * just applies the side effects the outcome names (Map writes, logging, throw).
 */
import { anchorFor, type Depth, prKey, type WalkthroughSpec, type WalkthroughStep } from "@kvasir/runes";
import { locateLines } from "./locateLines";
import { COVERAGE_MIN_ADDS, pathsMatch, significantFiles, uncoveredFiles } from "./manifest";
import type { ManifestStore } from "./manifestStore.sqlite";
import { parseSpecInput } from "./specInput";

export interface PublishState {
  /** Reader over the recorded per-PR manifests. Only `get` is needed here, so a
   * plain Map (tests) and the sqlite-backed store (channel) both satisfy it. */
  manifests: Pick<ManifestStore, "get">;
  /** Reader over the effective depth /generate actually delivered (heavy only when a
   * checkout resolved, else light), keyed like manifests — stamped onto the spec so
   * the panel can show it as a chip. */
  depths: Pick<Map<string, Depth>, "get">;
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
  const manifest = state.manifests.get(key);
  const patchFor = (file: string): string | undefined =>
    manifest?.files.find((changed) => pathsMatch(changed.path, file))?.patch;

  // Server-derive each step's `lines` from its `highlight` against the file's patch
  // (the model authors WHICH code it means; the server owns the line arithmetic).
  const located = spec.steps.map((step) => {
    const patch = patchFor(step.file);
    return { step, patch, lines: locateLines(step.highlight, patch) };
  });

  // Line-target gate (hard): a step whose file HAS a usable patch but whose highlight
  // can't be located opens to nothing — always fixable (copy substrings verbatim from
  // the diff), so reject rather than nudge, no loop risk. A file with no patch — or an
  // empty one (locateLines treats `""` and undefined alike) — can't be derived either
  // way and degrades to a lines-less step rendered at the file anchor, never blocked;
  // the `Boolean(patch)` guard matches locateLines' own `!patch` so the two can't
  // disagree and strand a step in a permanent, unbounded reject.
  const unlocatable = located
    .filter(({ patch, lines }) => !lines && Boolean(patch))
    .map(({ step }) => step.id);
  if (unlocatable.length > 0) {
    return {
      kind: "invalid",
      message: `spec failed validation — each step points at code via its \`highlight\` substrings, which the server locates in the diff to derive the exact line range. These steps' highlight substrings were not found in their file's patch: ${unlocatable.join(", ")}. Set highlight to 2-4 substrings copied VERBATIM (character-for-character) from the changed ('+'/'-') lines of each step's file in the manifest/sidecar.`,
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

  // Coverage gate (bounded): nudge ONCE if a significant file has no step, then accept
  // regardless — so a genuinely step-less file can't loop generation. Line precision is
  // no longer nudged: the server derives `lines` from `highlight` and always lands them
  // inside a changed hunk, so off-target is now structurally impossible.
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
        `NOT published — fix these, then call publish_walkthrough again:\n\n` +
        `These changed files have ≥${COVERAGE_MIN_ADDS} added lines but no step:\n` +
        uncovered.map((path) => `  - ${path}`).join("\n") +
        `\n(If a listed file genuinely needs no step — generated/config/trivial — call publish_walkthrough again unchanged to proceed.)`,
    };
  }

  // Stamp generatedAt (so clients detect the update) and the PR author from the
  // manifest server-side — the author is not trusted from the model-authored spec.
  const depth = state.depths.get(key);
  // GitHub anchors each file's diff as `diff-<sha256(path)>`. Derive every step's
  // anchor server-side from its file — the model-authored anchor is never trusted.
  // The schema only checks it's a string, so a truncated/mistyped value would pass
  // validation yet make the extension's getElementById(anchor) miss, silently
  // no-oping every step's jump-to-code. Prefer the manifest's recorded anchor for the
  // file (authoritative, and correct for renames where the diff anchor isn't
  // sha256 of the current path); fall back to deriving it from the path when there is
  // no manifest (the manual build path).
  const resolveAnchor = (file: string): string =>
    manifest?.files.find((changed) => pathsMatch(changed.path, file))?.anchor ?? anchorFor(file);
  // Stamp the server-derived anchor and lines onto each step, replacing whatever the
  // model sent (both are server-owned facts). A step with no derivable range (patch-less
  // file) ships without lines — the extension renders it at the file anchor.
  const stampStep = ({ step, lines }: (typeof located)[number]): WalkthroughStep => {
    const next: WalkthroughStep = { ...step, anchor: resolveAnchor(step.file) };
    if (lines) next.lines = lines;
    else delete next.lines;
    return next;
  };
  const stamped: WalkthroughSpec = {
    ...spec,
    generatedAt: state.now,
    pr: manifest ? { ...spec.pr, author: manifest.author } : spec.pr,
    steps: located.map((entry) => stampStep(entry)),
    // Coverage is meaningful only against a diff manifest — omit it (rather than
    // stamp empty arrays) when start_walkthrough wasn't recorded, so the panel
    // can tell "fully covered" from "unknown".
    ...(manifest ? { coverage: { significant: significantFiles(manifest), uncovered } } : {}),
    // Depth mirrors coverage's absence semantics: no recorded /generate request
    // (restart, manual publish) → no chip, not a guessed default.
    ...(depth ? { depth } : {}),
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
