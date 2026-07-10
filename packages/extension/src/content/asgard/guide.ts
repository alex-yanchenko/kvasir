// The shared parent both the walkthrough (tour) and the review implement, so the
// panel and chat treat them identically. Chat reads step + background context
// through activeGuide() — never a concrete store — so it behaves the same no
// matter how the panel was opened. The context TEXT pipeline both guides share
// lives in lib/stepText (clamp, step context, background bullets); only the
// polymorphic seams differ per source (revealing a step's code, building "ask
// about this step") and those live on each implementation, not in chat.
import { reviewIdFromUrl } from "../keys";

export interface Guide {
  /** Which source backs the active guide. */
  kind: "walkthrough" | "review";
  /** The current step framed as text for the chat's step-context banner ("" if none). */
  stepContext(): string;
  /** Distilled understanding of the whole PR/review, fed to /ask for grounding. */
  backgroundContext(): string;
  /** Build a selection from the current step and open a chat scoped to it. */
  askAboutStep(): void;
}

/** activeGuide() was asked for a guide whose store module never loaded — an
 * import-graph bug (some entry point reached chat without the stores), not a
 * user-facing state. */
export class GuideUnregisteredError extends Error {
  constructor(kind: Guide["kind"]) {
    super(`no ${kind} guide registered — its store module was never imported`);
    this.name = "GuideUnregisteredError";
  }
}

// The stores register themselves at module eval (tour.ts / review.ts call
// registerGuide) instead of being imported here: chat.ts needs activeGuide()
// while BOTH stores call into chatStore, so importing them from this module
// closes an ESM cycle (chat → guide → tour/review → chat). Every real entry
// point loads the stores (boot imports the launcher and the review loader), so
// the registry is full before anything can ask for a guide.
const guides: Partial<Record<Guide["kind"], Guide>> = {};
export const registerGuide = (guide: Guide): void => {
  guides[guide.kind] = guide;
};

/** The guide backing the current page — review when the URL carries a `?kvasir=<id>`
 * (a pushed review), otherwise the PR walkthrough. */
export function activeGuide(): Guide {
  const kind = reviewIdFromUrl() ? "review" : "walkthrough";
  const guide = guides[kind];
  if (!guide) throw new GuideUnregisteredError(kind);
  return guide;
}
