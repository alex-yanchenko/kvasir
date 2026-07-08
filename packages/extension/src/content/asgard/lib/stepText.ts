// One text pipeline for BOTH guides (the PR tour and the pushed review): how a
// step index clamps, how a step becomes chat context, and how a whole guide
// becomes /ask background. The guides differ only in the location they cite
// (file vs owner/repo/file) — callers pass that in as `where`. The genuinely
// polymorphic seams (revealing a step's code, "ask about this step") stay on
// each store; see guide.ts.
import { stripHtml } from "./strip";

export const clampIndex = (index: number, length: number): number => Math.min(Math.max(index, 0), length - 1);

/** " (src/a.ts:4-6)"-style location suffix; "" when there is no path to cite. */
export const whereText = (path: string, lines: { start: number; end: number } | null | undefined): string => {
  if (!path) return "";
  const range = lines ? `:${lines.start}-${lines.end}` : "";
  return ` (${path}${range})`;
};

/** Compact text of one step for the chat's step-context banner. */
export const stepContextText = (step: {
  title: string;
  where: string;
  body: string;
  detail?: string | undefined;
}): string =>
  `Step: ${step.title}${step.where}\n${stripHtml(step.body)}${
    step.detail ? "\n" + stripHtml(step.detail) : ""
  }`;

/** Distilled plain-text of a whole guide (header + bulleted steps), capped so a
 * fresh session gets grounding without blowing the /ask budget. */
export const guideBackgroundText = (
  head: string,
  steps: Array<{ title: string; where: string; body: string }>,
): string => {
  const bullets = steps.map((step) => `• ${step.title}${step.where}\n  ${stripHtml(step.body)}`).join("\n");
  return (head + bullets).slice(0, 12_000);
};
