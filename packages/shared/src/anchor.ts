import { createHash } from "node:crypto";

/**
 * GitHub anchors each file's diff on the PR "Files changed" page as
 * `diff-<sha256(path)>`. Computing it locally lets us deep-link into the PR and
 * (in the extension) scroll/highlight by element id instead of brittle text matching.
 */
export function anchorFor(path: string): string {
  return "diff-" + createHash("sha256").update(path).digest("hex");
}
