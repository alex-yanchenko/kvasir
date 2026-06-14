// The walkthrough tour machine — Asgard-owned. The card is a React component;
// this holds the step state, the page commands (highlight + grip context), the
// per-PR persistence, and the "ask about this step" payload. Ported verbatim
// from the vanilla tour.
import type { WalkthroughStep } from "@prw/runes/spec";
import { bifrost } from "../bifrost";
import { onFilesTab, prUrl, tourKey } from "../keys";
import { stepCode } from "../midgard/diff";
import { storeSet } from "../muninn";
import { chatStore } from "./chat";
import { state, touch } from "./store";
// chat.ts imports tourStore.stepContext and we call chatStore here — a runtime-
// safe ESM cycle: both references happen inside functions, never at module eval.

let open = false;
let stepIndex = 0;

const clamp = (index: number, length: number): number => Math.min(Math.max(index, 0), length - 1);

const strip = (h: string | undefined): string =>
  (h || "")
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();

export const tourStore = {
  kind: "walkthrough" as const,
  open: (): boolean => open,
  stepIndex: (): number => stepIndex,
  stepCount: (): number => state.spec?.steps.length ?? 0,
  step: (): WalkthroughStep | null => (open && state.spec ? (state.spec.steps[stepIndex] ?? null) : null),

  start(): void {
    if (!state.spec) return;
    if (!onFilesTab()) {
      // Hop to the diff tab and auto-resume once it loads.
      sessionStorage.setItem("prwAutoStart", "1");
      location.href = prUrl() + "/files";
      return;
    }
    open = true;
    tourStore.goto(state.tourState.step || 0); // resume where you left off
  },

  goto(index: number): void {
    if (!state.spec) return;
    stepIndex = clamp(index, state.spec.steps.length);
    state.tourState = { ...state.tourState, step: stepIndex }; // remember where we are
    storeSet(tourKey(prUrl()), state.tourState);
    const s = state.spec.steps[stepIndex];
    if (!s) return; // empty spec / out-of-range — nothing to highlight
    state.activeStep = s; // current step → available as chat context
    bifrost.send("grip:context", { hasActiveStep: true });
    bifrost.send("highlight:step", {
      anchor: s.anchor,
      lines: s.lines ?? null,
      highlight: s.highlight ?? null,
    });
    touch();
  },

  /** Advance to the next step; a no-op on the last (the Next control is disabled). */
  next(): void {
    if (state.spec && stepIndex < state.spec.steps.length - 1) tourStore.goto(stepIndex + 1);
  },
  back(): void {
    if (stepIndex > 0) tourStore.goto(stepIndex - 1);
  },

  close(): void {
    open = false;
    bifrost.send("highlight:clear", undefined);
    state.activeStep = null;
    bifrost.send("grip:context", { hasActiveStep: false });
    touch();
  },

  /** Distilled plain-text view of the whole walkthrough (overview + steps), sent
   * to /ask so even a fresh session understands the PR. */
  backgroundContext(): string {
    if (!state.spec) return "";
    const head = state.spec.overview
      ? `Overview: ${state.spec.overview.replaceAll(/\s+/g, " ").trim()}\n\n`
      : "";
    const steps = state.spec.steps
      .map((st) => {
        const lineSuffix = st.lines ? `:${st.lines.start}-${st.lines.end}` : "";
        const where = st.file ? ` (${st.file}${lineSuffix})` : "";
        const body = st.body
          .replaceAll(/<[^>]+>/g, "")
          .replaceAll(/\s+/g, " ")
          .trim();
        return `• ${st.title}${where}\n  ${body}`;
      })
      .join("\n");
    return (head + steps).slice(0, 12_000);
  },

  /** Compact text of the current step — passed to chat so answers are framed by it. */
  stepContext(): string {
    if (!state.activeStep) return "";
    const s = state.activeStep;
    const lineSuffix = s.lines ? `:${s.lines.start}-${s.lines.end}` : "";
    const where = s.file ? ` (${s.file}${lineSuffix})` : "";
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
      page?.text ||
      (s.highlight ?? []).join("\n") ||
      (s.body || "").replaceAll(/<[^>]+>/g, "").slice(0, 1000);
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
