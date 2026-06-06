import type { WalkthroughSpec, WalkthroughStep } from "@prw/runes/spec";
import type { ChatSession } from "./asgard/types";

export interface TourState {
  step: number;
  pos: { left: number; top: number } | null;
  size: { w: number; h: number } | null;
}

// Mutable state shared across the content-script UI modules (tour, selection,
// chat, launcher) and the content.js shell. A single object because ESM import
// bindings can't be reassigned — but object properties can, so every importer
// sees the same live values.
export const state: {
  spec: WalkthroughSpec | null;
  activeStep: WalkthroughStep | null;
  theme: string; // "auto" | "light" | "dark"
  hlStyle: string; // "tint" | "github"
  tourState: TourState;
  chatHistory: ChatSession[]; // session objects, most recent first
} = {
  spec: null,
  activeStep: null,
  theme: localStorage.getItem("prwTheme") || "auto",
  hlStyle: localStorage.getItem("prwHl") || "tint",
  tourState: { step: 0, pos: null, size: null },
  chatHistory: [],
};
