// The shared parent both the walkthrough (tour) and the review implement, so the
// panel and chat treat them identically. Chat reads step + background context
// through activeGuide() — never a concrete store — so it behaves the same no
// matter how the panel was opened. The context TEXT pipeline both guides share
// lives in lib/stepText (clamp, step context, background bullets); only the
// polymorphic seams differ per source (revealing a step's code, building "ask
// about this step") and those live on each implementation, not in chat.
import { reviewIdFromUrl } from "../keys";
import { reviewStore } from "./review";
import { tourStore } from "./tour";

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

/** The guide backing the current page — review when the URL carries a `?kvasir=<id>`
 * (a pushed review), otherwise the PR walkthrough. */
export function activeGuide(): Guide {
  return reviewIdFromUrl() ? reviewStore : tourStore;
}
