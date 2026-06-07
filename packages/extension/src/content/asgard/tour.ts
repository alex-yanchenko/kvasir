// The walkthrough tour machine — Asgard-owned. The card is a React component;
// this holds the step state, the page commands (highlight + grip context), the
// per-PR persistence, and the "ask about this step" payload. Ported verbatim
// from the vanilla tour.
import type { WalkthroughStep } from "@prw/runes/spec";
import { bifrost } from "../bifrost";
import { onFilesTab, prUrl, tourKey } from "../keys";
import { stepCode } from "../midgard/midgard";
import { storeSet } from "../muninn";
import { state } from "./store";
import { touch } from "./store";
// chat.ts imports tourStore.stepContext and we call chatStore here — a runtime-
// safe ESM cycle: both references happen inside functions, never at module eval.
import { chatStore } from "./chat";

let open = false;
let stepIdx = 0;

const clamp = (i: number, len: number): number => Math.min(Math.max(i, 0), len - 1);

const strip = (h: string | undefined): string =>
  (h || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const tourStore = {
  open: (): boolean => open,
  stepIdx: (): number => stepIdx,
  stepCount: (): number => state.spec?.steps.length ?? 0,
  step: (): WalkthroughStep | null => (open && state.spec ? state.spec.steps[stepIdx] : null),

  start(): void {
    if (!state.spec) return;
    if (!onFilesTab()) {
      // Hop to the diff tab and auto-resume once it loads.
      sessionStorage.setItem("prwAutoStart", "1");
      location.href = prUrl() + "/files";
      return;
    }
    open = true;
    this.goto(state.tourState.step || 0); // resume where you left off
  },

  goto(idx: number): void {
    if (!state.spec) return;
    stepIdx = clamp(idx, state.spec.steps.length);
    state.tourState = { ...state.tourState, step: stepIdx }; // remember where we are
    storeSet(tourKey(prUrl()), state.tourState);
    const s = state.spec.steps[stepIdx];
    state.activeStep = s; // current step → available as chat context
    bifrost.send("grip:context", { hasActiveStep: true });
    bifrost.send("highlight:step", {
      anchor: s.anchor,
      lines: s.lines ?? null,
      highlight: s.highlight ?? null,
    });
    touch();
  },

  /** The footer button: advances, or finishes (closes) on the last step. */
  next(): void {
    if (state.spec && stepIdx < state.spec.steps.length - 1) this.goto(stepIdx + 1);
    else this.close();
  },
  back(): void {
    if (stepIdx > 0) this.goto(stepIdx - 1);
  },

  /** Re-open from the first step after the walkthrough was finished. */
  restart(): void {
    open = true;
    this.goto(0);
  },

  close(): void {
    open = false;
    bifrost.send("highlight:clear", undefined);
    state.activeStep = null;
    bifrost.send("grip:context", { hasActiveStep: false });
    touch();
  },

  /** Compact text of the current step — passed to chat so answers are framed by it. */
  stepContext(): string {
    if (!state.activeStep) return "";
    const s = state.activeStep;
    const where = s.file ? ` (${s.file}${s.lines ? `:${s.lines.start}-${s.lines.end}` : ""})` : "";
    return `Step: ${s.title}${where}\n${strip(s.body)}${s.detail ? "\n" + strip(s.detail) : ""}`;
  },

  /** "Ask about this step": build a selection payload for the step's own code
   * (live rows when rendered; highlight/body text otherwise) and open a chat
   * framed by the step's context. */
  askAboutStep(): void {
    const s = state.activeStep;
    if (!s) return;
    const page = stepCode({ anchor: s.anchor, lines: s.lines ?? null });
    const text =
      page?.text || (s.highlight || []).join("\n") || (s.body || "").replace(/<[^>]+>/g, "").slice(0, 1000);
    const rect = page?.rect ?? { left: 60, top: 90, bottom: 114, height: 24 };
    chatStore.openSelection(
      {
        selectionId: `${s.file}::${text.slice(0, 200)}`,
        file: s.file,
        text,
        lines: s.lines ?? null,
        rect,
      },
      true,
    );
  },
};
